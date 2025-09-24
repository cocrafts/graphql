import {
	GraphQLLambdaHttpAdapter,
	GraphQLLambdaPubsub,
} from '@cocrafts/graphql-lambda';

import { graphqlHttpOptions, schema } from '../graphql';
import { setPubsub } from '../pubsub';
import { gateway, redis } from './shared';

const pubsub = setPubsub(new GraphQLLambdaPubsub(gateway, redis));

pubsub.setGraphQLSchema(schema);

export const handler = GraphQLLambdaHttpAdapter(graphqlHttpOptions);
