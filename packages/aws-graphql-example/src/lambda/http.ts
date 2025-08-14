import { AWSGraphQLHttpAdapter } from 'aws-graphql-lambda';
import { graphqlHttpOptions } from '../graphql';
import { setPubsub } from '../pubsub';
import { AWSGatewayRedisGraphQLPubsub } from 'aws-graphql-redis-pubsub';
import { gateway, redis } from './shared';

setPubsub(new AWSGatewayRedisGraphQLPubsub(gateway, redis));

export const handler = AWSGraphQLHttpAdapter(graphqlHttpOptions);
