import { PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import type { ApiGatewayManagementApiClient } from '@aws-sdk/client-apigatewaymanagementapi';
import type { RedisClientType } from 'redis';
import type { GraphQLPubSub } from '@metacraft/graphql-pubsub';

type RegistrableChannel = {
	topics: string[];
	register: (connectionId: string, subscriptionId: string) => Promise<void>;
};

type ChannelData = {
	connectionId: string;
	subscriptionId: string;
};

type AnyRedis = RedisClientType<any, any, any, any>;

type Options = {
	/**
	 * As this Pubsub handle distributing the event/data to gateway by itself,
	 * We have an option to pass the json message replacer in-case you have you custom
	 * replacer passed to server options of graphql-ws
	 */
	jsonMessageReplacer?: (this: any, key: string, value: any) => any;
	keyPrefix?: string;
};

export class GraphQLLambdaPubsub implements GraphQLPubSub {
	private redis: AnyRedis;
	private gateway: ApiGatewayManagementApiClient;
	private options: Options;

	constructor(
		gateway: ApiGatewayManagementApiClient,
		redis: AnyRedis,
		options: Options = {},
	) {
		this.gateway = gateway;
		this.redis = redis;
		this.options = options;
	}

	key(type: 'conn' | 'sub' | 'topic', id: string) {
		const prefix = this.options.keyPrefix ?? 'pubsub';
		return `${prefix}:${type}:${id}`;
	}

	extractId = (key: string) => {
		return key.split(':').pop();
	};

	async getChannels(topic: string): Promise<ChannelData[]> {
		const topicKey = this.key('topic', topic);
		const subscriptions = await this.redis.sMembers(topicKey);

		if (subscriptions.length === 0) {
			return [];
		}

		const channels: ChannelData[] = [];
		for (const subscription of subscriptions) {
			try {
				const [connectionId, subscriptionId] = subscription
					.split('#')
					.map(this.extractId);

				if (!connectionId || !subscriptionId) continue;

				channels.push({ connectionId, subscriptionId });
			} catch (error) {
				console.error('Failed to parse subscription:', subscription, error);
			}
		}

		return channels;
	}

	async getRegisteredTopics(subscriptionId: string) {
		const subscriptionKey = this.key('sub', subscriptionId);
		const topicKeys = await this.redis.sMembers(subscriptionKey);
		return topicKeys.map(this.extractId).filter(Boolean) as string[];
	}

	async getConnectionSubscriptions(connectionId: string) {
		const connectionKey = this.key('conn', connectionId);
		const subscriptionKeys = await this.redis.sMembers(connectionKey);
		return subscriptionKeys.map(this.extractId).filter(Boolean) as string[];
	}

	preparePayload(subscriptionId: string, payload: any) {
		return { id: subscriptionId, type: 'next', payload: { data: payload } };
	}

	prepareAndStringifyPayload(subscriptionId: string, payload: any) {
		return JSON.stringify(
			this.preparePayload(subscriptionId, payload),
			this.options.jsonMessageReplacer,
		);
	}

	subscribe(...topics: string[]): RegistrableChannel {
		const channel = {
			topics,
			register: async (connectionId: string, subscriptionId: string) => {
				console.log('register here', connectionId, subscriptionId);
				const connectionKey = this.key('conn', connectionId);
				const subscriptionKey = this.key('sub', subscriptionId);
				const topicKeys = topics.map(topic => this.key('topic', topic));

				await this.redis.eval(REGISTER_SUBSCRIPTION_REDIS_LUA_SCRIPT, {
					keys: [subscriptionKey, connectionKey, ...topicKeys],
				});
			},
		};

		return channel;
	}

	async isRegistered(subscriptionId: string) {
		const result = await this.redis.exists(this.key('sub', subscriptionId));
		return result === 1;
	}

	async publish(topic: string, payload: any) {
		const channels = await this.getChannels(topic);
		console.log('channels', channels);

		// NOTE: consider batching for high fan-out PostToConnection
		const results = await Promise.allSettled(
			channels.map(({ connectionId, subscriptionId }) => {
				console.log(
					'Send to',
					connectionId,
					subscriptionId,
					this.prepareAndStringifyPayload(subscriptionId, payload),
				);
				return this.gateway.send(
					new PostToConnectionCommand({
						ConnectionId: connectionId,
						Data: this.prepareAndStringifyPayload(subscriptionId, payload),
					}),
				);
			}),
		);

		for (let i = 0; i < results.length; i++) {
			const r = results[i];
			if (r?.status === 'rejected') {
				const { connectionId } = channels[i]!;
				const statusCode =
					r.reason?.$metadata?.httpStatusCode ?? r.reason?.statusCode;
				// If it's a GoneException (410), the connection is closed: clean it up.
				if (statusCode === 410) {
					await this.disconnect(connectionId).catch(() => {});
				} else {
					console.warn('GraphQLPubsub PostToConnection failed', r.reason);
				}
			}
		}
	}

	async unregister(
		connectionId: string,
		subscriptionId: string,
	): Promise<void> {
		const connectionKey = this.key('conn', connectionId);
		const subscriptionKey = this.key('sub', subscriptionId);

		await this.redis.eval(UNREGISTER_SUBSCRIPTION_REDIS_LUA_SCRIPT, {
			keys: [subscriptionKey, connectionKey],
		});
	}

	async disconnect(connectionId: string): Promise<void> {
		const connectionKey = this.key('conn', connectionId);

		await this.redis.eval(DISCONNECT_CONNECTION_REDIS_LUA_SCRIPT, {
			keys: [connectionKey],
		});
	}
}

const REGISTER_SUBSCRIPTION_REDIS_LUA_SCRIPT = `
-- KEYS[1]: sub:{subscriptionId}, KEYS[2]: conn:{connectionId}, KEYS[3...]: topic:{topicName}

local subKey, connKey = KEYS[1], KEYS[2]

redis.call('SADD', connKey, subKey)

local topicSubData = connKey .. "#" .. subKey
for i = 3, #KEYS do
    redis.call('SADD', KEYS[i], topicSubData)
end

local unpackFn = unpack or table.unpack
redis.call('SADD', subKey, unpackFn(KEYS, 3))

return {status="OK", topics=#KEYS - 2}
`;

const UNREGISTER_SUBSCRIPTION_REDIS_LUA_SCRIPT = `
-- KEYS[1]: sub:{subscriptionId}, KEYS[2]: conn:{connectionId}

local subKey, connKey = KEYS[1], KEYS[2]
local topicKeys = redis.call('SMEMBERS', subKey)
local topicSubData = connKey .. "#" .. subKey

for i, topicKey in ipairs(topicKeys) do
    redis.call('SREM', topicKey, topicSubData)
end

redis.call('SREM', connKey, subKey)
redis.call('DEL', subKey)

return {status="OK"}
`;

const DISCONNECT_CONNECTION_REDIS_LUA_SCRIPT = `
-- KEYS[1]: conn:{connectionId}

local connKey = KEYS[1]
local subKeys = redis.call('SMEMBERS', connKey)

local topicSubData
for i, subKey in ipairs(subKeys) do
	topicSubData = connKey .. "#" .. subKey
    local topicKeys = redis.call('SMEMBERS', subKey)
    
    for j, topicKey in ipairs(topicKeys) do
		redis.call('SREM', topicKey, topicSubData)
    end
    
    redis.call('DEL', subKey)
end

redis.call('DEL', connKey)

return {status="OK"}
`;
