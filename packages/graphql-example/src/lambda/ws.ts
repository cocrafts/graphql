import {
	GraphQLLambdaWsAdapter,
	GraphQLLambdaPubsub,
} from '@cocrafts/graphql-lambda';

import { graphqlWsOptions } from '../graphql';
import { gateway, redis, storage } from './shared';
import { setPubsub } from '../pubsub';

const pubsub = setPubsub(new GraphQLLambdaPubsub(gateway, redis));

const mergedOptions = { ...graphqlWsOptions, storage, gateway, pubsub };

export const handler = GraphQLLambdaWsAdapter(mergedOptions);
