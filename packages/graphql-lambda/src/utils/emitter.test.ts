import { test, expect, mock, beforeEach } from 'bun:test';
import { MessageType, stringifyMessage } from 'graphql-ws';
import type {
	ExecutionResult,
	ServerOptions,
	SubscribeMessage,
} from 'graphql-ws';
import type { ExecutionArgs, GraphQLError } from 'graphql';

import { createSubscriptionEmitter } from './emitter';
import type { Socket } from '../interface';

// Mock the stringifyMessage function
mock.module('graphql-ws', () => ({
	MessageType: {
		Next: 'next',
		Error: 'error',
		Complete: 'complete',
	},
	stringifyMessage: mock((message: any) => JSON.stringify(message)),
}));

// Mock socket
const mockSocketSend = mock();
const mockSocketContext = mock();
const mockSocket: Socket = {
	send: mockSocketSend,
	context: mockSocketContext,
	createContext: mock(),
	close: mock(),
	flushChanges: mock(),
};

// Mock server options callbacks
const mockOnNext = mock();
const mockOnError = mock();
const mockOnComplete = mock();
const mockJsonMessageReplacer = mock();

const mockServerOptions: ServerOptions = {
	onNext: mockOnNext,
	onError: mockOnError,
	onComplete: mockOnComplete,
	jsonMessageReplacer: mockJsonMessageReplacer,
};

// Sample data
const mockContext = {
	connectionInitReceived: true,
	acknowledged: true,
	subscriptions: {},
	extra: { userId: '123' },
};

const mockSubscribeMessage: SubscribeMessage = {
	id: 'subscription-123',
	type: MessageType.Subscribe,
	payload: {
		query: 'subscription { messageAdded { id content } }',
		variables: {},
	},
};

const mockExecutionArgs: ExecutionArgs = {
	schema: {} as any,
	document: {} as any,
	contextValue: mockContext,
};

beforeEach(() => {
	// Reset all mocks before each test
	mockSocketSend.mockClear();
	mockSocketContext.mockClear();
	mockOnNext.mockClear();
	mockOnError.mockClear();
	mockOnComplete.mockClear();
	mockJsonMessageReplacer.mockClear();
	(stringifyMessage as any).mockClear();

	// Set default return values
	mockSocketContext.mockResolvedValue(mockContext);
	mockSocketSend.mockResolvedValue(undefined);
});

test('createSubscriptionEmitter - returns object with next, error, and complete methods', () => {
	const emitter = createSubscriptionEmitter(mockServerOptions, mockSocket);

	expect(emitter).toBeDefined();
	expect(typeof emitter.next).toBe('function');
	expect(typeof emitter.error).toBe('function');
	expect(typeof emitter.complete).toBe('function');
});

test('next - sends execution result without errors', async () => {
	const emitter = createSubscriptionEmitter(mockServerOptions, mockSocket);

	const executionResult: ExecutionResult = {
		data: { messageAdded: { id: '1', content: 'Hello World' } },
	};

	await emitter.next(executionResult, mockSubscribeMessage, mockExecutionArgs);

	expect(mockSocketContext).toHaveBeenCalledTimes(1);
	expect(mockOnNext).toHaveBeenCalledWith(
		mockContext,
		mockSubscribeMessage.id,
		mockSubscribeMessage.payload,
		mockExecutionArgs,
		executionResult,
	);
	expect(stringifyMessage).toHaveBeenCalledWith(
		{
			id: mockSubscribeMessage.id,
			type: MessageType.Next,
			payload: {
				data: { messageAdded: { id: '1', content: 'Hello World' } },
			},
		},
		mockJsonMessageReplacer,
	);
	expect(mockSocketSend).toHaveBeenCalledTimes(1);
});

test('next - sends execution result with errors', async () => {
	const emitter = createSubscriptionEmitter(mockServerOptions, mockSocket);

	const mockError = {
		message: 'Test error',
		toJSON: mock(() => ({ message: 'Test error', path: ['messageAdded'] })),
	} as unknown as GraphQLError;

	const executionResult: ExecutionResult = {
		data: { messageAdded: null },
		errors: [mockError],
	};

	await emitter.next(executionResult, mockSubscribeMessage, mockExecutionArgs);

	expect(mockSocketContext).toHaveBeenCalledTimes(1);
	expect(mockOnNext).toHaveBeenCalledWith(
		mockContext,
		mockSubscribeMessage.id,
		mockSubscribeMessage.payload,
		mockExecutionArgs,
		executionResult,
	);
	expect(stringifyMessage).toHaveBeenCalledWith(
		{
			id: mockSubscribeMessage.id,
			type: MessageType.Next,
			payload: {
				data: { messageAdded: null },
				errors: [{ message: 'Test error', path: ['messageAdded'] }],
			},
		},
		mockJsonMessageReplacer,
	);
	expect(mockError.toJSON).toHaveBeenCalledTimes(1);
	expect(mockSocketSend).toHaveBeenCalledTimes(1);
});

test('next - uses custom result from onNext callback', async () => {
	const customResult = {
		data: { messageAdded: { id: '1', content: 'Custom Result' } },
		extensions: { customField: 'value' },
	};
	mockOnNext.mockResolvedValue(customResult);

	const emitter = createSubscriptionEmitter(mockServerOptions, mockSocket);

	const executionResult: ExecutionResult = {
		data: { messageAdded: { id: '1', content: 'Original Result' } },
	};

	await emitter.next(executionResult, mockSubscribeMessage, mockExecutionArgs);

	expect(stringifyMessage).toHaveBeenCalledWith(
		{
			id: mockSubscribeMessage.id,
			type: MessageType.Next,
			payload: customResult,
		},
		mockJsonMessageReplacer,
	);
});

test('next - handles missing onNext callback', async () => {
	const optionsWithoutOnNext: ServerOptions = {
		...mockServerOptions,
		onNext: undefined,
	};
	const emitter = createSubscriptionEmitter(optionsWithoutOnNext, mockSocket);

	const executionResult: ExecutionResult = {
		data: { messageAdded: { id: '1', content: 'Hello World' } },
	};

	await emitter.next(executionResult, mockSubscribeMessage, mockExecutionArgs);

	expect(stringifyMessage).toHaveBeenCalledWith(
		{
			id: mockSubscribeMessage.id,
			type: MessageType.Next,
			payload: {
				data: { messageAdded: { id: '1', content: 'Hello World' } },
			},
		},
		mockJsonMessageReplacer,
	);
	expect(mockSocketSend).toHaveBeenCalledTimes(1);
});

test('error - sends GraphQL errors', async () => {
	const emitter = createSubscriptionEmitter(mockServerOptions, mockSocket);

	const mockError1 = {
		message: 'Validation error',
		toJSON: mock(() => ({
			message: 'Validation error',
			locations: [{ line: 1, column: 1 }],
		})),
	} as unknown as GraphQLError;

	const mockError2 = {
		message: 'Authorization error',
		toJSON: mock(() => ({
			message: 'Authorization error',
			extensions: { code: 'UNAUTHORIZED' },
		})),
	} as unknown as GraphQLError;

	const errors = [mockError1, mockError2];

	await emitter.error(errors, mockSubscribeMessage);

	expect(mockSocketContext).toHaveBeenCalledTimes(1);
	expect(mockOnError).toHaveBeenCalledWith(
		mockContext,
		mockSubscribeMessage.id,
		mockSubscribeMessage.payload,
		errors,
	);
	expect(stringifyMessage).toHaveBeenCalledWith(
		{
			id: mockSubscribeMessage.id,
			type: MessageType.Error,
			payload: [
				{ message: 'Validation error', locations: [{ line: 1, column: 1 }] },
				{
					message: 'Authorization error',
					extensions: { code: 'UNAUTHORIZED' },
				},
			],
		},
		mockJsonMessageReplacer,
	);
	expect(mockError1.toJSON).toHaveBeenCalledTimes(1);
	expect(mockError2.toJSON).toHaveBeenCalledTimes(1);
	expect(mockSocketSend).toHaveBeenCalledTimes(1);
});

test('error - uses custom errors from onError callback', async () => {
	const customErrors = [
		{ message: 'Custom error 1', code: 'CUSTOM_1' },
		{ message: 'Custom error 2', code: 'CUSTOM_2' },
	];
	mockOnError.mockResolvedValue(customErrors);

	const emitter = createSubscriptionEmitter(mockServerOptions, mockSocket);

	const mockError = {
		message: 'Original error',
		toJSON: mock(() => ({ message: 'Original error' })),
	} as unknown as GraphQLError;

	await emitter.error([mockError], mockSubscribeMessage);

	expect(stringifyMessage).toHaveBeenCalledWith(
		{
			id: mockSubscribeMessage.id,
			type: MessageType.Error,
			payload: customErrors,
		},
		mockJsonMessageReplacer,
	);
	// Original error toJSON should not be called since custom errors are used
	expect(mockError.toJSON).not.toHaveBeenCalled();
});

test('error - handles missing onError callback', async () => {
	const optionsWithoutOnError: ServerOptions = {
		...mockServerOptions,
		onError: undefined,
	};
	const emitter = createSubscriptionEmitter(optionsWithoutOnError, mockSocket);

	const mockError = {
		message: 'Test error',
		toJSON: mock(() => ({ message: 'Test error' })),
	} as unknown as GraphQLError;

	await emitter.error([mockError], mockSubscribeMessage);

	expect(stringifyMessage).toHaveBeenCalledWith(
		{
			id: mockSubscribeMessage.id,
			type: MessageType.Error,
			payload: [{ message: 'Test error' }],
		},
		mockJsonMessageReplacer,
	);
	expect(mockError.toJSON).toHaveBeenCalledTimes(1);
	expect(mockSocketSend).toHaveBeenCalledTimes(1);
});

test('complete - sends complete message when notifyClient is true', async () => {
	const emitter = createSubscriptionEmitter(mockServerOptions, mockSocket);

	await emitter.complete(true, mockSubscribeMessage);

	expect(mockSocketContext).toHaveBeenCalledTimes(1);
	expect(mockOnComplete).toHaveBeenCalledWith(
		mockContext,
		mockSubscribeMessage.id,
		mockSubscribeMessage.payload,
	);
	expect(stringifyMessage).toHaveBeenCalledWith(
		{
			id: mockSubscribeMessage.id,
			type: MessageType.Complete,
		},
		mockJsonMessageReplacer,
	);
	expect(mockSocketSend).toHaveBeenCalledTimes(1);
});

test('complete - does not send message when notifyClient is false', async () => {
	const emitter = createSubscriptionEmitter(mockServerOptions, mockSocket);

	await emitter.complete(false, mockSubscribeMessage);

	expect(mockSocketContext).toHaveBeenCalledTimes(1);
	expect(mockOnComplete).toHaveBeenCalledWith(
		mockContext,
		mockSubscribeMessage.id,
		mockSubscribeMessage.payload,
	);
	expect(stringifyMessage).not.toHaveBeenCalled();
	expect(mockSocketSend).not.toHaveBeenCalled();
});

test('complete - handles missing onComplete callback', async () => {
	const optionsWithoutOnComplete: ServerOptions = {
		...mockServerOptions,
		onComplete: undefined,
	};
	const emitter = createSubscriptionEmitter(
		optionsWithoutOnComplete,
		mockSocket,
	);

	await emitter.complete(true, mockSubscribeMessage);

	expect(mockSocketContext).toHaveBeenCalledTimes(1);
	expect(stringifyMessage).toHaveBeenCalledWith(
		{
			id: mockSubscribeMessage.id,
			type: MessageType.Complete,
		},
		mockJsonMessageReplacer,
	);
	expect(mockSocketSend).toHaveBeenCalledTimes(1);
});

test('all methods - handle socket context errors', async () => {
	const contextError = new Error('Context retrieval failed');
	mockSocketContext.mockRejectedValue(contextError);

	const emitter = createSubscriptionEmitter(mockServerOptions, mockSocket);

	// Test next method
	await expect(
		emitter.next(
			{ data: { test: 'value' } },
			mockSubscribeMessage,
			mockExecutionArgs,
		),
	).rejects.toThrow('Context retrieval failed');

	// Test error method
	const mockError = {
		message: 'Test error',
		toJSON: () => ({ message: 'Test error' }),
	} as GraphQLError;

	await expect(
		emitter.error([mockError], mockSubscribeMessage),
	).rejects.toThrow('Context retrieval failed');

	// Test complete method
	await expect(emitter.complete(true, mockSubscribeMessage)).rejects.toThrow(
		'Context retrieval failed',
	);
});

test('all methods - handle socket send errors', async () => {
	const sendError = new Error('Send failed');
	mockSocketSend.mockRejectedValue(sendError);

	const emitter = createSubscriptionEmitter(mockServerOptions, mockSocket);

	// Test next method
	await expect(
		emitter.next(
			{ data: { test: 'value' } },
			mockSubscribeMessage,
			mockExecutionArgs,
		),
	).rejects.toThrow('Send failed');

	// Test error method
	const mockError = {
		message: 'Test error',
		toJSON: () => ({ message: 'Test error' }),
	} as GraphQLError;

	await expect(
		emitter.error([mockError], mockSubscribeMessage),
	).rejects.toThrow('Send failed');

	// Test complete method (only when notifyClient is true)
	await expect(emitter.complete(true, mockSubscribeMessage)).rejects.toThrow(
		'Send failed',
	);

	// Complete with notifyClient false should not throw since it doesn't call send
	mockSocketSend.mockClear();
	await emitter.complete(false, mockSubscribeMessage);
	expect(mockSocketSend).not.toHaveBeenCalled();
});

test('integration - complex execution result with multiple errors and extensions', async () => {
	// Reset onNext to not return custom result for this test
	mockOnNext.mockResolvedValue(null);

	const emitter = createSubscriptionEmitter(mockServerOptions, mockSocket);

	const complexError1 = {
		message: 'Field error',
		path: ['messageAdded', 'content'],
		locations: [{ line: 2, column: 15 }],
		toJSON: mock(() => ({
			message: 'Field error',
			path: ['messageAdded', 'content'],
			locations: [{ line: 2, column: 15 }],
		})),
	} as unknown as GraphQLError;

	const complexError2 = {
		message: 'Rate limit exceeded',
		extensions: { code: 'RATE_LIMITED', retryAfter: 60 },
		toJSON: mock(() => ({
			message: 'Rate limit exceeded',
			extensions: { code: 'RATE_LIMITED', retryAfter: 60 },
		})),
	} as unknown as GraphQLError;

	const complexResult: ExecutionResult = {
		data: {
			messageAdded: {
				id: '1',
				content: null,
				author: { id: '123', name: 'John' },
			},
		},
		errors: [complexError1, complexError2],
		extensions: {
			tracing: { version: 1, startTime: Date.now() },
		},
	};

	await emitter.next(complexResult, mockSubscribeMessage, mockExecutionArgs);

	expect(stringifyMessage).toHaveBeenCalledWith(
		{
			id: mockSubscribeMessage.id,
			type: MessageType.Next,
			payload: {
				data: {
					messageAdded: {
						id: '1',
						content: null,
						author: { id: '123', name: 'John' },
					},
				},
				extensions: {
					tracing: { version: 1, startTime: expect.any(Number) },
				},
				errors: [
					{
						message: 'Field error',
						path: ['messageAdded', 'content'],
						locations: [{ line: 2, column: 15 }],
					},
					{
						message: 'Rate limit exceeded',
						extensions: { code: 'RATE_LIMITED', retryAfter: 60 },
					},
				],
			},
		},
		mockJsonMessageReplacer,
	);

	expect(complexError1.toJSON).toHaveBeenCalledTimes(1);
	expect(complexError2.toJSON).toHaveBeenCalledTimes(1);
});

test('integration - callback chain execution order', async () => {
	const callOrder: string[] = [];

	mockSocketContext.mockImplementation(async () => {
		callOrder.push('socket.context');
		return mockContext;
	});

	mockOnNext.mockImplementation(async () => {
		callOrder.push('onNext');
		return null; // Use default result
	});

	mockSocketSend.mockImplementation(async () => {
		callOrder.push('socket.send');
	});

	const emitter = createSubscriptionEmitter(mockServerOptions, mockSocket);

	await emitter.next(
		{ data: { test: 'value' } },
		mockSubscribeMessage,
		mockExecutionArgs,
	);

	expect(callOrder).toEqual(['socket.context', 'onNext', 'socket.send']);
});
