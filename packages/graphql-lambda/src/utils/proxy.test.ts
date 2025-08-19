import { test, expect, mock } from 'bun:test';
import { deepProxy, type ProxyMut, type ProxyPath } from './proxy';

test('deepProxy - basic property setting', () => {
	const onChange = mock();
	const obj = {} as any;
	const proxy = deepProxy(obj, onChange);

	proxy.name = 'test';

	expect(onChange).toHaveBeenCalledWith('set', ['name'], 'test');
	expect(obj.name).toBe('test');
});

test('deepProxy - nested object creation and modification', () => {
	const onChange = mock();
	const obj = { nested: {} } as any;
	const proxy = deepProxy(obj, onChange);

	proxy.nested.value = 'test';

	expect(onChange).toHaveBeenCalledWith('set', ['nested', 'value'], 'test');
	expect(obj.nested.value).toBe('test');
});

test('deepProxy - deep nested object access', () => {
	const onChange = mock();
	const obj = { level1: { level2: {} } } as any;
	const proxy = deepProxy(obj, onChange);

	proxy.level1.level2.value = 'deep';

	expect(onChange).toHaveBeenCalledWith(
		'set',
		['level1', 'level2', 'value'],
		'deep',
	);
	expect(obj.level1.level2.value).toBe('deep');
});

test('deepProxy - property deletion', () => {
	const onChange = mock();
	const obj = { name: 'test' } as any;
	const proxy = deepProxy(obj, onChange);

	delete proxy.name;

	expect(onChange).toHaveBeenCalledWith('del', ['name'], null);
	expect(obj.name).toBeUndefined();
});

test('deepProxy - array operations', () => {
	const calls: any[] = [];
	const onChange = (mut: any, path: any, value: any) => {
		calls.push({ mut, path, value });
	};
	const obj = { items: [] } as any;
	const proxy = deepProxy(obj, onChange);

	proxy.items.push('item1');

	// Array push only triggers one change for setting the new item
	// The length property change doesn't trigger onChange since it's the same value (0 -> 1 vs undefined -> 1)
	expect(calls).toHaveLength(1);
	expect(calls[0]).toEqual({
		mut: 'set',
		path: ['items', '0'],
		value: 'item1',
	});
});

test('deepProxy - object assignment creates deep proxy', () => {
	const onChange = mock();
	const obj = {} as any;
	const proxy = deepProxy(obj, onChange);

	proxy.nested = { value: 'initial' };
	proxy.nested.value = 'changed';

	expect(onChange).toHaveBeenCalledTimes(2);
	expect(onChange).toHaveBeenNthCalledWith(
		2,
		'set',
		['nested', 'value'],
		'changed',
	);
	// First call will have the proxied object, so we just check the path and that it was called
	expect(onChange.mock.calls[0]?.[0]).toBe('set');
	expect(onChange.mock.calls[0]?.[1]).toEqual(['nested']);
});

test('deepProxy - no duplicate onChange calls for same value', () => {
	const onChange = mock();
	const obj = { value: 'initial' } as any;
	const proxy = deepProxy(obj, onChange);

	proxy.value = 'initial'; // Same value
	proxy.value = 'changed'; // Different value
	proxy.value = 'changed'; // Same value again

	expect(onChange).toHaveBeenCalledTimes(1);
	expect(onChange).toHaveBeenCalledWith('set', ['value'], 'changed');
});

test('deepProxy - already proxied objects are not re-proxied', () => {
	const onChange1 = mock();
	const onChange2 = mock();
	const obj = { nested: {} } as any;

	const proxy1 = deepProxy(obj, onChange1);
	const proxy2 = deepProxy(proxy1, onChange2);

	expect(proxy1).toBe(proxy2);
});

test('deepProxy - primitive values are handled correctly', () => {
	const onChange = mock();
	const obj = {} as any;
	const proxy = deepProxy(obj, onChange);

	proxy.string = 'test';
	proxy.number = 42;
	proxy.boolean = true;
	proxy.nullValue = null;
	proxy.undefinedValue = undefined;

	// undefined values don't trigger onChange since they're the same as not having the property
	expect(onChange).toHaveBeenCalledTimes(4);
	expect(obj.string).toBe('test');
	expect(obj.number).toBe(42);
	expect(obj.boolean).toBe(true);
	expect(obj.nullValue).toBe(null);
	expect(obj.undefinedValue).toBe(undefined);
});

test('deepProxy - symbol properties', () => {
	const onChange = mock();
	const obj = {} as any;
	const proxy = deepProxy(obj, onChange);
	const sym = Symbol('test');

	proxy[sym] = 'symbol value';

	expect(onChange).toHaveBeenCalledWith('set', [sym], 'symbol value');
	expect(obj[sym]).toBe('symbol value');
});

test('deepProxy - complex nested structure', () => {
	const changes: Array<{ mut: ProxyMut; path: ProxyPath; value: any }> = [];
	const onChange = (mut: ProxyMut, path: ProxyPath, value: any) => {
		changes.push({ mut, path, value });
	};

	const obj = {
		subscriptions: {},
		extra: {
			connectionId: '123',
		},
	} as any;

	const proxy = deepProxy(obj, onChange);

	// Add nested object
	proxy.extra['123'] = { data: 'initial' };

	// Modify nested property
	proxy.extra['123'].data = 'changed';

	// Add top-level property
	proxy.newField = 'value';

	expect(changes).toHaveLength(3);
	// First change creates a proxied object, so we check the structure
	expect(changes[0]?.mut).toBe('set');
	expect(changes[0]?.path).toEqual(['extra', '123']);
	expect(changes[1]).toEqual({
		mut: 'set',
		path: ['extra', '123', 'data'],
		value: 'changed',
	});
	expect(changes[2]).toEqual({
		mut: 'set',
		path: ['newField'],
		value: 'value',
	});
});

test('deepProxy - lazy proxying on get', () => {
	const onChange = mock();
	const obj = {
		existing: {
			nested: 'value',
		},
	} as any;

	const proxy = deepProxy(obj, onChange);

	// Access existing nested object should create proxy
	proxy.existing.newProp = 'test';

	expect(onChange).toHaveBeenCalledWith('set', ['existing', 'newProp'], 'test');
});

test('deepProxy - handles circular references gracefully', () => {
	const onChange = mock();
	const obj = {} as any;
	const proxy = deepProxy(obj, onChange);

	proxy.self = proxy;

	expect(onChange).toHaveBeenCalledWith('set', ['self'], proxy);
	expect(obj.self).toBe(proxy);
});

test('deepProxy - no onChange callback provided', () => {
	const obj = {} as any;
	const proxy = deepProxy(obj); // No onChange callback

	// Should not throw
	proxy.value = 'test';
	proxy.nested = {};
	proxy.nested.value = 'nested';

	expect(obj.value).toBe('test');
	expect(obj.nested.value).toBe('nested');
});
