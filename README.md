# @cocraft/graphql

A GraphQL Server setup for cross runtimes, server and serverless. Compliant with [`graphql-ws` protocol](https://github.com/enisdenjo/graphql-ws/blob/master/PROTOCOL.md).

This project is an experimental setup for GraphQL backend that's able to run on dedicated server, local development server, and will be deployed to AWS infrastructure, with AWS Gateways, AWS Lambda,...

# Main architecture

For a general GraphQL backend, there're main components:

- GraphQL schema
- GraphQL query/mutation/subscription resolvers
- GraphQL subscription via WebSocket (or other protocol) with a Pubsub Engine

# Monolith Server

Components:
- A single dedicated server
- On-runtime Websocket server, GraphQL Subscription, Pubsub

# Serverless on AWS Lambda

Components:
- Websocket Gateway: AWS Websocket Gateway
- Pubsub: Use with persistent distributed storage (Redis)
- Main resolvers: AWS Lambda
