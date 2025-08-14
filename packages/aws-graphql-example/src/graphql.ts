import { makeExecutableSchema } from '@graphql-tools/schema';
import { logOperation, randomIndex } from './utils';
import { type HandlerOptions as GraphQLHTTPOptions } from 'graphql-http';
import { type ServerOptions as GraphQLWSOptions } from 'graphql-ws';
import { pubsub } from './pubsub';
import chalk from 'chalk';

const typeDefs = /* GraphQL */ `
	type Query {
		greeting: String
	}

	type Mutation {
		sayHi(name: String): String
		sendMessage(chat: String, message: String!): String
	}

	type Subscription {
		counter(maxCount: Int = 10): Int!
		messaged(chat: String): String!
	}
`;

export const schema = makeExecutableSchema({
	typeDefs,
	resolvers: {
		Query: {
			greeting: (obj, args, ctx, info) => {
				logOperation(obj, args, ctx, info);
				return `Hello world! ${randomIndex()}`;
			},
		},
		Mutation: {
			sayHi: (obj, args, ctx, info) => {
				logOperation(obj, args, ctx, info);
				return `Hi, ${args.name}. ${randomIndex()}`;
			},
			sendMessage: async (obj, args, ctx, info) => {
				logOperation(obj, args, ctx, info);

				const chat = args.chat ?? 'broadcast';
				await pubsub.publish(`messaged_${chat}`, { messaged: args.message });

				return `sent_${args.message}_${chat}`;
			},
		},
		Subscription: {
			messaged: {
				subscribe: (obj, args, ctx, info) => {
					logOperation(obj, args, ctx, info);

					const chat = args.chat ?? 'broadcast';
					return pubsub.subscribe(`messaged_${chat}`);
				},
			},
			counter: {
				subscribe: (obj, args, ctx, info) => {
					logOperation(obj, args, ctx, info);

					const maxCount = Math.min(args.maxCount, 100);

					return (async function* () {
						let count = 0;
						while (count < maxCount) {
							await new Promise(resolve => setTimeout(resolve, 1000));
							yield { counter: count++ };
						}
					})();
				},
			},
		},
	},
});

export const graphqlHttpOptions: GraphQLHTTPOptions = { schema };

export const graphqlWsOptions: GraphQLWSOptions = {
	schema,
	/**
	 * Handle complete from client?
	 */
	onComplete(ctx, id, payload) {
		console.log(chalk.gray(`Completed ${id} ${JSON.stringify(payload)}`));
	},
	/**
	 * Handle client disconnect from client?
	 */
	onDisconnect(ctx, code, reason) {
		console.log(chalk.gray(`Disconnected ${code} ${reason}`));
	},
};
