import { test, expect } from 'bun:test';
import { buildContext } from './context';

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
		connectionInitReceived: 'true',
		acknowledged: '1',
	};
	const context = buildContext(raw);

	expect(context.connectionInitReceived).toBe(true);
	expect(context.acknowledged).toBe(true);
	expect(context.subscriptions).toEqual({});
	expect(context.extra).toEqual({});
});

test('buildContext - builds context with nested connectionParams', () => {
	const raw = {
		connectionInitReceived: 'true',
		acknowledged: 'true',
		'connectionParams.authorization': 'Bearer token123',
		'connectionParams.user.id': '456',
		'connectionParams.user.name': 'John Doe',
	};
	const context = buildContext(raw);

	expect(context.connectionInitReceived).toBe(true);
	expect(context.acknowledged).toBe(true);
	expect(context.connectionParams).toEqual({
		authorization: 'Bearer token123',
		user: {
			id: '456',
			name: 'John Doe',
		},
	});
});

test('buildContext - builds context with nested extra data', () => {
	const raw = {
		connectionInitReceived: 'false',
		acknowledged: 'false',
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
		connectionInitReceived: true, // boolean
		acknowledged: 'false', // string
		'extra.count': 42, // number
		'extra.settings.enabled': 'true', // string boolean
		'connectionParams.timestamp': 1234567890,
	};
	const context = buildContext(raw);

	expect(context.connectionInitReceived).toBe(true);
	expect(context.acknowledged).toBe(false);
	expect(context.extra).toEqual({
		count: 42,
		settings: {
			enabled: 'true',
		},
	});
	expect(context.connectionParams).toEqual({
		timestamp: 1234567890,
	});
});

test('buildContext - handles complex nested structure', () => {
	const raw = {
		connectionInitReceived: 'true',
		acknowledged: 'true',
		'connectionParams.headers.authorization': 'Bearer abc123',
		'connectionParams.headers.user-agent': 'GraphQL-Client/1.0',
		'extra.requestContext.connectionId': 'abc123',
		'extra.requestContext.stage': 'dev',
		'extra.user.id': 'user123',
		'extra.user.permissions.read': 'true',
		'extra.user.permissions.write': 'false',
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
					read: 'true',
					write: 'false',
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
		connectionInitReceived: 'true',
		acknowledged: 'true',
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
		connectionInitReceived: 'true',
		acknowledged: 'true',
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
		connectionInitReceived: 'true',
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
		connectionInitReceived: 'true',
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
		connectionInitReceived: 'true',
		acknowledged: 'true',
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
		connectionInitReceived: 'true',
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
		connectionInitReceived: 'true',
		'extra.items.0': 'zero',
		'extra.items.1': 'one',
		'extra.items.10': 'ten', // Two digits
		'extra.config.timeout': '5000', // Not an array index
		'extra.config.retries': '3',
	};
	const context = buildContext(raw);

	expect((context.extra as any).items).toHaveLength(11);
	expect((context.extra as any).items[0]).toBe('zero');
	expect((context.extra as any).items[1]).toBe('one');
	expect((context.extra as any).items[10]).toBe('ten');
	expect((context.extra as any).config).toEqual({
		timeout: '5000',
		retries: '3',
	});
});
