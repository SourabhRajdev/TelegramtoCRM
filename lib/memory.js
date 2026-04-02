/**
 * ARIA Memory Manager — Structured Context Memory
 *
 * Stores per-chat conversation history with STRUCTURED context,
 * not raw JSON blobs. Memory entries include:
 *   - what the user asked (natural language)
 *   - what the agent decided (intent, board, entities)
 *   - what happened (result summary)
 *
 * Memory is INJECTED into the reasoning step, not just appended as history.
 */

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const MEMORY_DIR = path.join(__dirname, '..', 'data', 'chat-memories');
const MAX_PAIRS = 5; // 5 conversation turns

if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true });

function memoryPath(chatId) {
  return path.join(MEMORY_DIR, `${chatId}.json`);
}

function loadMemory(chatId) {
  try {
    const filePath = memoryPath(chatId);
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      return Array.isArray(data) ? data : [];
    }
  } catch (err) {
    logger.warn('Failed to load memory', { chatId, error: err.message });
  }
  return [];
}

function saveMemory(chatId, messages) {
  try {
    fs.writeFileSync(memoryPath(chatId), JSON.stringify(messages, null, 2));
  } catch (err) {
    logger.error('Failed to save memory', { chatId, error: err.message });
  }
}

/**
 * Get raw conversation history for a chat.
 */
function getMemory(chatId) {
  return loadMemory(chatId);
}

/**
 * Add a structured conversation turn to memory.
 * Stores the user message and a SUMMARIZED version of the AI response
 * (not the raw JSON blob) so the model can reason about past context.
 *
 * @param {string|number} chatId
 * @param {string} userMessage - The user's original message
 * @param {object} aiResponse - The full agent response object
 */
function addToMemory(chatId, userMessage, aiResponse) {
  const messages = loadMemory(chatId);

  // Store the user message as-is
  messages.push({
    role: 'human',
    content: userMessage,
  });

  // Store a STRUCTURED summary of the AI response, not raw JSON
  const contextSummary = buildContextSummary(aiResponse);
  messages.push({
    role: 'ai',
    content: contextSummary,
    // Also store structured data for programmatic access
    _structured: {
      intent: aiResponse.intent || null,
      board: aiResponse.entities?.board || null,
      person_name: aiResponse.entities?.person_name || null,
      filters: aiResponse.entities?.filters || [],
      action_type: aiResponse.action_type || null,
      had_queries: (aiResponse.queries && aiResponse.queries.length > 0) || false,
    },
  });

  // Keep last MAX_PAIRS turns
  while (messages.length > MAX_PAIRS * 2) {
    messages.shift();
  }

  saveMemory(chatId, messages);
}

/**
 * Build a human-readable context summary from the agent's response.
 * This is what the model will see in conversation history —
 * NOT the raw JSON, but a description of what happened.
 */
function buildContextSummary(aiResponse) {
  const parts = [];

  if (aiResponse.intent) {
    parts.push(`[Intent: ${aiResponse.intent}]`);
  }

  if (aiResponse.entities?.board && aiResponse.entities.board !== 'unknown') {
    parts.push(`[Board: ${aiResponse.entities.board}]`);
  }

  if (aiResponse.entities?.person_name) {
    parts.push(`[Person: ${aiResponse.entities.person_name}]`);
  }

  if (aiResponse.entities?.filters && aiResponse.entities.filters.length > 0) {
    const filterDescs = aiResponse.entities.filters.map(f =>
      `${f.field} ${f.operator} ${f.value}`
    );
    parts.push(`[Filters: ${filterDescs.join(', ')}]`);
  }

  if (aiResponse.action_type === 'read') {
    parts.push('[Action: fetched data from Monday.com]');
  } else if (aiResponse.action_type === 'write') {
    parts.push(`[Action: ${aiResponse.message || 'executed write operation'}]`);
  } else if (aiResponse.action_type === 'question') {
    parts.push(`[Action: asked clarifying question — "${aiResponse.message}"]`);
  } else if (aiResponse.action_type === 'chat') {
    parts.push(`[Action: responded — "${aiResponse.message}"]`);
  }

  if (aiResponse.follow_up) {
    parts.push(`[Suggested: ${aiResponse.follow_up}]`);
  }

  return parts.join(' ');
}

/**
 * Clear conversation history for a chat.
 */
function clearMemory(chatId) {
  try {
    const filePath = memoryPath(chatId);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (err) {
    logger.warn('Failed to clear memory', { chatId, error: err.message });
  }
}

/**
 * Convert memory to LangChain-compatible message format.
 * Returns array of [role, content] tuples.
 *
 * Adds staleness signals when the last AI turn was a clarification question,
 * so the model knows it can abandon that thread if the user changed topic.
 */
function getMemoryAsMessages(chatId) {
  const messages = loadMemory(chatId);
  const result = messages.map(m => [m.role === 'human' ? 'human' : 'ai', m.content]);

  // If the last AI message was a clarification/question, add a system hint
  if (messages.length >= 2) {
    const lastAI = messages[messages.length - 1];
    if (lastAI?.role === 'ai' && lastAI._structured?.action_type === 'question') {
      result.push(['human', '[SYSTEM NOTE: The previous clarification question may be stale. If the user\'s new message is about a different topic, ignore the previous thread and classify the new message independently.]']);
    }
  }

  return result;
}

/**
 * Get the last conversation context for follow-up resolution.
 * Returns the structured data from the most recent AI response.
 */
function getLastContext(chatId) {
  const messages = loadMemory(chatId);
  // Find the last AI message with structured data
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'ai' && messages[i]._structured) {
      return messages[i]._structured;
    }
  }
  return null;
}

/**
 * Build a context injection string for the current reasoning step.
 * This gives the model a clear summary of what happened before,
 * so it can handle follow-ups and context references.
 */
function buildContextInjection(chatId) {
  const messages = loadMemory(chatId);
  if (messages.length === 0) return '';

  const turns = [];
  for (let i = 0; i < messages.length; i += 2) {
    const human = messages[i];
    const ai = messages[i + 1];
    if (human && ai) {
      turns.push(`  User: "${human.content}"\n  ARIA: ${ai.content}`);
    }
  }

  if (turns.length === 0) return '';

  return `\n[CONVERSATION CONTEXT — Last ${turns.length} turn(s)]\n${turns.join('\n\n')}\n[END CONTEXT]\n`;
}

module.exports = {
  getMemory,
  addToMemory,
  clearMemory,
  getMemoryAsMessages,
  getLastContext,
  buildContextInjection,
};
