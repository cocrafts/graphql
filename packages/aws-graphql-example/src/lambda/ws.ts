import { AWSGraphQLWsAdapter } from 'aws-graphql-lambda';
import { graphqlWsOptions } from '../graphql';
import { gateway, redis, storage } from './shared';
import { setPubsub } from '../pubsub';
import { AWSGatewayRedisGraphQLPubsub } from 'aws-graphql-redis-pubsub';

const pubsub = setPubsub(new AWSGatewayRedisGraphQLPubsub(gateway, redis));

const mergedOptions = { ...graphqlWsOptions, storage, gateway, pubsub };

export const handler = AWSGraphQLWsAdapter(mergedOptions);
