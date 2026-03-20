const { formatMondayResults, checkChatRateLimit, queryCache } = require('../aria-founder-terminal');

describe('formatMondayResults', () => {
  test('returns empty string for null/empty', () => {
    expect(formatMondayResults(null)).toBe('');
    expect(formatMondayResults([])).toBe('');
  });

  test('formats successful results', () => {
    const results = [{ boards: [{ id: '123' }] }];
    const formatted = formatMondayResults(results);
    expect(formatted).toContain('Query 1 Result');
    expect(formatted).toContain('123');
  });

  test('formats error results', () => {
    const results = [{ error: 'Something failed' }];
    const formatted = formatMondayResults(results);
    expect(formatted).toContain('Query 1 Error');
    expect(formatted).toContain('Something failed');
  });

  test('handles null entries', () => {
    const results = [null];
    const formatted = formatMondayResults(results);
    expect(formatted).toContain('No result');
  });

  test('formats multiple results', () => {
    const results = [
      { data: 'first' },
      { error: 'second failed' },
      { data: 'third' },
    ];
    const formatted = formatMondayResults(results);
    expect(formatted).toContain('Query 1 Result');
    expect(formatted).toContain('Query 2 Error');
    expect(formatted).toContain('Query 3 Result');
  });
});

describe('checkChatRateLimit', () => {
  test('allows first message', () => {
    expect(checkChatRateLimit('test-user-1')).toBe(true);
  });

  test('allows messages within limit', () => {
    const id = 'test-user-2';
    for (let i = 0; i < 30; i++) {
      expect(checkChatRateLimit(id)).toBe(true);
    }
  });

  test('blocks messages exceeding limit', () => {
    const id = 'test-user-3';
    for (let i = 0; i < 30; i++) {
      checkChatRateLimit(id);
    }
    expect(checkChatRateLimit(id)).toBe(false);
  });
});

describe('queryCache', () => {
  beforeEach(() => {
    queryCache.clear();
  });

  test('exists and is functional', () => {
    queryCache.set('test', [{ data: 'cached' }]);
    expect(queryCache.get('test')).toEqual([{ data: 'cached' }]);
  });
});
