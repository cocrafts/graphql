import type { GraphQLPubSub } from 'graphql-pubsub';

export let pubsub: GraphQLPubSub;

export function setPubsub<T extends GraphQLPubSub>(pb: T): T {
	pubsub = pb;
	return pb;
}
