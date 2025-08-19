import { test, expect, mock, beforeEach } from 'bun:test';
import type { APIGatewayProxyWebsocketEventV2, Context } from 'aws-lambda';
import { MessageType, CloseCode } from 'graphql-ws';
import type { GraphQLSchema, ExecutionArgs } from 'graphql';

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

// Mock server options callbacks
const mockOnConnect = mock();
const mockOnDisconnect = mock();
const mockOnClose = mock();
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
const mockParse = mock(() => ({ kind: 'Document' }));
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

// Mock socket
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

// Sample data
const mockWsAdapterOptions: WsAdapterOptions = {
	redis: mockRedis,
	gateway: mockGateway,
	pubsub: mockPubsub,
	schema: mockSchema,
	onConnect: mockOnConnect,
	onDisconnect: mockOnDisconnect,
	onClose: mockOnClose,
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

const createConnectEvent = (
	connectionId = 'test-connection-123',
): APIGatewayProxyWebsocketEventV2 =>
	({
		requestContext: {
			routeKey: '$connect',
			eventType: 'CONNECT',
			connectionId,
			requestId: 'test-request',
			apiId: 'test-api',
			stage: 'dev',
			requestTime: '01/Jan/2023:00:00:00 +0000',
			requestTimeEpoch: Date.now(),
			domainName: 'test.execute-api.us-east-1.amazonaws.com',
		} as any,
		multiValueHeaders: {
			'Sec-WebSocket-Protocol': ['graphql-transport-ws'],
		},
		isBase64Encoded: false,
	}) as any;

const createDisconnectEvent = (
	connectionId = 'test-connection-123',
): APIGatewayProxyWebsocketEventV2 =>
	({
		requestContext: {
			routeKey: '$disconnect',
			eventType: 'DISCONNECT',
			connectionId,
			requestId: 'test-request',
			apiId: 'test-api',
			stage: 'dev',
			requestTime: '01/Jan/2023:00:00:00 +0000',
			requestTimeEpoch: Date.now(),
			domainName: 'test.execute-api.us-east-1.amazonaws.com',
			disconnectStatusCode: 1000,
			disconnectReason: 'Client disconnect',
		} as any,
		isBase64Encoded: false,
	}) as any;

const createMessageEvent = (
	body: string,
	connectionId = 'test-connection-123',
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
	mockOnDisconnect.mockClear();
	mockOnClose.mockClear();
	mockOnSubscribe.mockClear();
	mockOnNext.mockClear();
	mockOnError.mockClear();
	mockOnComplete.mockClear();

	mockRedis.set.mockClear();
	mockRedis.get.mockClear();

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
	mockParse.mockReturnValue({ kind: 'Document' });
	mockValidate.mockReturnValue([]);
	mockExecute.mockReturnValue({ data: { test: 'result' } });

	// Set default return values
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
});

test('GraphQLLambdaWsAdapter - throws error for invalid pubsub', () => {
	const invalidOptions = {
		...mockWsAdapterOptions,
		pubsub: {} as any, // Invalid pubsub
	};

	expect(() => GraphQLLambdaWsAdapter(invalidOptions)).toThrow(
		'GraphQL Lambda adapter requires GraphQLLambdaPubsub',
	);
});

test('GraphQLLambdaWsAdapter - returns handler function', () => {
	const handler = GraphQLLambdaWsAdapter(mockWsAdapterOptions);

	expect(typeof handler).toBe('function');
});

test('CONNECT - successful connection with supported protocol', async () => {
	const handler = GraphQLLambdaWsAdapter(mockWsAdapterOptions);
	const event = createConnectEvent();

	const result = await handler(event, mockLambdaContext, () => {});

	expect(result).toEqual({
		statusCode: 200,
		headers: {
			'Sec-WebSocket-Protocol': 'graphql-transport-ws',
		},
	});
	expect(mockSocket.createContext).toHaveBeenCalledWith({
		connectionInitReceived: false,
		acknowledged: false,
		subscriptions: {},
		extra: event.requestContext,
	});
});

test('CONNECT - rejects unsupported protocol', async () => {
	// Mock handleProtocols to return null (unsupported)
	const { handleProtocols } = await import('graphql-ws');
	(handleProtocols as any).mockReturnValue(null);

	const handler = GraphQLLambdaWsAdapter(mockWsAdapterOptions);
	const event = createConnectEvent();

	const result = await handler(event, mockLambdaContext, () => {});

	expect(result).toEqual({
		statusCode: 400,
		body: JSON.stringify({
			error: 'Subprotocol not acceptable',
			message:
				'The requested WebSocket subprotocol is not supported by this server',
			supportedProtocol: null,
		}),
	});

	// Reset for other tests
	(handleProtocols as any).mockReturnValue('graphql-transport-ws');
});

test('DISCONNECT - handles disconnection with onComplete and onDisconnect', async () => {
	// Mock subscriptions and payload
	mockGetConnectionSubscriptions.mockResolvedValue(['sub-1', 'sub-2'] as any);
	mockRedis.get
		.mockResolvedValueOnce('{"query": "subscription { test1 }"}')
		.mockResolvedValueOnce('{"query": "subscription { test2 }"}');

	const handler = GraphQLLambdaWsAdapter(mockWsAdapterOptions);
	const event = createDisconnectEvent();

	const result = await handler(event, mockLambdaContext, () => {});

	expect(result).toEqual({ statusCode: 200 });
	expect(mockDisconnect).toHaveBeenCalledWith('test-connection-123');
	expect(mockOnComplete).toHaveBeenCalledTimes(2);
	expect(mockOnComplete).toHaveBeenCalledWith(expect.any(Object), 'sub-1', {
		query: 'subscription { test1 }',
	});
	expect(mockOnComplete).toHaveBeenCalledWith(expect.any(Object), 'sub-2', {
		query: 'subscription { test2 }',
	});
	expect(mockOnDisconnect).toHaveBeenCalledWith(
		expect.any(Object),
		1000,
		'Client disconnect',
	);
	expect(mockOnClose).toHaveBeenCalledWith(
		expect.any(Object),
		1000,
		'Client disconnect',
	);
});

test('MESSAGE - ConnectionInit flow', async () => {
	const { parseMessage } = await import('graphql-ws');
	const connectionInitMessage = {
		type: MessageType.ConnectionInit,
		payload: { authorization: 'Bearer token123' },
	};
	(parseMessage as any).mockReturnValue(connectionInitMessage);

	// Mock context to show connection not yet initialized
	mockSocket.context.mockResolvedValue({
		connectionInitReceived: false,
		acknowledged: false,
		subscriptions: {},
		extra: {},
	});

	const handler = GraphQLLambdaWsAdapter(mockWsAdapterOptions);
	const event = createMessageEvent(JSON.stringify(connectionInitMessage));

	const result = await handler(event, mockLambdaContext, () => {});

	expect(result).toEqual({ statusCode: 200 });
	expect(mockOnConnect).toHaveBeenCalledWith(expect.any(Object));
	expect(mockSocket.send).toHaveBeenCalledWith(
		JSON.stringify({ type: MessageType.ConnectionAck }),
	);
});

test('MESSAGE - ConnectionInit with custom payload', async () => {
	const { parseMessage } = await import('graphql-ws');
	const connectionInitMessage = {
		type: MessageType.ConnectionInit,
		payload: { authorization: 'Bearer token123' },
	};
	(parseMessage as any).mockReturnValue(connectionInitMessage);

	// Mock onConnect to return custom payload
	const customPayload = { serverVersion: '1.0.0', features: ['subscriptions'] };
	mockOnConnect.mockResolvedValue(customPayload);

	mockSocket.context.mockResolvedValue({
		connectionInitReceived: false,
		acknowledged: false,
		subscriptions: {},
		extra: {},
	});

	const handler = GraphQLLambdaWsAdapter(mockWsAdapterOptions);
	const event = createMessageEvent(JSON.stringify(connectionInitMessage));

	await handler(event, mockLambdaContext, () => {});

	expect(mockSocket.send).toHaveBeenCalledWith(
		JSON.stringify({
			type: MessageType.ConnectionAck,
			payload: customPayload,
		}),
	);
});

test('MESSAGE - ConnectionInit forbidden', async () => {
	const { parseMessage } = await import('graphql-ws');
	const connectionInitMessage = {
		type: MessageType.ConnectionInit,
		payload: { authorization: 'invalid-token' },
	};
	(parseMessage as any).mockReturnValue(connectionInitMessage);

	// Mock onConnect to return false (forbidden)
	mockOnConnect.mockResolvedValue(false);

	mockSocket.context.mockResolvedValue({
		connectionInitReceived: false,
		acknowledged: false,
		subscriptions: {},
		extra: {},
	});

	const handler = GraphQLLambdaWsAdapter(mockWsAdapterOptions);
	const event = createMessageEvent(JSON.stringify(connectionInitMessage));

	await handler(event, mockLambdaContext, () => {});

	expect(mockSocket.close).toHaveBeenCalledWith(
		CloseCode.Forbidden,
		'Forbidden',
	);
});

test('MESSAGE - Ping/Pong flow', async () => {
	const { parseMessage } = await import('graphql-ws');

	// Test Ping message
	const pingMessage = {
		type: MessageType.Ping,
		payload: { timestamp: Date.now() },
	};
	(parseMessage as any).mockReturnValue(pingMessage);

	const handler = GraphQLLambdaWsAdapter(mockWsAdapterOptions);
	const event = createMessageEvent(JSON.stringify(pingMessage));

	await handler(event, mockLambdaContext, () => {});

	expect(mockSocket.send).toHaveBeenCalledWith(
		JSON.stringify({
			type: MessageType.Pong,
			payload: pingMessage.payload,
		}),
	);

	// Test Ping without payload
	const pingMessageNoPayload = { type: MessageType.Ping };
	(parseMessage as any).mockReturnValue(pingMessageNoPayload);
	mockSocket.send.mockClear();

	await handler(event, mockLambdaContext, () => {});

	expect(mockSocket.send).toHaveBeenCalledWith(
		JSON.stringify({ type: MessageType.Pong }),
	);
});

test('MESSAGE - Subscribe flow with subscription operation', async () => {
	const { parseMessage } = await import('graphql-ws');
	const subscribeMessage = {
		type: MessageType.Subscribe,
		id: 'sub-123',
		payload: {
			query: 'subscription { messageAdded { id content } }',
			variables: {},
		},
	};
	(parseMessage as any).mockReturnValue(subscribeMessage);
	mockGetOperationAST.mockReturnValue({ operation: 'subscription' });

	// Mock isRegistrableChannel to return true for subscription
	const { isRegistrableChannel } = await import('../utils');
	const mockChannel = {
		register: mock().mockResolvedValue(undefined),
	};
	(isRegistrableChannel as any).mockReturnValue(true);

	// Mock custom subscribe
	mock.module('./graphql', () => ({
		customSubscribe: mock(() => mockChannel),
	}));

	const handler = GraphQLLambdaWsAdapter(mockWsAdapterOptions);
	const event = createMessageEvent(JSON.stringify(subscribeMessage));

	await handler(event, mockLambdaContext, () => {});

	expect(mockRedis.set).toHaveBeenCalledWith(
		'payload:sub-123',
		JSON.stringify(subscribeMessage.payload),
	);
	expect(mockChannel.register).toHaveBeenCalledWith(
		'test-connection-123',
		'sub-123',
	);
});

test('MESSAGE - Subscribe flow with query operation (single result)', async () => {
	const { parseMessage } = await import('graphql-ws');
	const subscribeMessage = {
		type: MessageType.Subscribe,
		id: 'query-123',
		payload: {
			query: 'query { user(id: "1") { name } }',
			variables: {},
		},
	};
	(parseMessage as any).mockReturnValue(subscribeMessage);
	mockGetOperationAST.mockReturnValue({ operation: 'query' });

	const mockResult = { data: { user: { name: 'John Doe' } } };
	(mockExecute as any).mockResolvedValue(mockResult);

	// Ensure isRegistrableChannel returns false for query operations
	const { isRegistrableChannel } = await import('../utils');
	(isRegistrableChannel as any).mockReturnValue(false);

	const handler = GraphQLLambdaWsAdapter(mockWsAdapterOptions);
	const event = createMessageEvent(JSON.stringify(subscribeMessage));

	await handler(event, mockLambdaContext, () => {});

	expect(mockEmitter.next).toHaveBeenCalledWith(
		mockResult,
		subscribeMessage,
		expect.any(Object),
	);
	expect(mockEmitter.complete).toHaveBeenCalledWith(false, subscribeMessage);
});

test('MESSAGE - Subscribe with validation errors', async () => {
	const { parseMessage } = await import('graphql-ws');
	const subscribeMessage = {
		type: MessageType.Subscribe,
		id: 'invalid-123',
		payload: {
			query: 'subscription { invalidField }',
			variables: {},
		},
	};
	(parseMessage as any).mockReturnValue(subscribeMessage);

	const validationErrors = [new Error('Field "invalidField" does not exist')];
	mockValidate.mockReturnValue(validationErrors as any);

	const handler = GraphQLLambdaWsAdapter(mockWsAdapterOptions);
	const event = createMessageEvent(JSON.stringify(subscribeMessage));

	await handler(event, mockLambdaContext, () => {});

	expect(mockEmitter.error).toHaveBeenCalledWith(
		validationErrors,
		subscribeMessage,
	);
});

test('MESSAGE - Subscribe unauthorized (not acknowledged)', async () => {
	const { parseMessage } = await import('graphql-ws');
	const subscribeMessage = {
		type: MessageType.Subscribe,
		id: 'sub-123',
		payload: {
			query: 'subscription { messageAdded { id } }',
		},
	};
	(parseMessage as any).mockReturnValue(subscribeMessage);

	// Mock context as not acknowledged
	mockSocket.context.mockResolvedValue({
		connectionInitReceived: true,
		acknowledged: false, // Not acknowledged
		subscriptions: {},
		extra: {},
	});

	const handler = GraphQLLambdaWsAdapter(mockWsAdapterOptions);
	const event = createMessageEvent(JSON.stringify(subscribeMessage));

	await handler(event, mockLambdaContext, () => {});

	expect(mockSocket.close).toHaveBeenCalledWith(
		CloseCode.Unauthorized,
		'Unauthorized',
	);
});

test('MESSAGE - Subscribe with existing subscription', async () => {
	const { parseMessage } = await import('graphql-ws');
	const subscribeMessage = {
		type: MessageType.Subscribe,
		id: 'existing-sub',
		payload: {
			query: 'subscription { messageAdded { id } }',
		},
	};
	(parseMessage as any).mockReturnValue(subscribeMessage);

	// Mock subscription already exists
	mockIsRegistered.mockResolvedValue(true);

	const handler = GraphQLLambdaWsAdapter(mockWsAdapterOptions);
	const event = createMessageEvent(JSON.stringify(subscribeMessage));

	await handler(event, mockLambdaContext, () => {});

	expect(mockSocket.close).toHaveBeenCalledWith(
		CloseCode.SubscriberAlreadyExists,
		'Subscriber for existing-sub already exists',
	);
});

test('MESSAGE - Complete subscription', async () => {
	const { parseMessage } = await import('graphql-ws');
	const completeMessage = {
		type: MessageType.Complete,
		id: 'sub-to-complete',
	};
	(parseMessage as any).mockReturnValue(completeMessage);

	// Mock payload exists in Redis
	mockRedis.get.mockResolvedValue('{"query": "subscription { test }"}');

	const handler = GraphQLLambdaWsAdapter(mockWsAdapterOptions);
	const event = createMessageEvent(JSON.stringify(completeMessage));

	await handler(event, mockLambdaContext, () => {});

	expect(mockUnregister).toHaveBeenCalledWith(
		'test-connection-123',
		'sub-to-complete',
	);
	expect(mockOnComplete).toHaveBeenCalledWith(
		expect.any(Object),
		'sub-to-complete',
		{ query: 'subscription { test }' },
	);
});

test('MESSAGE - Invalid message format', async () => {
	const { parseMessage } = await import('graphql-ws');
	(parseMessage as any).mockImplementation(() => {
		throw new Error('Invalid message format');
	});

	const handler = GraphQLLambdaWsAdapter(mockWsAdapterOptions);
	const event = createMessageEvent('invalid-json');

	await handler(event, mockLambdaContext, () => {});

	expect(mockSocket.close).toHaveBeenCalledWith(
		CloseCode.BadRequest,
		'Invalid message received',
	);
});

test('MESSAGE - Custom route handler', async () => {
	const customRouteHandler = mock().mockResolvedValue({ statusCode: 202 });
	const optionsWithCustomHandler = {
		...mockWsAdapterOptions,
		customRouteHandler,
	};

	const handler = GraphQLLambdaWsAdapter(optionsWithCustomHandler);
	const event = createMessageEvent('test', 'test-connection-123');
	event.requestContext.routeKey = 'custom-route'; // Not $default

	const result = await handler(event, mockLambdaContext, () => {});

	expect(result).toEqual({ statusCode: 202 });
	expect(customRouteHandler).toHaveBeenCalledWith(event, mockLambdaContext);
});

test('Integration - Full connection lifecycle', async () => {
	// Mock Redis to return subscription payload when needed
	mockRedis.get.mockResolvedValue(
		'{"query": "subscription { messageAdded { id } }"}',
	);

	const handler = GraphQLLambdaWsAdapter(mockWsAdapterOptions);

	// 1. CONNECT
	const connectEvent = createConnectEvent('lifecycle-test');
	const connectResult = await handler(
		connectEvent,
		mockLambdaContext,
		() => {},
	);
	expect((connectResult as any)?.statusCode).toBe(200);

	// 2. CONNECTION_INIT
	const { parseMessage } = await import('graphql-ws');
	const connectionInitMessage = {
		type: MessageType.ConnectionInit,
		payload: { token: 'test-token' },
	};
	(parseMessage as any).mockReturnValue(connectionInitMessage);

	mockSocket.context.mockResolvedValue({
		connectionInitReceived: false,
		acknowledged: false,
		subscriptions: {},
		extra: {},
	});

	const initEvent = createMessageEvent(
		JSON.stringify(connectionInitMessage),
		'lifecycle-test',
	);
	const initResult = await handler(initEvent, mockLambdaContext, () => {});
	expect((initResult as any)?.statusCode).toBe(200);

	// 3. SUBSCRIBE
	const subscribeMessage = {
		type: MessageType.Subscribe,
		id: 'lifecycle-sub',
		payload: {
			query: 'subscription { messageAdded { id } }',
		},
	};
	(parseMessage as any).mockReturnValue(subscribeMessage);

	mockSocket.context.mockResolvedValue({
		connectionInitReceived: true,
		acknowledged: true,
		subscriptions: {},
		extra: {},
	});

	const subscribeEvent = createMessageEvent(
		JSON.stringify(subscribeMessage),
		'lifecycle-test',
	);
	const subscribeResult = await handler(
		subscribeEvent,
		mockLambdaContext,
		() => {},
	);
	expect((subscribeResult as any)?.statusCode).toBe(200);

	// 4. DISCONNECT
	const disconnectEvent = createDisconnectEvent('lifecycle-test');
	const disconnectResult = await handler(
		disconnectEvent,
		mockLambdaContext,
		() => {},
	);
	expect((disconnectResult as any)?.statusCode).toBe(200);

	// Verify all callbacks were called
	expect(mockOnConnect).toHaveBeenCalled();
	expect(mockOnDisconnect).toHaveBeenCalled();
	expect(mockOnClose).toHaveBeenCalled();
	expect(mockSocket.flushChanges).toHaveBeenCalled(); // Called at least once
});

test('Error handling - Invalid message closes connection', async () => {
	const { parseMessage } = await import('graphql-ws');
	(parseMessage as any).mockImplementation(() => {
		throw new Error('Invalid JSON');
	});

	const handler = GraphQLLambdaWsAdapter(mockWsAdapterOptions);
	const event = createMessageEvent('invalid-json');

	await handler(event, mockLambdaContext, () => {});

	expect(mockSocket.close).toHaveBeenCalledWith(
		CloseCode.BadRequest,
		'Invalid message received',
	);
});

test('Subscribe with default execution flow', async () => {
	const { parseMessage } = await import('graphql-ws');
	const subscribeMessage = {
		type: MessageType.Subscribe,
		id: 'test-sub',
		payload: {
			query: 'subscription { messageAdded { id } }',
		},
	};
	(parseMessage as any).mockReturnValue(subscribeMessage);

	// Ensure isRegistrableChannel returns false so we use default execution
	const { isRegistrableChannel } = await import('../utils');
	(isRegistrableChannel as any).mockReturnValue(false);

	const handler = GraphQLLambdaWsAdapter(mockWsAdapterOptions);
	const event = createMessageEvent(JSON.stringify(subscribeMessage));

	// Should complete without throwing
	const result = await handler(event, mockLambdaContext, () => {});
	expect(result).toEqual({ statusCode: 200 });
});
