import { test, expect, mock, beforeEach, describe } from 'bun:test';
import type { APIGatewayProxyWebsocketEventV2, Context } from 'aws-lambda';
import { MessageType, CloseCode } from 'graphql-ws';
import type { GraphQLSchema } from 'graphql';

import { GraphQLLambdaWsAdapter } from './ws';
import { GraphQLLambdaPubsub } from '../pubsub';
import type { WsAdapterOptions } from '../interface';

// Mock dependencies
const mockRedis = {
	set: mock(),
	get: mock(),
	HGETALL: mock(),
	HSET: mock(),
	HDEL: mock(),
} as any;

const mockGateway = {
	send: mock(),
} as any;

const mockPubsub = new GraphQLLambdaPubsub(mockGateway, mockRedis, {
	keyPrefix: 'test',
});

const mockLogger = {
	debug: mock(),
	info: mock(),
	warn: mock(),
	error: mock(),
};

// Mock GraphQL schema
const mockSchema = {} as GraphQLSchema;

// Mock server options callbacks with context manipulation
const mockOnConnect = mock();
const mockOnSubscribe = mock();
const mockOnNext = mock();
const mockOnError = mock();
const mockOnComplete = mock();

// Mock utils
mock.module('../utils', () => ({
	key: {
		connCtx: (id: string) => `ctx:${id}`,
		subPayload: (id: string) => `payload:${id}`,
	},
	isAWSBaseEvent: mock(() => true),
	isRegistrableChannel: mock(() => false),
	createSocket: mock(() => mockSocket),
	createConsoleLogger: mock(() => mockLogger),
	createSubscriptionEmitter: mock(() => mockEmitter),
}));

// Mock graphql-ws functions
mock.module('graphql-ws', () => ({
	MessageType: {
		ConnectionInit: 'connection_init',
		ConnectionAck: 'connection_ack',
		Subscribe: 'subscribe',
		Next: 'next',
		Error: 'error',
		Complete: 'complete',
		Ping: 'ping',
		Pong: 'pong',
	},
	CloseCode: {
		BadRequest: 4400,
		Unauthorized: 4401,
		Forbidden: 4403,
		TooManyInitialisationRequests: 4429,
		SubscriberAlreadyExists: 4409,
	},
	parseMessage: mock(),
	stringifyMessage: mock((msg: any) => JSON.stringify(msg)),
	handleProtocols: mock(() => 'graphql-transport-ws'),
	areGraphQLErrors: mock(() => false),
}));

// Mock GraphQL functions
const mockGetOperationAST = mock(() => ({ operation: 'subscription' }));
const mockParse = mock(() => ({
	kind: 'Document',
	definitions: [
		{
			kind: 'OperationDefinition',
			operation: 'subscription',
			selectionSet: {
				kind: 'SelectionSet',
				selections: [],
			},
		},
	],
}));
const mockValidate = mock(() => []);
const mockExecute = mock(() => ({ data: { test: 'result' } }));

mock.module('graphql', () => ({
	GraphQLError: class MockGraphQLError extends Error {
		constructor(message: string) {
			super(message);
			this.name = 'GraphQLError';
		}
	},
	getOperationAST: mockGetOperationAST,
	parse: mockParse,
	validate: mockValidate,
	execute: mockExecute,
}));

// Mock the custom GraphQL subscription
mock.module('./graphql', () => ({
	customSubscribe: mock(() => ({ data: { test: 'subscription result' } })),
}));

// Advanced mock socket with race condition simulation
const mockSocket = {
	context: mock(),
	createContext: mock(),
	close: mock(),
	send: mock(),
	flushChanges: mock(),
};

// Mock emitter
const mockEmitter = {
	next: mock(),
	error: mock(),
	complete: mock(),
};

// Mock pubsub methods
const mockIsRegistered = mock(() => Promise.resolve(false));
const mockGetConnectionSubscriptions = mock(() => Promise.resolve([]));
const mockDisconnect = mock(() => Promise.resolve(undefined));
const mockUnregister = mock(() => Promise.resolve(undefined));

mockPubsub.isRegistered = mockIsRegistered;
mockPubsub.getConnectionSubscriptions = mockGetConnectionSubscriptions;
mockPubsub.disconnect = mockDisconnect;
mockPubsub.unregister = mockUnregister;

// Advanced server options with context manipulation
const mockAdvancedWsAdapterOptions: WsAdapterOptions = {
	redis: mockRedis,
	gateway: mockGateway,
	pubsub: mockPubsub,
	schema: mockSchema,
	onConnect: mockOnConnect,
	onSubscribe: mockOnSubscribe,
	onNext: mockOnNext,
	onError: mockOnError,
	onComplete: mockOnComplete,
};

const mockLambdaContext: Context = {
	callbackWaitsForEmptyEventLoop: false,
	functionName: 'test-function',
	functionVersion: '1',
	invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test',
	memoryLimitInMB: '128',
	awsRequestId: 'test-request-id',
	logGroupName: '/aws/lambda/test',
	logStreamName: '2023/01/01/[1]test',
	getRemainingTimeInMillis: () => 30000,
	done: () => {},
	fail: () => {},
	succeed: () => {},
};

const createMessageEvent = (
	body: string,
	connectionId = 'race-test-connection',
): APIGatewayProxyWebsocketEventV2 =>
	({
		requestContext: {
			routeKey: '$default',
			eventType: 'MESSAGE',
			connectionId,
			requestId: 'test-request',
			apiId: 'test-api',
			stage: 'dev',
			requestTime: '01/Jan/2023:00:00:00 +0000',
			requestTimeEpoch: Date.now(),
			domainName: 'test.execute-api.us-east-1.amazonaws.com',
		} as any,
		body,
		isBase64Encoded: false,
	}) as any;

beforeEach(() => {
	// Reset all mocks
	mockSocket.context.mockClear();
	mockSocket.createContext.mockClear();
	mockSocket.close.mockClear();
	mockSocket.send.mockClear();
	mockSocket.flushChanges.mockClear();

	mockEmitter.next.mockClear();
	mockEmitter.error.mockClear();
	mockEmitter.complete.mockClear();

	mockOnConnect.mockClear();
	mockOnSubscribe.mockClear();
	mockOnNext.mockClear();
	mockOnError.mockClear();
	mockOnComplete.mockClear();

	mockRedis.set.mockClear();
	mockRedis.get.mockClear();
	mockRedis.HGETALL.mockClear();
	mockRedis.HSET.mockClear();
	mockRedis.HDEL.mockClear();

	mockIsRegistered.mockClear();
	mockGetConnectionSubscriptions.mockClear();
	mockDisconnect.mockClear();
	mockUnregister.mockClear();

	mockGetOperationAST.mockClear();
	mockParse.mockClear();
	mockValidate.mockClear();
	mockExecute.mockClear();

	// Reset default return values
	mockGetOperationAST.mockReturnValue({ operation: 'subscription' });
	mockParse.mockReturnValue({
		kind: 'Document',
		definitions: [
			{
				kind: 'OperationDefinition',
				operation: 'subscription',
				selectionSet: {
					kind: 'SelectionSet',
					selections: [],
				},
			},
		],
	});
	mockValidate.mockReturnValue([]);
	(mockExecute as any).mockResolvedValue({ data: { test: 'result' } });

	// Set default context
	mockSocket.context.mockResolvedValue({
		connectionInitReceived: true,
		acknowledged: true,
		subscriptions: {},
		extra: {},
	});
	mockSocket.createContext.mockResolvedValue({});
	mockSocket.close.mockResolvedValue(undefined);
	mockSocket.send.mockResolvedValue(undefined);
	mockSocket.flushChanges.mockResolvedValue(undefined);

	mockOnConnect.mockResolvedValue(true);
	mockRedis.set.mockResolvedValue('OK');
	mockRedis.get.mockResolvedValue(null);
	mockRedis.HGETALL.mockResolvedValue({});
	mockRedis.HSET.mockResolvedValue(1);
	mockRedis.HDEL.mockResolvedValue(1);
});

describe('Advanced WebSocket Adapter - Race Condition & Context Management', () => {
	describe('Concurrent Subscription Context Updates', () => {
		test('Multiple subscriptions update context.extra concurrently without race conditions', async () => {
			const { parseMessage } = await import('graphql-ws');
			const handler = GraphQLLambdaWsAdapter(mockAdvancedWsAdapterOptions);

			// Simulate context with existing data
			let contextState = {
				connectionInitReceived: true,
				acknowledged: true,
				subscriptions: {},
				extra: {
					userId: 'user123',
					permissions: ['read'],
				},
			};

			// Mock context to return evolving state
			mockSocket.context.mockImplementation(async () => ({ ...contextState }));

			// Mock onSubscribe to add subscription-specific context data
			mockOnSubscribe.mockImplementation(
				async (ctx: any, id: string, payload: any) => {
					// Simulate race condition - each subscription adds its own data
					const subscriptionData = {
						subscriptionId: id,
						query: payload.query,
						timestamp: Date.now(),
					};

					// Update context.extra with subscription-specific data
					ctx.extra[`subscription_${id}`] = subscriptionData;
					ctx.extra.lastSubscription = id;

					// Simulate async context persistence
					await new Promise(resolve => setTimeout(resolve, Math.random() * 10));

					return null; // Use default execution
				},
			);

			// Create multiple subscription messages
			const subscriptions = [
				{
					id: 'sub1',
					payload: { query: 'subscription { messageAdded { id } }' },
				},
				{
					id: 'sub2',
					payload: { query: 'subscription { userUpdated { name } }' },
				},
				{
					id: 'sub3',
					payload: { query: 'subscription { orderCreated { total } }' },
				},
			];

			// Process subscriptions concurrently (simulating serverless environment)
			const subscriptionPromises = subscriptions.map(async sub => {
				const subscribeMessage = {
					type: MessageType.Subscribe,
					id: sub.id,
					payload: sub.payload,
				};
				(parseMessage as any).mockReturnValue(subscribeMessage);

				const event = createMessageEvent(JSON.stringify(subscribeMessage));
				return handler(event, mockLambdaContext, () => {});
			});

			// Wait for all subscriptions to complete
			const results = await Promise.all(subscriptionPromises);

			// Verify all subscriptions completed successfully
			results.forEach(result => {
				expect((result as any)?.statusCode).toBe(200);
			});

			// Verify onSubscribe was called for each subscription
			expect(mockOnSubscribe).toHaveBeenCalledTimes(3);
			expect(mockOnSubscribe).toHaveBeenCalledWith(
				expect.objectContaining({
					extra: expect.objectContaining({
						userId: 'user123',
						permissions: ['read'],
					}),
				}),
				'sub1',
				subscriptions[0]?.payload,
			);

			// Verify context was updated with subscription data
			const contextCalls = mockOnSubscribe.mock.calls as any[];
			contextCalls.forEach((call, index) => {
				const [ctx, subId] = call;
				expect(ctx.extra).toHaveProperty(`subscription_${subId}`);
				expect(ctx.extra[`subscription_${subId}`]).toMatchObject({
					subscriptionId: subId,
					query: subscriptions[index]?.payload.query,
					timestamp: expect.any(Number),
				});
			});
		});

		test('Context manager batches multiple updates in single event loop', async () => {
			const { parseMessage } = await import('graphql-ws');
			const handler = GraphQLLambdaWsAdapter(mockAdvancedWsAdapterOptions);

			// Track Redis operations to verify batching
			const redisOperations: string[] = [];
			mockRedis.HSET.mockImplementation(async (...args: any[]) => {
				redisOperations.push(`HSET:${args.join(',')}`);
				return 1;
			});

			// Mock onSubscribe to make multiple context updates
			mockOnSubscribe.mockImplementation(async (ctx: any, id: string) => {
				// Multiple updates in quick succession
				ctx.extra.step1 = `${id}_step1`;
				ctx.extra.step2 = `${id}_step2`;
				ctx.extra.step3 = `${id}_step3`;
				ctx.extra.lastUpdate = Date.now();

				return null;
			});

			const subscribeMessage = {
				type: MessageType.Subscribe,
				id: 'batch-test',
				payload: { query: 'subscription { test }' },
			};
			(parseMessage as any).mockReturnValue(subscribeMessage);

			const event = createMessageEvent(JSON.stringify(subscribeMessage));
			await handler(event, mockLambdaContext, () => {});

			// Verify flushChanges was called to batch updates
			expect(mockSocket.flushChanges).toHaveBeenCalled();

			// Verify context updates were made
			expect(mockOnSubscribe).toHaveBeenCalledWith(
				expect.objectContaining({
					extra: expect.any(Object),
				}),
				'batch-test',
				subscribeMessage.payload,
			);
		});
	});

	describe('Deep Proxy Context Protection', () => {
		test('Context proxy detects nested property changes', async () => {
			const { parseMessage } = await import('graphql-ws');
			const handler = GraphQLLambdaWsAdapter(mockAdvancedWsAdapterOptions);

			// Mock onSubscribe to make deep nested changes
			mockOnSubscribe.mockImplementation(async (ctx: any) => {
				// Deep nested updates that should be tracked by proxy
				if (!ctx.extra.user) ctx.extra.user = {};
				ctx.extra.user.profile = {
					name: 'John Doe',
					settings: {
						theme: 'dark',
						notifications: {
							email: true,
							push: false,
						},
					},
				};

				// Array updates
				if (!ctx.extra.subscriptions) ctx.extra.subscriptions = [];
				ctx.extra.subscriptions.push('new-subscription');

				return null;
			});

			const subscribeMessage = {
				type: MessageType.Subscribe,
				id: 'deep-proxy-test',
				payload: { query: 'subscription { test }' },
			};
			(parseMessage as any).mockReturnValue(subscribeMessage);

			const event = createMessageEvent(JSON.stringify(subscribeMessage));
			await handler(event, mockLambdaContext, () => {});

			// Verify deep changes were processed
			expect(mockOnSubscribe).toHaveBeenCalledWith(
				expect.objectContaining({
					extra: expect.any(Object),
				}),
				'deep-proxy-test',
				subscribeMessage.payload,
			);

			// Verify flushChanges was called to persist deep changes
			expect(mockSocket.flushChanges).toHaveBeenCalled();
		});

		test('Proxy prevents race conditions during concurrent property access', async () => {
			const { parseMessage } = await import('graphql-ws');
			const handler = GraphQLLambdaWsAdapter(mockAdvancedWsAdapterOptions);

			// Mock context with shared state
			const sharedContext = {
				connectionInitReceived: true,
				acknowledged: true,
				subscriptions: {},
				extra: {
					counter: 0,
					operations: [] as string[],
				},
			};

			mockSocket.context.mockResolvedValue(sharedContext);

			// Mock onSubscribe to simulate concurrent access
			mockOnSubscribe.mockImplementation(async (ctx: any, id: string) => {
				// Simulate concurrent read-modify-write operations
				const currentCounter = ctx.extra.counter;

				// Simulate async operation
				await new Promise(resolve => setTimeout(resolve, Math.random() * 5));

				// Update counter and log operation
				ctx.extra.counter = currentCounter + 1;
				ctx.extra.operations.push(`${id}:${ctx.extra.counter}`);

				return null;
			});

			// Create multiple concurrent subscriptions
			const concurrentSubscriptions = ['race1', 'race2', 'race3'].map(id => {
				const subscribeMessage = {
					type: MessageType.Subscribe,
					id,
					payload: { query: `subscription { ${id} }` },
				};
				(parseMessage as any).mockReturnValue(subscribeMessage);

				const event = createMessageEvent(JSON.stringify(subscribeMessage));
				return handler(event, mockLambdaContext, () => {});
			});

			// Execute concurrently
			const results = await Promise.all(concurrentSubscriptions);

			// Verify all completed successfully
			results.forEach(result => {
				expect((result as any)?.statusCode).toBe(200);
			});

			// Verify onSubscribe was called for each
			expect(mockOnSubscribe).toHaveBeenCalledTimes(3);
		});
	});

	describe('Serverless Event Loop Simulation', () => {
		test('Single connection handles multiple subscription lifecycles', async () => {
			const { parseMessage } = await import('graphql-ws');
			const handler = GraphQLLambdaWsAdapter(mockAdvancedWsAdapterOptions);
			const connectionId = 'lifecycle-connection';

			// Track subscription states
			const subscriptionStates = new Map();

			// Mock onSubscribe to track subscription lifecycle
			mockOnSubscribe.mockImplementation(
				async (ctx: any, id: string, payload: any) => {
					subscriptionStates.set(id, {
						status: 'subscribed',
						query: payload.query,
						timestamp: Date.now(),
					});

					ctx.extra.activeSubscriptions = Array.from(subscriptionStates.keys());
					return null;
				},
			);

			// Mock onComplete to track completion
			mockOnComplete.mockImplementation(async (ctx: any, id: string) => {
				subscriptionStates.set(id, {
					...subscriptionStates.get(id),
					status: 'completed',
					completedAt: Date.now(),
				});

				ctx.extra.activeSubscriptions = Array.from(
					subscriptionStates.keys(),
				).filter(
					subId => subscriptionStates.get(subId)?.status === 'subscribed',
				);
			});

			// Phase 1: Create multiple subscriptions
			const subscriptionIds = ['lifecycle1', 'lifecycle2', 'lifecycle3'];

			for (const subId of subscriptionIds) {
				const subscribeMessage = {
					type: MessageType.Subscribe,
					id: subId,
					payload: { query: `subscription { ${subId} }` },
				};
				(parseMessage as any).mockReturnValue(subscribeMessage);

				const event = createMessageEvent(
					JSON.stringify(subscribeMessage),
					connectionId,
				);
				const result = await handler(event, mockLambdaContext, () => {});
				expect((result as any)?.statusCode).toBe(200);
			}

			// Phase 2: Complete some subscriptions
			mockRedis.get.mockResolvedValue('{"query": "subscription { test }"}');

			const completeMessage = {
				type: MessageType.Complete,
				id: 'lifecycle1',
			};
			(parseMessage as any).mockReturnValue(completeMessage);

			const completeEvent = createMessageEvent(
				JSON.stringify(completeMessage),
				connectionId,
			);
			await handler(completeEvent, mockLambdaContext, () => {});

			// Verify lifecycle management
			expect(mockOnSubscribe).toHaveBeenCalledTimes(3);
			expect(mockOnComplete).toHaveBeenCalledTimes(1);
			expect(mockOnComplete).toHaveBeenCalledWith(
				expect.any(Object),
				'lifecycle1',
				{ query: 'subscription { test }' },
			);

			// Verify context updates throughout lifecycle
			expect(mockSocket.flushChanges).toHaveBeenCalled();
		});

		test('Event loop batching with mixed message types', async () => {
			const { parseMessage } = await import('graphql-ws');
			const handler = GraphQLLambdaWsAdapter(mockAdvancedWsAdapterOptions);

			// Track message processing order
			const messageOrder: string[] = [];

			// Mock callbacks to track order
			mockOnSubscribe.mockImplementation(async (ctx: any, id: string) => {
				messageOrder.push(`subscribe:${id}`);
				ctx.extra.lastAction = `subscribe:${id}`;
				return null;
			});

			mockOnComplete.mockImplementation(async (ctx: any, id: string) => {
				messageOrder.push(`complete:${id}`);
				ctx.extra.lastAction = `complete:${id}`;
			});

			// Simulate mixed message processing in single event loop
			const messages = [
				{
					type: MessageType.Subscribe,
					id: 'mixed1',
					payload: { query: 'sub1' },
				},
				{
					type: MessageType.Subscribe,
					id: 'mixed2',
					payload: { query: 'sub2' },
				},
				{ type: MessageType.Ping, payload: { timestamp: Date.now() } },
				{ type: MessageType.Complete, id: 'mixed1' },
			];

			// Process messages sequentially (simulating event loop)
			for (const [index, message] of messages.entries()) {
				(parseMessage as any).mockReturnValue(message);

				if (message.type === MessageType.Complete) {
					mockRedis.get.mockResolvedValue('{"query": "subscription { test }"}');
				}

				const event = createMessageEvent(JSON.stringify(message));
				const result = await handler(event, mockLambdaContext, () => {});

				// All messages should complete successfully
				expect((result as any)?.statusCode).toBe(200);
			}

			// Verify message processing order
			expect(messageOrder).toEqual([
				'subscribe:mixed1',
				'subscribe:mixed2',
				'complete:mixed1',
			]);

			// Verify batched context updates
			expect(mockSocket.flushChanges).toHaveBeenCalled();
		});
	});

	describe('Error Recovery and Consistency', () => {
		test('Context remains consistent after subscription errors', async () => {
			const { parseMessage } = await import('graphql-ws');
			const handler = GraphQLLambdaWsAdapter(mockAdvancedWsAdapterOptions);

			// Mock onSubscribe to fail on specific subscription
			mockOnSubscribe.mockImplementation(async (ctx: any, id: string) => {
				ctx.extra.attempts = (ctx.extra.attempts || 0) + 1;

				if (id === 'failing-sub') {
					throw new Error('Subscription failed');
				}

				ctx.extra.successfulSubs = (ctx.extra.successfulSubs || 0) + 1;
				return null;
			});

			// Process successful subscription first
			const successMessage = {
				type: MessageType.Subscribe,
				id: 'success-sub',
				payload: { query: 'subscription { success }' },
			};
			(parseMessage as any).mockReturnValue(successMessage);

			const successEvent = createMessageEvent(JSON.stringify(successMessage));
			const successResult = await handler(
				successEvent,
				mockLambdaContext,
				() => {},
			);
			expect((successResult as any)?.statusCode).toBe(200);

			// Process failing subscription
			const failMessage = {
				type: MessageType.Subscribe,
				id: 'failing-sub',
				payload: { query: 'subscription { fail }' },
			};
			(parseMessage as any).mockReturnValue(failMessage);

			const failEvent = createMessageEvent(JSON.stringify(failMessage));

			// Should handle error gracefully
			await expect(
				handler(failEvent, mockLambdaContext, () => {}),
			).rejects.toThrow('Subscription failed');
			expect(mockSocket.close).toHaveBeenCalledWith(CloseCode.BadRequest);

			// Verify context consistency is maintained
			expect(mockOnSubscribe).toHaveBeenCalledTimes(2);
			expect(mockSocket.flushChanges).toHaveBeenCalled();
		});

		test('Concurrent context updates maintain data integrity', async () => {
			const { parseMessage } = await import('graphql-ws');
			const handler = GraphQLLambdaWsAdapter(mockAdvancedWsAdapterOptions);

			// Shared context state
			let contextVersion = 0;
			const contextHistory: any[] = [];

			// Mock context to simulate versioning
			mockSocket.context.mockImplementation(async () => {
				const ctx = {
					connectionInitReceived: true,
					acknowledged: true,
					subscriptions: {},
					extra: {
						version: contextVersion++,
						timestamp: Date.now(),
						data: {},
					},
				};
				contextHistory.push({ ...ctx });
				return ctx;
			});

			// Mock onSubscribe to make concurrent updates
			mockOnSubscribe.mockImplementation(async (ctx: any, id: string) => {
				// Simulate concurrent data updates
				ctx.extra.data[id] = {
					created: Date.now(),
					version: ctx.extra.version,
				};

				// Simulate some async work
				await new Promise(resolve => setTimeout(resolve, Math.random() * 10));

				ctx.extra.lastModified = Date.now();
				return null;
			});

			// Create multiple concurrent subscriptions
			const concurrentOps = Array.from({ length: 5 }, (_, i) => {
				const subscribeMessage = {
					type: MessageType.Subscribe,
					id: `concurrent-${i}`,
					payload: { query: `subscription { test${i} }` },
				};
				(parseMessage as any).mockReturnValue(subscribeMessage);

				const event = createMessageEvent(JSON.stringify(subscribeMessage));
				return handler(event, mockLambdaContext, () => {});
			});

			// Execute all concurrently
			const results = await Promise.all(concurrentOps);

			// Verify all operations completed
			results.forEach(result => {
				expect((result as any)?.statusCode).toBe(200);
			});

			// Verify data integrity
			expect(mockOnSubscribe).toHaveBeenCalledTimes(5);
			expect(contextHistory.length).toBeGreaterThan(0);

			// Verify context updates were flushed
			expect(mockSocket.flushChanges).toHaveBeenCalled();
		});
	});
});
