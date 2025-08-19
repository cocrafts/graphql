export type ProxyMut = 'set' | 'del';

export type ProxyPath = (string | symbol)[];

export type ProxyNotify = (mut: ProxyMut, path: ProxyPath, value: any) => void;

const IsProxy = Symbol('IsProxy');

const shouldProxy = (value: any): value is object => {
	return value !== null && typeof value === 'object';
};

/**
 * Creates a deep proxy that recursively monitors changes to object properties and nested objects.
 *
 * Features:
 * - **Deep monitoring**: Automatically proxies nested objects when accessed or assigned
 * - **Change detection**: Only triggers onChange when values actually change (deduplication)
 * - **Lazy proxying**: Existing nested objects are proxied when first accessed
 * - **Idempotent**: Re-proxying an already proxied object returns the same instance
 * - **Path tracking**: Provides full property path for nested changes
 *
 * @param obj - The object to proxy. Must be a non-null object.
 * @param onChange - Callback invoked when properties are set or removed. Receives:
 *   - `mut`: Either 'set' for property assignments or 'del' for deletions
 *   - `path`: Array of property keys representing the full path to the changed property
 *   - `value`: The new value (for 'set') or null (for 'del')
 * @param path - Internal parameter for tracking nested property paths (used during recursion)
 *
 * @returns The proxied object with the same type as the input
 *
 * @example
 * ```typescript
 * const obj = { user: { name: 'John' }, tags: [] };
 * const proxy = deepProxy(obj, (mut, path, value) => {
 *   console.log(`${mut} at ${path.join('.')}: ${value}`);
 * });
 *
 * proxy.user.name = 'Jane';        // logs: "set at user.name: Jane"
 * proxy.tags.push('admin');        // logs: "set at tags.0: admin"
 * delete proxy.user.name;          // logs: "del at user.name: null"
 * ```
 */
export const deepProxy = <T extends object>(
	obj: T,
	onChange: (mut: ProxyMut, path: ProxyPath, value: any) => void = () => {},
	path: ProxyPath = [],
): T => {
	// Check if object is already proxied
	if ((obj as any)[IsProxy]) return obj;

	const proxy = new Proxy(obj, {
		set(target, prop, value, receiver) {
			const propIsProxyKey = prop === IsProxy;
			const oldValue = target[prop as keyof T];

			let valid;
			if (shouldProxy(value)) {
				// Create a deep proxy for the new object value (if not already proxied)
				const proxiedValue = (value as any)[IsProxy]
					? value
					: deepProxy(value, onChange, [...path, prop]);

				valid = Reflect.set(target, prop, proxiedValue, receiver);
			} else {
				valid = Reflect.set(target, prop, value, receiver);
			}

			if (!propIsProxyKey && valid) {
				if (oldValue !== value) onChange('set', [...path, prop], value);
			}

			return valid;
		},
		deleteProperty(target, prop) {
			const propIsProxyKey = prop === IsProxy;
			const valid = Reflect.deleteProperty(target, prop);

			if (!propIsProxyKey && valid) onChange('del', [...path, prop], null);

			return valid;
		},
		get(target, prop, receiver) {
			const value = Reflect.get(target, prop, receiver);

			// If accessing a nested object that wasn't previously proxied, proxy it now
			if (shouldProxy(value) && !(value as any)[IsProxy]) {
				const proxiedValue = deepProxy(value, onChange, [...path, prop]);
				Reflect.set(target, prop, proxiedValue, receiver);
				return proxiedValue;
			}

			return value;
		},
	}) as T;

	(proxy as any)[IsProxy] = true;

	return proxy;
};
