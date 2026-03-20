/**
 * Telegram Bot API Wrapper
 * Handles all Telegram API interactions
 */

const axios = require('axios');

const TELEGRAM_API_BASE = 'https://api.telegram.org';

/**
 * Send a message to Telegram
 * @param {string} chatId - Telegram chat ID
 * @param {string} text - Message text
 * @param {object} options - Additional options (parse_mode, reply_markup, etc.)
 * @returns {object} - Telegram API response
 */
async function sendTelegramMessage(chatId, text, options = {}) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  
  if (!botToken) {
    throw new Error('TELEGRAM_BOT_TOKEN not configured');
  }
  
  try {
    const response = await axios.post(
      `${TELEGRAM_API_BASE}/bot${botToken}/sendMessage`,
      {
        chat_id: chatId,
        text: text,
        parse_mode: 'Markdown',
        ...options
      },
      {
        timeout: 10000
      }
    );
    
    return response.data;
  } catch (error) {
    console.error('[Telegram] Send message failed:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Send typing indicator
 * @param {string} chatId - Telegram chat ID
 */
async function sendTypingIndicator(chatId) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  
  if (!botToken) {
    return; // Fail silently for typing indicator
  }
  
  try {
    await axios.post(
      `${TELEGRAM_API_BASE}/bot${botToken}/sendChatAction`,
      {
        chat_id: chatId,
        action: 'typing'
      },
      {
        timeout: 5000
      }
    );
  } catch (error) {
    // Fail silently for typing indicator
    console.warn('[Telegram] Typing indicator failed:', error.message);
  }
}

/**
 * Edit an existing message
 * @param {string} chatId - Telegram chat ID
 * @param {number} messageId - Message ID to edit
 * @param {string} text - New message text
 * @param {object} options - Additional options
 * @returns {object} - Telegram API response
 */
async function editTelegramMessage(chatId, messageId, text, options = {}) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  
  if (!botToken) {
    throw new Error('TELEGRAM_BOT_TOKEN not configured');
  }
  
  try {
    const response = await axios.post(
      `${TELEGRAM_API_BASE}/bot${botToken}/editMessageText`,
      {
        chat_id: chatId,
        message_id: messageId,
        text: text,
        parse_mode: 'Markdown',
        ...options
      },
      {
        timeout: 10000
      }
    );
    
    return response.data;
  } catch (error) {
    console.error('[Telegram] Edit message failed:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Send message with inline keyboard
 * @param {string} chatId - Telegram chat ID
 * @param {string} text - Message text
 * @param {array} keyboard - Inline keyboard buttons
 * @returns {object} - Telegram API response
 */
async function sendMessageWithKeyboard(chatId, text, keyboard) {
  return await sendTelegramMessage(chatId, text, {
    reply_markup: {
      inline_keyboard: keyboard
    }
  });
}

/**
 * Get bot information
 * @returns {object} - Bot info
 */
async function getBotInfo() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  
  if (!botToken) {
    throw new Error('TELEGRAM_BOT_TOKEN not configured');
  }
  
  try {
    const response = await axios.get(
      `${TELEGRAM_API_BASE}/bot${botToken}/getMe`,
      { timeout: 10000 }
    );
    
    return response.data.result;
  } catch (error) {
    console.error('[Telegram] Get bot info failed:', error.message);
    throw error;
  }
}

module.exports = {
  sendTelegramMessage,
  sendTypingIndicator,
  editTelegramMessage,
  sendMessageWithKeyboard,
  getBotInfo
};