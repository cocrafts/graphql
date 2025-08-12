import { makeExecutableSchema } from '@graphql-tools/schema';
import { logOperation, randomIndex } from './utils';

const typeDefs = /* GraphQL */ `
	type Query {
		greeting: String
	}

	type Mutation {
		sayHi(name: String): String
	}

	type Subscription {
		counter(maxCount: Int = 10): Int!
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
		},
		Subscription: {
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
