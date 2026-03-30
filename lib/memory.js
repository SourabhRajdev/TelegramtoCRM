/**
 * ARIA Memory Manager — Per-chat file-persisted conversation history
 * Stores last 5 message pairs per Telegram chat ID in data/chat-memories/
 */

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const MEMORY_DIR = path.join(__dirname, '..', 'data', 'chat-memories');
const MAX_PAIRS = 5; // 5 user+ai pairs = 10 messages

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
 * Get conversation history for a chat as LangChain-compatible message pairs.
 * Returns array of { role: 'human'|'ai', content: string }
 */
function getMemory(chatId) {
  return loadMemory(chatId);
}

/**
 * Add a user+AI message pair to chat history. Trims to last MAX_PAIRS pairs.
 */
function addToMemory(chatId, userMessage, aiResponse) {
  const messages = loadMemory(chatId);
  messages.push(
    { role: 'human', content: userMessage },
    { role: 'ai', content: typeof aiResponse === 'string' ? aiResponse : JSON.stringify(aiResponse) }
  );

  // Keep last MAX_PAIRS pairs (MAX_PAIRS * 2 messages)
  while (messages.length > MAX_PAIRS * 2) {
    messages.shift();
  }

  saveMemory(chatId, messages);
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
 * Convert memory to Gemini-compatible message format for the chain.
 * Returns array of [role, content] tuples for ChatPromptTemplate.
 */
function getMemoryAsMessages(chatId) {
  const messages = loadMemory(chatId);
  return messages.map(m => [m.role === 'human' ? 'human' : 'ai', m.content]);
}

module.exports = { getMemory, addToMemory, clearMemory, getMemoryAsMessages };
