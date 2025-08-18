# @metacraft/graphql-lambda

GraphQL Lambda adapters for AWS Lambda functions with support for HTTP and WebSocket APIs, Redis storage, and distributed pub/sub.

## Installation

```bash
npm install @metacraft/graphql-lambda
```

## Features

- **Unified GraphQL Interface**: Single schema works across HTTP, WebSocket, and Lambda environments
- **AWS Lambda Support**: Native adapters for API Gateway HTTP and WebSocket APIs
- **Redis Integration**: Distributed storage and pub/sub for serverless environments
- **Cross-Environment**: Same GraphQL schema runs locally and on AWS Lambda

## Usage

### Local Development

```typescript
import { createHandler } from 'graphql-http/lib/use/http';
import { useServer } from 'graphql-ws/use/ws';
import { DefaultGraphQLPubSub } from '@metacraft/graphql-pubsub';

// Use standard graphql-http and graphql-ws with your schema
const graphqlHandler = createHandler(graphqlHttpOptions);
useServer(graphqlWsOptions, wss);
```

### Shared Schema and Options

The same GraphQL schema and server options can be shared across all environments:

```typescript
// graphql.ts - Shared across local and Lambda
import { makeExecutableSchema } from '@graphql-tools/schema';
import { type HandlerOptions as GraphQLHTTPOptions } from 'graphql-http';
import { type ServerOptions as GraphQLWSOptions } from 'graphql-ws';

const typeDefs = /* GraphQL */ `
  type Query {
    greeting: String
  }

  type Mutation {
    sendMessage(chat: String, message: String!): String
  }

  type Subscription {
    messaged(chat: String): String!
  }
`;

const resolvers = {
  Query: {
    greeting: () => 'Hello world!',
  },
  Mutation: {
    sendMessage: async (obj, args, ctx, info) => {
      const chat = args.chat ?? 'broadcast';
      await pubsub.publish(`messaged_${chat}`, { messaged: args.message });
      return `sent_${args.message}_${chat}`;
    },
  },
  Subscription: {
    messaged: {
      subscribe: (obj, args, ctx, info) => {
        const chat = args.chat ?? 'broadcast';
        return pubsub.subscribe(`messaged_${chat}`);
      },
    },
  },
};

export const schema = makeExecutableSchema({ typeDefs, resolvers });

export const graphqlHttpOptions: GraphQLHTTPOptions = { schema };

export const graphqlWsOptions: GraphQLWSOptions = {
  schema,
  onComplete(ctx, id, payload) {
    console.log(`Subscription ${id} completed with payload:`, payload);
  },
  onDisconnect(ctx, code, reason) {
    console.log(`Client disconnected with code ${code}: ${reason}`);
  },
  onConnect(ctx) {
    console.log('New client connected');
    return true; // Allow connection
  },
  onSubscribe(ctx, message, args) {
    console.log(`New subscription: ${message.id}`);
    return args; // Return execution arguments
  },
};
```

### AWS Lambda HTTP

```typescript
import { AWSGraphQLHttpAdapter } from '@metacraft/graphql-lambda';
import { AWSGatewayRedisGraphQLPubsub } from 'aws-graphql-redis-pubsub';

const pubsub = new AWSGatewayRedisGraphQLPubsub(gateway, redis);
export const handler = AWSGraphQLHttpAdapter(graphqlHttpOptions);
```

### AWS Lambda WebSocket

```typescript
import { AWSGraphQLWsAdapter } from '@metacraft/graphql-lambda';

const mergedOptions = { 
  ...graphqlWsOptions, 
  storage, 
  gateway, 
  pubsub 
};

export const handler = AWSGraphQLWsAdapter(mergedOptions);
```

### Shared Infrastructure

```typescript
import { ApiGatewayManagementApiClient } from '@aws-sdk/client-apigatewaymanagementapi';
import { createClient } from 'redis';

export const redis = createClient({ url: 'redis://localhost:6379' });
export const gateway = new ApiGatewayManagementApiClient({ region: 'us-east-1' });

export const storage = {
  set: async (key: string, value: string) => await redis.set(key, value),
  get: async (key: string) => await redis.get(key),
};
```

## Architecture

The library provides adapters that bridge standard GraphQL HTTP/WebSocket configurations with AWS Lambda runtime:

- **Shared Schema**: Single GraphQL schema definition used across all environments
- **Shared Options**: Server configuration options (onComplete, onDisconnect, etc.) shared between local and Lambda
- **HTTP Adapter**: Converts GraphQL HTTP requests to Lambda responses
- **WebSocket Adapter**: Manages WebSocket connections through API Gateway
- **Storage Interface**: Abstract storage layer for connection state and subscriptions
- **Pub/Sub Integration**: Distributed event system using Redis and API Gateway

## Build

```bash
bun run build
```

Generates ESM, CommonJS, and TypeScript declaration files in the `dist/` directory.
