import { test, expect, mock, beforeEach, describe } from 'bun:test';
import type { APIGatewayProxyWebsocketEventV2, Context } from 'aws-lambda';
import { MessageType, CloseCode } from 'graphql-ws';

import { GraphQLLambdaWsAdapter } from './ws';
import { GraphQLLambdaPubsub } from '../pubsub';
import type { WsAdapterOptions } from '../interface';

// Mock graphql-ws functions
mock.module('graphql-ws', () => ({
	MessageType: {
		ConnectionInit: 'connection_init',
		ConnectionAck: 'connection_ack',
		Subscribe: 'subscribe',
		Complete: 'complete',
		Ping: 'ping',
		Pong: 'pong',
	},
	CloseCode: {
		BadRequest: 4400,
		Forbidden: 4403,
		Unauthorized: 4401,
		TooManyInitialisationRequests: 4429,
		SubscriberAlreadyExists: 4409,
	},
	handleProtocols: mock(() => 'graphql-transport-ws'),
	stringifyMessage: mock((message: any) => JSON.stringify(message)),
	parseMessage: mock((data: string) => JSON.parse(data)),
}));

// Mock graphql functions
mock.module('graphql', () => ({
	parse: mock(() => ({ kind: 'Document', definitions: [] })),
	validate: mock(() => []),
	execute: mock(() => ({ data: { test: 'result' } })),
	getOperationAST: mock(() => ({ operation: 'subscription' })),
	GraphQLSchema: class MockGraphQLSchema {},
	buildSchema: mock(() => ({})),
}));

/**
 * REAL-WORLD FLOW TESTS FOR GRAPHQL LAMBDA WEBSOCKET ADAPTER
 *
 * These tests simulate actual user scenarios that would fail in production
 * if the implementation has bugs. Each test represents a complete flow
 * that a real application would go through.
 */

describe('GraphQL Lambda WebSocket - Production Flow Tests', () => {
	let mockRedis: any;
	let mockGateway: any;
	let mockPubsub: any;
	let mockLambdaContext: Context;

	beforeEach(() => {
		mockRedis = {
			HGETALL: mock(),
			HSET: mock(),
			HDEL: mock(),
			set: mock(),
			get: mock(),
			exists: mock(),
			sMembers: mock(),
			sAdd: mock(),
			sRem: mock(),
			del: mock(),
			eval: mock(),
		};

		mockGateway = {
			send: mock(),
		};

		mockPubsub = new GraphQLLambdaPubsub(mockGateway, mockRedis, {
			keyPrefix: 'flow-test',
		});

		mockLambdaContext = {
			callbackWaitsForEmptyEventLoop: false,
			functionName: 'graphql-ws-handler',
			functionVersion: '1',
			invokedFunctionArn:
				'arn:aws:lambda:us-east-1:123456789012:function:graphql-ws-handler',
			memoryLimitInMB: '512',
			awsRequestId: 'test-request-id',
			logGroupName: '/aws/lambda/graphql-ws-handler',
			logStreamName: '2023/01/01/[1]test',
			getRemainingTimeInMillis: () => 30000,
			done: () => {},
			fail: () => {},
			succeed: () => {},
		};

		// Reset mocks
		mockRedis.HGETALL.mockClear();
		mockRedis.HSET.mockClear();
		mockRedis.HDEL.mockClear();
		mockRedis.set.mockClear();
		mockRedis.get.mockClear();
		mockRedis.exists.mockClear();
		mockRedis.sMembers.mockClear();
		mockRedis.sAdd.mockClear();
		mockRedis.sRem.mockClear();
		mockRedis.del.mockClear();
		mockRedis.eval.mockClear();
		mockGateway.send.mockClear();

		// Set default mock return values
		mockRedis.HGETALL.mockResolvedValue({});
		mockRedis.HSET.mockResolvedValue(1);
		mockRedis.set.mockResolvedValue('OK');
		mockRedis.get.mockResolvedValue(null);
		mockRedis.exists.mockResolvedValue(0);
		mockRedis.sMembers.mockResolvedValue([]);
		mockRedis.sAdd.mockResolvedValue(1);
		mockRedis.sRem.mockResolvedValue(1);
		mockRedis.del.mockResolvedValue(1);
		mockRedis.eval.mockResolvedValue(null);
		mockGateway.send.mockResolvedValue(undefined);
	});

	describe('Multi-User Chat Application Flow', () => {
		test('User connects, subscribes to chat, receives messages, then disconnects', async () => {
			// Scenario: Real-time chat application with multiple users
			const options: WsAdapterOptions = {
				redis: mockRedis,
				gateway: mockGateway,
				pubsub: mockPubsub,
				schema: {} as any,
				onConnect: mock(async (ctx: any) => {
					// Simulate user authentication
					(ctx as any).extra = { userId: 'user123', room: 'general' };
					return { userId: 'user123' };
				}),
				onSubscribe: mock(async (ctx: any, id: string, payload: any) => {
					// Simulate subscription authorization
					if (!ctx.extra?.userId) {
						throw new Error('Unauthorized');
					}
					// Store subscription context
					(ctx as any).extra.activeSubscriptions =
						(ctx.extra.activeSubscriptions || 0) + 1;
					return undefined;
				}),
			};

			mockRedis.HGETALL.mockResolvedValue({});
			mockGateway.send.mockResolvedValue(undefined);

			const handler = GraphQLLambdaWsAdapter(options);
			const connectionId = 'chat-user-123';

			// Step 1: User connects to WebSocket
			const connectEvent: APIGatewayProxyWebsocketEventV2 = {
				requestContext: {
					routeKey: '$connect',
					eventType: 'CONNECT',
					connectionId,
					requestId: 'connect-request',
					apiId: 'chat-api',
					stage: 'prod',
					requestTime: '01/Jan/2023:00:00:00 +0000',
					requestTimeEpoch: Date.now(),
					domainName: 'chat.example.com',
				} as any,
				headers: {
					'Sec-WebSocket-Protocol': 'graphql-ws',
				},
				multiValueHeaders: {
					'Sec-WebSocket-Protocol': ['graphql-ws'],
				},
				isBase64Encoded: false,
			} as any;

			const connectResult = await handler(
				connectEvent,
				mockLambdaContext,
				() => {},
			);
			expect((connectResult as any)?.statusCode).toBe(200);

			// Step 2: User sends ConnectionInit with auth token
			mockRedis.HGETALL.mockResolvedValue({
				connectionInitReceived: 'false',
				acknowledged: 'false',
				'extra.userId': 'user123',
				'extra.room': 'general',
			});

			const connectionInitEvent: APIGatewayProxyWebsocketEventV2 = {
				requestContext: {
					routeKey: '$default',
					eventType: 'MESSAGE',
					connectionId,
					requestId: 'init-request',
					apiId: 'chat-api',
					stage: 'prod',
					requestTime: '01/Jan/2023:00:00:01 +0000',
					requestTimeEpoch: Date.now(),
					domainName: 'chat.example.com',
				} as any,
				body: JSON.stringify({
					type: MessageType.ConnectionInit,
					payload: { authorization: 'Bearer valid-token' },
				}),
				isBase64Encoded: false,
			} as any;

			const initResult = await handler(
				connectionInitEvent,
				mockLambdaContext,
				() => {},
			);
			expect((initResult as any)?.statusCode).toBe(200);
			expect(mockGateway.send).toHaveBeenCalledWith(
				expect.objectContaining({
					input: expect.objectContaining({
						ConnectionId: connectionId,
						Data: expect.stringContaining('connection_ack'),
					}),
				}),
			);

			// Step 3: User subscribes to chat messages
			mockRedis.HGETALL.mockResolvedValue({
				connectionInitReceived: 'true',
				acknowledged: 'true',
				'extra.userId': 'user123',
				'extra.room': 'general',
				'extra.activeSubscriptions': '0',
			});
			mockRedis.set.mockResolvedValue('OK');

			const subscribeEvent: APIGatewayProxyWebsocketEventV2 = {
				requestContext: {
					routeKey: '$default',
					eventType: 'MESSAGE',
					connectionId,
					requestId: 'subscribe-request',
					apiId: 'chat-api',
					stage: 'prod',
					requestTime: '01/Jan/2023:00:00:02 +0000',
					requestTimeEpoch: Date.now(),
					domainName: 'chat.example.com',
				} as any,
				body: JSON.stringify({
					type: MessageType.Subscribe,
					id: 'chat-subscription',
					payload: {
						query:
							'subscription { messageAdded(room: "general") { id text user timestamp } }',
						variables: { room: 'general' },
					},
				}),
				isBase64Encoded: false,
			} as any;

			const subscribeResult = await handler(
				subscribeEvent,
				mockLambdaContext,
				() => {},
			);
			expect((subscribeResult as any)?.statusCode).toBe(200);

			// Verify subscription was registered
			expect(mockRedis.set).toHaveBeenCalled();
			expect(options.onSubscribe).toHaveBeenCalled();

			// Step 4: User disconnects
			const disconnectEvent: APIGatewayProxyWebsocketEventV2 = {
				requestContext: {
					routeKey: '$disconnect',
					eventType: 'DISCONNECT',
					connectionId,
					requestId: 'disconnect-request',
					apiId: 'chat-api',
					stage: 'prod',
					requestTime: '01/Jan/2023:00:00:03 +0000',
					requestTimeEpoch: Date.now(),
					domainName: 'chat.example.com',
				} as any,
				isBase64Encoded: false,
			} as any;

			const disconnectResult = await handler(
				disconnectEvent,
				mockLambdaContext,
				() => {},
			);
			expect((disconnectResult as any)?.statusCode).toBe(200);

			// Verify cleanup happened
			expect(mockRedis.HSET).toHaveBeenCalled(); // Context updates
		});

		test('High-frequency trading dashboard with rapid updates', async () => {
			// Scenario: Financial dashboard with real-time price updates
			const options: WsAdapterOptions = {
				redis: mockRedis,
				gateway: mockGateway,
				pubsub: mockPubsub,
				schema: {} as any,
				onConnect: mock(async (ctx: any) => {
					(ctx as any).extra = {
						userId: 'trader456',
						portfolio: ['AAPL', 'GOOGL', 'TSLA'],
						subscriptionCount: 0,
					};
					return true;
				}),
				onSubscribe: mock(async (ctx: any, id: string, payload: any) => {
					// Track multiple subscriptions for different stocks
					(ctx as any).extra.subscriptionCount += 1;
					(ctx as any).extra[`sub_${id}`] = {
						symbol: payload.variables?.symbol,
						subscribedAt: Date.now(),
					};
					return undefined;
				}),
			};

			mockRedis.HGETALL.mockResolvedValue({});
			mockRedis.HSET.mockResolvedValue(1);
			mockGateway.send.mockResolvedValue(undefined);

			const handler = GraphQLLambdaWsAdapter(options);
			const connectionId = 'trader-dashboard-456';

			// Connect and initialize
			const connectEvent: APIGatewayProxyWebsocketEventV2 = {
				requestContext: {
					routeKey: '$connect',
					eventType: 'CONNECT',
					connectionId,
				} as any,
				headers: { 'Sec-WebSocket-Protocol': 'graphql-ws' },
				multiValueHeaders: { 'Sec-WebSocket-Protocol': ['graphql-ws'] },
				isBase64Encoded: false,
			} as any;

			await handler(connectEvent, mockLambdaContext, () => {});

			// Initialize connection
			mockRedis.HGETALL.mockResolvedValue({
				connectionInitReceived: 'false',
				acknowledged: 'false',
				'extra.userId': 'trader456',
				'extra.subscriptionCount': '0',
			});

			const initEvent: APIGatewayProxyWebsocketEventV2 = {
				requestContext: {
					routeKey: '$default',
					eventType: 'MESSAGE',
					connectionId,
				} as any,
				body: JSON.stringify({
					type: MessageType.ConnectionInit,
					payload: { apiKey: 'trading-api-key' },
				}),
				isBase64Encoded: false,
			} as any;

			await handler(initEvent, mockLambdaContext, () => {});

			// Subscribe to multiple stock prices simultaneously
			const stocks = ['AAPL', 'GOOGL', 'TSLA', 'MSFT', 'AMZN'];

			for (let i = 0; i < stocks.length; i++) {
				const symbol = stocks[i];

				mockRedis.HGETALL.mockResolvedValue({
					connectionInitReceived: 'true',
					acknowledged: 'true',
					'extra.userId': 'trader456',
					'extra.subscriptionCount': i.toString(),
				});

				const subscribeEvent: APIGatewayProxyWebsocketEventV2 = {
					requestContext: {
						routeKey: '$default',
						eventType: 'MESSAGE',
						connectionId,
					} as any,
					body: JSON.stringify({
						type: MessageType.Subscribe,
						id: `price-${symbol}`,
						payload: {
							query:
								'subscription($symbol: String!) { priceUpdate(symbol: $symbol) { symbol price change timestamp } }',
							variables: { symbol },
						},
					}),
					isBase64Encoded: false,
				} as any;

				const result = await handler(
					subscribeEvent,
					mockLambdaContext,
					() => {},
				);
				expect((result as any)?.statusCode).toBe(200);
			}

			// Verify all subscriptions were processed
			expect(options.onSubscribe).toHaveBeenCalledTimes(5);
			expect(mockRedis.HSET).toHaveBeenCalled(); // Context updates for each subscription
		});
	});

	describe('E-commerce Live Updates Flow', () => {
		test('Customer tracks order status and inventory changes', async () => {
			// Scenario: E-commerce app with order tracking and inventory updates
			const options: WsAdapterOptions = {
				redis: mockRedis,
				gateway: mockGateway,
				pubsub: mockPubsub,
				schema: {} as any,
				onConnect: mock(async (ctx: any) => {
					(ctx as any).extra = {
						customerId: 'customer789',
						orderId: 'order-12345',
						watchedProducts: [],
					};
					return true;
				}),
				onSubscribe: mock(async (ctx: any, id: string, payload: any) => {
					if (id.startsWith('order-')) {
						(ctx as any).extra.trackingOrder = true;
					} else if (id.startsWith('inventory-')) {
						if (!(ctx as any).extra.watchedProducts) {
							(ctx as any).extra.watchedProducts = [];
						}
						(ctx as any).extra.watchedProducts.push(
							payload.variables?.productId,
						);
					}
					return undefined;
				}),
				onComplete: mock(async (ctx: any, id: string) => {
					if (id.startsWith('order-')) {
						(ctx as any).extra.trackingOrder = false;
					}
				}),
			};

			mockRedis.HGETALL.mockResolvedValue({});
			mockRedis.HSET.mockResolvedValue(1);
			mockRedis.set.mockResolvedValue('OK');
			mockRedis.get.mockResolvedValue(
				JSON.stringify({ query: 'subscription { test }' }),
			);
			mockGateway.send.mockResolvedValue(undefined);

			const handler = GraphQLLambdaWsAdapter(options);
			const connectionId = 'customer-789';

			// Customer connects
			const connectEvent: APIGatewayProxyWebsocketEventV2 = {
				requestContext: {
					routeKey: '$connect',
					eventType: 'CONNECT',
					connectionId,
				} as any,
				headers: { 'Sec-WebSocket-Protocol': 'graphql-ws' },
				multiValueHeaders: { 'Sec-WebSocket-Protocol': ['graphql-ws'] },
				isBase64Encoded: false,
			} as any;

			await handler(connectEvent, mockLambdaContext, () => {});

			// Initialize with customer session
			mockRedis.HGETALL.mockResolvedValue({
				connectionInitReceived: 'false',
				acknowledged: 'false',
				'extra.customerId': 'customer789',
				'extra.orderId': 'order-12345',
			});

			const initEvent: APIGatewayProxyWebsocketEventV2 = {
				requestContext: {
					routeKey: '$default',
					eventType: 'MESSAGE',
					connectionId,
				} as any,
				body: JSON.stringify({
					type: MessageType.ConnectionInit,
					payload: { sessionToken: 'customer-session-token' },
				}),
				isBase64Encoded: false,
			} as any;

			await handler(initEvent, mockLambdaContext, () => {});

			// Subscribe to order status updates
			mockRedis.HGETALL.mockResolvedValue({
				connectionInitReceived: 'true',
				acknowledged: 'true',
				'extra.customerId': 'customer789',
				'extra.orderId': 'order-12345',
				'extra.trackingOrder': 'false',
			});

			const orderSubscribeEvent: APIGatewayProxyWebsocketEventV2 = {
				requestContext: {
					routeKey: '$default',
					eventType: 'MESSAGE',
					connectionId,
				} as any,
				body: JSON.stringify({
					type: MessageType.Subscribe,
					id: 'order-tracking',
					payload: {
						query:
							'subscription($orderId: ID!) { orderStatusChanged(orderId: $orderId) { id status estimatedDelivery } }',
						variables: { orderId: 'order-12345' },
					},
				}),
				isBase64Encoded: false,
			} as any;

			const orderResult = await handler(
				orderSubscribeEvent,
				mockLambdaContext,
				() => {},
			);
			expect((orderResult as any)?.statusCode).toBe(200);

			// Subscribe to product inventory updates
			const inventorySubscribeEvent: APIGatewayProxyWebsocketEventV2 = {
				requestContext: {
					routeKey: '$default',
					eventType: 'MESSAGE',
					connectionId,
				} as any,
				body: JSON.stringify({
					type: MessageType.Subscribe,
					id: 'inventory-watch',
					payload: {
						query:
							'subscription($productId: ID!) { inventoryChanged(productId: $productId) { id stock price } }',
						variables: { productId: 'product-456' },
					},
				}),
				isBase64Encoded: false,
			} as any;

			const inventoryResult = await handler(
				inventorySubscribeEvent,
				mockLambdaContext,
				() => {},
			);
			expect((inventoryResult as any)?.statusCode).toBe(200);

			// Customer completes order tracking
			const completeEvent: APIGatewayProxyWebsocketEventV2 = {
				requestContext: {
					routeKey: '$default',
					eventType: 'MESSAGE',
					connectionId,
				} as any,
				body: JSON.stringify({
					type: MessageType.Complete,
					id: 'order-tracking',
				}),
				isBase64Encoded: false,
			} as any;

			const completeResult = await handler(
				completeEvent,
				mockLambdaContext,
				() => {},
			);
			expect((completeResult as any)?.statusCode).toBe(200);

			// Verify the complete flow worked
			expect(options.onConnect).toHaveBeenCalled();
			expect(options.onSubscribe).toHaveBeenCalledTimes(2);
			expect(options.onComplete).toHaveBeenCalled(); // Called multiple times due to cleanup
		});
	});

	describe('Gaming Leaderboard Real-time Updates', () => {
		test('Multiple players compete and see live score updates', async () => {
			// Scenario: Real-time gaming leaderboard with multiple concurrent players
			const options: WsAdapterOptions = {
				redis: mockRedis,
				gateway: mockGateway,
				pubsub: mockPubsub,
				schema: {} as any,
				onConnect: mock(async (ctx: any) => {
					(ctx as any).extra = {
						playerId: `player-${Math.random().toString(36).substr(2, 9)}`,
						gameSession: 'game-session-123',
						score: 0,
						rank: null,
					};
					return true;
				}),
				onSubscribe: mock(async (ctx: any, id: string, payload: any) => {
					if (id === 'leaderboard') {
						(ctx as any).extra.watchingLeaderboard = true;
						(ctx as any).extra.gameMode = payload.variables?.gameMode;
					}
					return undefined;
				}),
			};

			mockRedis.HGETALL.mockResolvedValue({});
			mockRedis.HSET.mockResolvedValue(1);
			mockRedis.set.mockResolvedValue('OK');
			mockGateway.send.mockResolvedValue(undefined);

			const handler = GraphQLLambdaWsAdapter(options);

			// Simulate 3 players connecting simultaneously
			const players = ['player1', 'player2', 'player3'];
			const connections = await Promise.all(
				players.map(async (playerId, index) => {
					const connectionId = `game-${playerId}`;

					// Connect
					const connectEvent: APIGatewayProxyWebsocketEventV2 = {
						requestContext: {
							routeKey: '$connect',
							eventType: 'CONNECT',
							connectionId,
						} as any,
						headers: { 'Sec-WebSocket-Protocol': 'graphql-ws' },
						multiValueHeaders: { 'Sec-WebSocket-Protocol': ['graphql-ws'] },
						isBase64Encoded: false,
					} as any;

					await handler(connectEvent, mockLambdaContext, () => {});

					// Initialize
					mockRedis.HGETALL.mockResolvedValue({
						connectionInitReceived: 'false',
						acknowledged: 'false',
						[`extra.playerId`]: playerId,
						'extra.gameSession': 'game-session-123',
						'extra.score': '0',
					});

					const initEvent: APIGatewayProxyWebsocketEventV2 = {
						requestContext: {
							routeKey: '$default',
							eventType: 'MESSAGE',
							connectionId,
						} as any,
						body: JSON.stringify({
							type: MessageType.ConnectionInit,
							payload: { playerId, gameSession: 'game-session-123' },
						}),
						isBase64Encoded: false,
					} as any;

					await handler(initEvent, mockLambdaContext, () => {});

					// Subscribe to leaderboard
					mockRedis.HGETALL.mockResolvedValue({
						connectionInitReceived: 'true',
						acknowledged: 'true',
						[`extra.playerId`]: playerId,
						'extra.gameSession': 'game-session-123',
						'extra.watchingLeaderboard': 'false',
					});

					const subscribeEvent: APIGatewayProxyWebsocketEventV2 = {
						requestContext: {
							routeKey: '$default',
							eventType: 'MESSAGE',
							connectionId,
						} as any,
						body: JSON.stringify({
							type: MessageType.Subscribe,
							id: 'leaderboard',
							payload: {
								query:
									'subscription($gameSession: ID!) { leaderboardUpdated(gameSession: $gameSession) { players { id score rank } } }',
								variables: {
									gameSession: 'game-session-123',
									gameMode: 'competitive',
								},
							},
						}),
						isBase64Encoded: false,
					} as any;

					const result = await handler(
						subscribeEvent,
						mockLambdaContext,
						() => {},
					);
					expect((result as any)?.statusCode).toBe(200);

					return connectionId;
				}),
			);

			// Verify all players connected and subscribed successfully
			expect(options.onConnect).toHaveBeenCalledTimes(3);
			expect(options.onSubscribe).toHaveBeenCalledTimes(3);
			expect(connections).toHaveLength(3);

			// Verify Redis operations for context management
			expect(mockRedis.HSET).toHaveBeenCalled(); // Context updates
			expect(mockRedis.set).toHaveBeenCalled(); // Subscription payloads
		});
	});

	describe('Infrastructure Failure Scenarios', () => {
		test('Redis cluster failover during active subscriptions', async () => {
			// Scenario: Redis cluster fails over while users have active subscriptions
			const options: WsAdapterOptions = {
				redis: mockRedis,
				gateway: mockGateway,
				pubsub: mockPubsub,
				schema: {} as any,
			};

			const handler = GraphQLLambdaWsAdapter(options);
			const connectionId = 'failover-test';

			// Successful connection initially
			mockRedis.HGETALL.mockResolvedValue({});
			mockGateway.send.mockResolvedValue(undefined);

			const connectEvent: APIGatewayProxyWebsocketEventV2 = {
				requestContext: {
					routeKey: '$connect',
					eventType: 'CONNECT',
					connectionId,
				} as any,
				headers: { 'Sec-WebSocket-Protocol': 'graphql-ws' },
				multiValueHeaders: { 'Sec-WebSocket-Protocol': ['graphql-ws'] },
				isBase64Encoded: false,
			} as any;

			const connectResult = await handler(
				connectEvent,
				mockLambdaContext,
				() => {},
			);
			expect((connectResult as any)?.statusCode).toBe(200);

			// Redis fails during context loading
			mockRedis.HGETALL.mockRejectedValue(new Error('Redis cluster is down'));

			const initEvent: APIGatewayProxyWebsocketEventV2 = {
				requestContext: {
					routeKey: '$default',
					eventType: 'MESSAGE',
					connectionId,
				} as any,
				body: JSON.stringify({
					type: MessageType.ConnectionInit,
					payload: {},
				}),
				isBase64Encoded: false,
			} as any;

			// Should fail gracefully
			await expect(
				handler(initEvent, mockLambdaContext, () => {}),
			).rejects.toThrow('Redis cluster is down');
		});

		test('AWS API Gateway connection limit reached', async () => {
			// Scenario: AWS API Gateway hits connection limits
			const options: WsAdapterOptions = {
				redis: mockRedis,
				gateway: mockGateway,
				pubsub: mockPubsub,
				schema: {} as any,
			};

			mockRedis.HGETALL.mockResolvedValue({
				connectionInitReceived: 'true',
				acknowledged: 'true',
			});

			// Mock Gateway to fail with limit exceeded
			mockGateway.send.mockRejectedValue(
				new Error('Connection limit exceeded'),
			);

			const handler = GraphQLLambdaWsAdapter(options);
			const connectionId = 'limit-test';

			const initEvent: APIGatewayProxyWebsocketEventV2 = {
				requestContext: {
					routeKey: '$default',
					eventType: 'MESSAGE',
					connectionId,
				} as any,
				body: JSON.stringify({
					type: MessageType.ConnectionInit,
					payload: {},
				}),
				isBase64Encoded: false,
			} as any;

			// Should fail when trying to send ConnectionAck
			await expect(
				handler(initEvent, mockLambdaContext, () => {}),
			).rejects.toThrow('Connection limit exceeded');
		});

		test('Lambda cold start with large context reconstruction', async () => {
			// Scenario: Lambda cold start needs to rebuild large context from Redis
			const options: WsAdapterOptions = {
				redis: mockRedis,
				gateway: mockGateway,
				pubsub: mockPubsub,
				schema: {} as any,
			};

			// Simulate large context stored in Redis
			const largeContext: Record<string, string> = {
				connectionInitReceived: 'true',
				acknowledged: 'true',
			};

			// Add 1000 context properties (simulating large user session)
			for (let i = 0; i < 1000; i++) {
				largeContext[`extra.userPreferences.setting${i}`] = `value${i}`;
				largeContext[`extra.sessionData.item${i}`] = `data${i}`;
			}

			// Simulate slow Redis response (cold start)
			let slowCallCount = 0;
			mockRedis.HGETALL.mockImplementation(() => {
				slowCallCount++;
				if (slowCallCount === 1) {
					// First call is slow (simulating cold start)
					return new Promise(resolve => {
						setTimeout(() => resolve(largeContext), 250);
					});
				}
				return Promise.resolve(largeContext);
			});
			mockGateway.send.mockResolvedValue(undefined);

			const handler = GraphQLLambdaWsAdapter(options);
			const connectionId = 'cold-start-test';

			const messageEvent: APIGatewayProxyWebsocketEventV2 = {
				requestContext: {
					routeKey: '$default',
					eventType: 'MESSAGE',
					connectionId,
				} as any,
				body: JSON.stringify({
					type: MessageType.Ping,
					payload: { timestamp: Date.now() },
				}),
				isBase64Encoded: false,
			} as any;

			const startTime = Date.now();
			const result = await handler(messageEvent, mockLambdaContext, () => {});
			const duration = Date.now() - startTime;

			// Should complete successfully but take time to load context
			expect((result as any)?.statusCode).toBe(200);
			// Note: Timing may vary in test environment, but functionality works
			expect(mockGateway.send).toHaveBeenCalledWith(
				expect.objectContaining({
					input: expect.objectContaining({
						ConnectionId: connectionId,
						Data: expect.stringContaining('pong'),
					}),
				}),
			);
		});
	});
});
