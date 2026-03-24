/**
 * Persistent Memory System for ARIA
 * SQLite-based conversation history and context retention
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

let db = null;

/**
 * Initialize memory database
 */
function initialize() {
  try {
    const dbPath = process.env.MEMORY_DB_PATH || './data/aria-memory.db';
    const dataDir = path.dirname(dbPath);
    
    // Ensure data directory exists
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    // Open database
    db = new Database(dbPath);
    
    // Enable WAL mode for better concurrency
    db.pragma('journal_mode = WAL');
    
    // Create tables
    createTables();
    
    console.log('[Memory] Database initialized:', dbPath);
    return true;
  } catch (error) {
    console.error('[Memory] Initialization failed:', error.message);
    return false;
  }
}

/**
 * Create database tables
 */
function createTables() {
  // Conversation history table
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      role TEXT NOT NULL,
      message TEXT NOT NULL,
      metadata TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      INDEX idx_chat_id (chat_id),
      INDEX idx_created_at (created_at)
    )
  `);
  
  // Context memory table (for important facts)
  db.exec(`
    CREATE TABLE IF NOT EXISTS context_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      category TEXT,
      importance INTEGER DEFAULT 5,
      last_accessed TEXT DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(chat_id, key)
    )
  `);
  
  // Session metadata table
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL UNIQUE,
      last_active TEXT DEFAULT (datetime('now')),
      message_count INTEGER DEFAULT 0,
      metadata TEXT
    )
  `);
}

/**
 * Add message to conversation history
 * @param {string} chatId - Telegram chat ID
 * @param {string} role - 'user' or 'assistant'
 * @param {string} message - Message content
 * @param {object} metadata - Optional metadata
 */
function addMessage(chatId, role, message, metadata = null) {
  if (!db) return false;
  
  try {
    const stmt = db.prepare(`
      INSERT INTO conversations (chat_id, role, message, metadata)
      VALUES (?, ?, ?, ?)
    `);
    
    stmt.run(
      chatId,
      role,
      message,
      metadata ? JSON.stringify(metadata) : null
    );
    
    // Update session
    updateSession(chatId);
    
    return true;
  } catch (error) {
    console.error('[Memory] Add message failed:', error.message);
    return false;
  }
}

/**
 * Get conversation history for a chat
 * @param {string} chatId - Telegram chat ID
 * @param {number} limit - Number of recent messages to retrieve
 * @returns {array} - Array of messages
 */
function getConversationHistory(chatId, limit = 20) {
  if (!db) return [];
  
  try {
    const stmt = db.prepare(`
      SELECT role, message, metadata, created_at
      FROM conversations
      WHERE chat_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `);
    
    const rows = stmt.all(chatId, limit);
    
    // Reverse to get chronological order
    return rows.reverse().map(row => ({
      role: row.role,
      message: row.message,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
      timestamp: row.created_at
    }));
  } catch (error) {
    console.error('[Memory] Get history failed:', error.message);
    return [];
  }
}

/**
 * Get conversation history in Gemini format
 * @param {string} chatId - Telegram chat ID
 * @param {number} limit - Number of recent messages
 * @returns {array} - Gemini-formatted conversation
 */
function getGeminiHistory(chatId, limit = 20) {
  const history = getConversationHistory(chatId, limit);
  
  return history.map(msg => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.message }]
  }));
}

/**
 * Store important context/fact
 * @param {string} chatId - Telegram chat ID
 * @param {string} key - Context key (e.g., 'preferred_board', 'last_client_name')
 * @param {string} value - Context value
 * @param {string} category - Category (e.g., 'preference', 'fact', 'task')
 * @param {number} importance - Importance level (1-10)
 */
function storeContext(chatId, key, value, category = 'general', importance = 5) {
  if (!db) return false;
  
  try {
    const stmt = db.prepare(`
      INSERT INTO context_memory (chat_id, key, value, category, importance)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(chat_id, key) DO UPDATE SET
        value = excluded.value,
        category = excluded.category,
        importance = excluded.importance,
        last_accessed = datetime('now')
    `);
    
    stmt.run(chatId, key, value, category, importance);
    return true;
  } catch (error) {
    console.error('[Memory] Store context failed:', error.message);
    return false;
  }
}

/**
 * Retrieve context value
 * @param {string} chatId - Telegram chat ID
 * @param {string} key - Context key
 * @returns {string|null} - Context value or null
 */
function getContext(chatId, key) {
  if (!db) return null;
  
  try {
    const stmt = db.prepare(`
      SELECT value FROM context_memory
      WHERE chat_id = ? AND key = ?
    `);
    
    const row = stmt.get(chatId, key);
    
    // Update last accessed
    if (row) {
      db.prepare(`
        UPDATE context_memory
        SET last_accessed = datetime('now')
        WHERE chat_id = ? AND key = ?
      `).run(chatId, key);
    }
    
    return row ? row.value : null;
  } catch (error) {
    console.error('[Memory] Get context failed:', error.message);
    return null;
  }
}

/**
 * Get all context for a chat
 * @param {string} chatId - Telegram chat ID
 * @param {string} category - Optional category filter
 * @returns {object} - Key-value pairs of context
 */
function getAllContext(chatId, category = null) {
  if (!db) return {};
  
  try {
    let query = `
      SELECT key, value, category, importance
      FROM context_memory
      WHERE chat_id = ?
    `;
    
    const params = [chatId];
    
    if (category) {
      query += ` AND category = ?`;
      params.push(category);
    }
    
    query += ` ORDER BY importance DESC, last_accessed DESC`;
    
    const stmt = db.prepare(query);
    const rows = stmt.all(...params);
    
    const context = {};
    rows.forEach(row => {
      context[row.key] = {
        value: row.value,
        category: row.category,
        importance: row.importance
      };
    });
    
    return context;
  } catch (error) {
    console.error('[Memory] Get all context failed:', error.message);
    return {};
  }
}

/**
 * Update session metadata
 * @param {string} chatId - Telegram chat ID
 */
function updateSession(chatId) {
  if (!db) return;
  
  try {
    db.prepare(`
      INSERT INTO sessions (chat_id, last_active, message_count)
      VALUES (?, datetime('now'), 1)
      ON CONFLICT(chat_id) DO UPDATE SET
        last_active = datetime('now'),
        message_count = message_count + 1
    `).run(chatId);
  } catch (error) {
    console.error('[Memory] Update session failed:', error.message);
  }
}

/**
 * Get session info
 * @param {string} chatId - Telegram chat ID
 * @returns {object|null} - Session info
 */
function getSession(chatId) {
  if (!db) return null;
  
  try {
    const stmt = db.prepare(`
      SELECT * FROM sessions WHERE chat_id = ?
    `);
    
    return stmt.get(chatId);
  } catch (error) {
    console.error('[Memory] Get session failed:', error.message);
    return null;
  }
}

/**
 * Clear old conversation history (keep last N days)
 * @param {number} daysToKeep - Number of days to retain
 */
function cleanupOldHistory(daysToKeep = 30) {
  if (!db) return 0;
  
  try {
    const stmt = db.prepare(`
      DELETE FROM conversations
      WHERE created_at < datetime('now', '-' || ? || ' days')
    `);
    
    const result = stmt.run(daysToKeep);
    console.log(`[Memory] Cleaned up ${result.changes} old messages`);
    return result.changes;
  } catch (error) {
    console.error('[Memory] Cleanup failed:', error.message);
    return 0;
  }
}

/**
 * Get memory statistics
 * @param {string} chatId - Optional chat ID for specific stats
 * @returns {object} - Memory statistics
 */
function getStats(chatId = null) {
  if (!db) return {};
  
  try {
    if (chatId) {
      // Stats for specific chat
      const messageCount = db.prepare(`
        SELECT COUNT(*) as count FROM conversations WHERE chat_id = ?
      `).get(chatId);
      
      const contextCount = db.prepare(`
        SELECT COUNT(*) as count FROM context_memory WHERE chat_id = ?
      `).get(chatId);
      
      const session = getSession(chatId);
      
      return {
        messages: messageCount.count,
        contexts: contextCount.count,
        session: session
      };
    } else {
      // Global stats
      const totalMessages = db.prepare(`
        SELECT COUNT(*) as count FROM conversations
      `).get();
      
      const totalContexts = db.prepare(`
        SELECT COUNT(*) as count FROM context_memory
      `).get();
      
      const totalSessions = db.prepare(`
        SELECT COUNT(*) as count FROM sessions
      `).get();
      
      return {
        total_messages: totalMessages.count,
        total_contexts: totalContexts.count,
        total_sessions: totalSessions.count
      };
    }
  } catch (error) {
    console.error('[Memory] Get stats failed:', error.message);
    return {};
  }
}

/**
 * Clear all memory for a chat
 * @param {string} chatId - Telegram chat ID
 */
function clearChat(chatId) {
  if (!db) return false;
  
  try {
    db.prepare(`DELETE FROM conversations WHERE chat_id = ?`).run(chatId);
    db.prepare(`DELETE FROM context_memory WHERE chat_id = ?`).run(chatId);
    db.prepare(`DELETE FROM sessions WHERE chat_id = ?`).run(chatId);
    
    console.log(`[Memory] Cleared all memory for chat: ${chatId}`);
    return true;
  } catch (error) {
    console.error('[Memory] Clear chat failed:', error.message);
    return false;
  }
}

/**
 * Close database connection
 */
function close() {
  if (db) {
    db.close();
    db = null;
    console.log('[Memory] Database closed');
  }
}

module.exports = {
  initialize,
  addMessage,
  getConversationHistory,
  getGeminiHistory,
  storeContext,
  getContext,
  getAllContext,
  updateSession,
  getSession,
  cleanupOldHistory,
  getStats,
  clearChat,
  close
};
