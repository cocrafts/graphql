import {
	ApiGatewayManagementApiClient,
	DeleteConnectionCommand,
	PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import type { APIGatewayProxyWebsocketHandlerV2 } from 'aws-lambda';
import {
	CloseCode,
	MessageType,
	parseMessage,
	stringifyMessage,
	handleProtocols,
	areGraphQLErrors,
} from 'graphql-ws';
import type {
	ServerOptions,
	Context as GraphQLWSContext,
	ExecutionResult,
	Message,
	SubscribeMessage,
} from 'graphql-ws';
import type { ExecutionArgs } from 'graphql';
import {
	GraphQLError,
	getOperationAST,
	parse as graphqlParse,
	validate as graphqlValidate,
	execute as graphqlExecute,
} from 'graphql';

import type {
	WsAdapterOptions,
	AWSGraphQLRouteHandler,
	GraphQLWsAdapterContext,
	Socket,
	Storage,
} from '../interface';
import {
	createConsoleLogger,
	isAWSBaseEvent,
	isRegistrableChannel,
	key,
} from '../utils';
import { GraphQLLambdaPubsub } from '../pubsub';
import { customSubscribe } from './graphql';

export function GraphQLLambdaWsAdapter({
	storage,
	gateway,
	pubsub,
	logger = createConsoleLogger(),
	customRouteHandler,
	...options
}: WsAdapterOptions): APIGatewayProxyWebsocketHandlerV2 {
	if (!(pubsub instanceof GraphQLLambdaPubsub)) {
		throw Error('GraphQL Lambda adapter requires GraphQLLambdaPubsub');
	}

	return async (event, ctx) => {
		const connectionId = event.requestContext.connectionId;
		const socket = createSocket(gateway, storage, connectionId);

		// A wrapped context for handler
		const context: GraphQLWsAdapterContext = {
			...ctx,
			storage,
			socket,
			pubsub,
			logger,
			options,
		};

		switch (event.requestContext.eventType) {
			case 'CONNECT': {
				const result = await handleConnect(context, event);
				if (result) return result;
				break;
			}
			case 'DISCONNECT': {
				const result = await handleDisconnect(context, event);
				if (result) return result;
				break;
			}
			case 'MESSAGE': {
				if (event.requestContext.routeKey === '$default') {
					const result = await handleMessage(context, event);
					if (result) return result;
					break;
				}

				if (customRouteHandler) {
					const result = await customRouteHandler?.(event, ctx);
					if (result) return result;
				}
			}
		}

		return { statusCode: 200 };
	};
}

/**
 * Handle the `CONNECT` event, establish connection or abort the handshake.
 */
const handleConnect: AWSGraphQLRouteHandler = async ({ socket }, event) => {
	if (isAWSBaseEvent(event)) {
		const subprotocols: string[] =
			event.multiValueHeaders['Sec-WebSocket-Protocol'] ?? [];
		const supportedProtocol = handleProtocols(subprotocols);

		if (supportedProtocol) {
			// Initiate persistent context for later message handling
			await socket.createContext({
				connectionInitReceived: false,
				acknowledged: false,
				subscriptions: {},
				extra: { ...event.requestContext },
			} satisfies GraphQLWSContext);

			return Promise.resolve({
				statusCode: 200,
				headers: {
					'Sec-WebSocket-Protocol': supportedProtocol,
				},
			});
		}

		return {
			statusCode: 400,
			body: JSON.stringify({
				error: 'Subprotocol not acceptable',
				message:
					'The requested WebSocket subprotocol is not supported by this server',
				supportedProtocol,
			}),
		};
	}
};

/**
 * Handle `DISCONNECT`, equivalent to `socket.closed` implemented in `vendor/graphql-ws/src/server.ts`
 */
const handleDisconnect: AWSGraphQLRouteHandler = async (
	{ socket, storage, pubsub, options },
	event,
) => {
	const unsafeContext = event.requestContext as any;
	const code = unsafeContext['disconnectStatusCode'] ?? 1001;
	const reason = unsafeContext['disconnectReason'] ?? 'Going away';

	const connectionId = event.requestContext.connectionId;

	// Get subscriptions before cleaning up by `pubsub.disconnect`
	const subscriptions = await pubsub.getConnectionSubscriptions(connectionId);

	// Disconnect all subscriptions in pubsub
	await pubsub.disconnect(connectionId);

	const ctx = await socket.context();

	if (options.onComplete) {
		const completePromises = subscriptions.map(async subscriptionId => {
			const rawPayload = await storage.get(key.subPayload(subscriptionId));
			if (!rawPayload) {
				throw Error('Subscription payload is missing to handle disconnect');
			}

			const payload = JSON.parse(rawPayload);
			await options.onComplete?.(ctx, subscriptionId, payload);
		});

		await Promise.all(completePromises);
	}

	if (ctx.acknowledged) await options.onDisconnect?.(ctx, code, reason);

	await options.onClose?.(ctx, code, reason);

	return { statusCode: 200 };
};

const handleMessage: AWSGraphQLRouteHandler = async (
	{ socket, storage, pubsub, options },
	event,
) => {
	let message: Message;
	try {
		message = parseMessage(event.body, options.jsonMessageReviver);
	} catch (error) {
		await socket.close(CloseCode.BadRequest, 'Invalid message received');
		return;
	}

	switch (message.type) {
		case MessageType.ConnectionInit: {
			const ctx = await socket.context();
			if (ctx.connectionInitReceived) {
				return await socket.close(
					CloseCode.TooManyInitialisationRequests,
					'Too many initialisation requests',
				);
			}

			const permittedOrPayload = await options.onConnect?.(ctx);
			if (permittedOrPayload === false) {
				return await socket.close(CloseCode.Forbidden, 'Forbidden');
			}

			await socket.updateContext({
				acknowledged: true,
				connectionInitReceived: true,
				connectionParams: message.payload,
			});

			await socket.send(
				stringifyMessage<MessageType.ConnectionAck>(
					typeof permittedOrPayload === 'object'
						? { type: MessageType.ConnectionAck, payload: permittedOrPayload }
						: { type: MessageType.ConnectionAck },
					options.jsonMessageReplacer,
				),
			);

			break;
		}
		case MessageType.Ping: {
			await socket.send(
				stringifyMessage<MessageType.Pong>(
					message.payload
						? { type: MessageType.Pong, payload: message.payload }
						: { type: MessageType.Pong },
					options.jsonMessageReplacer,
				),
			);

			break;
		}
		case MessageType.Pong: {
			// Nothing to handle
			break;
		}
		case MessageType.Subscribe: {
			const ctx = await socket.context();
			if (!ctx.acknowledged) {
				return await socket.close(CloseCode.Unauthorized, 'Unauthorized');
			}

			const { id, payload } = message;

			let isSubscribed = await pubsub.isRegistered(id);
			if (isSubscribed) {
				return await socket.close(
					CloseCode.SubscriberAlreadyExists,
					`Subscriber for ${id} already exists`,
				);
			}

			// Store message payload to handle with `onComplete` from disconnect event
			// or complete message from client in another runtimes
			await storage.set(key.subPayload(id), JSON.stringify(payload));

			const emit = createSubscriptionEmitter(options, socket);

			try {
				let execArgs: ExecutionArgs;
				const maybeExecArgsOrErrors = await options.onSubscribe?.(
					ctx,
					message.id,
					message.payload,
				);
				if (maybeExecArgsOrErrors) {
					if (areGraphQLErrors(maybeExecArgsOrErrors)) {
						return await emit.error(maybeExecArgsOrErrors, message);
					} else if (Array.isArray(maybeExecArgsOrErrors)) {
						throw new Error(
							'Invalid return value from onSubscribe hook, \
                            expected an array of GraphQLError objects',
						);
					}

					execArgs = maybeExecArgsOrErrors;
				} else {
					if (!options.schema) {
						throw new Error('The GraphQL schema is not provided');
					}

					const args = {
						operationName: payload.operationName,
						document: graphqlParse(payload.query),
						variableValues: payload.variables,
					};

					const schema =
						typeof options.schema === 'function'
							? await options.schema(ctx, id, payload, args)
							: options.schema;

					execArgs = { ...args, schema };

					const validate = options.validate ?? graphqlValidate;
					const validationErrors = validate(execArgs.schema, execArgs.document);
					if (validationErrors.length > 0) {
						return emit.error(validationErrors, message);
					}
				}

				const operationAST = getOperationAST(
					execArgs.document,
					execArgs.operationName,
				);
				if (!operationAST) {
					return await emit.error(
						[new GraphQLError('Unable to identify operation')],
						message,
					);
				}

				// if `onSubscribe` didn't specify a rootValue, inject one
				if (!('rootValue' in execArgs)) {
					execArgs.rootValue = options.roots?.[operationAST.operation];
				}

				// if `onSubscribe` didn't specify a context, inject one
				if (!('contextValue' in execArgs)) {
					execArgs.contextValue =
						typeof options.context === 'function'
							? await options.context(ctx, id, payload, execArgs)
							: options.context;
				}

				let operationResult;
				if (operationAST.operation === 'subscription') {
					const subscribe = options.subscribe ?? customSubscribe;
					operationResult = await subscribe(execArgs);
				} else {
					const execute = options.execute ?? graphqlExecute;
					operationResult = await execute(execArgs);
				}

				if (isRegistrableChannel(operationResult)) {
					// register the subscription via returned channel of the supported pubsub
					await operationResult.register(event.requestContext.connectionId, id);
					break;
				} else {
					// Single emitted result that can be errors in execution
					await emit.next(operationResult as any, message, execArgs);
					await emit.complete(id in ctx.subscriptions, message);
				}
			} catch (error) {
				await socket.close(CloseCode.InternalServerError);
				throw error;
			}

			break;
		}
		case MessageType.Complete: {
			const connectionId = event.requestContext.connectionId;
			const subscriptionId = message.id;

			// Unregister from pubsub to prevent receiving new data from topic
			await pubsub.unregister(connectionId, subscriptionId);

			const [ctx, rawPayload] = await Promise.all([
				socket.context(),
				storage.get(key.subPayload(subscriptionId)),
			]);

			if (!rawPayload) {
				throw Error('Subscription payload is missing to handle complete');
			}

			const payload = JSON.parse(rawPayload);

			await options.onComplete?.(ctx, subscriptionId, payload);
		}
	}
};

const createSocket = (
	gateway: ApiGatewayManagementApiClient,
	storage: Storage,
	connectionId: string,
): Socket => {
	const ctxKey = key.connCtx(connectionId);
	let ctx: GraphQLWSContext;
	let ctxPromise: Promise<GraphQLWSContext> | undefined;
	let isCtxUpdating = false;

	const queryContext = async () => {
		if (!ctxPromise) {
			ctxPromise = storage
				.get(ctxKey)
				.then(rawCtx => {
					if (!rawCtx) {
						throw Error('AWS GraphQL Websocket Context is not available');
					}

					return JSON.parse(rawCtx);
				})
				.finally(() => {
					ctxPromise = undefined;
				});
		}

		return ctxPromise;
	};

	return {
		context: async () => {
			if (!ctx) ctx = await queryContext();

			return ctx;
		},
		updateContext: async data => {
			if (isCtxUpdating) {
				// context update is internally called, shouldn't be in concurrent
				throw Error('Can not update socket context concurrently');
			}

			try {
				isCtxUpdating = true;
				if (!ctx) ctx = await queryContext();

				ctx = { ...ctx, ...data };
				await storage.set(ctxKey, JSON.stringify(ctx));

				return ctx;
			} finally {
				isCtxUpdating = false;
			}
		},
		createContext: async data => {
			await storage.set(ctxKey, JSON.stringify(data));
			ctx = data;

			return ctx;
		},
		close: async (code?: number, reason?: string) => {
			// Send a close event to client, to mimic the close action of a Websocket server
			await gateway.send(
				new PostToConnectionCommand({
					ConnectionId: connectionId,
					Data: JSON.stringify({ type: 'close', code, reason }),
				}),
			);

			await gateway.send(
				new DeleteConnectionCommand({
					ConnectionId: connectionId,
				}),
			);
		},
		send: async data => {
			await gateway.send(
				new PostToConnectionCommand({
					ConnectionId: connectionId,
					Data: typeof data === 'string' ? data : JSON.stringify(data),
				}),
			);
		},
	};
};

const createSubscriptionEmitter = (options: ServerOptions, socket: Socket) => {
	const next = async (
		result: ExecutionResult,
		{ id, payload }: SubscribeMessage,
		args: ExecutionArgs,
	) => {
		const { errors, ...resultWithoutErrors } = result;

		const ctx = await socket.context();
		const maybeResult = await options.onNext?.(ctx, id, payload, args, result);

		await socket.send(
			stringifyMessage<MessageType.Next>(
				{
					id,
					type: MessageType.Next,
					payload: maybeResult || {
						...resultWithoutErrors,
						// omit errors completely if not defined
						...(errors ? { errors: errors.map(e => e.toJSON()) } : {}),
					},
				},
				options.jsonMessageReplacer,
			),
		);
	};

	const error = async (
		errors: readonly GraphQLError[],
		{ id, payload }: SubscribeMessage,
	) => {
		const ctx = await socket.context();
		const maybeErrors = await options.onError?.(ctx, id, payload, errors);

		await socket.send(
			stringifyMessage<MessageType.Error>(
				{
					id,
					type: MessageType.Error,
					payload: maybeErrors || errors.map(e => e.toJSON()),
				},
				options.jsonMessageReplacer,
			),
		);
	};

	/**
	 * This complete function is supposed to be called if:
	 * - the subscription execution return single object
	 * - the async iterator of execution return done
	 *
	 * How about called when disconnect???
	 */
	const complete = async (
		notifyClient: boolean,
		{ id, payload }: SubscribeMessage,
	) => {
		const ctx = await socket.context();
		await options.onComplete?.(ctx, id, payload);

		if (notifyClient) {
			await socket.send(
				stringifyMessage<MessageType.Complete>(
					{ id, type: MessageType.Complete },
					options.jsonMessageReplacer,
				),
			);
		}
	};

	return { next, error, complete };
};
