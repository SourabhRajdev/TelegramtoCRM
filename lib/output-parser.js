/**
 * ARIA Output Parser — Agent Decision Schema
 *
 * Forces the model to THINK → DECIDE → ACT → OUTPUT.
 * The schema includes reasoning, intent, entities, and filters
 * so the model must express its decision process, not just spit queries.
 */

const { z } = require('zod');
const { StructuredOutputParser } = require('langchain/output_parsers');
const logger = require('./logger');

// ── Agent Decision Schema ──────────────────────────────────

const ariaResponseSchema = z.object({

  // THINK: The model must explain its reasoning
  reasoning: z.string().describe(
    'MANDATORY. Your internal reasoning chain. Explain: (1) what the user wants, (2) which board(s) are relevant, (3) what entities/filters you identified, (4) what action you chose and why. Must be at least 150 characters (~30 words). Generic reasoning like "user wants data" is REJECTED.'
  ),

  // DECIDE: Explicit intent classification
  intent: z.enum([
    'search_by_name',       // find a specific person
    'list_all',             // show all items from a board
    'list_filtered',        // show items matching status/role/art_form/numeric criteria
    'count',                // how many items match
    'create_item',          // add new lead/artist/staff
    'update_item',          // change status/field on existing item
    'delete_item',          // remove an item
    'cross_board_search',   // search across multiple boards
    'follow_up',            // refers to previous conversation context
    'clarify',              // need more info from user
    'greeting',             // hi/hello/hey
    'chitchat',             // non-operational conversation
  ]).describe('The classified intent of the user request. Must match the reasoning.'),

  // DECIDE: What entities were extracted
  entities: z.object({
    person_name: z.string().optional().describe('Extracted person name, or empty string if none.'),
    board: z.enum(['sales', 'artists', 'staff', 'all', 'unknown']).describe('Target board based on context keywords.'),
    filters: z.array(z.object({
      field: z.string().describe('Column or concept being filtered: status, art_form, experience, pricing, availability, rating, source, etc.'),
      operator: z.enum(['equals', 'contains', 'greater_than', 'less_than', 'greater_equal', 'less_equal', 'not_equals']),
      value: z.string().describe('The target value, normalized to Monday.com labels (e.g., "Music - DJ" not "dj").'),
    })).describe('Filters extracted from the query. Empty array if no filters.'),
    values_to_set: z.record(z.string()).optional().describe('For writes: { column_id: value } map of fields to set.'),
  }).describe('Extracted entities from the user message.'),

  // ACT: The action to take
  action_type: z.enum(['read', 'write', 'question', 'chat', 'error']).describe(
    'read=fetch/show/find/count. write=create/update/delete. question=need clarification. chat=greeting/chitchat.'
  ),

  needs_data: z.boolean().describe('true if queries[] contains GraphQL. false only for chat/question/error.'),

  queries: z.array(z.string()).describe(
    'GraphQL query/mutation strings. For reads: fetch items from the correct board. For writes: search + mutation. For chat/question: empty array [].'
  ),

  // OUTPUT: What to say to the user
  message: z.string().describe(
    'READ: "" (empty, system formats data). WRITE: "Updating [name] — [field] to [value]" or "Creating [name]". QUESTION: your clarifying question. CHAT: short, direct reply in ARIA voice.'
  ),

  follow_up: z.string().describe('Proactive suggestion or empty string. E.g., "Want me to also check their booking status?"'),
});

const parser = StructuredOutputParser.fromZodSchema(ariaResponseSchema);
const formatInstructions = parser.getFormatInstructions();

function getParser() {
  return parser;
}

function getFormatInstructions() {
  return formatInstructions;
}

// ── Response Parser with Validation ────────────────────────

async function parseResponse(rawText) {
  try {
    const result = await parser.parse(rawText);
    const validation = validateAgentOutput(result);
    if (!validation.valid) {
      logger.warn('Agent output validation failed', { reasons: validation.reasons });
      // Still return the data but flag it
      result._validation_warnings = validation.reasons;
    }
    return { success: true, data: result };
  } catch (parseError) {
    logger.warn('StructuredOutputParser failed, attempting manual extraction', { error: parseError.message });
    try {
      const cleanText = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const firstBrace = cleanText.indexOf('{');
      const lastBrace = cleanText.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        const parsed = JSON.parse(cleanText.substring(firstBrace, lastBrace + 1));
        const normalized = normalizeManualParse(parsed);
        return { success: true, data: normalized };
      }
    } catch (manualError) {
      logger.error('Manual JSON extraction failed', { error: manualError.message });
    }
    return {
      success: false,
      data: {
        reasoning: 'Parse failure — raw text could not be extracted as JSON.',
        intent: 'chitchat',
        entities: { person_name: '', board: 'unknown', filters: [] },
        action_type: 'chat',
        needs_data: false,
        queries: [],
        message: rawText.substring(0, 500),
        follow_up: '',
      },
    };
  }
}

// ── Manual Parse Normalizer ────────────────────────────────

function normalizeManualParse(parsed) {
  const actionMap = { create: 'write', update: 'write', delete: 'write', intelligence: 'chat' };
  const queries = Array.isArray(parsed.queries)
    ? parsed.queries
    : Array.isArray(parsed.graphql_queries)
    ? parsed.graphql_queries
    : [];

  return {
    reasoning: parsed.reasoning || 'Recovered from manual parse.',
    intent: parsed.intent || (queries.length > 0 ? 'list_all' : 'chitchat'),
    entities: parsed.entities || { person_name: '', board: 'unknown', filters: [] },
    action_type: actionMap[parsed.action_type || parsed.operation_type] || parsed.action_type || 'chat',
    needs_data: parsed.needs_data !== undefined ? parsed.needs_data : queries.length > 0,
    queries,
    message: parsed.message || parsed.human_response || '',
    follow_up: parsed.follow_up || parsed.followup_action || '',
  };
}

// ── Agent Output Validator ─────────────────────────────────

function validateAgentOutput(output) {
  const reasons = [];

  // Reasoning must be substantive
  if (!output.reasoning || output.reasoning.length < 150) {
    reasons.push('Reasoning is missing or too short (< 150 chars, ~30 words minimum).');
  }
  const genericReasoningPatterns = [
    /^the user (wants|is asking|asked)/i,
    /^user wants/i,
    /^this is a/i,
    /^i will/i,
  ];
  if (output.reasoning && genericReasoningPatterns.some(p => p.test(output.reasoning.trim()))) {
    reasons.push('Reasoning is generic — must include board detection, entity extraction, and action decision.');
  }

  // Intent must match action_type
  const intentActionMap = {
    search_by_name: 'read',
    list_all: 'read',
    list_filtered: 'read',
    count: 'read',
    create_item: 'write',
    update_item: 'write',
    delete_item: 'write',
    cross_board_search: 'read',
    follow_up: null, // can be read or write
    clarify: 'question',
    greeting: 'chat',
    chitchat: 'chat',
  };
  const expectedAction = intentActionMap[output.intent];
  if (expectedAction && expectedAction !== output.action_type) {
    reasons.push(`Intent "${output.intent}" conflicts with action_type "${output.action_type}".`);
  }

  // Reads/writes must have queries
  if (['read', 'write'].includes(output.action_type) && (!output.queries || output.queries.length === 0)) {
    reasons.push(`action_type "${output.action_type}" requires queries[] but got none.`);
  }

  // Board must not be 'unknown' for data operations
  if (['read', 'write'].includes(output.action_type) && output.entities?.board === 'unknown') {
    reasons.push('Data operation but board is "unknown" — must detect target board.');
  }

  // Filtered intents must have filters
  if (output.intent === 'list_filtered' && (!output.entities?.filters || output.entities.filters.length === 0)) {
    reasons.push('Intent is "list_filtered" but no filters extracted.');
  }

  // Search by name must have person_name
  if (output.intent === 'search_by_name' && !output.entities?.person_name) {
    reasons.push('Intent is "search_by_name" but no person_name extracted.');
  }

  return { valid: reasons.length === 0, reasons };
}

module.exports = { ariaResponseSchema, getParser, getFormatInstructions, parseResponse, validateAgentOutput };
