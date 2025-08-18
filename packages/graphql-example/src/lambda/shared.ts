import { ApiGatewayManagementApiClient } from '@aws-sdk/client-apigatewaymanagementapi';
import type { Storage } from 'aws-graphql-lambda';
import { createClient } from 'redis';
import chalk from 'chalk';
import { Resource } from 'sst';

export const redis = createClient({
	url: `rediss://${Resource.redis.host}:${Resource.redis.port}`,
	username: Resource.redis.username,
	password: Resource.redis.password,
});

await redis.connect();

redis.on('error', err => {
	console.error('Redis Client Error', err);
});

redis.on('connect', () => {
	console.log('Redis connected');
});

redis.on('ready', () => {
	console.log('Redis ready');
});

redis.on('end', () => {
	console.warn('Redis disconnected');
});

redis.on('reconnecting', () => {
	console.log('Redis trying to reconnect...');
});

export const storage: Storage = {
	set: async (key: string, value: string) => {
		await redis.set(key, value);
	},
	get: async (key: string) => {
		return await redis.get(key);
	},
};

export const gateway = new ApiGatewayManagementApiClient({
	region: Resource.shared.region,
	endpoint: Resource.ws.managementEndpoint,
});

// 0 = no colors, 1 = basic colors, 2 = 256 colors, 3 = 16 million colors
chalk.level = 0;
