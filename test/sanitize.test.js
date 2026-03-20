const { sanitizeQuery, sanitizeQueries } = require('../lib/sanitize');

const BOARD_ID = '5027042315';

describe('sanitizeQuery', () => {
  test('accepts valid query', () => {
    const result = sanitizeQuery(
      `query { boards(ids: [${BOARD_ID}]) { items_page(limit: 50) { items { id name } } } }`,
      BOARD_ID
    );
    expect(result.valid).toBe(true);
    expect(result.sanitized).toBeTruthy();
  });

  test('accepts valid mutation', () => {
    const result = sanitizeQuery(
      `mutation { create_item(board_id: ${BOARD_ID}, item_name: "Test") { id } }`,
      BOARD_ID
    );
    expect(result.valid).toBe(true);
  });

  test('rejects empty query', () => {
    expect(sanitizeQuery('', BOARD_ID).valid).toBe(false);
    expect(sanitizeQuery(null, BOARD_ID).valid).toBe(false);
    expect(sanitizeQuery(undefined, BOARD_ID).valid).toBe(false);
  });

  test('rejects non-string query', () => {
    expect(sanitizeQuery(123, BOARD_ID).valid).toBe(false);
    expect(sanitizeQuery({}, BOARD_ID).valid).toBe(false);
  });

  test('rejects query exceeding max length', () => {
    const longQuery = 'query { ' + 'a'.repeat(2000) + ' }';
    const result = sanitizeQuery(longQuery, BOARD_ID);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('maximum length');
  });

  test('rejects query not starting with query/mutation', () => {
    const result = sanitizeQuery('SELECT * FROM boards', BOARD_ID);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('must start with');
  });

  test('blocks introspection queries', () => {
    const result = sanitizeQuery('query { __schema { types { name } } }', BOARD_ID);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('blocked pattern');
  });

  test('blocks __type queries', () => {
    const result = sanitizeQuery('query { __type(name: "Board") { fields { name } } }', BOARD_ID);
    expect(result.valid).toBe(false);
  });

  test('rejects unauthorized board ID in board_id parameter', () => {
    const result = sanitizeQuery(
      'mutation { create_item(board_id: 9999999999, item_name: "Test") { id } }',
      BOARD_ID
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain('unauthorized board');
  });

  test('rejects unauthorized board ID in boards(ids:) pattern', () => {
    const result = sanitizeQuery(
      'query { boards(ids: [9999999999]) { items_page { items { id } } } }',
      BOARD_ID
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain('unauthorized board');
  });

  test('allows query without board ID when no allowedBoardId set', () => {
    const result = sanitizeQuery('query { items(ids: [123]) { id name } }');
    expect(result.valid).toBe(true);
  });

  test('trims whitespace', () => {
    const result = sanitizeQuery('  query { boards(ids: [5027042315]) { id } }  ', BOARD_ID);
    expect(result.valid).toBe(true);
    expect(result.sanitized).not.toMatch(/^\s/);
  });
});

describe('sanitizeQueries', () => {
  test('accepts array of valid queries', () => {
    const result = sanitizeQueries([
      `query { boards(ids: [${BOARD_ID}]) { id } }`,
      `mutation { create_item(board_id: ${BOARD_ID}, item_name: "X") { id } }`,
    ], BOARD_ID);
    expect(result.valid).toBe(true);
    expect(result.sanitized).toHaveLength(2);
  });

  test('rejects non-array input', () => {
    const result = sanitizeQueries('not an array', BOARD_ID);
    expect(result.valid).toBe(false);
  });

  test('returns partial results when some queries fail', () => {
    const result = sanitizeQueries([
      `query { boards(ids: [${BOARD_ID}]) { id } }`,
      'INVALID QUERY',
    ], BOARD_ID);
    expect(result.valid).toBe(false);
    expect(result.sanitized).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
  });

  test('handles empty array', () => {
    const result = sanitizeQueries([], BOARD_ID);
    expect(result.valid).toBe(true);
    expect(result.sanitized).toHaveLength(0);
  });
});
