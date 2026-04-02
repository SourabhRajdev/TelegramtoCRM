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

// v6 schema — matches ARIA_v6_System_Prompt.md Section 1 exactly
const ariaResponseSchema = z.object({

  // THINK: The model must explain its reasoning (40+ words)
  reasoning: z.string().describe(
    'MANDATORY. Minimum 40 words. Explicit chain-of-thought: board detection, intent classification, entity extraction, follow-up detection, execution decision.'
  ),

  // DECIDE: Explicit intent classification
  intent: z.enum([
    'search_by_name',
    'list_all',
    'list_filtered',
    'count',
    'create_item',
    'update_item',
    'delete_item',
    'cross_board_search',
    'follow_up',
    'clarify',
    'greeting',
    'chitchat',
  ]).describe('ONE intent from the Intent Registry. Clarify is last resort only.'),

  // DECIDE: What entities were extracted
  entities: z.object({
    person_name: z.string().describe('Person name only. Empty string if none. NEVER an attribute.'),
    board: z.enum(['sales', 'artists', 'staff', 'all']).nullable().describe('Target board. Default "sales" when ambiguous. null only for pure greetings.'),
    limit: z.number().int().nullable().describe('Any integer from the message that constrains result count. null if no integer present.'),
    sort_by: z.enum(['created_at_desc', 'pricing_asc', 'pricing_desc', 'experience_desc', 'rating_desc']).nullable().describe('Sort order derived from message. null if not specified.'),
    filters: z.array(z.object({
      field: z.string(),
      operator: z.enum(['equals', 'not_equals', 'contains', 'less_than', 'greater_than', 'less_equal', 'greater_equal']),
      value: z.union([z.string(), z.number()]),
    })).describe('Attribute filters only. Person names NEVER in filters.'),
    values_to_set: z.record(z.unknown()).optional().describe('For writes: semantic field → value map.'),
  }),

  // ACT: The action to take
  action_type: z.enum(['read', 'write', 'none']).describe(
    'read=fetch/show/find/count. write=create/update/delete. none=greeting/chitchat/clarify.'
  ),

  queries: z.array(z.string()).describe(
    'GraphQL queries/mutations. Empty array for greeting/clarify/none.'
  ),

  needs_data: z.boolean().describe('true if queries[] must execute before response.'),

  // OUTPUT: What the user sees
  message: z.string().describe(
    'Read: empty string. Write: human confirmation. Greeting: "Hey! What do you need?". Clarify: one specific question with two named options.'
  ),
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
        entities: { person_name: '', board: null, limit: null, sort_by: null, filters: [] },
        action_type: 'none',
        needs_data: false,
        queries: [],
        message: rawText.substring(0, 500),
      },
    };
  }
}

// ── Manual Parse Normalizer ────────────────────────────────

function normalizeManualParse(parsed) {
  // v6: action_type must be 'read' | 'write' | 'none' — no 'chat' or 'question'
  const actionMap = {
    create: 'write', update: 'write', delete: 'write',
    chat: 'none', question: 'none', intelligence: 'none',
  };
  const queries = Array.isArray(parsed.queries)
    ? parsed.queries
    : Array.isArray(parsed.graphql_queries)
    ? parsed.graphql_queries
    : [];

  const rawAction = parsed.action_type || parsed.operation_type || '';
  const resolvedAction = actionMap[rawAction] || (['read', 'write', 'none'].includes(rawAction) ? rawAction : 'none');

  return {
    reasoning: parsed.reasoning || 'Recovered from manual parse.',
    intent: parsed.intent || (queries.length > 0 ? 'list_all' : 'chitchat'),
    entities: {
      person_name: '',
      board: null,
      limit: null,
      sort_by: null,
      filters: [],
      ...(parsed.entities || {}),
    },
    action_type: resolvedAction,
    needs_data: parsed.needs_data !== undefined ? parsed.needs_data : queries.length > 0,
    queries,
    message: parsed.message || parsed.human_response || '',
  };
}

// ── Agent Output Validator ─────────────────────────────────

function validateAgentOutput(output) {
  const reasons = [];

  // PHASE 1: ENTITY vs FILTER SEPARATION (CRITICAL)
  if (output.entities?.filters && Array.isArray(output.entities.filters)) {
    for (const filter of output.entities.filters) {
      if (filter.field === 'person_name' || filter.field.includes('name') && filter.field !== 'art_form') {
        reasons.push('🔴 CRITICAL: person_name found in filters array. Person names are ENTITIES, not filters. Move to person_name field.');
      }
    }
  }

  // Reasoning must be substantive — v6 spec: 40 words minimum (word count, not char count)
  if (!output.reasoning) {
    reasons.push('Reasoning is missing.');
  } else {
    const wordCount = output.reasoning.trim().split(/\s+/).filter(Boolean).length;
    if (wordCount < 40) {
      reasons.push(`Reasoning is too short (${wordCount} words — minimum 40 words required).`);
    }
  }

  // Generic reasoning check: only fire when reasoning is BOTH short AND generic
  // v6 reasoning legitimately starts with "User wants..." followed by deep chain-of-thought.
  // Pattern must be coupled with short word count to avoid false positives.
  const genericReasoningPatterns = [
    /^this is a (greeting|chitchat|simple)/i,
    /^i will (fetch|query|search)/i,
  ];
  if (output.reasoning) {
    const wordCount = output.reasoning.trim().split(/\s+/).filter(Boolean).length;
    if (wordCount < 25 && genericReasoningPatterns.some(p => p.test(output.reasoning.trim()))) {
      reasons.push('Reasoning is generic — must include board detection, entity extraction, and action decision.');
    }
  }

  // PHASE 3: NO GENERIC FAILURE RESPONSES
  const genericFailurePatterns = [
    /^i couldn't find that$/i,
    /^can you rephrase\??$/i,
    /^i'm having trouble processing that$/i,
    /^check the name and try again$/i,
  ];
  if (output.message && genericFailurePatterns.some(p => p.test(output.message.trim()))) {
    // Check if reasoning shows interpretation attempts
    const hasInterpretationAttempts = output.reasoning && (
      output.reasoning.includes('searched') ||
      output.reasoning.includes('looked for') ||
      output.reasoning.includes('checked') ||
      output.reasoning.includes('found') ||
      output.reasoning.includes('alternative')
    );
    if (!hasInterpretationAttempts) {
      reasons.push('🔴 Generic failure response without interpretation attempts. Must explain what was searched and offer alternatives.');
    }
  }

  // PHASE 2: CONTEXT LOCKING (FOLLOW-UP FIX)
  if (output.intent === 'follow_up') {
    const contextReferences = [
      'previous', 'last', 'earlier', 'before', 'context', 'merging', 'combining', 'adding to'
    ];
    const hasContextReference = contextReferences.some(ref => 
      output.reasoning.toLowerCase().includes(ref)
    );
    if (!hasContextReference) {
      reasons.push('🔴 Follow-up intent detected but reasoning does not reference previous context. Must explicitly mention what is being merged/combined.');
    }
  }

  // Intent must match action_type (v6: 'none' replaces 'chat'/'question')
  const intentActionMap = {
    search_by_name: 'read',
    list_all: 'read',
    list_filtered: 'read',
    count: 'read',
    create_item: 'write',
    update_item: 'write',
    delete_item: 'write',
    cross_board_search: 'read',
    follow_up: null,  // can be read or write
    clarify: 'none',
    greeting: 'none',
    chitchat: 'none',
  };
  const expectedAction = intentActionMap[output.intent];
  if (expectedAction && expectedAction !== output.action_type) {
    reasons.push(`Intent "${output.intent}" conflicts with action_type "${output.action_type}".`);
  }

  // Reads/writes must have queries
  if (['read', 'write'].includes(output.action_type) && (!output.queries || output.queries.length === 0)) {
    reasons.push(`action_type "${output.action_type}" requires queries[] but got none.`);
  }

  // Board must be set for data operations
  if (['read', 'write'].includes(output.action_type) && !output.entities?.board) {
    reasons.push('Data operation but board is null/unknown — must detect target board.');
  }

  // Filtered intents must have at least one qualifying constraint
  // v6 OCV-05: "top N" → list_filtered with limit only (no attribute filters required)
  if (output.intent === 'list_filtered') {
    const hasPersonName = output.entities?.person_name && output.entities.person_name.trim() !== '';
    const hasFilters = output.entities?.filters && output.entities.filters.length > 0;
    const hasLimit = output.entities?.limit !== null && output.entities?.limit !== undefined;
    const hasSortBy = output.entities?.sort_by !== null && output.entities?.sort_by !== undefined;
    if (!hasPersonName && !hasFilters && !hasLimit && !hasSortBy) {
      reasons.push('Intent is "list_filtered" but no filters, person_name, limit, or sort_by extracted.');
    }
  }

  // Search by name must have person_name
  if (output.intent === 'search_by_name' && !output.entities?.person_name) {
    reasons.push('Intent is "search_by_name" but no person_name extracted.');
  }

  // PHASE 5: WHATSAPP HIJACKING DETECTION
  // If the message field mentions WhatsApp but the reasoning doesn't show the user asked about it
  if (output.message && /whatsapp/i.test(output.message) && output.action_type === 'question') {
    // Check if reasoning shows the user actually asked about WhatsApp
    const reasoningMentionsUserAskedWhatsApp = output.reasoning && (
      output.reasoning.includes('user asked about WhatsApp') ||
      output.reasoning.includes('user wants WhatsApp') ||
      output.reasoning.includes('user mentioned WhatsApp number') ||
      output.reasoning.includes('user wants to update WhatsApp')
    );
    if (!reasoningMentionsUserAskedWhatsApp) {
      reasons.push('🔴 CRITICAL: WhatsApp hijacking detected — asking about WhatsApp when user did not request it. Classify the actual user intent instead.');
    }
  }

  // PHASE 6: CLARIFICATION LOOP DETECTION
  // If intent is clarify but the message contains clear board keywords + data request verbs, reject
  if (output.intent === 'clarify' || output.action_type === 'question') {
    // These patterns are NEVER ambiguous — they are always data requests
    const clearDataRequest = /\b(tell me|show me|give me|how many|list|find)\b.*\b(leads?|clients?|artists?|staff|team|deals?)\b/i;
    const clearDataRequest2 = /\b(leads?|clients?|artists?|staff|team|deals?)\b.*\b(tell|show|give|list|find|get)\b/i;
    if (output._userMessage && (clearDataRequest.test(output._userMessage) || clearDataRequest2.test(output._userMessage))) {
      reasons.push('🔴 CRITICAL: Clear data request classified as clarify. User message contains board keyword + data verb — this is a data operation, not ambiguous.');
    }
  }

  return { valid: reasons.length === 0, reasons };
}

module.exports = { ariaResponseSchema, getParser, getFormatInstructions, parseResponse, validateAgentOutput };
