import { makeExecutableSchema } from '@graphql-tools/schema';
import { logOperation, randomIndex } from './utils';
import { type HandlerOptions as GraphQLHTTPOptions } from 'graphql-http';
import { type ServerOptions as GraphQLWSOptions } from 'graphql-ws';
import { GraphQLError, parse } from 'graphql';
import { pubsub } from './pubsub';
import chalk from 'chalk';
import { notifications, userStatuses } from './db';

// Serverless-compatible context (must be JSON serializable)
interface ExtendedContext {
	userId?: string;
	isAdmin?: boolean;
	connectedAt?: string;
	subscriptionCount?: number;
}

const typeDefs = /* GraphQL */ `
	type Query {
		greeting: String
	}

	type Mutation {
		sendMessage(chat: String, message: String!): String
		updateUserStatus(userId: ID!, status: String!): UserStatus
		sendNotification(userId: ID!, message: String!): Notification
	}

	type Subscription {
		# Basic async iterator (local development)
		counter(maxCount: Int = 10): Int!

		# PubSub-based subscriptions (serverless compatible)
		messaged(chat: String): String!
		userStatusChanged(userId: ID): UserStatus!
		notificationReceived(userId: ID!): Notification!
	}

	type UserStatus {
		id: ID!
		username: String!
		status: String!
		lastSeen: String
	}

	type Notification {
		id: ID!
		userId: ID!
		message: String!
		createdAt: String!
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
			sendMessage: async (obj, args, ctx, info) => {
				logOperation(obj, args, ctx, info);
				const chat = args.chat ?? 'broadcast';
				await pubsub.publish(`messaged_${chat}`, { messaged: args.message });
				return `sent_${args.message}_${chat}`;
			},
			updateUserStatus: async (obj, args, ctx, info) => {
				logOperation(obj, args, ctx, info);
				const user = userStatuses.get(args.userId) || {
					id: args.userId,
					username: `user_${args.userId}`,
				};
				const updatedUser = {
					...user,
					status: args.status,
					lastSeen: new Date().toISOString(),
				};
				userStatuses.set(args.userId, updatedUser);

				// Dual topic publishing for serverless flexibility
				await pubsub.publish(`user_status_${args.userId}`, {
					userStatusChanged: updatedUser,
				});
				await pubsub.publish('user_status_all', {
					userStatusChanged: updatedUser,
				});

				return updatedUser;
			},
			sendNotification: async (obj, args, ctx, info) => {
				logOperation(obj, args, ctx, info);
				const notificationId = `noti_${Date.now()}_${randomIndex()}`;
				const notification = {
					id: notificationId,
					userId: args.userId,
					message: args.message,
					createdAt: new Date().toISOString(),
				};
				notifications.set(notificationId, notification);
				await pubsub.publish(`notifications_${args.userId}`, {
					notificationReceived: notification,
				});
				return notification;
			},
		},
		Subscription: {
			counter: {
				subscribe: (obj, args, ctx, info) => {
					logOperation(obj, args, ctx, info);
					const maxCount = Math.min(args.maxCount, 100);
					// Async iterator - works locally but not in serverless
					return (async function* () {
						let count = 0;
						while (count < maxCount) {
							await new Promise(resolve => setTimeout(resolve, 1000));
							yield { counter: count++ };
						}
					})();
				},
			},
			messaged: {
				subscribe: (obj, args, ctx, info) => {
					logOperation(obj, args, ctx, info);
					const chat = args.chat ?? 'broadcast';
					return pubsub.subscribe(`messaged_${chat}`);
				},
			},
			userStatusChanged: {
				subscribe: (obj, args, ctx, info) => {
					logOperation(obj, args, ctx, info);
					const topic = args.userId
						? `user_status_${args.userId}`
						: 'user_status_all';
					return pubsub.subscribe(topic);
				},
			},
			notificationReceived: {
				subscribe: (obj, args, ctx, info) => {
					logOperation(obj, args, ctx, info);
					if (ctx.userId !== args.userId && !ctx.isAdmin) {
						throw new GraphQLError('Unauthorized to subscribe to notification');
					}

					return pubsub.subscribe(`notifications_${args.userId}`);
				},
			},
		},
	},
});

export const graphqlHttpOptions: GraphQLHTTPOptions = { schema };

export const graphqlWsOptions: GraphQLWSOptions = {
	schema,

	context: ctx => {
		const context = {
			userId: (ctx.extra as any)?.['userId'],
			isAdmin: (ctx.extra as any)?.['isAdmin'],
		};
		console.log(chalk.green(`🧠 Context prepared: ${JSON.stringify(context)}`));

		return context;
	},

	/**
	 * Initialize connection context (serialized to Redis in serverless)
	 */
	onConnect(ctx) {
		console.log(
			chalk.green(
				`🔗 Client connected ${JSON.stringify({ ...ctx, extra: null })}`,
			),
		);

		if (!ctx.extra) ctx.extra = {};
		const extraCtx = ctx.extra as ExtendedContext;

		// Example: Authentication from connection params, with a json object (use JWT in real use-case)
		if (ctx.connectionParams?.['token']) {
			const data = JSON.parse(ctx.connectionParams['token'] as string);
			extraCtx.userId = data.userId ?? 'unknown';
			extraCtx.isAdmin = data.isAdmin ?? false;
			extraCtx.connectedAt = new Date().toISOString();
			extraCtx.subscriptionCount = 0;
			console.log(chalk.blue(`👤 User ${extraCtx.userId} authenticated`));
		}

		return true;
	},

	/**
	 * Track subscriptions and validate permissions
	 */
	onSubscribe(ctx, id, payload) {
		console.log(
			chalk.yellow(`📡 Subscription ${id}: ${payload.query?.split('\n')[0]}`),
		);

		const extraCtx = ctx.extra as ExtendedContext;
		if (ctx.extra) {
			extraCtx.subscriptionCount = (extraCtx.subscriptionCount || 0) + 1;
		}
	},

	/**
	 * Clean up on subscription completion
	 */
	onComplete(ctx, id) {
		console.log(chalk.gray(`✅ Completed ${id}`));
		const extraCtx = ctx.extra as ExtendedContext;
		if (ctx.extra && extraCtx.subscriptionCount) {
			extraCtx.subscriptionCount = Math.max(0, extraCtx.subscriptionCount - 1);
		}
	},

	/**
	 * Handle disconnect and status updates
	 */
	onDisconnect(ctx, code, reason) {
		const extraCtx = ctx.extra as ExtendedContext;
		console.log(
			chalk.red(
				`🔌 ${extraCtx.userId || 'Anonymous'} disconnected (${code}): ${reason}`,
			),
		);

		// Publish user offline status
		if (extraCtx?.userId) {
			const publishPromise = pubsub.publish(`user_status_${extraCtx.userId}`, {
				userStatusChanged: {
					id: extraCtx.userId,
					status: 'offline',
					lastSeen: new Date().toISOString(),
				},
			});
			if (publishPromise) {
				publishPromise.catch((err: any) =>
					console.error('Failed to publish disconnect status:', err),
				);
			}
		}
	},
};
