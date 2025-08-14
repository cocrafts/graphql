import { expect, test, afterEach, beforeAll } from 'bun:test';
import { AWSGatewayRedisGraphQLPubsub } from './index';
import { createClient } from 'redis';

const redis = createClient({ url: 'redis://127.0.0.1:6379' });
const TEST_PREFIX = 'test:pubsub';
let pubsub: AWSGatewayRedisGraphQLPubsub;

beforeAll(async () => {
	await redis.connect();
	pubsub = new AWSGatewayRedisGraphQLPubsub({} as never, redis, {
		keyPrefix: TEST_PREFIX,
	});
});

afterEach(async () => {
	const keys = await redis.keys(`${TEST_PREFIX}*`);
	if (keys.length > 0) await redis.del(keys);
});

test('subscription data form is correct', async () => {
	const topic = 'test-topic';
	const channel = pubsub.subscribe(topic);
	const connectionId = 'conn-1';
	const subscriptionId = 'sub-1';

	await channel.register(connectionId, subscriptionId);

	const channels = await pubsub.getChannels(topic);
	expect(channels[0]).toMatchObject({ connectionId, subscriptionId });

	// Verify Redis data structure
	const topicKey = pubsub.key('topic', topic);
	const topicData = await redis.sMembers(topicKey);
	expect(topicData).toHaveLength(1);
	expect(topicData[0]!).toEqual(
		`${pubsub.key('conn', connectionId)}#${pubsub.key('sub', subscriptionId)}`,
	);
});

test('handle duplicate subscriptions gracefully', async () => {
	const channel = pubsub.subscribe('test-topic');
	const connectionId = 'conn-1';
	const subscriptionId = 'sub-1';

	await channel.register(connectionId, subscriptionId);
	await channel.register(connectionId, subscriptionId); // Duplicate

	const channels = await pubsub.getChannels('test-topic');
	expect(channels).toHaveLength(1); // Should not create duplicate
});

test('handle malformed data in Redis', async () => {
	const topic = 'test-topic';

	// Inject malformed data directly into Redis
	const topicKey = pubsub.key('topic', topic);
	await redis.sAdd(topicKey, 'invalid-json-data');

	// Should handle gracefully
	const channels = await pubsub.getChannels(topic);
	expect(channels).toHaveLength(0);
});

test('register a topic from a subscription', async () => {
	const topic = 'topic-1';
	const channel = pubsub.subscribe(topic);
	const connectionId = 'conn-1';
	const subscriptionId = 'sub-1';
	await channel.register(connectionId, subscriptionId);

	const channels = await pubsub.getChannels(topic);
	expect(channels).toHaveLength(1);
	expect(channels[0]?.connectionId).toEqual(connectionId);
	expect(channels[0]?.subscriptionId).toEqual(subscriptionId);

	const topics = await pubsub.getRegisteredTopics(subscriptionId);
	expect(topics).toHaveLength(1);
	expect(topics[0]).toEqual(topic);

	const subscriptions = await pubsub.getConnectionSubscriptions(connectionId);
	expect(subscriptions).toHaveLength(1);
	expect(subscriptions[0]).toEqual(subscriptionId);

	await pubsub.disconnect(connectionId);

	const channels2 = await pubsub.getChannels(topic);
	expect(channels2).toHaveLength(0);

	const topics2 = await pubsub.getRegisteredTopics(subscriptionId);
	expect(topics2).toHaveLength(0);

	const subscriptions2 = await pubsub.getConnectionSubscriptions(connectionId);
	expect(subscriptions2).toHaveLength(0);
});

test('register a topic from multiple subscriptions over a connection', async () => {
	const topic = 'test-topic';
	const connectionId = 'conn-1';

	await pubsub.subscribe(topic).register(connectionId, 'sub-1');
	await pubsub.subscribe(topic).register(connectionId, 'sub-2');

	const channels = await pubsub.getChannels(topic);
	expect(channels).toHaveLength(2);
	expect(channels.every(c => c.connectionId === connectionId)).toBe(true);

	const subscriptions = await pubsub.getConnectionSubscriptions(connectionId);
	expect(subscriptions).toHaveLength(2);
});

test('register a topic from multiple subscriptions over multiple connections', async () => {
	const topic = 'test-topic';

	await pubsub.subscribe(topic).register('conn-1', 'sub-1');
	await pubsub.subscribe(topic).register('conn-2', 'sub-2');

	const channels = await pubsub.getChannels(topic);
	expect(channels).toHaveLength(2);
	expect(new Set(channels.map(c => c.connectionId)).size).toBe(2);
});

test('register multiple topics from a subscription', async () => {
	const connectionId = 'conn-1';
	const subscriptionId = 'sub-1';

	await pubsub
		.subscribe('topic-1', 'topic-2')
		.register(connectionId, subscriptionId);

	const topics1 = await pubsub.getChannels('topic-1');
	const topics2 = await pubsub.getChannels('topic-2');
	expect(topics1).toHaveLength(1);
	expect(topics2).toHaveLength(1);
	expect(topics1[0]?.subscriptionId).toBe(subscriptionId);
	expect(topics2[0]?.subscriptionId).toBe(subscriptionId);
});

test('register multiple topics from multiple subscriptions over a connection', async () => {
	const connectionId = 'conn-1';

	await pubsub.subscribe('topic-1').register(connectionId, 'sub-1');
	await pubsub.subscribe('topic-2').register(connectionId, 'sub-2');

	const topics1 = await pubsub.getChannels('topic-1');
	const topics2 = await pubsub.getChannels('topic-2');
	expect(topics1).toHaveLength(1);
	expect(topics2).toHaveLength(1);

	const subscriptions = await pubsub.getConnectionSubscriptions(connectionId);
	expect(subscriptions).toHaveLength(2);
});

test('register multiple topics from multiple subscriptions over multiple connections', async () => {
	await pubsub.subscribe('topic-1').register('conn-1', 'sub-1');
	await pubsub.subscribe('topic-2').register('conn-2', 'sub-2');

	const topics1 = await pubsub.getChannels('topic-1');
	const topics2 = await pubsub.getChannels('topic-2');
	expect(topics1).toHaveLength(1);
	expect(topics2).toHaveLength(1);
	expect(topics1[0]?.connectionId).toBe('conn-1');
	expect(topics2[0]?.connectionId).toBe('conn-2');
});

test('unregister a subscription from a large fan-out topic', async () => {
	const topic = 'large-topic';

	// Create 10 subscriptions
	for (let i = 0; i < 10; i++) {
		await pubsub.subscribe(topic).register(`conn-${i}`, `sub-${i}`);
	}

	let channels = await pubsub.getChannels(topic);
	expect(channels).toHaveLength(10);

	// Unregister one
	await pubsub.unregister('conn-5', 'sub-5');

	channels = await pubsub.getChannels(topic);
	expect(channels).toHaveLength(9);
	expect(channels.some(c => c.connectionId === 'conn-5')).toBe(false);
});

test('unregister a subscription from multiple large fan-out topics', async () => {
	// Create subscriptions across multiple topics
	for (let i = 0; i < 5; i++) {
		await pubsub.subscribe(`topic-${i}`).register('conn-1', `sub-${i}`);
	}

	// Verify all topics have the subscription
	for (let i = 0; i < 5; i++) {
		const channels = await pubsub.getChannels(`topic-${i}`);
		expect(channels).toHaveLength(1);
	}

	// Unregister from one topic
	await pubsub.unregister('conn-1', 'sub-0');

	// Verify only that topic is affected
	const channels0 = await pubsub.getChannels('topic-0');
	const channels1 = await pubsub.getChannels('topic-1');
	expect(channels0).toHaveLength(0);
	expect(channels1).toHaveLength(1);
});

test('publish event of a topic to connection', async () => {
	const topic = 'test-topic';
	const connectionId = 'conn-1';

	await pubsub.subscribe(topic).register(connectionId, 'sub-1');

	// Mock the gateway to capture the command
	let capturedCommand: any = null;
	const mockGateway = {
		send: async (command: any) => {
			capturedCommand = command;
			return Promise.resolve({});
		},
	} as any;

	const pubsubWithMock = new AWSGatewayRedisGraphQLPubsub(mockGateway, redis, {
		keyPrefix: TEST_PREFIX,
	});
	await pubsubWithMock.publish(topic, { message: 'Hello World' });

	expect(capturedCommand).toBeDefined();
	expect(capturedCommand.input.ConnectionId).toBe(connectionId);
	expect(capturedCommand.input.Data).toContain('Hello World');
	expect(capturedCommand.input.Data).toEqual(
		pubsubWithMock.prepareAndStringifyPayload('sub-1', {
			message: 'Hello World',
		}),
	);
});

test('publish event of a topic to subscriptions of a single connection', async () => {
	const topic = 'test-topic';
	const connectionId = 'conn-1';

	// Create multiple subscriptions for same connection
	await pubsub.subscribe(topic).register(connectionId, 'sub-1');
	await pubsub.subscribe(topic).register(connectionId, 'sub-2');

	let publishCount = 0;
	const mockGateway = {
		send: async (command: any) => {
			publishCount++;
			return Promise.resolve({});
		},
	};

	const pubsubWithMock = new AWSGatewayRedisGraphQLPubsub(
		mockGateway as any,
		redis,
		{ keyPrefix: TEST_PREFIX },
	);
	await pubsubWithMock.publish(topic, { message: 'Hello' });

	expect(publishCount).toBe(2); // Should publish to both subscriptions
});

test('not publish event of unregistered subscription', async () => {
	const topic = 'test-topic';

	let publishCount = 0;
	const mockGateway = {
		send: async (command: any) => {
			publishCount++;
			return Promise.resolve({});
		},
	};

	const pubsubWithMock = new AWSGatewayRedisGraphQLPubsub(
		mockGateway as any,
		redis,
		{ keyPrefix: TEST_PREFIX },
	);
	await pubsubWithMock.publish(topic, { message: 'Hello' });

	expect(publishCount).toBe(0); // Should not publish to unregistered topic
});

test('not publish event of unregistered connection', async () => {
	const topic = 'test-topic';

	// Register then disconnect
	await pubsub.subscribe(topic).register('conn-1', 'sub-1');
	await pubsub.disconnect('conn-1');

	let publishCount = 0;
	const mockGateway = {
		send: async (command: any) => {
			publishCount++;
			return Promise.resolve({});
		},
	};

	const pubsubWithMock = new AWSGatewayRedisGraphQLPubsub(
		mockGateway as any,
		redis,
		{ keyPrefix: TEST_PREFIX },
	);
	await pubsubWithMock.publish(topic, { message: 'Hello' });

	expect(publishCount).toBe(0); // Should not publish to disconnected connection
});

test('handle publish GoneException gracefully', async () => {
	const topic = 'test-topic';

	await pubsub.subscribe(topic).register('conn-1', 'sub-1');

	// Mock gateway to throw GoneException
	const mockGateway = {
		send: async (command: any) => {
			const error = {
				reason: {
					$metadata: { httpStatusCode: 410 },
					statusCode: 410,
				},
			};
			throw error;
		},
	};

	const pubsubWithMock = new AWSGatewayRedisGraphQLPubsub(
		mockGateway as any,
		redis,
		{ keyPrefix: TEST_PREFIX },
	);

	expect(async () => {
		await pubsubWithMock.publish(topic, { message: 'Hello' });
	}).not.toThrow();
});

test('handle publish any error gracefully', async () => {
	const topic = 'test-topic';

	await pubsub.subscribe(topic).register('conn-1', 'sub-1');

	// Mock gateway to throw various errors
	const mockGateway = {
		send: async (command: any) => {
			const error = {
				reason: {
					$metadata: { httpStatusCode: 500 },
					statusCode: 500,
				},
			};
			throw error;
		},
	};

	const pubsubWithMock = new AWSGatewayRedisGraphQLPubsub(
		mockGateway as any,
		redis,
		{ keyPrefix: TEST_PREFIX },
	);

	// Should not throw, should handle gracefully
	expect(async () => {
		await pubsubWithMock.publish(topic, { message: 'Hello' });
	}).not.toThrow();
});
