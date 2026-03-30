/**
 * ARIA Few-Shot Examples — Keyword-based example selector
 * 15 canonical input/output pairs with keyword tags.
 * selectExamples() picks the 3 most relevant based on user input keywords.
 */

const EXAMPLES = [
  {
    keywords: ['show', 'all', 'artists', 'roster', 'talent', 'list'],
    input: 'show all artists',
    output: JSON.stringify({
      message: '', needs_data: true, action_type: 'read', follow_up: '',
      queries: ['query { boards(ids: [{{ARTISTS_BOARD_ID}}]) { items_page(limit: 100) { items { id name column_values { id text value type } } } } }'],
    }),
  },
  {
    keywords: ['dj', 'experience', 'years', 'under', 'aed', 'price', 'filter'],
    input: 'show me DJs with more than 5 years experience under AED 4000',
    output: JSON.stringify({
      message: '', needs_data: true, action_type: 'read', follow_up: '',
      queries: ['query { boards(ids: [{{ARTISTS_BOARD_ID}}]) { items_page(limit: 100) { items { id name column_values { id text value type } } } } }'],
    }),
  },
  {
    keywords: ['available', 'dj', 'free', 'open'],
    input: 'available DJs',
    output: JSON.stringify({
      message: '', needs_data: true, action_type: 'read', follow_up: '',
      queries: ['query { boards(ids: [{{ARTISTS_BOARD_ID}}]) { items_page(limit: 100) { items { id name column_values { id text value type } } } } }'],
    }),
  },
  {
    keywords: ['how', 'many', 'leads', 'count', 'total'],
    input: 'how many leads do we have',
    output: JSON.stringify({
      message: '', needs_data: true, action_type: 'read', follow_up: '',
      queries: ['query { boards(ids: [{{SALES_BOARD_ID}}]) { items_page(limit: 100) { items { id name column_values { id text value type } } } } }'],
    }),
  },
  {
    keywords: ['mark', 'contracted', 'update', 'status', 'move'],
    input: 'mark Ravi Khanna as contracted',
    output: JSON.stringify({
      message: 'Updating', needs_data: true, action_type: 'write', follow_up: '',
      queries: [
        'query { boards(ids: [{{SALES_BOARD_ID}}]) { items_page(limit: 5, query_params: {rules: [{column_id: \\"name\\", compare_value: [\\"ravi khanna\\"], operator: contains_text}]}) { items { id name column_values { id text value type } } } } }',
        'mutation { change_multiple_column_values(board_id: {{SALES_BOARD_ID}}, item_id: ITEM_ID_PLACEHOLDER, column_values: \\"{\\\\\\"status\\\\\\":{\\\\\\"\label\\\\\\":\\\\\\"Contracted\\\\\\"}}\\") { id name } }',
      ],
    }),
  },
  {
    keywords: ['find', 'search', 'lookup', 'priya', 'detail'],
    input: 'find Priya',
    output: JSON.stringify({
      message: '', needs_data: true, action_type: 'read', follow_up: '',
      queries: ['query { boards(ids: [{{ARTISTS_BOARD_ID}}]) { items_page(limit: 5, query_params: {rules: [{column_id: \\"name\\", compare_value: [\\"priya\\"], operator: contains_text}]}) { items { id name column_values { id text value type } } } } }'],
    }),
  },
  {
    keywords: ['find', 'ravi', 'cross', 'board', 'search', 'both'],
    input: 'find Ravi',
    output: JSON.stringify({
      message: '', needs_data: true, action_type: 'read', follow_up: '',
      queries: [
        'query { boards(ids: [{{SALES_BOARD_ID}}]) { items_page(limit: 5, query_params: {rules: [{column_id: \\"name\\", compare_value: [\\"ravi\\"], operator: contains_text}]}) { items { id name column_values { id text value type } } } } }',
        'query { boards(ids: [{{ARTISTS_BOARD_ID}}]) { items_page(limit: 5, query_params: {rules: [{column_id: \\"name\\", compare_value: [\\"ravi\\"], operator: contains_text}]}) { items { id name column_values { id text value type } } } } }',
      ],
    }),
  },
  {
    keywords: ['hey', 'hello', 'hi', 'greet', 'sup'],
    input: 'hey',
    output: JSON.stringify({
      message: 'What do you need?', needs_data: false, action_type: 'chat', follow_up: '', queries: [],
    }),
  },
  {
    keywords: ['qualified', 'leads', 'status', 'pipeline'],
    input: 'qualified leads',
    output: JSON.stringify({
      message: '', needs_data: true, action_type: 'read', follow_up: '',
      queries: ['query { boards(ids: [{{SALES_BOARD_ID}}]) { items_page(limit: 100) { items { id name column_values { id text value type } } } } }'],
    }),
  },
  {
    keywords: ['add', 'lead', 'create', 'new', 'phone', 'source'],
    input: 'add lead Omar Saeed +971509876543 whatsapp Sourabh',
    output: JSON.stringify({
      message: 'Creating', needs_data: true, action_type: 'write', follow_up: '',
      queries: ['mutation { create_item(board_id: {{SALES_BOARD_ID}}, group_id: \\"topics\\", item_name: \\"Omar Saeed\\", column_values: \\"{}\\") { id name } }'],
    }),
  },
  {
    keywords: ['top', 'rated', 'best', 'premium', 'star', 'rating'],
    input: 'top rated artists',
    output: JSON.stringify({
      message: '', needs_data: true, action_type: 'read', follow_up: '',
      queries: ['query { boards(ids: [{{ARTISTS_BOARD_ID}}]) { items_page(limit: 100) { items { id name column_values { id text value type } } } } }'],
    }),
  },
  {
    keywords: ['assign', 'transfer', 'give', 'ae'],
    input: 'assign Kabir to Yash',
    output: JSON.stringify({
      message: 'Updating', needs_data: true, action_type: 'write', follow_up: '',
      queries: [
        'query { boards(ids: [{{SALES_BOARD_ID}}]) { items_page(limit: 5, query_params: {rules: [{column_id: \\"name\\", compare_value: [\\"kabir\\"], operator: contains_text}]}) { items { id name column_values { id text value type } } } } }',
        'mutation { change_multiple_column_values(board_id: {{SALES_BOARD_ID}}, item_id: ITEM_ID_PLACEHOLDER, column_values: \\"{}\\") { id name } }',
      ],
    }),
  },
  {
    keywords: ['tasks', 'working', 'yash', 'sourabh', 'ansh', 'staff', 'team'],
    input: "Yash's tasks",
    output: JSON.stringify({
      message: '', needs_data: true, action_type: 'read', follow_up: '',
      queries: ['query { boards(ids: [{{STAFF_BOARD_ID}}]) { items_page(limit: 50) { items { id name column_values { id text value type } } } } }'],
    }),
  },
  {
    keywords: ['full', 'report', 'summary', 'overview', 'everything', 'all', 'boards'],
    input: 'full report',
    output: JSON.stringify({
      message: '', needs_data: true, action_type: 'read', follow_up: '',
      queries: [
        'query { boards(ids: [{{SALES_BOARD_ID}}]) { items_page(limit: 100) { items { id name column_values { id text value type } } } } }',
        'query { boards(ids: [{{ARTISTS_BOARD_ID}}]) { items_page(limit: 100) { items { id name column_values { id text value type } } } } }',
        'query { boards(ids: [{{STAFF_BOARD_ID}}]) { items_page(limit: 50) { items { id name column_values { id text value type } } } } }',
      ],
    }),
  },
  {
    keywords: ['under', 'below', 'less', 'budget', 'cheaper', 'now', 'those', 'ones', '3000', '3k'],
    input: 'now show me the ones under 3000',
    output: JSON.stringify({
      message: '', needs_data: true, action_type: 'read', follow_up: '',
      queries: ['query { boards(ids: [{{ARTISTS_BOARD_ID}}]) { items_page(limit: 100) { items { id name column_values { id text value type } } } } }'],
    }),
  },
];

/**
 * Select the k most relevant examples based on keyword overlap with user input.
 * @param {string} userInput - The user's message
 * @param {object} boardIds - { sales, artists, staff } board ID strings
 * @param {number} k - Number of examples to return (default 3)
 * @returns {Array<{input: string, output: string}>}
 */
function selectExamples(userInput, boardIds, k = 3) {
  const inputWords = userInput.toLowerCase().split(/\s+/);

  const scored = EXAMPLES.map(example => {
    let score = 0;
    for (const keyword of example.keywords) {
      for (const word of inputWords) {
        if (word.includes(keyword) || keyword.includes(word)) {
          score++;
        }
      }
    }
    return { example, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const selected = scored.slice(0, k).filter(s => s.score > 0);

  // If no matches, use default examples (read, write, chat)
  if (selected.length === 0) {
    return [scored[0], scored[4], scored[7]]
      .map(s => substituteBoardIds(s.example, boardIds));
  }

  // Pad to k if fewer matches
  while (selected.length < k) {
    const next = scored.find(s => !selected.includes(s));
    if (next) selected.push(next);
    else break;
  }

  return selected.map(s => substituteBoardIds(s.example, boardIds));
}

function substituteBoardIds(example, boardIds) {
  let output = example.output;
  if (boardIds) {
    output = output.replace(/\{\{SALES_BOARD_ID\}\}/g, boardIds.sales || '5027332893');
    output = output.replace(/\{\{ARTISTS_BOARD_ID\}\}/g, boardIds.artists || '5027403725');
    output = output.replace(/\{\{STAFF_BOARD_ID\}\}/g, boardIds.staff || '5027403709');
  }
  return { input: example.input, output };
}

module.exports = { selectExamples, EXAMPLES };
