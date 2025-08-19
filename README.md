# @cocrafts/graphql

A GraphQL Server setup for cross runtimes, supporting both dedicated servers and serverless environments. Compliant with the [`graphql-ws` protocol](https://github.com/enisdenjo/graphql-ws/blob/master/PROTOCOL.md).

This project provides a unified GraphQL backend architecture that can run on dedicated servers, local development environments, and AWS Lambda infrastructure with API Gateway and WebSocket Gateway support.

## Architecture Overview

The project consists of three main packages that work together to provide a seamless GraphQL experience across different runtime environments:

### Core Components

- **GraphQL Schema**: Single schema definition shared across all environments
- **Query/Mutation/Subscription Resolvers**: Unified resolver logic
- **WebSocket Support**: GraphQL subscriptions via WebSocket protocol
- **Pub/Sub Engine**: Abstract interface for event distribution

## Packages

### @cocrafts/graphql-lambda

AWS Lambda adapters for GraphQL with support for HTTP and WebSocket APIs, Redis storage, and distributed pub/sub.

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

Abstract pub/sub interface for GraphQL subscriptions with a default implementation using `graphql-subscriptions`.

**Features:**
- Abstract `GraphQLPubSub` interface
- Default implementation with `graphql-subscriptions`
- Extensible for custom pub/sub backends
- Lightweight and focused

**Usage:**
```typescript
import { DefaultGraphQLPubSub, GraphQLPubSub } from '@cocrafts/graphql-pubsub';

const pubsub = new DefaultGraphQLPubSub();
const channel = pubsub.subscribe('user.created');
await pubsub.publish('user.created', { id: '123', name: 'John' });
```

### @cocrafts/graphql-example

Complete working example demonstrating the full stack integration.

**Features:**
- Local development server with HTTP and WebSocket
- AWS Lambda deployment with SST
- Redis integration for distributed pub/sub
- Shared GraphQL schema across environments

## Runtime Environments

### Monolith Server

**Components:**
- Single dedicated server
- On-runtime WebSocket server
- GraphQL subscriptions with local pub/sub
- Standard `graphql-http` and `graphql-ws` libraries

**Use Case:** Traditional server deployments, local development

### Serverless on AWS Lambda

**Components:**
- WebSocket Gateway: AWS API Gateway WebSocket API
- Pub/Sub: Redis-based distributed storage and event distribution
- Main resolvers: AWS Lambda functions
- HTTP API: AWS API Gateway HTTP API

**Use Case:** Scalable, event-driven serverless architectures

## Getting Started

### Installation

```bash
# Install all packages
npm install @cocrafts/graphql-lambda @cocrafts/graphql-pubsub

# Or install individually
npm install @cocrafts/graphql-lambda
npm install @cocrafts/graphql-pubsub
```

### Basic Setup

1. **Define your GraphQL schema and resolvers**
2. **Choose your pub/sub implementation**
3. **Select your runtime environment**
4. **Deploy and run**

### Example Implementation

See the `@cocrafts/graphql-example` package for a complete working implementation that demonstrates:
- Local development server
- AWS Lambda deployment
- Redis integration
- Shared schema across environments

## Development

### Building Packages

```bash
# Build graphql-lambda
cd packages/graphql-lambda
bun run build

# Build graphql-pubsub
cd packages/graphql-pubsub
bun run build
```

### Running Examples

```bash
# Run local development server
cd packages/graphql-example
bun run dev

# Deploy to AWS
cd packages/graphql-example
bun run deploy
```

## Key Benefits

- **Unified Codebase**: Single GraphQL schema works everywhere
- **Environment Agnostic**: Same code runs locally and in production
- **Scalable Architecture**: Serverless-ready with Redis pub/sub
- **Protocol Compliant**: Full `graphql-ws` protocol support
- **Type Safe**: Complete TypeScript support across all packages

## Contributing

This project uses a monorepo structure with shared tooling and configurations. Each package can be developed and built independently while maintaining consistency across the ecosystem.
