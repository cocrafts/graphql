import {
	DeleteConnectionCommand,
	PostToConnectionCommand,
	type ApiGatewayManagementApiClient,
} from '@aws-sdk/client-apigatewaymanagementapi';
import type { Context as GraphQLWSContext } from 'graphql-ws';

import type { AnyRedis, Socket } from '../interface';
import { key } from './common';

import { buildContext, compressContext, createContextManager } from './context';

export const createSocket = (
	gateway: ApiGatewayManagementApiClient,
	redis: AnyRedis,
	connectionId: string,
): Socket => {
	const contextKey = key.connCtx(connectionId);
	let contextManager: ReturnType<typeof createContextManager<GraphQLWSContext>>;
	let contextPromise: Promise<GraphQLWSContext>;

	const retrieveAndBuildContext = async (): Promise<GraphQLWSContext> => {
		const rawContext = await redis.HGETALL(contextKey);
		if (!rawContext) {
			// Return default, uninitialized context object
			return {
				connectionInitReceived: false,
				acknowledged: false,
				subscriptions: {},
				extra: {},
			};
		}

		const context = buildContext(rawContext);

		contextManager = createContextManager(context, contextKey, redis);

		return contextManager.context;
	};

	return {
		context: async () => {
			if (!contextManager) {
				if (!contextPromise) {
					contextPromise = retrieveAndBuildContext();
				}

				return contextPromise;
			}

			return contextManager.context;
		},
		createContext: async data => {
			contextManager = createContextManager(data, contextKey, redis);

			const compressedContext = compressContext(contextManager.context);
			redis.HSET(contextKey, compressedContext);

			return contextManager.context;
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
		flushChanges: async () => {
			if (contextManager) await contextManager.waitAllSync();
		},
	};
};
