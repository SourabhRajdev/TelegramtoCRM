const Cache = require('../lib/cache');

describe('Cache', () => {
  let cache;

  beforeEach(() => {
    cache = new Cache(1000); // 1 second TTL for tests
  });

  test('set and get a value', () => {
    cache.set('key1', { data: 'test' });
    expect(cache.get('key1')).toEqual({ data: 'test' });
  });

  test('returns null for missing key', () => {
    expect(cache.get('nonexistent')).toBeNull();
  });

  test('expires after TTL', async () => {
    cache = new Cache(50); // 50ms TTL
    cache.set('key1', 'value');
    expect(cache.get('key1')).toBe('value');

    await new Promise(resolve => setTimeout(resolve, 60));
    expect(cache.get('key1')).toBeNull();
  });

  test('clear removes all entries', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.size()).toBe(2);

    cache.clear();
    expect(cache.size()).toBe(0);
    expect(cache.get('a')).toBeNull();
  });

  test('size returns correct count', () => {
    expect(cache.size()).toBe(0);
    cache.set('a', 1);
    expect(cache.size()).toBe(1);
    cache.set('b', 2);
    expect(cache.size()).toBe(2);
  });

  test('overwrites existing key', () => {
    cache.set('key', 'old');
    cache.set('key', 'new');
    expect(cache.get('key')).toBe('new');
    expect(cache.size()).toBe(1);
  });
});
