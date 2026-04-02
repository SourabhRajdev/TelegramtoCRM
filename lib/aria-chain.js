/**
 * ============================================================
 * ARIA Chain — Decision-Making Agent Engine
 * ============================================================
 * 
 * This is NOT a simple prompt-response chain.
 * This is a DECISION ENGINE with:
 *   - Structured reasoning enforcement
 *   - Intent-based few-shot selection
 *   - Context-aware memory injection
 *   - Output validation with retry
 * 
 * The model MUST think before acting.
 * Generic responses are REJECTED and retried.
 * 
 * ============================================================
 */

const { ChatGoogleGenerativeAI } = require('@langchain/google-genai');
const { HumanMessage, SystemMessage, AIMessage } = require('@langchain/core/messages');
const logger = require('./logger');
const { loadSystemPrompt } = require('./prompt-loader');
const { selectExamples } = require('./few-shot-examples');
const { parseResponse, validateAgentOutput, getFormatInstructions } = require('./output-parser');
const { buildContextInjection, addToMemory } = require('./memory');

let model = null;
let systemPromptTemplate = null;
let _boardColumns = {}; // Store column schemas
let _boardGroups = {}; // Store real group IDs

/**
 * Initialize the ARIA chain with board configuration
 */
async function initChain(config) {
  // P0-1 FIX: Accept both flat and nested config shapes
  const apiKey = config.geminiApiKey || config.gemini?.apiKey;
  const modelName = config.geminiModel || config.gemini?.model || 'gemini-2.5-flash';
  
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is required');
  }

  // Initialize Gemini model
  // P1-6 FIX: Use 'model' not 'modelName'
  model = new ChatGoogleGenerativeAI({
    apiKey: apiKey,
    model: modelName,
    temperature: 0.3,
    topP: 0.95,
    topK: 40,
    maxOutputTokens: 1024,
  });

  // P0-2 FIX: Store column schemas for later use
  _boardColumns = {
    sales: config.salesColumns || [],
    artists: config.artistsColumns || [],
    staff: config.staffColumns || [],
  };

  // P0-3 FIX: Store real group IDs for create mutations
  _boardGroups = config.boardGroups || {
    sales: 'topics',
    artists: 'topics',
    staff: 'topics',
  };

  // Load system prompt template
  systemPromptTemplate = loadSystemPrompt();

  logger.info('ARIA chain initialized', {
    model: modelName,
    promptLength: systemPromptTemplate.length,
  });
}

/**
 * Invoke the ARIA agent with full decision protocol
 * 
 * @param {string} userMessage - The user's input
 * @param {string|number} chatId - Chat identifier for memory
 * @param {object} boardIds - Monday.com board IDs
 * @returns {Promise<object>} Agent decision with reasoning, intent, entities, queries
 */
async function invokeAgent(userMessage, chatId, boardIds) {
  const startTime = Date.now();

  try {
    // STEP 1: Build context-aware system prompt
    const systemPrompt = buildSystemPrompt(userMessage, chatId, boardIds);

    // STEP 2: Select relevant few-shot examples (attach group IDs for substitution)
    const boardIdsWithGroups = { ...boardIds, groups: _boardGroups };
    const examples = selectExamples(userMessage, boardIdsWithGroups, 3);

    // STEP 3: Build message chain
    const messages = buildMessageChain(systemPrompt, examples, userMessage, chatId);

    // STEP 4: Invoke model with retry logic
    const agentOutput = await invokeWithRetry(messages, userMessage, 3);

    // STEP 5: Save to memory
    addToMemory(chatId, userMessage, agentOutput);

    const duration = Date.now() - startTime;
    logger.info('Agent invocation complete', {
      chatId,
      intent: agentOutput.intent,
      board: agentOutput.entities?.board,
      hasQueries: agentOutput.queries?.length > 0,
      duration,
    });

    return agentOutput;

  } catch (error) {
    logger.error('Agent invocation failed', {
      chatId,
      error: error.message,
      stack: error.stack,
    });

    // Return safe fallback
    return {
      reasoning: `System error: ${error.message}`,
      intent: 'chitchat',
      entities: { person_name: '', board: 'unknown', filters: [] },
      action_type: 'error',
      needs_data: false,
      queries: [],
      message: "I'm having trouble processing that. Can you rephrase?",
      follow_up: '',
    };
  }
}

/**
 * Build the complete system prompt with dynamic injection
 */
function buildSystemPrompt(userMessage, chatId, boardIds) {
  let prompt = systemPromptTemplate;

  // Inject board IDs
  prompt = prompt.replace(/\{\{SALES_BOARD_ID\}\}/g, boardIds.sales || '5027332893');
  prompt = prompt.replace(/\{\{ARTISTS_BOARD_ID\}\}/g, boardIds.artists || '5027403725');
  prompt = prompt.replace(/\{\{STAFF_BOARD_ID\}\}/g, boardIds.staff || '5027403709');

  // P0-2 FIX: Inject column schemas from stored _boardColumns
  prompt = prompt.replace(/\{\{SALES_COLUMNS\}\}/g, formatBoardColumns('sales'));
  prompt = prompt.replace(/\{\{ARTISTS_COLUMNS\}\}/g, formatBoardColumns('artists'));
  prompt = prompt.replace(/\{\{STAFF_COLUMNS\}\}/g, formatBoardColumns('staff'));

  // P0-3 FIX: Inject real group IDs
  prompt = prompt.replace(/\{\{SALES_GROUP_ID\}\}/g, _boardGroups.sales || 'topics');
  prompt = prompt.replace(/\{\{ARTISTS_GROUP_ID\}\}/g, _boardGroups.artists || 'topics');
  prompt = prompt.replace(/\{\{STAFF_GROUP_ID\}\}/g, _boardGroups.staff || 'topics');

  // Inject format instructions
  prompt = prompt.replace(/\{\{FORMAT_INSTRUCTIONS\}\}/g, getFormatInstructions());

  // P1-7 FIX: Remove context injection from system prompt end
  // Context is now injected as proper messages in buildMessageChain (P1-8)

  return prompt;
}

/**
 * Format board columns for prompt injection
 * P0-2 FIX: Use stored _boardColumns instead of expecting columns in boardIds
 */
function formatBoardColumns(boardKey) {
  const columns = _boardColumns[boardKey];
  if (!columns || columns.length === 0) {
    return '   (columns not loaded)';
  }
  return columns
    .filter(c => c.id !== 'name')
    .map(c => `   - "${c.id}" → ${c.title} (${c.type})`)
    .join('\n');
}

/**
 * Build the message chain with examples and context
 * P1-7 & P1-8 FIX: Inject conversation history as messages, not appended to system prompt
 */
function buildMessageChain(systemPrompt, examples, userMessage, chatId) {
  const messages = [];

  // System prompt
  messages.push(new SystemMessage(systemPrompt));

  // Few-shot examples
  for (const example of examples) {
    messages.push(new HumanMessage(example.input));
    messages.push(new AIMessage(example.output));
  }

  // P1-8 FIX: Inject conversation history from memory as proper messages
  const { getMemoryAsMessages } = require('./memory');
  const memoryMessages = getMemoryAsMessages(chatId);
  for (const [role, content] of memoryMessages) {
    if (role === 'human') {
      messages.push(new HumanMessage(content));
    } else {
      messages.push(new AIMessage(content));
    }
  }

  // Current user message
  messages.push(new HumanMessage(userMessage));

  return messages;
}

/**
 * Invoke model with validation and retry logic
 * CRITICAL: Retries ONLY the LLM call, NOT query execution
 */
async function invokeWithRetry(messages, userMessage, maxRetries = 1) {
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.info(`Agent invocation attempt ${attempt}/${maxRetries}`);

      // Call model
      const response = await model.invoke(messages);
      const rawText = response.content;

      // Parse response
      const parseResult = await parseResponse(rawText);

      if (!parseResult.success) {
        throw new Error(`Parse failed: ${parseResult.data.message}`);
      }

      const agentOutput = parseResult.data;

      // Attach user message for contextual validation (e.g., WhatsApp hijacking, clarification loop detection)
      agentOutput._userMessage = userMessage;

      // Validate output
      const validation = validateAgentOutput(agentOutput);

      if (!validation.valid) {
        logger.warn(`Validation failed on attempt ${attempt}`, {
          reasons: validation.reasons,
        });

        if (attempt < maxRetries) {
          // Add feedback message and retry
          const feedbackMessage = buildValidationFeedback(validation.reasons, agentOutput);
          messages.push(new AIMessage(rawText));
          messages.push(new HumanMessage(feedbackMessage));
          continue;
        } else {
          // Last attempt - force-correct critical violations, log the rest
          logger.error('Validation failed on final attempt — applying auto-corrections', {
            reasons: validation.reasons,
            output: agentOutput,
          });

          // AUTO-CORRECT: Move person_name out of filters into entity field
          if (agentOutput.entities?.filters && Array.isArray(agentOutput.entities.filters)) {
            const nameFilters = agentOutput.entities.filters.filter(
              f => f.field === 'person_name' || (f.field.includes('name') && f.field !== 'art_form')
            );
            if (nameFilters.length > 0) {
              // Extract person name from filter and move to entity
              if (!agentOutput.entities.person_name || agentOutput.entities.person_name === '') {
                agentOutput.entities.person_name = nameFilters[0].value;
              }
              agentOutput.entities.filters = agentOutput.entities.filters.filter(
                f => f.field !== 'person_name' && !(f.field.includes('name') && f.field !== 'art_form')
              );
              logger.info('Auto-corrected: moved person_name from filters to entity', {
                person_name: agentOutput.entities.person_name,
              });
            }
          }

          agentOutput._validation_failed = true;
          agentOutput._validation_reasons = validation.reasons;
        }
      }

      // CRITICAL: Return decision WITHOUT executing queries
      // Execution happens in processMessage AFTER retry loop completes
      return agentOutput;

    } catch (error) {
      lastError = error;
      logger.warn(`Attempt ${attempt} failed`, { error: error.message });

      if (attempt < maxRetries) {
        // Exponential backoff
        const delay = Math.min(attempt * 2000, 10000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(`Agent invocation failed after ${maxRetries} attempts: ${lastError.message}`);
}

/**
 * Build feedback message for validation failures
 */
function buildValidationFeedback(reasons, agentOutput) {
  const feedback = [
    'Your output was REJECTED. Fix these issues:',
    '',
    ...reasons.map((r, i) => `${i + 1}. ${r}`),
    '',
    'Remember the DECISION PROTOCOL:',
    '1. THINK: Write detailed reasoning (30+ words)',
    '2. CLASSIFY: Pick the correct intent',
    '3. EXTRACT: Get all entities and filters',
    '4. GENERATE: Write real GraphQL queries',
    '5. OUTPUT: Follow message field rules',
    '',
    'Try again with a valid response.',
  ];

  return feedback.join('\n');
}

/**
 * Wrapper function for invoking the agent (for backward compatibility)
 */
async function callAriaChain(chatId, userMessage, dataContext = null) {
  // If dataContext is provided, this is a follow-up/refinement call
  // For now, we'll just invoke the agent normally
  // TODO: Implement context-aware refinement if needed
  
  const boardIds = {
    sales: process.env.MONDAY_SALES_BOARD_ID || '5027332893',
    artists: process.env.MONDAY_ARTISTS_BOARD_ID || '5027403725',
    staff: process.env.MONDAY_STAFF_BOARD_ID || '5027403709',
  };
  
  return await invokeAgent(userMessage, chatId, boardIds);
}

/**
 * Clear conversation memory for a chat
 */
function clearChatMemory(chatId) {
  const { clearMemory } = require('./memory');
  clearMemory(chatId);
}

/**
 * Get the initialized model (for testing)
 */
function getModel() {
  return model;
}

module.exports = {
  initChain,
  invokeAgent,
  callAriaChain,
  clearChatMemory,
  getModel,
};
