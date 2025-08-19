import type { APIGatewayProxyWebsocketHandlerV2 } from 'aws-lambda';
import {
	CloseCode,
	MessageType,
	parseMessage,
	stringifyMessage,
	handleProtocols,
	areGraphQLErrors,
} from 'graphql-ws';
import type { Context as GraphQLWSContext, Message } from 'graphql-ws';
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
} from '../interface';
import {
	key,
	isAWSBaseEvent,
	isRegistrableChannel,
	createSocket,
	createConsoleLogger,
	createSubscriptionEmitter,
} from '../utils';
import { GraphQLLambdaPubsub } from '../pubsub';
import { customSubscribe } from './graphql';

export function GraphQLLambdaWsAdapter({
	redis,
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

		const socket = createSocket(gateway, redis, connectionId);

		// A wrapped context for handler
		const context: GraphQLWsAdapterContext = {
			...ctx,
			socket,
			redis,
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

		// Wait for any pending change before freezing this lambda instance
		await socket.flushChanges();

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
	{ socket, redis, pubsub, options },
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
			const rawPayload = await redis.get(key.subPayload(subscriptionId));
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
	{ socket, redis, pubsub, options },
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

			// @ts-expect-error I can write
			ctx.acknowledged = true;
			// @ts-expect-error I can write
			ctx.connectionInitReceived = true;
			// @ts-expect-error I can write
			ctx.connectionParams = message.payload;

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
			await redis.set(key.subPayload(id), JSON.stringify(payload));

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
				await socket.close(CloseCode.BadRequest);
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
				redis.get(key.subPayload(subscriptionId)),
			]);

			if (!rawPayload) {
				throw Error('Subscription payload is missing to handle complete');
			}

			const payload = JSON.parse(rawPayload);

			await options.onComplete?.(ctx, subscriptionId, payload);
		}
	}
};
