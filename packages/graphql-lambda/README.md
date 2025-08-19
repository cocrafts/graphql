# @cocrafts/graphql-lambda

GraphQL Lambda adapters for AWS Lambda functions with support for HTTP and WebSocket APIs, Redis storage, and distributed pub/sub.

## Installation

```bash
npm install @cocrafts/graphql-lambda
```

## Features

- **Unified GraphQL Interface**: Single schema works across HTTP, WebSocket, and Lambda environments
- **AWS Lambda Support**: Native adapters for API Gateway HTTP and WebSocket APIs
- **Redis Integration**: Distributed storage and pub/sub for serverless environments
- **Cross-Environment**: Same GraphQL schema runs locally and on AWS Lambda

## Serverless Considerations

### Context Serialization Requirements

**Context must be JSON serializable**: All context data is persisted to Redis between Lambda invocations using flattened dot-notation (e.g., `extra.user.id`). Functions, classes, and circular references are not supported.

```typescript
// Supported: Plain JSON data
ctx.extra.user = { id: '123', name: 'John', roles: ['admin'] };

// Not supported: Functions, circular references
ctx.extra.callback = () => console.log('hello');
ctx.extra.user.parent = ctx.extra.user;
```

### Subscription Execution Model

**No async iterators**: Unlike server implementations, serverless uses a custom pubsub engine. Each subscription resolver runs once during setup, not for each published event. Published events are sent directly to clients without re-running GraphQL execution or validation.

```typescript
// Server: Re-executes GraphQL for each event
for await (const event of asyncIterator) {
  yield await execute({ schema, document, rootValue: event });
}

// Serverless: Direct event forwarding
await pubsub.publish('topic', payload); // No re-execution
```

### Key Limitations

- **No field-level filtering**: Server implementations can filter/transform fields per event; serverless sends raw published payloads
- **No real-time validation**: Schema changes don't affect in-flight subscriptions until reconnection
- **No per-event context**: Published events don't have access to subscription-time context or variables
- **Context reconstruction**: Context is rebuilt from Redis on each Lambda invocation

### Best Practices

#### Context Management
```typescript
onConnect: async (ctx) => {
  ctx.extra = {
    userId: await authenticateUser(ctx.connectionParams?.token),
    subscriptionCount: 0
  };
  return true;
}
```

#### Subscription Design
```typescript
// Design for direct payload forwarding
subscribe: () => pubsub.subscribe('CHAT_MESSAGE')

// Publish complete, typed payloads
await pubsub.publish('CHAT_MESSAGE', {
  messageAdded: { id: '123', text: 'Hello', timestamp: new Date().toISOString() }
});
```

### When to Use

**Good for**: Event-driven applications, infrequent real-time updates, variable traffic patterns, cost optimization.

**Consider alternatives for**: High-frequency updates, complex field filtering, low-latency requirements, heavy context usage.

## Usage

### Local Development

```typescript
import { createHandler } from 'graphql-http/lib/use/http';
import { useServer } from 'graphql-ws/use/ws';
import { DefaultGraphQLPubSub } from '@cocrafts/graphql-pubsub';

const graphqlHandler = createHandler(graphqlHttpOptions);
useServer(graphqlWsOptions, wss);
```

### AWS Lambda WebSocket

```typescript
import { AWSGraphQLWsAdapter } from '@cocrafts/graphql-lambda';

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

## Build

```bash
bun run build
```

Generates ESM, CommonJS, and TypeScript declaration files in the `dist/` directory.
