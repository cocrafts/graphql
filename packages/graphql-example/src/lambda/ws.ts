import {
	GraphQLLambdaWsAdapter,
	GraphQLLambdaPubsub,
} from '@cocrafts/graphql-lambda';

import { graphqlWsOptions, schema } from '../graphql';
import { gateway, redis } from './shared';
import { setPubsub } from '../pubsub';

const pubsub = setPubsub(new GraphQLLambdaPubsub(gateway, redis));

pubsub.setGraphQLSchema(schema);

const mergedOptions = { ...graphqlWsOptions, gateway, redis, pubsub };

export const handler = GraphQLLambdaWsAdapter(mergedOptions);
