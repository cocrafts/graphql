import { PubSub, PubSubEngine } from 'graphql-subscriptions';

type Channel = AsyncIterable<any, any, any>;

/**
 * An interface to GraphQL Pubsub Engine.
 *
 * Return Channel:
 * - An Async Iterator for receiving data through await loops, with data emitted by a pubsub engine,
 *  e.g. local event emitter, pubsub engine like Redis Pubsub.
 * - An Registrable channel object for declaring the subscribed topics with connection and subscriptions,
 * designed for serverless runtime environments where pubsub handle the distribution by itself.
 */
export interface GraphQLPubSub {
	subscribe: (...topics: string[]) => Channel;
	publish: (topic: string, payload: any) => void | Promise<void>;
}

export class DefaultGraphQLPubSub implements GraphQLPubSub {
	private engine: PubSubEngine;

	constructor(engine: PubSubEngine = new PubSub()) {
		this.engine = engine;
	}

	subscribe(...topics: string[]): Channel {
		return this.engine.asyncIterableIterator(topics);
	}

	publish(topic: string, payload: any): void | Promise<void> {
		return this.engine.publish(topic, payload);
	}
}
