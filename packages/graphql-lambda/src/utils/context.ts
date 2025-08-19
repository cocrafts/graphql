import { deepProxy, type ProxyMut, type ProxyPath } from './proxy';
import type { Context as GraphQLWSContext } from 'graphql-ws';
import type { AnyRedis } from '../interface';

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
	redis: AnyRedis,
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
					acc.push({ mut, pairs: [[path, value]] });
				}

				return acc;
			},
			[] as { mut: 'set' | 'del'; pairs: [string, any][] }[],
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
			isUpdateScheduled = true;
			queueMicrotask(flushChanges);
		}
	};

	const proxy = deepProxy(initial, (mut: ProxyMut, path: ProxyPath, value) => {
		const pathString = path.join('.');

		if (mut === 'set' && typeof value === 'object') {
			const flattened: Record<string, any> = {};
			flattenObject(value, pathString, flattened);

			for (const [flatPath, flatValue] of Object.entries(flattened)) {
				pendingChanges.push([mut, flatPath, serializeValue(flatValue)]);
			}
		} else {
			pendingChanges.push([mut, pathString, serializeValue(value)]);
		}

		scheduleUpdate();
	});

	return {
		context: proxy,
		waitAllSync: () => Promise.allSettled(updatePromises),
	};
};

/**
 * Compress GraphQLWSContext into a flat object suitable for Redis storage.
 * This is the inverse of buildContext - it takes a nested context object
 * and flattens it using dot notation for storage in Redis hash.
 *
 * The subscriptions field is intentionally excluded from compression
 * as it typically contains AsyncGenerators that shouldn't be persisted.
 */
export const compressContext = (
	context: GraphQLWSContext,
): Record<string, any> => {
	const compressed: Record<string, any> = {};

	// Handle top-level boolean flags directly
	if (context.connectionInitReceived !== undefined) {
		compressed.connectionInitReceived = serializeValue(
			context.connectionInitReceived,
		);
	}
	if (context.acknowledged !== undefined) {
		compressed.acknowledged = serializeValue(context.acknowledged);
	}

	// Handle connectionParams - flatten with dot notation
	if (context.connectionParams) {
		const flattened: Record<string, any> = {};
		flattenObject(context.connectionParams, 'connectionParams', flattened);
		// Apply serialization after flattening
		for (const [key, value] of Object.entries(flattened)) {
			compressed[key] = serializeValue(value);
		}
	}

	// Handle extra data - flatten with dot notation
	if (context.extra) {
		const flattened: Record<string, any> = {};
		flattenObject(context.extra, 'extra', flattened);
		// Apply serialization after flattening
		for (const [key, value] of Object.entries(flattened)) {
			compressed[key] = serializeValue(value);
		}
	}

	// Note: subscriptions are intentionally excluded as they contain
	// AsyncGenerators and other non-serializable data that shouldn't be persisted

	return compressed;
};

/**
 * Recursively flatten an object using dot notation.
 * Handles both objects and arrays, preserving the structure for later reconstruction.
 */
const flattenObject = (
	obj: any,
	prefix: string,
	target: Record<string, any>,
): void => {
	if (obj === null || obj === undefined) {
		target[prefix] = obj;
		return;
	}

	// Handle arrays
	if (Array.isArray(obj)) {
		for (let i = 0; i < obj.length; i++) {
			const value = obj[i];
			const key = `${prefix}.${i}`;

			if (value === null || value === undefined) {
				target[key] = value;
			} else if (typeof value === 'object') {
				flattenObject(value, key, target);
			} else {
				target[key] = value;
			}
		}
		return;
	}

	// Handle objects
	if (typeof obj === 'object') {
		for (const [key, value] of Object.entries(obj)) {
			const fullKey = `${prefix}.${key}`;

			if (value === null || value === undefined) {
				target[fullKey] = value;
			} else if (typeof value === 'object') {
				flattenObject(value, fullKey, target);
			} else {
				target[fullKey] = value;
			}
		}
		return;
	}

	// Handle primitive values (shouldn't reach here in normal usage)
	target[prefix] = obj;
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
			context[key] = deserializeValue(value);
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
			setNestedValue(target, path, deserializeValue(value));
		}
	}

	return context as GraphQLWSContext;
};

/**
 * Serialize a value with type prefix for Redis storage.
 * This ensures we can accurately deserialize the value back to its original type.
 */
const serializeValue = (value: any): string => {
	if (value === null) return '__null__';
	if (value === undefined) return '__undefined__';

	if (typeof value === 'boolean') {
		return `__boolean__${value}`;
	}

	if (typeof value === 'number') {
		return `__number__${value}`;
	}

	if (typeof value === 'string') {
		// Strings are the default, no prefix needed
		return value;
	}

	// For other types (objects, arrays, functions), stringify them
	// This shouldn't normally happen in our flattened context, but handle it gracefully
	return String(value);
};

/**
 * Deserialize a value from Redis storage back to its original type using type prefixes.
 */
const deserializeValue = (value: any): any => {
	// If it's not a string, return as-is
	if (typeof value !== 'string') {
		return value;
	}

	// Handle type prefix format
	if (value.startsWith('__')) {
		const prefixEnd = value.indexOf('__', 2);
		if (prefixEnd !== -1) {
			const type = value.substring(2, prefixEnd);
			const content = value.substring(prefixEnd + 2);

			switch (type) {
				case 'boolean':
					return content === 'true';
				case 'number':
					const num = Number(content);
					return isNaN(num) ? content : num;
				case 'string':
					return content;
				case 'null':
					return null;
				case 'undefined':
					return undefined;
				default:
					// Unknown prefix, return the content as string
					return content;
			}
		}
	}

	// If no type prefix found, treat as plain string
	return value;
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
