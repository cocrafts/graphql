import { test, expect, mock, beforeEach } from 'bun:test';
import {
	DeleteConnectionCommand,
	PostToConnectionCommand,
	type ApiGatewayManagementApiClient,
} from '@aws-sdk/client-apigatewaymanagementapi';
import type { RedisClientType } from 'redis';

import { createSocket } from './socket';
import { buildContext, createContextManager } from './context';

// Mock the dependencies
const mockGatewaySend = mock();
const mockGateway = {
	send: mockGatewaySend,
} as unknown as ApiGatewayManagementApiClient;

const mockRedisHGETALL = mock();
const mockRedisHSET = mock();
const mockRedisHDEL = mock();
const mockRedis = {
	HGETALL: mockRedisHGETALL,
	HSET: mockRedisHSET,
	HDEL: mockRedisHDEL,
} as unknown as RedisClientType;

const mockContextManager = {
	context: {
		connectionInitReceived: true,
		acknowledged: true,
		subscriptions: {},
		extra: { userId: '123' },
	},
	waitAllSync: mock(() => Promise.resolve([])),
};

// Mock the context utilities
mock.module('./context', () => ({
	buildContext: mock((raw: object) => ({
		connectionInitReceived: false,
		acknowledged: false,
		subscriptions: {},
		extra: raw,
	})),
	createContextManager: mock(() => mockContextManager),
}));

beforeEach(() => {
	// Reset all mocks before each test
	mockGatewaySend.mockClear();
	mockGatewaySend.mockResolvedValue(undefined); // Reset to success
	mockRedisHGETALL.mockClear();
	mockRedisHSET.mockClear();
	mockRedisHDEL.mockClear();
	mockContextManager.waitAllSync.mockClear();
	(buildContext as any).mockClear();
	(createContextManager as any).mockClear();
});

test('createSocket - creates socket with correct connection ID', () => {
	const connectionId = 'test-connection-123';
	const socket = createSocket(mockGateway, mockRedis, connectionId);

	expect(socket).toBeDefined();
	expect(typeof socket.context).toBe('function');
	expect(typeof socket.createContext).toBe('function');
	expect(typeof socket.close).toBe('function');
	expect(typeof socket.send).toBe('function');
	expect(typeof socket.flushChanges).toBe('function');
});

test('createSocket.context - loads context from Redis when no context manager exists', async () => {
	const connectionId = 'test-connection-123';
	const rawContext = {
		'extra.userId': '456',
		'extra.role': 'admin',
	};

	mockRedisHGETALL.mockResolvedValue(rawContext);

	const socket = createSocket(mockGateway, mockRedis, connectionId);
	const context = await socket.context();

	expect(mockRedisHGETALL).toHaveBeenCalledWith(
		'AWSWebsocketGraphQL:connection:test-connection-123',
	);
	expect(buildContext).toHaveBeenCalledWith(rawContext);
	expect(createContextManager).toHaveBeenCalledWith(
		expect.any(Object),
		'AWSWebsocketGraphQL:connection:test-connection-123',
		mockRedis,
	);
	expect(context).toBe(mockContextManager.context);
});

test('createSocket.context - returns default context when Redis has no data', async () => {
	const connectionId = 'test-connection-456';

	mockRedisHGETALL.mockResolvedValue(null);

	const socket = createSocket(mockGateway, mockRedis, connectionId);
	const context = await socket.context();

	expect(mockRedisHGETALL).toHaveBeenCalledWith(
		'AWSWebsocketGraphQL:connection:test-connection-456',
	);
	expect(context).toEqual({
		connectionInitReceived: false,
		acknowledged: false,
		subscriptions: {},
		extra: {},
	});
});

test('createSocket.context - reuses existing context manager', async () => {
	const connectionId = 'test-connection-789';
	const rawContext = { 'extra.test': 'reuse' };

	mockRedisHGETALL.mockResolvedValue(rawContext);

	const socket = createSocket(mockGateway, mockRedis, connectionId);

	// First call creates context manager
	const context1 = await socket.context();

	// Reset mocks to check second call behavior
	mockRedisHGETALL.mockClear();
	(buildContext as any).mockClear();
	(createContextManager as any).mockClear();

	// Second call should reuse existing context manager
	const context2 = await socket.context();

	expect(mockRedisHGETALL).not.toHaveBeenCalled();
	expect(buildContext).not.toHaveBeenCalled();
	expect(createContextManager).not.toHaveBeenCalled();
	expect(context1).toBe(mockContextManager.context);
	expect(context2).toBe(mockContextManager.context);
	expect(context1).toBe(context2);
});

test('createSocket.context - handles concurrent calls correctly', async () => {
	const connectionId = 'test-connection-concurrent';
	const rawContext = { 'extra.test': 'value' };

	mockRedisHGETALL.mockResolvedValue(rawContext);

	const socket = createSocket(mockGateway, mockRedis, connectionId);

	// Make multiple concurrent calls
	const [context1, context2, context3] = await Promise.all([
		socket.context(),
		socket.context(),
		socket.context(),
	]);

	// Should only call Redis once due to promise caching
	expect(mockRedisHGETALL).toHaveBeenCalledTimes(1);
	expect(buildContext).toHaveBeenCalledTimes(1);
	expect(createContextManager).toHaveBeenCalledTimes(1);

	// All calls should return the same context
	expect(context1).toBe(mockContextManager.context);
	expect(context2).toBe(mockContextManager.context);
	expect(context3).toBe(mockContextManager.context);
});

test('createSocket.createContext - creates new context manager with provided data', async () => {
	const connectionId = 'test-connection-create';
	const contextData = {
		connectionInitReceived: true,
		acknowledged: true,
		subscriptions: {},
		extra: { customData: 'test' },
	};

	const socket = createSocket(mockGateway, mockRedis, connectionId);
	const context = await socket.createContext(contextData);

	expect(createContextManager).toHaveBeenCalledWith(
		contextData,
		'AWSWebsocketGraphQL:connection:test-connection-create',
		mockRedis,
	);
	expect(context).toBe(mockContextManager.context);
});

test('createSocket.createContext - replaces existing context manager', async () => {
	const connectionId = 'test-connection-replace';
	const socket = createSocket(mockGateway, mockRedis, connectionId);

	// First create a context through context()
	await socket.context();
	expect(createContextManager).toHaveBeenCalledTimes(1);

	// Then create a new context with createContext()
	const newContextData = {
		connectionInitReceived: false,
		acknowledged: false,
		subscriptions: {},
		extra: { newData: 'replaced' },
	};

	await socket.createContext(newContextData);
	expect(createContextManager).toHaveBeenCalledTimes(2);
	expect(createContextManager).toHaveBeenLastCalledWith(
		newContextData,
		'AWSWebsocketGraphQL:connection:test-connection-replace',
		mockRedis,
	);
});

test('createSocket.close - sends close and delete commands', async () => {
	const connectionId = 'test-connection-close';
	const socket = createSocket(mockGateway, mockRedis, connectionId);

	await socket.close(1000, 'Normal closure');

	expect(mockGatewaySend).toHaveBeenCalledTimes(2);

	// First call should be PostToConnectionCommand with close message
	const firstCall = mockGatewaySend.mock.calls[0]?.[0];
	expect(firstCall).toBeInstanceOf(PostToConnectionCommand);
	expect(firstCall?.input.ConnectionId).toBe(connectionId);
	expect(firstCall?.input.Data).toBe(
		JSON.stringify({
			type: 'close',
			code: 1000,
			reason: 'Normal closure',
		}),
	);

	// Second call should be DeleteConnectionCommand
	const secondCall = mockGatewaySend.mock.calls[1]?.[0];
	expect(secondCall).toBeInstanceOf(DeleteConnectionCommand);
	expect(secondCall?.input.ConnectionId).toBe(connectionId);
});

test('createSocket.close - handles optional parameters', async () => {
	const connectionId = 'test-connection-close-optional';
	const socket = createSocket(mockGateway, mockRedis, connectionId);

	await socket.close();

	expect(mockGatewaySend).toHaveBeenCalledTimes(2);

	const firstCall = mockGatewaySend.mock.calls[0]?.[0];
	expect(firstCall?.input.Data).toBe(
		JSON.stringify({
			type: 'close',
			code: undefined,
			reason: undefined,
		}),
	);
});

test('createSocket.send - sends string data directly', async () => {
	const connectionId = 'test-connection-send-string';
	const socket = createSocket(mockGateway, mockRedis, connectionId);

	const message = 'Hello WebSocket';
	await socket.send(message);

	expect(mockGatewaySend).toHaveBeenCalledTimes(1);

	const call = mockGatewaySend.mock.calls[0]?.[0];
	expect(call).toBeInstanceOf(PostToConnectionCommand);
	expect(call?.input.ConnectionId).toBe(connectionId);
	expect(call?.input.Data).toBe(message);
});

test('createSocket.send - JSON stringifies object data', async () => {
	const connectionId = 'test-connection-send-object';
	const socket = createSocket(mockGateway, mockRedis, connectionId);

	const message = { type: 'next', id: '123', payload: { data: 'test' } };
	await socket.send(message);

	expect(mockGatewaySend).toHaveBeenCalledTimes(1);

	const call = mockGatewaySend.mock.calls[0]?.[0];
	expect(call).toBeInstanceOf(PostToConnectionCommand);
	expect(call?.input.ConnectionId).toBe(connectionId);
	expect(call?.input.Data).toBe(JSON.stringify(message));
});

test('createSocket.send - handles various data types', async () => {
	const connectionId = 'test-connection-send-types';
	const socket = createSocket(mockGateway, mockRedis, connectionId);

	// Test number
	await socket.send(42);
	expect(mockGatewaySend.mock.calls[0]?.[0]?.input.Data).toBe('42');

	// Test boolean
	await socket.send(true);
	expect(mockGatewaySend.mock.calls[1]?.[0]?.input.Data).toBe('true');

	// Test array
	await socket.send([1, 2, 3]);
	expect(mockGatewaySend.mock.calls[2]?.[0]?.input.Data).toBe('[1,2,3]');

	// Test null
	await socket.send(null);
	expect(mockGatewaySend.mock.calls[3]?.[0]?.input.Data).toBe('null');
});

test('createSocket.flushChanges - calls waitAllSync when context manager exists', async () => {
	const connectionId = 'test-connection-flush';
	const socket = createSocket(mockGateway, mockRedis, connectionId);

	// Create context manager first
	await socket.context();

	await socket.flushChanges();

	expect(mockContextManager.waitAllSync).toHaveBeenCalledTimes(1);
});

test('createSocket.flushChanges - does nothing when no context manager', async () => {
	const connectionId = 'test-connection-flush-empty';
	const socket = createSocket(mockGateway, mockRedis, connectionId);

	// Don't create context manager
	await socket.flushChanges();

	expect(mockContextManager.waitAllSync).not.toHaveBeenCalled();
});

test('createSocket - handles Redis errors gracefully', async () => {
	const connectionId = 'test-connection-error';
	const redisError = new Error('Redis connection failed');

	mockRedisHGETALL.mockRejectedValue(redisError);

	const socket = createSocket(mockGateway, mockRedis, connectionId);

	// Should propagate the error
	await expect(socket.context()).rejects.toThrow('Redis connection failed');
});

test('createSocket - handles Gateway errors gracefully', async () => {
	const connectionId = 'test-connection-gateway-error';
	const gatewayError = new Error('Gateway send failed');

	mockGatewaySend.mockRejectedValue(gatewayError);

	const socket = createSocket(mockGateway, mockRedis, connectionId);

	// Should propagate the error
	await expect(socket.send('test message')).rejects.toThrow(
		'Gateway send failed',
	);
	await expect(socket.close()).rejects.toThrow('Gateway send failed');
});

test('createSocket - integration test with real context flow', async () => {
	const connectionId = 'test-integration';
	const rawContext = {
		connectionInitReceived: 'true',
		acknowledged: 'false',
		'extra.userId': '789',
		'extra.permissions.0': 'read',
		'extra.permissions.1': 'write',
	};

	mockRedisHGETALL.mockResolvedValue(rawContext);

	const socket = createSocket(mockGateway, mockRedis, connectionId);

	// Test the full flow
	const context1 = await socket.context();
	const context2 = await socket.context(); // Should reuse

	expect(context1).toBe(mockContextManager.context);
	expect(context2).toBe(mockContextManager.context);
	expect(context1).toBe(context2);
	expect(mockRedisHGETALL).toHaveBeenCalledTimes(1);

	// Test sending a message
	await socket.send({ type: 'test', data: 'integration' });
	expect(mockGatewaySend).toHaveBeenCalledTimes(1);

	// Test flushing changes
	await socket.flushChanges();
	expect(mockContextManager.waitAllSync).toHaveBeenCalledTimes(1);

	// Test closing
	await socket.close(1000, 'Test complete');
	expect(mockGatewaySend).toHaveBeenCalledTimes(3); // 1 from send + 2 from close
});
