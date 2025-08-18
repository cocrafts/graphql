import type { APIGatewayProxyEventBase } from 'aws-lambda';
import type { Logger } from './interface';

export const isAWSBaseEvent = (
	event: any,
): event is APIGatewayProxyEventBase<any> => {
	if ('multiValueHeaders' in event) return true;
	return false;
};

export const key = {
	connCtx: (connectionId: string) => {
		return `AWSWebsocketGraphQL:connection:${connectionId}`;
	},
	subPayload: (subscriptionId: string) => {
		return `AWSWebsocketGraphQL:subscription:${subscriptionId}`;
	},
};

type RegistrableChannel = {
	topics: string[];
	register: (connectionId: string, subscriptionId: string) => Promise<void>;
};

export const isRegistrableChannel = (val: any): val is RegistrableChannel => {
	return Array.isArray(val['topics']) && typeof val['register'] === 'function';
};

export const createConsoleLogger = (): Logger => {
	return {
		debug: console.debug,
		info: console.log,
		warn: console.warn,
		error: console.error,
	};
};
