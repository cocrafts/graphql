import {
	GraphQLLambdaHttpAdapter,
	GraphQLLambdaPubsub,
} from '@cocrafts/graphql-lambda';

import { graphqlHttpOptions } from '../graphql';
import { setPubsub } from '../pubsub';
import { gateway, redis } from './shared';

setPubsub(new GraphQLLambdaPubsub(gateway, redis));

export const handler = GraphQLLambdaHttpAdapter(graphqlHttpOptions);
