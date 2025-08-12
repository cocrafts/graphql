import type { ApiGatewayManagementApiClient } from '@aws-sdk/client-apigatewaymanagementapi';
import type {
	APIGatewayProxyResultV2,
	APIGatewayProxyWebsocketEventV2,
	APIGatewayProxyWebsocketHandlerV2,
	Context as AWSLambdaContext,
} from 'aws-lambda';
import type { CloseCode } from 'graphql-ws/common';
import type {
	ServerOptions as WsServerOptions,
	Context as GraphQLWSContext,
} from 'graphql-ws/server';
import { type HandlerOptions as HttpHandlerOptions } from 'graphql-http';

export type CustomWsServerOptions = Omit<
	WsServerOptions,
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
	 * Distributed persistent storage. Used to store connection context.
	 */
	storage: StorageEngine;
	/**
	 * AWS Websocket Gateway Only
	 *
	 * Required to interact with AWS Websocket Gateway to handle connection.
	 */
	gateway: ApiGatewayManagementApiClient;
	/**
	 * AWS Websocket Gateway Only
	 *
	 * Called to handle custom routes defined by `action` in the event payload.
	 */
	customRouteHandler?: APIGatewayProxyWebsocketHandlerV2;
};

export type HttpAdapterOptions = HttpHandlerOptions & {};

export type Socket = {
	context: () => Promise<Readonly<GraphQLWSContext>>;
	updateContext: (
		data: Partial<GraphQLWSContext>,
	) => Promise<Readonly<GraphQLWSContext>>;
	createContext: (
		data: GraphQLWSContext,
	) => Promise<Readonly<GraphQLWSContext>>;
	close: (code: CloseCode, reason: string) => Promise<void>;
	send: (data: string | unknown) => Promise<void>;
};

export type GraphQLAdapterContext = AWSLambdaContext & {
	server: WsServerOptions;
	storage: StorageEngine;
	socket: Socket;
};

export type AWSGraphQLRouteHandler = <T = any>(
	context: GraphQLAdapterContext,
	event: APIGatewayProxyWebsocketEventV2,
) => Promise<APIGatewayProxyResultV2<T> | void>;

/**
 *
 * Define persitent storage engine for cross runtimes.
 *
 * On Serverless runtime like AWS Lambda, we may want use Redis or any other databases.
 */
export interface StorageEngine {
	set: (key: string, value: string) => Promise<void> | void;
	get: (key: string) => Promise<string | null> | string | null;
}
