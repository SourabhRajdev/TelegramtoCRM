/**
 * ============================================================
 * ARIA Chain — LangChain-powered AI Engine
 * ============================================================
 * 
 * Replaces the manual callGemini() function with a structured
 * LangChain chain that combines:
 *   1. System prompt (from ARIA_SYSTEM_PROMPT.md)
 *   2. Few-shot examples (3 most relevant, keyword-selected)
 *   3. Conversation memory (last 5 turns, file-persisted)
 *   4. Format instructions (auto-injected by StructuredOutputParser)
 *   5. Gemini model (ChatGoogleGenerativeAI)
 *   6. Output parser (validates JSON, retries on failure)
 * 
 * ============================================================
 */

const logger = require('./logger');
const { getFormatInstructions, parseResponse } = require('./output-parser');
const { selectExamples } = require('./few-shot-examples');
const { addToMemory, getMemoryAsMessages, clearMemory } = require('./memory');
const { loadSystemPrompt } = require('./prompt-loader');
const { ChatGoogleGenerativeAI } = require('@langchain/google-genai');

// ── State ───────────────────────────────────────────────────

let _model = null;
let _systemPrompt = null;
let _boardIds = null;
let _initialized = false;
let _initError = null;
let _lastCallTime = 0;
const MIN_CALL_INTERVAL = 2000; // 2s between Gemini calls

// ── Initialization ──────────────────────────────────────────

/**
 * Initialize the ARIA chain with configuration and board schemas.
 * Call this once at startup after fetchBoardColumns() completes.
 *
 * @param {object} config
 * @param {string} config.geminiApiKey
 * @param {string} config.geminiModel
 * @param {object} config.boardIds - { sales, artists, staff }
 * @param {object} config.formattedColumns - { sales, artists, staff } formatted column strings
 */
async function initChain(config) {
  try {

    _model = new ChatGoogleGenerativeAI({
      apiKey: config.geminiApiKey,
      model: config.geminiModel || 'gemini-2.5-flash',
      temperature: 0.3,
      topP: 0.95,
      topK: 40,
      maxOutputTokens: 2048,
    });

    _boardIds = config.boardIds;

    // Load format instructions from the output parser
    const formatInstructions = await getFormatInstructions();

    // Load the system prompt from ARIA_SYSTEM_PROMPT.md with variable substitution
    _systemPrompt = loadSystemPrompt({
      SALES_BOARD_ID: config.boardIds.sales,
      ARTISTS_BOARD_ID: config.boardIds.artists,
      STAFF_BOARD_ID: config.boardIds.staff,
      SALES_COLUMNS: config.formattedColumns.sales,
      ARTISTS_COLUMNS: config.formattedColumns.artists,
      STAFF_COLUMNS: config.formattedColumns.staff,
      FORMAT_INSTRUCTIONS: formatInstructions,
    });

    _initialized = true;
    _initError = null;
    logger.info('ARIA LangChain initialized', {
      model: config.geminiModel,
      promptLength: _systemPrompt.length,
      boards: Object.keys(config.boardIds).length,
    });
  } catch (err) {
    _initError = err.message + '\n' + err.stack;
    throw err;
  }
}

// ── Main Chain Call ──────────────────────────────────────────

/**
 * Call the ARIA chain — drop-in replacement for callGemini().
 *
 * @param {string|number} chatId - Telegram chat ID (for memory)
 * @param {string} userMessage - The user's message
 * @param {object|null} dataContext - Optional Monday.com data for write confirmations
 * @param {number} retryCount - Internal retry counter
 * @returns {object} { message, needs_data, queries, action_type, follow_up }
 */
async function callAriaChain(chatId, userMessage, dataContext = null, retryCount = 0) {
  const MAX_RETRIES = 3;

  if (!_initialized) {
    throw new Error(`Chain not initialized: ${_initError || 'Unknown error'}`);
  }

  try {

    // Throttle requests
    const now = Date.now();
    const timeSinceLastCall = now - _lastCallTime;
    if (timeSinceLastCall < MIN_CALL_INTERVAL) {
      const waitTime = MIN_CALL_INTERVAL - timeSinceLastCall;
      logger.info(`Throttling chain call, waiting ${waitTime}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    _lastCallTime = Date.now();

    // Build the full user message with data context if provided
    let fullMessage = userMessage;
    if (dataContext) {
      fullMessage += `\n\n[DATA FROM MONDAY.COM]:\n${JSON.stringify(dataContext, null, 2)}`;
    }

    // Build the message array for the chat model
    const messages = buildMessages(chatId, fullMessage);
    logger.info('Calling Gemini via LangChain', { messageCount: messages.length, chatId });

    // Call Gemini via LangChain
    const response = await _model.invoke(messages);
    const rawText = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);

    if (!rawText) {
      throw new Error('No response from Gemini');
    }

    // Parse and validate the response
    const { success, data } = await parseResponse(rawText);

    // Sanitize message field — strip leaked JSON fragments
    if (data.message) {
      data.message = data.message
        .replace(/","needs_data".*$/s, '')
        .replace(/","queries".*$/s, '')
        .replace(/","action_type".*$/s, '')
        .replace(/","follow_up".*$/s, '')
        .replace(/\{"message":\s*"/g, '')
        .trim();
    }

    // Save to per-chat memory (only on first attempt, not retries)
    if (retryCount === 0) {
      addToMemory(chatId, fullMessage, data);
    }

    return data;

  } catch (error) {
    // Retry on rate limit (429) with exponential backoff
    if (error.message?.includes('429') && retryCount < MAX_RETRIES) {
      const retryAfter = Math.min((retryCount + 1) * 10000, 60000);
      logger.warn(`Gemini rate limited (429), retry ${retryCount + 1}/${MAX_RETRIES} in ${retryAfter / 1000}s`);
      await new Promise(resolve => setTimeout(resolve, retryAfter));
      return callAriaChain(chatId, userMessage, dataContext, retryCount + 1);
    }

    logger.error('ARIA chain error', {
      error: error.message,
      retry: retryCount,
    });

    if (error.message?.includes('429')) {
      return {
        message: "I'm temporarily rate-limited by Google's API. Please wait 60 seconds and try again.",
        needs_data: false, queries: [], action_type: 'error', follow_up: '',
      };
    }

    throw error;
  }
}

// ── Message Builder ─────────────────────────────────────────

/**
 * Build the complete message array for the chat model:
 * [system prompt, few-shot examples, memory, user message]
 */
function buildMessages(chatId, userMessage) {
  const { HumanMessage, AIMessage, SystemMessage } = require('@langchain/core/messages');

  const messages = [];

  // 1. System prompt
  messages.push(new SystemMessage(_systemPrompt));

  // 2. Few-shot examples (3 most relevant)
  const examples = selectExamples(userMessage, _boardIds, 3);
  for (const ex of examples) {
    messages.push(new HumanMessage(ex.input));
    messages.push(new AIMessage(ex.output));
  }

  // 3. Conversation memory (last 5 pairs)
  const memoryMessages = getMemoryAsMessages(chatId);
  for (const [role, content] of memoryMessages) {
    if (role === 'human') {
      messages.push(new HumanMessage(content));
    } else {
      messages.push(new AIMessage(content));
    }
  }

  // 4. Current user message
  messages.push(new HumanMessage(userMessage));

  return messages;
}

// ── Exports ─────────────────────────────────────────────────

/**
 * Clear memory for a specific chat (used by /clear command).
 */
function clearChatMemory(chatId) {
  clearMemory(chatId);
}

module.exports = { initChain, callAriaChain, clearChatMemory };
