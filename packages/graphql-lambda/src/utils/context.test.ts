import { test, expect } from 'bun:test';
import { buildContext, compressContext } from './context';

test('buildContext - builds context from empty raw object', () => {
	const raw = {};
	const context = buildContext(raw);

	expect(context.connectionInitReceived).toBe(false);
	expect(context.acknowledged).toBe(false);
	expect(context.subscriptions).toEqual({});
	expect(context.extra).toEqual({});
	expect(context.connectionParams).toBeUndefined();
});

test('buildContext - builds context with basic flags', () => {
	const raw = {
		connectionInitReceived: '__boolean__true',
		acknowledged: '__boolean__true',
	};
	const context = buildContext(raw);

	expect(context.connectionInitReceived).toBe(true);
	expect(context.acknowledged).toBe(true);
	expect(context.subscriptions).toEqual({});
	expect(context.extra).toEqual({});
});

test('buildContext - builds context with nested connectionParams', () => {
	const raw = {
		connectionInitReceived: '__boolean__true',
		acknowledged: '__boolean__true',
		'connectionParams.authorization': 'Bearer token123',
		'connectionParams.user.id': '__number__456',
		'connectionParams.user.name': 'John Doe',
	};
	const context = buildContext(raw);

	expect(context.connectionInitReceived).toBe(true);
	expect(context.acknowledged).toBe(true);
	expect(context.connectionParams).toEqual({
		authorization: 'Bearer token123',
		user: {
			id: 456, // Now parsed as number
			name: 'John Doe',
		},
	});
});

test('buildContext - builds context with nested extra data', () => {
	const raw = {
		connectionInitReceived: '__boolean__false',
		acknowledged: '__boolean__false',
		'extra.requestContext.connectionId': 'conn123',
		'extra.requestContext.routeKey': '$connect',
		'extra.authUser.id': 'user456',
		'extra.authUser.profile.email': 'user@example.com',
		'extra.metadata.version': '1.0.0',
	};
	const context = buildContext(raw);

	expect(context.connectionInitReceived).toBe(false);
	expect(context.acknowledged).toBe(false);
	expect(context.extra).toEqual({
		requestContext: {
			connectionId: 'conn123',
			routeKey: '$connect',
		},
		authUser: {
			id: 'user456',
			profile: {
				email: 'user@example.com',
			},
		},
		metadata: {
			version: '1.0.0',
		},
	});
});

test('buildContext - handles mixed data types', () => {
	const raw = {
		connectionInitReceived: '__boolean__true', // boolean
		acknowledged: '__boolean__false', // boolean
		'extra.count': '__number__42', // number
		'extra.settings.enabled': '__boolean__true', // boolean
		'connectionParams.timestamp': '__number__1234567890',
	};
	const context = buildContext(raw);

	expect(context.connectionInitReceived).toBe(true);
	expect(context.acknowledged).toBe(false);
	expect(context.extra).toEqual({
		count: 42,
		settings: {
			enabled: true, // Now parsed as boolean
		},
	});
	expect(context.connectionParams).toEqual({
		timestamp: 1234567890,
	});
});

test('buildContext - handles complex nested structure', () => {
	const raw = {
		connectionInitReceived: '__boolean__true',
		acknowledged: '__boolean__true',
		'connectionParams.headers.authorization': 'Bearer abc123',
		'connectionParams.headers.user-agent': 'GraphQL-Client/1.0',
		'extra.requestContext.connectionId': 'abc123',
		'extra.requestContext.stage': 'dev',
		'extra.user.id': 'user123',
		'extra.user.permissions.read': '__boolean__true',
		'extra.user.permissions.write': '__boolean__false',
		'extra.session.id': 'session456',
		'extra.session.createdAt': '2023-01-01T00:00:00Z',
	};
	const context = buildContext(raw);

	expect(context).toEqual({
		connectionInitReceived: true,
		acknowledged: true,
		subscriptions: {},
		connectionParams: {
			headers: {
				authorization: 'Bearer abc123',
				'user-agent': 'GraphQL-Client/1.0',
			},
		},
		extra: {
			requestContext: {
				connectionId: 'abc123',
				stage: 'dev',
			},
			user: {
				id: 'user123',
				permissions: {
					read: true, // Now parsed as boolean
					write: false, // Now parsed as boolean
				},
			},
			session: {
				id: 'session456',
				createdAt: '2023-01-01T00:00:00Z',
			},
		},
	});
});

test('buildContext - handles subscriptions (though typically not persisted)', () => {
	const raw = {
		connectionInitReceived: '__boolean__true',
		acknowledged: '__boolean__true',
		'subscriptions.sub1': 'some-subscription-data',
		'subscriptions.sub2': null, // null values should be ignored
	};
	const context = buildContext(raw);

	expect(context.subscriptions).toEqual({
		sub1: 'some-subscription-data' as any, // Normally subscriptions contain AsyncGenerators, but for testing we use strings
		// sub2 should not be included due to null value
	});
});

test('buildContext - handles empty nested paths gracefully', () => {
	const raw = {
		'extra.': 'should-be-ignored', // empty key after dot
		'extra..nested': 'should-handle-double-dots',
		'connectionParams.valid.key': 'should-work',
	};
	const context = buildContext(raw);

	expect(context.extra).toEqual({
		nested: 'should-handle-double-dots', // double dots create an empty key that gets skipped
	});
	expect(context.connectionParams).toEqual({
		valid: {
			key: 'should-work',
		},
	});
});

test('buildContext - supports arrays in nested fields', () => {
	const raw = {
		connectionInitReceived: '__boolean__true',
		acknowledged: '__boolean__true',
		'extra.tags.0': 'admin',
		'extra.tags.1': 'user',
		'extra.tags.2': 'guest',
		'extra.permissions.0.action': 'read',
		'extra.permissions.0.resource': 'posts',
		'extra.permissions.1.action': 'write',
		'extra.permissions.1.resource': 'comments',
	};
	const context = buildContext(raw);

	expect(context.extra).toEqual({
		tags: ['admin', 'user', 'guest'],
		permissions: [
			{ action: 'read', resource: 'posts' },
			{ action: 'write', resource: 'comments' },
		],
	});
});

test('buildContext - handles mixed arrays and objects', () => {
	const raw = {
		connectionInitReceived: '__boolean__true',
		'extra.user.name': 'John',
		'extra.user.roles.0': 'admin',
		'extra.user.roles.1': 'moderator',
		'extra.user.profile.addresses.0.street': '123 Main St',
		'extra.user.profile.addresses.0.city': 'New York',
		'extra.user.profile.addresses.1.street': '456 Oak Ave',
		'extra.user.profile.addresses.1.city': 'Boston',
		'extra.settings.notifications.0': 'email',
		'extra.settings.notifications.1': 'sms',
		'extra.settings.theme': 'dark',
	};
	const context = buildContext(raw);

	expect(context.extra).toEqual({
		user: {
			name: 'John',
			roles: ['admin', 'moderator'],
			profile: {
				addresses: [
					{ street: '123 Main St', city: 'New York' },
					{ street: '456 Oak Ave', city: 'Boston' },
				],
			},
		},
		settings: {
			notifications: ['email', 'sms'],
			theme: 'dark',
		},
	});
});

test('buildContext - handles sparse arrays', () => {
	const raw = {
		connectionInitReceived: '__boolean__true',
		'extra.items.0': 'first',
		'extra.items.2': 'third', // Skip index 1
		'extra.items.5': 'sixth', // Large gap
	};
	const context = buildContext(raw);

	expect((context.extra as any).items).toHaveLength(6);
	expect((context.extra as any).items[0]).toBe('first');
	expect((context.extra as any).items[1]).toBeUndefined();
	expect((context.extra as any).items[2]).toBe('third');
	expect((context.extra as any).items[3]).toBeUndefined();
	expect((context.extra as any).items[4]).toBeUndefined();
	expect((context.extra as any).items[5]).toBe('sixth');
});

test('buildContext - handles connectionParams with arrays', () => {
	const raw = {
		connectionInitReceived: '__boolean__true',
		acknowledged: '__boolean__true',
		'connectionParams.headers.0.name': 'Authorization',
		'connectionParams.headers.0.value': 'Bearer token123',
		'connectionParams.headers.1.name': 'User-Agent',
		'connectionParams.headers.1.value': 'GraphQL-Client/1.0',
		'connectionParams.scopes.0': 'read:posts',
		'connectionParams.scopes.1': 'write:comments',
	};
	const context = buildContext(raw);

	expect(context.connectionParams).toEqual({
		headers: [
			{ name: 'Authorization', value: 'Bearer token123' },
			{ name: 'User-Agent', value: 'GraphQL-Client/1.0' },
		],
		scopes: ['read:posts', 'write:comments'],
	});
});

test('buildContext - handles nested arrays', () => {
	const raw = {
		connectionInitReceived: '__boolean__true',
		'extra.matrix.0.0': 'a1',
		'extra.matrix.0.1': 'a2',
		'extra.matrix.1.0': 'b1',
		'extra.matrix.1.1': 'b2',
		'extra.groups.0.members.0': 'user1',
		'extra.groups.0.members.1': 'user2',
		'extra.groups.0.name': 'Admins',
		'extra.groups.1.members.0': 'user3',
		'extra.groups.1.name': 'Users',
	};
	const context = buildContext(raw);

	expect(context.extra).toEqual({
		matrix: [
			['a1', 'a2'],
			['b1', 'b2'],
		],
		groups: [
			{
				name: 'Admins',
				members: ['user1', 'user2'],
			},
			{
				name: 'Users',
				members: ['user3'],
			},
		],
	});
});

test('buildContext - handles array indices as strings vs numbers', () => {
	const raw = {
		connectionInitReceived: '__boolean__true',
		'extra.items.0': 'zero',
		'extra.items.1': 'one',
		'extra.items.10': 'ten', // Two digits
		'extra.config.timeout': '__number__5000', // Not an array index
		'extra.config.retries': '__number__3',
	};
	const context = buildContext(raw);

	expect((context.extra as any).items).toHaveLength(11);
	expect((context.extra as any).items[0]).toBe('zero');
	expect((context.extra as any).items[1]).toBe('one');
	expect((context.extra as any).items[10]).toBe('ten');
	expect((context.extra as any).config).toEqual({
		timeout: 5000, // Now parsed as number
		retries: 3, // Now parsed as number
	});
});

// Tests for compressContext function
test('compressContext - compresses minimal context', () => {
	const context = {
		connectionInitReceived: false,
		acknowledged: false,
		subscriptions: {},
		extra: {},
	};
	const compressed = compressContext(context as any);

	expect(compressed).toEqual({
		connectionInitReceived: '__boolean__false',
		acknowledged: '__boolean__false',
	});
});

test('compressContext - compresses context with basic flags', () => {
	const context = {
		connectionInitReceived: true,
		acknowledged: true,
		subscriptions: {},
		extra: {},
	};
	const compressed = compressContext(context as any);

	expect(compressed).toEqual({
		connectionInitReceived: '__boolean__true',
		acknowledged: '__boolean__true',
	});
});

test('compressContext - compresses context with connectionParams', () => {
	const context = {
		connectionInitReceived: true,
		acknowledged: true,
		subscriptions: {},
		extra: {},
		connectionParams: {
			authorization: 'Bearer token123',
			user: {
				id: '456',
				name: 'John Doe',
			},
		},
	};
	const compressed = compressContext(context as any);

	expect(compressed).toEqual({
		connectionInitReceived: '__boolean__true',
		acknowledged: '__boolean__true',
		'connectionParams.authorization': 'Bearer token123',
		'connectionParams.user.id': '456',
		'connectionParams.user.name': 'John Doe',
	});
});

test('compressContext - compresses context with nested extra data', () => {
	const context = {
		connectionInitReceived: true,
		acknowledged: false,
		subscriptions: {},
		extra: {
			requestContext: {
				connectionId: 'conn123',
				routeKey: '$connect',
			},
			authUser: {
				id: 'user456',
				profile: {
					email: 'user@example.com',
				},
			},
			metadata: {
				version: '1.0.0',
			},
		},
	};
	const compressed = compressContext(context as any);

	expect(compressed).toEqual({
		connectionInitReceived: '__boolean__true',
		acknowledged: '__boolean__false',
		'extra.requestContext.connectionId': 'conn123',
		'extra.requestContext.routeKey': '$connect',
		'extra.authUser.id': 'user456',
		'extra.authUser.profile.email': 'user@example.com',
		'extra.metadata.version': '1.0.0',
	});
});

test('compressContext - compresses context with arrays', () => {
	const context = {
		connectionInitReceived: true,
		acknowledged: true,
		subscriptions: {},
		extra: {
			tags: ['admin', 'user', 'guest'],
			permissions: [
				{ action: 'read', resource: 'posts' },
				{ action: 'write', resource: 'comments' },
			],
		},
	};
	const compressed = compressContext(context as any);

	expect(compressed).toEqual({
		connectionInitReceived: '__boolean__true',
		acknowledged: '__boolean__true',
		'extra.tags.0': 'admin',
		'extra.tags.1': 'user',
		'extra.tags.2': 'guest',
		'extra.permissions.0.action': 'read',
		'extra.permissions.0.resource': 'posts',
		'extra.permissions.1.action': 'write',
		'extra.permissions.1.resource': 'comments',
	});
});

test('compressContext - compresses complex nested structure', () => {
	const context = {
		connectionInitReceived: true,
		acknowledged: true,
		subscriptions: {},
		connectionParams: {
			headers: {
				authorization: 'Bearer abc123',
				'user-agent': 'GraphQL-Client/1.0',
			},
		},
		extra: {
			requestContext: {
				connectionId: 'abc123',
				stage: 'dev',
			},
			user: {
				id: 'user123',
				permissions: {
					read: 'true',
					write: 'false',
				},
			},
			session: {
				id: 'session456',
				createdAt: '2023-01-01T00:00:00Z',
			},
		},
	};
	const compressed = compressContext(context as any);

	expect(compressed).toEqual({
		connectionInitReceived: '__boolean__true',
		acknowledged: '__boolean__true',
		'connectionParams.headers.authorization': 'Bearer abc123',
		'connectionParams.headers.user-agent': 'GraphQL-Client/1.0',
		'extra.requestContext.connectionId': 'abc123',
		'extra.requestContext.stage': 'dev',
		'extra.user.id': 'user123',
		'extra.user.permissions.read': 'true',
		'extra.user.permissions.write': 'false',
		'extra.session.id': 'session456',
		'extra.session.createdAt': '2023-01-01T00:00:00Z',
	});
});

test('compressContext - handles mixed arrays and objects', () => {
	const context = {
		connectionInitReceived: true,
		acknowledged: true,
		subscriptions: {},
		extra: {
			user: {
				name: 'John',
				roles: ['admin', 'moderator'],
				profile: {
					addresses: [
						{ street: '123 Main St', city: 'New York' },
						{ street: '456 Oak Ave', city: 'Boston' },
					],
				},
			},
			settings: {
				notifications: ['email', 'sms'],
				theme: 'dark',
			},
		},
	};
	const compressed = compressContext(context as any);

	expect(compressed).toEqual({
		connectionInitReceived: '__boolean__true',
		acknowledged: '__boolean__true',
		'extra.user.name': 'John',
		'extra.user.roles.0': 'admin',
		'extra.user.roles.1': 'moderator',
		'extra.user.profile.addresses.0.street': '123 Main St',
		'extra.user.profile.addresses.0.city': 'New York',
		'extra.user.profile.addresses.1.street': '456 Oak Ave',
		'extra.user.profile.addresses.1.city': 'Boston',
		'extra.settings.notifications.0': 'email',
		'extra.settings.notifications.1': 'sms',
		'extra.settings.theme': 'dark',
	});
});

test('compressContext - excludes subscriptions field', () => {
	const context = {
		connectionInitReceived: true,
		acknowledged: true,
		subscriptions: {
			sub1: 'some-subscription-data',
			sub2: { complex: 'subscription-object' },
		},
		extra: {
			user: { id: 'user123' },
		},
	};
	const compressed = compressContext(context as any);

	// subscriptions should not appear in compressed output
	expect(compressed).toEqual({
		connectionInitReceived: '__boolean__true',
		acknowledged: '__boolean__true',
		'extra.user.id': 'user123',
	});
});

test('compressContext - handles null and undefined values', () => {
	const context = {
		connectionInitReceived: true,
		acknowledged: undefined,
		subscriptions: {},
		extra: {
			user: {
				id: 'user123',
				name: null,
				email: undefined,
			},
			settings: null,
		},
		connectionParams: {
			valid: 'value',
			nullValue: null,
			undefinedValue: undefined,
		},
	};
	const compressed = compressContext(context as any);

	// null and undefined values should be included with type prefixes
	expect(compressed).toEqual({
		connectionInitReceived: '__boolean__true',
		'extra.user.id': 'user123',
		'extra.user.name': '__null__',
		'extra.user.email': '__undefined__',
		'extra.settings': '__null__',
		'connectionParams.valid': 'value',
		'connectionParams.nullValue': '__null__',
		'connectionParams.undefinedValue': '__undefined__',
	});
});

test('compressContext - handles sparse arrays', () => {
	const context = {
		connectionInitReceived: true,
		acknowledged: true,
		subscriptions: {},
		extra: {
			items: ['first', undefined, 'third', null, , 'sixth'],
		},
	};
	const compressed = compressContext(context as any);

	// All values including null and undefined should be included with type prefixes
	expect(compressed).toEqual({
		connectionInitReceived: '__boolean__true',
		acknowledged: '__boolean__true',
		'extra.items.0': 'first',
		'extra.items.1': '__undefined__',
		'extra.items.2': 'third',
		'extra.items.3': '__null__',
		'extra.items.4': '__undefined__',
		'extra.items.5': 'sixth',
	});
});

// Round-trip tests to verify compressContext and buildContext are inverse operations
test('compressContext and buildContext - round trip with basic context', () => {
	const original = {
		connectionInitReceived: true,
		acknowledged: false,
		subscriptions: {},
		extra: {
			user: { id: 'user123', name: 'John' },
		},
	};

	const compressed = compressContext(original as any);
	const rebuilt = buildContext(compressed);

	expect(rebuilt.connectionInitReceived).toBe(original.connectionInitReceived);
	expect(rebuilt.acknowledged).toBe(original.acknowledged);
	expect(rebuilt.extra).toEqual(original.extra);
	expect(rebuilt.subscriptions).toEqual({});
});

test('compressContext and buildContext - round trip with complex nested data', () => {
	const original = {
		connectionInitReceived: true,
		acknowledged: true,
		subscriptions: {},
		connectionParams: {
			headers: {
				authorization: 'Bearer token',
				'user-agent': 'test-client',
			},
		},
		extra: {
			user: {
				id: 'user123',
				roles: ['admin', 'user'],
				profile: {
					addresses: [{ street: '123 Main St', city: 'NYC' }],
				},
			},
			metadata: {
				version: '1.0.0',
				features: ['feature1', 'feature2'],
			},
		},
	};

	const compressed = compressContext(original as any);
	const rebuilt = buildContext(compressed);

	expect(rebuilt.connectionInitReceived).toBe(original.connectionInitReceived);
	expect(rebuilt.acknowledged).toBe(original.acknowledged);
	expect(rebuilt.connectionParams).toEqual(original.connectionParams);
	expect(rebuilt.extra).toEqual(original.extra);
	expect(rebuilt.subscriptions).toEqual({});
});

test('compressContext and buildContext - round trip with arrays', () => {
	const original = {
		connectionInitReceived: true,
		acknowledged: true,
		subscriptions: {},
		extra: {
			matrix: [
				['a1', 'a2'],
				['b1', 'b2'],
			],
			groups: [
				{
					name: 'Admins',
					members: ['user1', 'user2'],
				},
				{
					name: 'Users',
					members: ['user3'],
				},
			],
		},
	};

	const compressed = compressContext(original as any);
	const rebuilt = buildContext(compressed);

	expect(rebuilt.connectionInitReceived).toBe(original.connectionInitReceived);
	expect(rebuilt.acknowledged).toBe(original.acknowledged);
	expect(rebuilt.extra).toEqual(original.extra);
});

test('compressContext and buildContext - maintains data types through round trip', () => {
	const original = {
		connectionInitReceived: true,
		acknowledged: false,
		subscriptions: {},
		extra: {
			count: 42,
			settings: {
				enabled: 'true',
				timeout: 5000,
			},
		},
		connectionParams: {
			timestamp: 1234567890,
		},
	};

	const compressed = compressContext(original as any);
	const rebuilt = buildContext(compressed);

	expect(rebuilt.connectionInitReceived).toBe(true);
	expect(rebuilt.acknowledged).toBe(false);
	expect((rebuilt.extra as any).count).toBe(42);
	expect((rebuilt.extra as any).settings.enabled).toBe('true'); // Remains as string since original was string
	expect((rebuilt.extra as any).settings.timeout).toBe(5000);
	expect((rebuilt.connectionParams as any).timestamp).toBe(1234567890);
});

// Tests for new type prefix serialization system
test('compressContext - uses type prefixes for all value types', () => {
	const context = {
		connectionInitReceived: true,
		acknowledged: false,
		subscriptions: {},
		extra: {
			count: 42,
			price: 19.99,
			enabled: true,
			disabled: false,
			name: 'John Doe',
			id: '123', // String that looks like a number
			nullValue: null,
			undefinedValue: undefined,
			booleanString: 'true', // Actual string containing 'true'
		},
	};

	const compressed = compressContext(context as any);

	// Check that all values have proper type prefixes
	expect(compressed.connectionInitReceived).toBe('__boolean__true');
	expect(compressed.acknowledged).toBe('__boolean__false');
	expect(compressed['extra.count']).toBe('__number__42');
	expect(compressed['extra.price']).toBe('__number__19.99');
	expect(compressed['extra.enabled']).toBe('__boolean__true');
	expect(compressed['extra.disabled']).toBe('__boolean__false');
	expect(compressed['extra.name']).toBe('John Doe');
	expect(compressed['extra.id']).toBe('123');
	expect(compressed['extra.nullValue']).toBe('__null__');
	expect(compressed['extra.undefinedValue']).toBe('__undefined__');
	expect(compressed['extra.booleanString']).toBe('true');
});

test('buildContext - correctly deserializes type-prefixed values', () => {
	const raw = {
		connectionInitReceived: '__boolean__true',
		acknowledged: '__boolean__false',
		'extra.count': '__number__42',
		'extra.price': '__number__19.99',
		'extra.enabled': '__boolean__true',
		'extra.disabled': '__boolean__false',
		'extra.name': 'John Doe',
		'extra.id': '123', // String that looks like number
		'extra.nullValue': '__null__',
		'extra.undefinedValue': '__undefined__',
		'extra.booleanString': 'true', // Actual string containing 'true'
	};

	const context = buildContext(raw);

	expect(context.connectionInitReceived).toBe(true);
	expect(context.acknowledged).toBe(false);
	expect((context.extra as any).count).toBe(42);
	expect((context.extra as any).price).toBe(19.99);
	expect((context.extra as any).enabled).toBe(true);
	expect((context.extra as any).disabled).toBe(false);
	expect((context.extra as any).name).toBe('John Doe');
	expect((context.extra as any).id).toBe('123'); // Remains as string
	expect((context.extra as any).nullValue).toBe(null);
	expect((context.extra as any).undefinedValue).toBe(undefined);
	expect((context.extra as any).booleanString).toBe('true'); // Remains as string
});

test('buildContext - handles edge cases in type prefixes', () => {
	const raw = {
		connectionInitReceived: '__boolean__true',
		'extra.invalidPrefix': '__unknown__value', // Unknown prefix
		'extra.malformedPrefix': '__boolean_value', // Malformed prefix
		'extra.emptyContent': '', // Empty content
		'extra.specialChars': 'Hello__World__', // Content with double underscores
	};

	const context = buildContext(raw);

	expect(context.connectionInitReceived).toBe(true);
	expect((context.extra as any).invalidPrefix).toBe('value'); // Falls back to content
	expect((context.extra as any).malformedPrefix).toBe('__boolean_value'); // Treated as plain string
	expect((context.extra as any).emptyContent).toBe(''); // Empty string
	expect((context.extra as any).specialChars).toBe('Hello__World__'); // Preserves content
});

test('type prefix system - full round trip maintains exact types', () => {
	const original = {
		connectionInitReceived: true,
		acknowledged: false,
		subscriptions: {},
		extra: {
			// Numbers
			integer: 42,
			float: 19.99,
			negative: -123,
			zero: 0,

			// Booleans
			enabled: true,
			disabled: false,

			// Strings that could be ambiguous
			stringNumber: '123',
			stringBoolean: 'true',
			stringFloat: '19.99',
			normalString: 'Hello World',
			emptyString: '',

			// Special values
			nullValue: null,
			undefinedValue: undefined,

			// Arrays with mixed types
			mixedArray: [1, 'two', true, null],

			// Nested object
			nested: {
				count: 5,
				name: 'nested',
				active: false,
			},
		},
	};

	// Full round trip: compress -> build
	const compressed = compressContext(original as any);
	const rebuilt = buildContext(compressed);

	// Verify exact type preservation
	expect(rebuilt.connectionInitReceived).toBe(true);
	expect(rebuilt.acknowledged).toBe(false);

	const extra = rebuilt.extra as any;
	expect(extra.integer).toBe(42);
	expect(extra.float).toBe(19.99);
	expect(extra.negative).toBe(-123);
	expect(extra.zero).toBe(0);
	expect(extra.enabled).toBe(true);
	expect(extra.disabled).toBe(false);
	expect(extra.stringNumber).toBe('123'); // Preserved as string
	expect(extra.stringBoolean).toBe('true'); // Preserved as string
	expect(extra.stringFloat).toBe('19.99'); // Preserved as string
	expect(extra.normalString).toBe('Hello World');
	expect(extra.emptyString).toBe('');
	expect(extra.nullValue).toBe(null);
	expect(extra.undefinedValue).toBe(undefined);
	expect(extra.mixedArray).toEqual([1, 'two', true, null]);
	expect(extra.nested).toEqual({
		count: 5,
		name: 'nested',
		active: false,
	});
});
