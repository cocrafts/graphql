import type { RedisClientType } from 'redis';
import { deepProxy, type ProxyMut, type ProxyPath } from './proxy';
import type { Context as GraphQLWSContext } from 'graphql-ws';

/**
 * Each connection has a context for subsequence subscriptions and handler callbacks (onConnect, onComplete, onDisconnect)
 * This context will be shared across lambda runtimes, so we will need to sync to a persistent storage to later use.
 *
 * Race condition of context update can happen.
 * But we can assume that context update happening in sequence,
 * `connection_init` will happen once and before all other subscriptions.
 * So the `extra` value will be saved for other uses in the subsequence events.
 *
 * Any change happen to the context object will be recognized by proxy intercept.
 * And will call an updating to storage at the next event loop. So all mutation can freely happen in a sync operation,
 * like onComplete, onDisconnect, onConnect.
 * We can also have a better schedule to minimize number of update requests, but may cause race condition more easy to happen.
 */
export const createContextManager = <T extends object>(
	initial: T,
	contextKey: string,
	redis: RedisClientType,
) => {
	type Changes = ['set' | 'del', string, any][];

	let isUpdateScheduled = false;
	let pendingChanges: Changes = [];
	const updatePromises = new Set<Promise<void>>();

	const batchUpdate = async (changes: Changes) => {
		const batches = changes.reduce(
			(acc, [mut, path, value]) => {
				const currentBatchMut = acc[acc.length - 1]?.mut;
				if (currentBatchMut === mut) {
					acc[acc.length - 1]?.pairs.push([path, value]);
				} else {
					acc.push({ mut, pairs: [path, value] });
				}

				return acc;
			},
			[] as { mut: 'set' | 'del'; pairs: [string, any] }[],
		);

		for (const batch of batches) {
			if (batch.mut === 'del') {
				redis.HDEL(
					contextKey,
					batch.pairs.map(p => p[0]),
				);
			}

			if (batch.mut === 'set') {
				redis.HSET(contextKey, Object.fromEntries(batch.pairs));
			}
		}
	};

	const flushChanges = async () => {
		if (Object.keys(pendingChanges).length === 0) return;

		const changes = [...pendingChanges];
		pendingChanges = [];
		isUpdateScheduled = false;

		const promise = batchUpdate(changes);
		updatePromises.add(promise);
		try {
			await promise;
		} catch (error) {
			console.error('Batch update failed:', error);
		} finally {
			updatePromises.delete(promise);
		}
	};

	const scheduleUpdate = () => {
		if (!isUpdateScheduled) {
			isUpdateScheduled = false;
			queueMicrotask(flushChanges);
		}
	};

	const proxy = deepProxy(initial, (mut: ProxyMut, path: ProxyPath, value) => {
		pendingChanges.push([mut, path.join('.'), value]);
		scheduleUpdate();
	});

	return {
		context: proxy,
		waitAllSync: () => Promise.allSettled(updatePromises),
	};
};

/**
 * Build the context object from raw context stored in redis with race-protected format:
 * {
 *	connectionInitReceived: true,
 *	acknowledged: true,
 *	['connectionParams.header']: "atomic heading string",
 *	['extra.authUser.id`]: "atomic id string",
 *	['extra.authUser.username`]: "atomic username string"
 *	...
 * }
 */
export const buildContext = (raw: object): GraphQLWSContext => {
	const context: any = {
		connectionInitReceived: false,
		acknowledged: false,
		subscriptions: {},
		extra: {},
	};

	for (const [key, value] of Object.entries(raw)) {
		// Handle top-level boolean flags
		if (key === 'connectionInitReceived' || key === 'acknowledged') {
			context[key] = value === true || value === 'true' || value === '1';
			continue;
		}

		// Handle nested properties with dot notation
		const dotIndex = key.indexOf('.');
		if (dotIndex === -1) continue;

		const prefix = key.substring(0, dotIndex);
		const path = key.substring(dotIndex + 1);

		// Initialize nested objects as needed
		if (prefix === 'connectionParams' && !context.connectionParams) {
			context.connectionParams = {};
		}

		// Set the nested value
		const target =
			prefix === 'extra'
				? context.extra
				: prefix === 'connectionParams'
					? context.connectionParams
					: prefix === 'subscriptions'
						? context.subscriptions
						: null;

		if (target && value !== null) {
			setNestedValue(target, path, value);
		}
	}

	return context as GraphQLWSContext;
};

/**
 * Sets a nested value using dot notation with array support.
 * Handles both objects and arrays automatically based on numeric keys.
 */
const setNestedValue = (obj: any, path: string, value: any): void => {
	const keys = path.split('.').filter(Boolean); // Remove empty keys
	let current = obj;

	// Navigate/create the path
	for (let i = 0; i < keys.length - 1; i++) {
		const key = keys[i];
		const nextKey = keys[i + 1];

		if (key && nextKey !== undefined) {
			current = navigateOrCreate(current, key, isArrayIndex(nextKey));
		}
	}

	// Set the final value
	const finalKey = keys[keys.length - 1];
	if (finalKey !== undefined) {
		setFinalValue(current, finalKey, value);
	}
};

/**
 * Navigate to or create a nested property/array element
 */
const navigateOrCreate = (obj: any, key: string, nextIsArray: boolean): any => {
	if (isArrayIndex(key)) {
		const index = parseInt(key, 10);
		if (!Array.isArray(obj)) return obj; // Should not happen

		// Expand array if needed
		while (obj.length <= index) {
			obj.push(undefined);
		}

		// Initialize element if needed
		if (!obj[index] || typeof obj[index] !== 'object') {
			obj[index] = nextIsArray ? [] : {};
		}

		return obj[index];
	} else {
		// Object property
		if (
			!obj[key] ||
			typeof obj[key] !== 'object' ||
			Array.isArray(obj[key]) !== nextIsArray
		) {
			obj[key] = nextIsArray ? [] : {};
		}

		return obj[key];
	}
};

/**
 * Set the final value in the target object/array
 */
const setFinalValue = (obj: any, key: string, value: any): void => {
	if (isArrayIndex(key)) {
		const index = parseInt(key, 10);
		if (!Array.isArray(obj)) return; // Should not happen

		// Expand array if needed
		while (obj.length <= index) {
			obj.push(undefined);
		}

		obj[index] = value;
	} else {
		obj[key] = value;
	}
};

/**
 * Check if a key represents an array index (numeric string)
 */
const isArrayIndex = (key: string): boolean => /^\d+$/.test(key);
