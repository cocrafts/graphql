import type { ApiGatewayManagementApiClient } from '@aws-sdk/client-apigatewaymanagementapi';
import type {
	APIGatewayProxyResultV2,
	APIGatewayProxyWebsocketEventV2,
	Context as AWSLambdaContext,
	Context,
} from 'aws-lambda';
import type {
	ServerOptions as WSServerOptions,
	Context as GraphQLWSContext,
} from 'graphql-ws/server';
import { type HandlerOptions as HTTPHandlerOptions } from 'graphql-http';
import type { AWSGatewayRedisGraphQLPubsub } from 'aws-graphql-redis-pubsub';

export type CustomWSServerOptions = Omit<
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
export type WSAdapterOptions = CustomWSServerOptions & {
	/**
	 * Distributed persistent storage. Used to store connection context.
	 */
	storage: Storage;
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
	pubsub: AWSGatewayRedisGraphQLPubsub;
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

export type HTTPAdapterOptions = HTTPHandlerOptions & {};

export type Socket = {
	context: () => Promise<Readonly<GraphQLWSContext>>;
	updateContext: (data: Partial<GraphQLWSContext>) => Promise<GraphQLWSContext>;
	createContext: (data: GraphQLWSContext) => Promise<GraphQLWSContext>;
	close: (code?: number, data?: string) => Promise<void>;
	send: (data: string | unknown) => Promise<void>;
};

export type GraphQLWsAdapterContext = AWSLambdaContext & {
	storage: Storage;
	socket: Socket;
	pubsub: AWSGatewayRedisGraphQLPubsub;
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
