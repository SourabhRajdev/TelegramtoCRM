/**
 * ARIA Output Parser — LangChain Structured Output
 * Zod schema + StructuredOutputParser for reliable JSON responses
 */

const { z } = require('zod');
const { StructuredOutputParser } = require('langchain/output_parsers');
const logger = require('./logger');

const ariaResponseSchema = z.object({
  message: z.string().describe(
    'READ: empty "". WRITE: "Updating"/"Creating" (1 word). Questions: the question. Chat: short reply.'
  ),
  needs_data: z.boolean().describe('true when queries[] is non-empty. false only for pure chat.'),
  queries: z.array(z.string()).describe('Array of GraphQL query/mutation strings for Monday.com.'),
  action_type: z.enum(['read', 'write', 'question', 'chat', 'error']).describe(
    'read=fetch/show/find. write=create/update/delete. question=clarify. chat=greetings.'
  ),
  follow_up: z.string().describe('Internal note or empty string.'),
});

const parser = StructuredOutputParser.fromZodSchema(ariaResponseSchema);
const formatInstructions = parser.getFormatInstructions();

function getParser() {
  return parser;
}

function getFormatInstructions() {
  return formatInstructions;
}

async function parseResponse(rawText) {
  try {
    const result = await parser.parse(rawText);
    return { success: true, data: result };
  } catch (parseError) {
    logger.warn('StructuredOutputParser failed, attempting manual extraction', { error: parseError.message });
    try {
      const cleanText = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const firstBrace = cleanText.indexOf('{');
      const lastBrace = cleanText.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        const parsed = JSON.parse(cleanText.substring(firstBrace, lastBrace + 1));
        const actionMap = { create: 'write', update: 'write', delete: 'write', intelligence: 'chat' };
        const normalized = {
          message: parsed.message || parsed.human_response || '',
          needs_data: parsed.needs_data !== undefined ? parsed.needs_data : (parsed.requires_monday_action || false),
          queries: Array.isArray(parsed.queries) ? parsed.queries : (Array.isArray(parsed.graphql_queries) ? parsed.graphql_queries : []),
          action_type: actionMap[parsed.action_type || parsed.operation_type] || parsed.action_type || 'chat',
          follow_up: parsed.follow_up || parsed.followup_action || '',
        };
        if (normalized.queries.length > 0) normalized.needs_data = true;
        return { success: true, data: normalized };
      }
    } catch (manualError) {
      logger.error('Manual JSON extraction failed', { error: manualError.message });
    }
    return {
      success: false,
      data: { message: rawText.substring(0, 500), needs_data: false, queries: [], action_type: 'chat', follow_up: '' },
    };
  }
}

module.exports = { ariaResponseSchema, getParser, getFormatInstructions, parseResponse };
