import type { APIGatewayProxyWebsocketHandlerV2 } from 'aws-lambda';
import {
	handleProtocols,
	type ServerOptions,
	type Context as GraphQLWSContext,
	areGraphQLErrors,
} from 'graphql-ws/server';
import {
	ApiGatewayManagementApiClient,
	DeleteConnectionCommand,
	PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import type {
	AdapterOptions,
	AWSGraphQLRouteHandler,
	GraphQLAdapterContext,
	Socket,
	StorageEngine,
} from '../interface';
import { isAWSBaseEvent, storageKey } from '../utils';
import {
	CloseCode,
	MessageType,
	parseMessage,
	stringifyMessage,
	type ExecutionResult,
	type Message,
	type SubscribeMessage,
} from 'graphql-ws/common';
import { isObject } from 'graphql-ws/utils';
import type { ExecutionArgs } from 'graphql';
import {
	GraphQLError,
	getOperationAST,
	parse as graphqlParse,
	validate as graphqlValidate,
	subscribe as graphqlSubscribe,
	execute as graphqlExecute,
} from 'graphql';

export function AWSGraphQLWSAdapter({
	server,
	storage,
	gateway,
	customRouteHandler,
}: AdapterOptions): APIGatewayProxyWebsocketHandlerV2 {
	return (event, ctx, callback) => {
		const connectionId = event.requestContext.connectionId;
		const socket = createSocket(gateway, storage, connectionId);

		// A wrapped context for handler
		const context: GraphQLAdapterContext = { ...ctx, server, storage, socket };

		try {
			switch (event.requestContext.routeKey) {
				case '$connect': {
					handleConnect(context, event);
					break;
				}
				case '$disconnect': {
					break;
				}
				case '$default': {
					handleMessage(context, event);
					break;
				}
				default: {
					return customRouteHandler?.(event, ctx, callback);
				}
			}
		} catch {}

		return Promise.resolve({
			statusCode: 500,
			body: JSON.stringify({
				error: 'Event Not Handled',
				message: 'The event is not supported or handled by the server',
			}),
		});
	};
}

/**
 * Handle the `$connect` event, establish connection or abort the handshake.
 *
 * Ref:
 * - https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-websocket-api-route-keys-connect-disconnect.html
 * - https://docs.aws.amazon.com/apigateway/latest/developerguide/websocket-connect-route-subprotocol.html
 */
const handleConnect: AWSGraphQLRouteHandler = async ({ socket }, event) => {
	if (isAWSBaseEvent(event)) {
		// https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html#apigateway-multivalue-headers-and-parameters
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

const handleMessage: AWSGraphQLRouteHandler = async (
	{ server, socket },
	event,
) => {
	let message: Message;
	try {
		message = parseMessage(event.body, server.jsonMessageReviver);
	} catch (error) {
		await socket.close(CloseCode.BadRequest, 'Invalid message received');
		return;
	}

	switch (message.type) {
		case MessageType.ConnectionInit: {
			const ctx = await socket.context();
			if (ctx.connectionInitReceived) {
				return socket.close(
					CloseCode.TooManyInitialisationRequests,
					'Too many initialisation requests',
				);
			}

			const permittedOrPayload = await server.onConnect?.(ctx);
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
					isObject(permittedOrPayload)
						? {
								type: MessageType.ConnectionAck,
								payload: permittedOrPayload,
							}
						: {
								type: MessageType.ConnectionAck,
							},
					server.jsonMessageReplacer,
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
					server.jsonMessageReplacer,
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
				return socket.close(CloseCode.Unauthorized, 'Unauthorized');
			}

			const { id, payload } = message;
			if (id in ctx.subscriptions) {
				return socket.close(
					CloseCode.SubscriberAlreadyExists,
					`Subscriber for ${id} already exists`,
				);
			}

			const emit = createSubscriptionEmitter(server, socket);

			try {
				let execArgs: ExecutionArgs;
				const maybeExecArgsOrErrors = await server.onSubscribe?.(
					ctx,
					message.id,
					message.payload,
				);
				if (maybeExecArgsOrErrors) {
					if (areGraphQLErrors(maybeExecArgsOrErrors)) {
						return id in ctx.subscriptions
							? await emit.error(maybeExecArgsOrErrors, message)
							: void 0;
					} else if (Array.isArray(maybeExecArgsOrErrors)) {
						throw new Error(
							'Invalid return value from onSubscribe hook, \
                            expected an array of GraphQLError objects',
						);
					}

					execArgs = maybeExecArgsOrErrors;
				} else {
					if (!server.schema) {
						throw new Error('The GraphQL schema is not provided');
					}

					const args = {
						operationName: payload.operationName,
						document: graphqlParse(payload.query),
						variableValues: payload.variables,
					};

					execArgs = {
						...args,
						schema:
							typeof server.schema === 'function'
								? await server.schema(ctx, id, payload, args)
								: server.schema,
					};

					const validate = server.validate ?? graphqlValidate;
					const validationErrors = validate(execArgs.schema, execArgs.document);
					if (validationErrors.length > 0) {
						return id in ctx.subscriptions
							? await emit.error(validationErrors, message)
							: void 0;
					}
				}

				const operationAST = getOperationAST(
					execArgs.document,
					execArgs.operationName,
				);
				if (!operationAST) {
					return id in ctx.subscriptions
						? await emit.error(
								[new GraphQLError('Unable to identify operation')],
								message,
							)
						: void 0;
				}

				// if `onSubscribe` didn't specify a rootValue, inject one
				if (!('rootValue' in execArgs)) {
					execArgs.rootValue = server.roots?.[operationAST.operation];
				}

				// if `onSubscribe` didn't specify a context, inject one
				if (!('contextValue' in execArgs)) {
					execArgs.contextValue =
						typeof server.context === 'function'
							? await server.context(ctx, id, payload, execArgs)
							: server.context;
				}

				// the execution arguments have been prepared
				// perform the operation and act accordingly
				let operationResult;
				if (operationAST.operation === 'subscription') {
					const subscribe = server.subscribe ?? graphqlSubscribe;
					operationResult = await subscribe(execArgs);
				}
				// operation === 'query' || 'mutation'
				else {
					const execute = server.execute ?? graphqlExecute;
					operationResult = await execute(execArgs);
				}

				const maybeResult = await server.onOperation?.(
					ctx,
					id,
					payload,
					execArgs,
					operationResult,
				);
				if (maybeResult) operationResult = maybeResult;

				// This is gonna be handled differently than normal async iterator.
				// As Lambda, serverless architecture does not hold the runtime to wait and
				// emit subscription events.
				// We need to tightly integrate with a dedicated pubsub engine.
			} catch {
			} finally {
			}

			break;
		}
		case MessageType.Complete: {
		}
	}
};

const createSocket = (
	gateway: ApiGatewayManagementApiClient,
	storage: StorageEngine,
	connectionId: string,
): Socket => {
	const ctxKey = storageKey.context(connectionId);
	let ctx: GraphQLWSContext;

	const queryContext = async () => {
		const ctxStr = await storage.get(ctxKey);
		if (!ctxStr) throw Error('AWS GraphQL Websocket Context is not available');
		return JSON.parse(ctxStr);
	};

	return {
		context: async () => {
			if (!ctx) ctx = await queryContext();

			return ctx;
		},
		updateContext: async data => {
			if (!ctx) ctx = await queryContext();

			ctx = { ...ctx, ...data };
			await storage.set(ctxKey, JSON.stringify(ctx));

			return ctx;
		},
		createContext: async data => {
			await storage.set(ctxKey, JSON.stringify(data));
			ctx = data;

			return ctx;
		},
		close: async (code: CloseCode, reason: string) => {
			try {
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
			} catch {}
		},
		send: async data => {
			try {
				await gateway.send(
					new PostToConnectionCommand({
						ConnectionId: connectionId,
						Data: JSON.stringify(data),
					}),
				);
			} catch {}
		},
	};
};

const createSubscriptionEmitter = (server: ServerOptions, socket: Socket) => {
	const next = async (
		result: ExecutionResult,
		{ id, payload }: SubscribeMessage,
		args: ExecutionArgs,
	) => {
		const { errors, ...resultWithoutErrors } = result;

		const ctx = await socket.context();
		const maybeResult = await server.onNext?.(ctx, id, payload, args, result);

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
				server.jsonMessageReplacer,
			),
		);
	};

	const error = async (
		errors: readonly GraphQLError[],
		{ id, payload }: SubscribeMessage,
	) => {
		const ctx = await socket.context();
		const maybeErrors = await server.onError?.(ctx, id, payload, errors);

		await socket.send(
			stringifyMessage<MessageType.Error>(
				{
					id,
					type: MessageType.Error,
					payload: maybeErrors || errors.map(e => e.toJSON()),
				},
				server.jsonMessageReplacer,
			),
		);
	};

	const complete = async (
		notifyClient: boolean,
		{ id, payload }: SubscribeMessage,
	) => {
		const ctx = await socket.context();
		await server.onComplete?.(ctx, id, payload);

		if (notifyClient) {
			await socket.send(
				stringifyMessage<MessageType.Complete>(
					{ id, type: MessageType.Complete },
					server.jsonMessageReplacer,
				),
			);
		}
	};

	return { next, error, complete };
};
