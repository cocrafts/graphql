import type { ApiGatewayManagementApiClient } from '@aws-sdk/client-apigatewaymanagementapi';
import type {
	APIGatewayProxyResultV2,
	APIGatewayProxyWebsocketEventV2,
	Context as AWSLambdaContext,
	Context,
} from 'aws-lambda';
import type {
	ServerOptions as WSServerOptions,
	Context as GraphQLWsContext,
} from 'graphql-ws';
import { type HandlerOptions as HttpHandlerOptions } from 'graphql-http';
import type { GraphQLLambdaPubsub } from './pubsub';
import type { RedisClientType } from 'redis';

export type CustomWsServerOptions = Omit<
	WSServerOptions,
	'connectionInitWaitTimeout'
> & {
	/**
	 * Unsupported cause there's no way to schedule timeout to close connection on AWS Lambda
	 */
	connectionInitWaitTimeout?: number;
};

/**
 * Options of general GraphQL Websocket Server, defined in
 * [graphql-ws/server.ts](https://github.com/enisdenjo/graphql-ws/blob/master/src/server.ts)
 */
export type WsAdapterOptions = CustomWsServerOptions & {
	/**
	 * Distributed persistent storage by Redis. Used to store connection context.
	 * Consider creating Storage interface for it.
	 */
	redis: RedisClientType;
	/**
	 * AWS Websocket Gateway Only
	 *
	 * Required to interact with AWS Websocket Gateway to handle connection.
	 */
	gateway: ApiGatewayManagementApiClient;
	/**
	 * AWS Websocket Gateway Only
	 *
	 * Required to interact with AWS Websocket Gateway to handle connection.
	 */
	pubsub: GraphQLLambdaPubsub;
	/**
	 * A custom logger used inside the adapter. Use `console` by default
	 */
	logger?: Logger;
	/**
	 * AWS Websocket Gateway Only
	 *
	 * Called to handle custom routes defined by `action` in the event payload.
	 */
	customRouteHandler?: (
		event: APIGatewayProxyWebsocketEventV2,
		context: Context,
	) => APIGatewayProxyResultV2<any>;
};

export type HttpAdapterOptions = HttpHandlerOptions & {
	/**
	 * A custom logger used inside the adapter. Use `console` by default
	 */
	logger?: Logger;
};

export type Socket = {
	context: () => Promise<GraphQLWsContext>;
	createContext: (data: GraphQLWsContext) => Promise<GraphQLWsContext>;
	close: (code?: number, data?: string) => Promise<void>;
	send: (data: string | unknown) => Promise<void>;
	flushChanges: () => Promise<void>;
};

export type GraphQLWsAdapterContext = AWSLambdaContext & {
	socket: Socket;
	redis: RedisClientType;
	pubsub: GraphQLLambdaPubsub;
	logger: Logger;
	options: WSServerOptions;
};

export type AWSGraphQLRouteHandler = <T = any>(
	context: GraphQLWsAdapterContext,
	event: APIGatewayProxyWebsocketEventV2,
) => Promise<APIGatewayProxyResultV2<T> | void>;

/**
 *
 * Define persitent storage engine for cross runtimes.
 *
 * On Serverless runtime like AWS Lambda, we may want use Redis or any other databases.
 */
export interface Storage {
	set: (key: string, value: string) => Promise<void>;
	get: (key: string) => Promise<any | null>;
}

export interface Logger {
	debug: (...msg: unknown[]) => void;
	info: (...msg: unknown[]) => void;
	warn: (...msg: unknown[]) => void;
	error: (...msg: unknown[]) => void;
}
