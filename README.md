# @cocrafts/graphql

A GraphQL Server setup for cross runtimes, supporting both dedicated servers and serverless environments. Compliant with the [`graphql-ws` protocol](https://github.com/enisdenjo/graphql-ws/blob/master/PROTOCOL.md).

## Overview

This project provides a unified GraphQL backend architecture that can run on dedicated servers, local development environments, and AWS Lambda infrastructure. The same GraphQL schema and resolvers work across all environments.

## Packages

### @cocrafts/graphql-lambda

AWS Lambda adapters for GraphQL with HTTP and WebSocket support.

**Features:**
- HTTP and WebSocket adapters for AWS Lambda
- Redis integration for distributed storage and pub/sub
- Cross-environment compatibility (local + Lambda)
- Unified GraphQL interface

**Usage:**
```typescript
import { AWSGraphQLHttpAdapter, AWSGraphQLWsAdapter } from '@cocrafts/graphql-lambda';

// HTTP Lambda
export const httpHandler = AWSGraphQLHttpAdapter(graphqlHttpOptions);

// WebSocket Lambda
export const wsHandler = AWSGraphQLWsAdapter({ 
  ...graphqlWsOptions, 
  storage, 
  gateway, 
  pubsub 
});
```

### @cocrafts/graphql-pubsub

Abstract pub/sub interface for GraphQL subscriptions.

**Features:**
- Abstract `GraphQLPubSub` interface
- Default implementation with `graphql-subscriptions`
- Extensible for custom pub/sub backends

**Usage:**
```typescript
import { DefaultGraphQLPubSub } from '@cocrafts/graphql-pubsub';

const pubsub = new DefaultGraphQLPubSub();
const channel = pubsub.subscribe('user.created');
await pubsub.publish('user.created', { id: '123', name: 'John' });
```

### @cocrafts/graphql-example

Complete working example demonstrating the full stack integration.

## Runtime Environments

### Local Development / Monolith Server

- Standard `graphql-http` and `graphql-ws` libraries
- Local pub/sub engine
- Direct WebSocket connections

### AWS Lambda Serverless

- WebSocket Gateway via API Gateway
- Redis-based distributed storage and pub/sub
- Lambda functions for resolvers
- Context persistence between invocations

## Installation

```bash
npm install @cocrafts/graphql-lambda @cocrafts/graphql-pubsub
```

## Key Benefits

- **Unified Codebase**: Single GraphQL schema works everywhere
- **Environment Agnostic**: Same code runs locally and in production
- **Serverless Ready**: Lambda adapters with Redis pub/sub
- **Protocol Compliant**: Full `graphql-ws` protocol support
- **Type Safe**: Complete TypeScript support

## Development

```bash
# Build packages
cd packages/graphql-lambda && bun run build
cd packages/graphql-pubsub && bun run build

# Run example
cd packages/graphql-example && bun run dev
```

## Critical Considerations

### Serverless Limitations

- **Context must be JSON serializable** - No functions, classes, or circular references
- **No async iterators** - Uses custom pub/sub engine instead
- **No field-level filtering** - Topic-based subscription routing only
- **Context reconstruction** - Context rebuilt from Redis on each Lambda invocation

### Best Practices

- Design subscriptions for direct payload forwarding
- Use topic-based filtering instead of field-level filtering
- Keep context data minimal and serializable
- Implement proper error handling and cleanup

For detailed serverless considerations, see the [@cocrafts/graphql-lambda README](./packages/graphql-lambda/README.md).
