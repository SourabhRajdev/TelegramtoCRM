/**
 * ARIA Few-Shot Examples — Intent-based Agent Decision Examples
 *
 * Each example demonstrates the FULL decision protocol:
 *   reasoning → intent → entities → action → queries → message
 *
 * Selection is intent-based, not keyword-based.
 * Examples show the model HOW to reason, not just WHAT to output.
 */

const EXAMPLES = [
  // ── LIST ALL (no filters) ──────────────────────────────────
  {
    intent_category: 'list_all',
    keywords: ['show', 'all', 'list', 'everyone', 'everything', 'roster', 'team'],
    input: 'show all artists',
    output: JSON.stringify({
      reasoning: 'User wants the complete artist roster with no filters applied. Target board is Artists (keyword: "artists"). No person name, no status filter, no art form filter. This is a straightforward list_all on the artists board.',
      intent: 'list_all',
      entities: { person_name: '', board: 'artists', filters: [] },
      action_type: 'read',
      needs_data: true,
      queries: ['query { boards(ids: [{{ARTISTS_BOARD_ID}}]) { items_page(limit: 100) { items { id name column_values { id text value type } } } } }'],
      message: '',
      follow_up: '',
    }),
  },

  // ── LIST FILTERED (single filter) ─────────────────────────
  {
    intent_category: 'list_filtered',
    keywords: ['available', 'free', 'open', 'booked', 'qualified', 'new', 'contracted', 'status'],
    input: 'available DJs',
    output: JSON.stringify({
      reasoning: 'User wants artists filtered by two criteria: availability status "Available" AND art form "Music - DJ". Board is Artists (keywords: "DJs", "available"). Two filters extracted. Fetching all artists — system will apply filters locally.',
      intent: 'list_filtered',
      entities: {
        person_name: '',
        board: 'artists',
        filters: [
          { field: 'availability', operator: 'equals', value: 'Available' },
          { field: 'art_form', operator: 'equals', value: 'Music - DJ' },
        ],
      },
      action_type: 'read',
      needs_data: true,
      queries: ['query { boards(ids: [{{ARTISTS_BOARD_ID}}]) { items_page(limit: 100) { items { id name column_values { id text value type } } } } }'],
      message: '',
      follow_up: '',
    }),
  },

  // ── LIST FILTERED (multiple filters + numeric) ─────────────
  {
    intent_category: 'list_filtered',
    keywords: ['experience', 'years', 'under', 'price', 'aed', 'budget', 'charge', 'filter', 'above', 'below'],
    input: 'show me DJs with more than 5 years experience under AED 4000',
    output: JSON.stringify({
      reasoning: 'User wants artists filtered by three criteria: art form "Music - DJ", experience >= 5 years, and pricing < 4000 AED. Board is Artists. Three filters extracted: art_form equals "Music - DJ", experience greater_equal 5, pricing less_than 4000. Fetching all and system filters locally since these are column-value filters.',
      intent: 'list_filtered',
      entities: {
        person_name: '',
        board: 'artists',
        filters: [
          { field: 'art_form', operator: 'equals', value: 'Music - DJ' },
          { field: 'experience', operator: 'greater_equal', value: '5' },
          { field: 'pricing', operator: 'less_than', value: '4000' },
        ],
      },
      action_type: 'read',
      needs_data: true,
      queries: ['query { boards(ids: [{{ARTISTS_BOARD_ID}}]) { items_page(limit: 100) { items { id name column_values { id text value type } } } } }'],
      message: '',
      follow_up: 'Want me to also check their booking availability?',
    }),
  },

  // ── COUNT ──────────────────────────────────────────────────
  {
    intent_category: 'count',
    keywords: ['how', 'many', 'count', 'total', 'number'],
    input: 'how many leads do we have',
    output: JSON.stringify({
      reasoning: 'User wants a count of leads. Board is Sales (keyword: "leads"). No filters — total count. Intent is count, not list_all, because user said "how many". Fetching all items, system counts.',
      intent: 'count',
      entities: { person_name: '', board: 'sales', filters: [] },
      action_type: 'read',
      needs_data: true,
      queries: ['query { boards(ids: [{{SALES_BOARD_ID}}]) { items_page(limit: 100) { items { id name column_values { id text value type } } } } }'],
      message: '',
      follow_up: '',
    }),
  },

  // ── SEARCH BY NAME ─────────────────────────────────────────
  {
    intent_category: 'search_by_name',
    keywords: ['find', 'search', 'lookup', 'where', 'who', 'detail', 'about'],
    input: 'find Priya',
    output: JSON.stringify({
      reasoning: 'User wants to find a specific person named "Priya". No board context given — defaulting to Artists first since "Priya" is likely a performer name. Using name search with contains_text. If no results, user can ask to check other boards.',
      intent: 'search_by_name',
      entities: { person_name: 'Priya', board: 'artists', filters: [] },
      action_type: 'read',
      needs_data: true,
      queries: ['query { boards(ids: [{{ARTISTS_BOARD_ID}}]) { items_page(limit: 5, query_params: {rules: [{column_id: \\"name\\", compare_value: [\\"priya\\"], operator: contains_text}]}) { items { id name column_values { id text value type } } } } }'],
      message: '',
      follow_up: '',
    }),
  },

  // ── CROSS-BOARD SEARCH ─────────────────────────────────────
  {
    intent_category: 'cross_board_search',
    keywords: ['find', 'search', 'both', 'all', 'boards', 'cross'],
    input: 'find Ravi across all boards',
    output: JSON.stringify({
      reasoning: 'User wants to find "Ravi" across all boards. Explicit cross-board request. Will search Sales and Artists by name (contains_text). Staff board uses item codes so must fetch all and system filters by person name in column values.',
      intent: 'cross_board_search',
      entities: { person_name: 'Ravi', board: 'all', filters: [] },
      action_type: 'read',
      needs_data: true,
      queries: [
        'query { boards(ids: [{{SALES_BOARD_ID}}]) { items_page(limit: 5, query_params: {rules: [{column_id: \\"name\\", compare_value: [\\"ravi\\"], operator: contains_text}]}) { items { id name column_values { id text value type } } } } }',
        'query { boards(ids: [{{ARTISTS_BOARD_ID}}]) { items_page(limit: 5, query_params: {rules: [{column_id: \\"name\\", compare_value: [\\"ravi\\"], operator: contains_text}]}) { items { id name column_values { id text value type } } } } }',
        'query { boards(ids: [{{STAFF_BOARD_ID}}]) { items_page(limit: 50) { items { id name column_values { id text value type } } } } }',
      ],
      message: '',
      follow_up: '',
    }),
  },

  // ── UPDATE ITEM ────────────────────────────────────────────
  {
    intent_category: 'update_item',
    keywords: ['mark', 'update', 'change', 'set', 'move', 'assign', 'book', 'contracted', 'qualify'],
    input: 'mark Ravi Khanna as contracted',
    output: JSON.stringify({
      reasoning: 'User wants to update Ravi Khanna\'s pipeline status to "Contracted" on the Sales board. This is a write operation: first search by name to get item ID, then mutate the status column. Using ITEM_ID_PLACEHOLDER pattern for two-step execution. Using semantic field name "status" which will be translated to real column ID.',
      intent: 'update_item',
      entities: {
        person_name: 'Ravi Khanna',
        board: 'sales',
        filters: [],
        values_to_set: { status: 'Contracted' },
      },
      action_type: 'write',
      needs_data: true,
      queries: [
        'query { boards(ids: [{{SALES_BOARD_ID}}]) { items_page(limit: 5, query_params: {rules: [{column_id: \\"name\\", compare_value: [\\"ravi khanna\\"], operator: contains_text}]}) { items { id name column_values { id text value type } } } } }',
        'mutation { change_multiple_column_values(board_id: {{SALES_BOARD_ID}}, item_id: ITEM_ID_PLACEHOLDER, column_values: \\"{\\\\\\"status\\\\\\":{\\\\\\"label\\\\\\":\\\\\\"Contracted\\\\\\"}}\\") { id name } }',
      ],
      message: 'Updating Ravi Khanna — status to Contracted',
      follow_up: '',
    }),
  },

  // ── CREATE ITEM ────────────────────────────────────────────
  {
    intent_category: 'create_item',
    keywords: ['add', 'create', 'new', 'register', 'onboard'],
    input: 'add lead Omar Saeed +971509876543 whatsapp source Sourabh',
    output: JSON.stringify({
      reasoning: 'User wants to create a new lead on the Sales board. Person: Omar Saeed. Phone: +971509876543. Source channel: WhatsApp. Assigned AE: Sourabh. Generating create_item mutation with semantic column values (phone, source, assigned_ae) which will be translated to real Monday.com column IDs.',
      intent: 'create_item',
      entities: {
        person_name: 'Omar Saeed',
        board: 'sales',
        filters: [],
        values_to_set: { phone: '+971509876543', source: 'WhatsApp', assigned_ae: 'Sourabh' },
      },
      action_type: 'write',
      needs_data: true,
      queries: ['mutation { create_item(board_id: {{SALES_BOARD_ID}}, group_id: \\"topics\\", item_name: \\"Omar Saeed\\", column_values: \\"{\\\\\\"phone\\\\\\":{\\\\\\"phone\\\\\\":\\\\\\"+971509876543\\\\\\",\\\\\\"countryShortName\\\\\\":\\\\\\"AE\\\\\\"},\\\\\\"source\\\\\\":{\\\\\\"label\\\\\\":\\\\\\"WhatsApp\\\\\\"},\\\\\\"assigned_ae\\\\\\":\\\\\\"Sourabh\\\\\\"}\\") { id name } }'],
      message: 'Creating lead Omar Saeed — phone +971509876543, source WhatsApp, AE Sourabh',
      follow_up: '',
    }),
  },

  // ── STAFF QUERY (tasks) ────────────────────────────────────
  {
    intent_category: 'list_filtered',
    keywords: ['tasks', 'working', 'assigned', 'staff', 'team', 'department'],
    input: "what is Yash working on",
    output: JSON.stringify({
      reasoning: 'User wants to see tasks assigned to Yash. Board is Staff (keyword: "working on" implies staff tasks). Person name: "Yash". Staff board uses item codes (STF-XXX), so I must fetch all items and the system filters by person name in column values. No filter field needed - person_name is handled separately.',
      intent: 'list_filtered',
      entities: {
        person_name: 'Yash',
        board: 'staff',
        filters: [],
      },
      action_type: 'read',
      needs_data: true,
      queries: ['query { boards(ids: [{{STAFF_BOARD_ID}}]) { items_page(limit: 50) { items { id name column_values { id text value type } } } } }'],
      message: '',
      follow_up: '',
    }),
  },

  // ── GREETING ───────────────────────────────────────────────
  {
    intent_category: 'greeting',
    keywords: ['hey', 'hello', 'hi', 'greet', 'sup', 'good morning'],
    input: 'hey',
    output: JSON.stringify({
      reasoning: 'Simple greeting. No operational intent. Responding with ARIA voice — direct, no filler.',
      intent: 'greeting',
      entities: { person_name: '', board: 'unknown', filters: [] },
      action_type: 'chat',
      needs_data: false,
      queries: [],
      message: 'What do you need?',
      follow_up: '',
    }),
  },

  // ── FOLLOW-UP (context-aware) ──────────────────────────────
  {
    intent_category: 'follow_up',
    keywords: ['those', 'them', 'ones', 'now', 'but', 'without', 'also', 'his', 'her', 'under', 'filter'],
    input: 'now show me the ones under 3000',
    output: JSON.stringify({
      reasoning: 'Follow-up to a previous query. User said "the ones" — referring to the last result set. Adding a pricing filter: under 3000 AED. The previous query was about artists (from conversation context). Re-fetching artists board with the pricing filter added to the existing filter set.',
      intent: 'follow_up',
      entities: {
        person_name: '',
        board: 'artists',
        filters: [{ field: 'pricing', operator: 'less_than', value: '3000' }],
      },
      action_type: 'read',
      needs_data: true,
      queries: ['query { boards(ids: [{{ARTISTS_BOARD_ID}}]) { items_page(limit: 100) { items { id name column_values { id text value type } } } } }'],
      message: '',
      follow_up: '',
    }),
  },

  // ── CLARIFY (ambiguous) ────────────────────────────────────
  {
    intent_category: 'clarify',
    keywords: ['ambiguous', 'unclear', 'which'],
    input: 'update Ravi',
    output: JSON.stringify({
      reasoning: 'User wants to update "Ravi" but did not specify which field to change or which Ravi (could be Ravi Khanna on Sales or Ravi Sharma on Artists). Need to ask: which Ravi and what field to update.',
      intent: 'clarify',
      entities: { person_name: 'Ravi', board: 'unknown', filters: [] },
      action_type: 'question',
      needs_data: false,
      queries: [],
      message: 'Which Ravi — Ravi Khanna (Sales) or Ravi Sharma (Artists)? And what do you want to update?',
      follow_up: '',
    }),
  },

  // ── FULL REPORT ────────────────────────────────────────────
  {
    intent_category: 'list_all',
    keywords: ['full', 'report', 'summary', 'overview', 'everything', 'all', 'boards'],
    input: 'full report',
    output: JSON.stringify({
      reasoning: 'User wants a complete overview across all three boards. "Full report" maps to board: all. Fetching all items from Sales, Artists, and Staff. System formats the combined results.',
      intent: 'list_all',
      entities: { person_name: '', board: 'all', filters: [] },
      action_type: 'read',
      needs_data: true,
      queries: [
        'query { boards(ids: [{{SALES_BOARD_ID}}]) { items_page(limit: 100) { items { id name column_values { id text value type } } } } }',
        'query { boards(ids: [{{ARTISTS_BOARD_ID}}]) { items_page(limit: 100) { items { id name column_values { id text value type } } } } }',
        'query { boards(ids: [{{STAFF_BOARD_ID}}]) { items_page(limit: 50) { items { id name column_values { id text value type } } } } }',
      ],
      message: '',
      follow_up: '',
    }),
  },

  // ── ASSIGN (write with person context) ─────────────────────
  {
    intent_category: 'update_item',
    keywords: ['assign', 'transfer', 'give', 'ae', 'responsible'],
    input: 'assign Kabir to Yash',
    output: JSON.stringify({
      reasoning: 'User wants to assign the lead "Kabir" to AE "Yash". Board is Sales (assign implies lead assignment). First search for Kabir by name, then update the Assigned AE column to Yash. Using ITEM_ID_PLACEHOLDER for two-step execution.',
      intent: 'update_item',
      entities: {
        person_name: 'Kabir',
        board: 'sales',
        filters: [],
        values_to_set: { assigned_ae: 'Yash' },
      },
      action_type: 'write',
      needs_data: true,
      queries: [
        'query { boards(ids: [{{SALES_BOARD_ID}}]) { items_page(limit: 5, query_params: {rules: [{column_id: \\"name\\", compare_value: [\\"kabir\\"], operator: contains_text}]}) { items { id name column_values { id text value type } } } } }',
        'mutation { change_multiple_column_values(board_id: {{SALES_BOARD_ID}}, item_id: ITEM_ID_PLACEHOLDER, column_values: \\"{\\\\\\"assigned_ae\\\\\\":\\\\\\"Yash\\\\\\"}\\") { id name } }',
      ],
      message: 'Assigning Kabir to AE Yash',
      follow_up: '',
    }),
  },

  // ── QUALIFIED LEADS (status filter) ────────────────────────
  {
    intent_category: 'list_filtered',
    keywords: ['qualified', 'pipeline', 'stage', 'status', 'new inquiry', 'contacted'],
    input: 'qualified leads',
    output: JSON.stringify({
      reasoning: 'User wants leads filtered by status "Qualified". Board is Sales (keyword: "leads"). One filter: pipeline status equals "Qualified". Fetching all sales items, system filters by status column locally.',
      intent: 'list_filtered',
      entities: {
        person_name: '',
        board: 'sales',
        filters: [{ field: 'status', operator: 'equals', value: 'Qualified' }],
      },
      action_type: 'read',
      needs_data: true,
      queries: ['query { boards(ids: [{{SALES_BOARD_ID}}]) { items_page(limit: 100) { items { id name column_values { id text value type } } } } }'],
      message: '',
      follow_up: '',
    }),
  },
];

// ── Intent-Based Example Selector ────────────────────────────

/**
 * Select the k most relevant examples using a two-pass strategy:
 *   Pass 1: Match by detected intent category (strongest signal)
 *   Pass 2: Score by keyword overlap (tiebreaker)
 *
 * Always returns k examples, padding with diverse defaults.
 */
function selectExamples(userInput, boardIds, k = 3) {
  const inputLower = userInput.toLowerCase();
  const inputWords = inputLower.split(/\s+/);

  // ── Pass 1: Detect likely intent from input ──
  const intentSignals = detectIntentSignals(inputLower);

  // ── Pass 2: Score each example ──
  const scored = EXAMPLES.map(example => {
    let score = 0;

    // Intent category match (strong signal — worth 10 points)
    if (intentSignals.includes(example.intent_category)) {
      score += 10;
    }

    // Keyword overlap (tiebreaker — 1 point each)
    for (const keyword of example.keywords) {
      for (const word of inputWords) {
        if (word.includes(keyword) || keyword.includes(word)) {
          score += 1;
        }
      }
    }

    return { example, score };
  });

  scored.sort((a, b) => b.score - a.score);

  // Take top scoring, deduplicate by intent_category to get diverse examples
  const selected = [];
  const seenCategories = new Set();

  for (const s of scored) {
    if (selected.length >= k) break;
    // Allow max 2 from same category
    const catCount = selected.filter(sel => sel.example.intent_category === s.example.intent_category).length;
    if (catCount < 2) {
      selected.push(s);
      seenCategories.add(s.example.intent_category);
    }
  }

  // Pad to k with diverse defaults if needed
  const defaultCategories = ['list_filtered', 'search_by_name', 'greeting'];
  while (selected.length < k) {
    const needed = defaultCategories.find(cat => !seenCategories.has(cat));
    const fallback = scored.find(s => s.example.intent_category === (needed || 'list_all') && !selected.includes(s));
    if (fallback) {
      selected.push(fallback);
      seenCategories.add(fallback.example.intent_category);
    } else {
      break;
    }
  }

  return selected.map(s => substituteBoardIds(s.example, boardIds));
}

/**
 * Detect likely intent categories from input text.
 * Returns array of matching categories (strongest signals first).
 */
function detectIntentSignals(input) {
  const signals = [];

  // Follow-up signals
  if (/\b(those|them|the ones|now show|now filter|his |her |their |the first|next\b|but |without )/i.test(input)) {
    signals.push('follow_up');
  }

  // Write signals
  if (/\b(mark|update|change|set|move|assign|book |qualify|contract|delete|remove|archive)\b/i.test(input)) {
    signals.push('update_item');
  }
  if (/\b(add|create|new |register|onboard)\b/i.test(input)) {
    signals.push('create_item');
  }

  // Count signals
  if (/\b(how many|count|total|number of)\b/i.test(input)) {
    signals.push('count');
  }

  // Filtered list signals
  if (/\b(available|qualified|contracted|booked|inactive|top rated|verified|under \d|above \d|over \d|less than|more than|experience|pricing|price)\b/i.test(input)) {
    signals.push('list_filtered');
  }

  // Search signals
  if (/\b(find|search|lookup|where is|who is)\b/i.test(input)) {
    signals.push('search_by_name');
  }
  if (/\b(across|all boards|cross.?board|both)\b/i.test(input)) {
    signals.push('cross_board_search');
  }

  // List all signals
  if (/\b(show all|list all|everyone|full report|overview|roster|everything)\b/i.test(input)) {
    signals.push('list_all');
  }

  // Greeting
  if (/^(hey|hi|hello|sup|good morning|good evening|yo)\b/i.test(input)) {
    signals.push('greeting');
  }

  return signals;
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

module.exports = { selectExamples, EXAMPLES, detectIntentSignals };
