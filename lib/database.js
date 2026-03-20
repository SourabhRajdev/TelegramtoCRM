/**
 * SQLite Database Layer for ARIA V2 Multi-Tenant
 * Handles users, board access, and audit logging
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

let db = null;

/**
 * Initialize database connection and run migrations
 * @returns {Database} - SQLite database instance
 */
function initialize() {
  try {
    // Ensure data directory exists
    const dbPath = process.env.DATABASE_PATH || './data/aria.db';
    const dataDir = path.dirname(dbPath);
    
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
      console.log(`[Database] Created directory: ${dataDir}`);
    }
    
    // Open database connection
    db = new Database(dbPath);
    
    // Configure SQLite for performance and safety
    db.pragma('journal_mode = WAL'); // Write-Ahead Logging for concurrent reads
    db.pragma('foreign_keys = ON');  // Enforce foreign key constraints
    db.pragma('synchronous = NORMAL'); // Balance safety vs performance
    
    console.log(`[Database] Connected to: ${dbPath}`);
    
    // Run migrations
    runMigrations();
    
    console.log('[Database] ✅ Initialized successfully');
    return db;
  } catch (error) {
    console.error('[Database] Initialization failed:', error.message);
    throw error;
  }
}

/**
 * Run all migration files in order
 */
function runMigrations() {
  const migrationsDir = path.join(__dirname, '../migrations');
  
  if (!fs.existsSync(migrationsDir)) {
    console.log('[Database] No migrations directory found, skipping');
    return;
  }
  
  const migrationFiles = fs.readdirSync(migrationsDir)
    .filter(file => file.endsWith('.sql'))
    .sort(); // Alphabetical order ensures 001, 002, 003...
  
  console.log(`[Database] Running ${migrationFiles.length} migrations...`);
  
  for (const file of migrationFiles) {
    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf8');
    
    try {
      db.exec(sql);
      console.log(`[Database] ✅ ${file}`);
    } catch (error) {
      console.error(`[Database] ❌ ${file}:`, error.message);
      throw error;
    }
  }
}

/**
 * Close database connection gracefully
 */
function close() {
  if (db) {
    db.close();
    db = null;
    console.log('[Database] Connection closed');
  }
}

// ============================================================
// USER MANAGEMENT
// ============================================================

/**
 * Create a new user
 * @param {object} userData - { telegram_user_id, telegram_username, telegram_first_name }
 * @returns {object} - Created user row
 */
function createUser({ telegram_user_id, telegram_username, telegram_first_name }) {
  const stmt = db.prepare(`
    INSERT INTO users (telegram_user_id, telegram_username, telegram_first_name)
    VALUES (?, ?, ?)
    RETURNING *
  `);
  
  try {
    const user = stmt.get(telegram_user_id, telegram_username, telegram_first_name);
    console.log(`[Database] Created user: ${telegram_user_id} (${telegram_first_name})`);
    return user;
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      console.log(`[Database] User already exists: ${telegram_user_id}`);
      return getUser(telegram_user_id);
    }
    console.error('[Database] Create user failed:', error.message);
    throw error;
  }
}

/**
 * Get user by Telegram ID
 * @param {string} telegram_user_id
 * @returns {object|null} - User row or null
 */
function getUser(telegram_user_id) {
  const stmt = db.prepare('SELECT * FROM users WHERE telegram_user_id = ?');
  return stmt.get(telegram_user_id) || null;
}

/**
 * Get user by Monday.com user ID
 * @param {string} monday_user_id
 * @returns {object|null} - User row or null
 */
function getUserByMondayId(monday_user_id) {
  const stmt = db.prepare('SELECT * FROM users WHERE monday_user_id = ?');
  return stmt.get(monday_user_id) || null;
}

/**
 * Update user fields
 * @param {string} telegram_user_id
 * @param {object} fields - Fields to update
 * @returns {object} - Updated user row
 */
function updateUser(telegram_user_id, fields) {
  const allowedFields = [
    'telegram_username', 'telegram_first_name', 'monday_user_id', 
    'monday_account_id', 'company_name', 'access_level', 'is_active',
    'onboarding_state', 'last_active_at'
  ];
  
  const updates = [];
  const values = [];
  
  for (const [key, value] of Object.entries(fields)) {
    if (allowedFields.includes(key)) {
      updates.push(`${key} = ?`);
      values.push(value);
    }
  }
  
  if (updates.length === 0) {
    throw new Error('No valid fields to update');
  }
  
  updates.push('updated_at = datetime(\'now\')');
  values.push(telegram_user_id);
  
  const stmt = db.prepare(`
    UPDATE users 
    SET ${updates.join(', ')} 
    WHERE telegram_user_id = ?
    RETURNING *
  `);
  
  const user = stmt.get(...values);
  console.log(`[Database] Updated user: ${telegram_user_id}`);
  return user;
}

/**
 * Deactivate user (soft delete)
 * @param {string} telegram_user_id
 */
function deactivateUser(telegram_user_id) {
  return updateUser(telegram_user_id, { is_active: 0 });
}

/**
 * List all active users
 * @returns {array} - Array of user rows
 */
function listActiveUsers() {
  const stmt = db.prepare(`
    SELECT * FROM users 
    WHERE is_active = 1 
    ORDER BY created_at DESC
  `);
  return stmt.all();
}

/**
 * Set user onboarding state
 * @param {string} telegram_user_id
 * @param {string} state - 'new' | 'oauth_pending' | 'board_select' | 'active'
 */
function setOnboardingState(telegram_user_id, state) {
  return updateUser(telegram_user_id, { onboarding_state: state });
}

/**
 * Store encrypted Monday.com token
 * @param {string} telegram_user_id
 * @param {object} tokenData - { encrypted, iv, tag, monday_user_id, monday_account_id, company_name }
 */
function storeMondayToken(telegram_user_id, { encrypted, iv, tag, monday_user_id, monday_account_id, company_name }) {
  return updateUser(telegram_user_id, {
    monday_token_encrypted: encrypted,
    monday_token_iv: iv,
    monday_token_tag: tag,
    monday_user_id,
    monday_account_id,
    company_name
  });
}

// ============================================================
// BOARD ACCESS MANAGEMENT
// ============================================================

/**
 * Add board access for a user
 * @param {string} telegram_user_id
 * @param {object} boardData - { board_id, board_name, board_kind, item_count, added_by }
 * @returns {object} - Created board_access row
 */
function addBoardAccess(telegram_user_id, { board_id, board_name, board_kind = 'public', item_count = 0, added_by = null }) {
  const stmt = db.prepare(`
    INSERT INTO board_access (telegram_user_id, board_id, board_name, board_kind, item_count, added_by)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(telegram_user_id, board_id) DO UPDATE SET
      board_name = excluded.board_name,
      board_kind = excluded.board_kind,
      item_count = excluded.item_count
    RETURNING *
  `);
  
  try {
    const access = stmt.get(telegram_user_id, board_id, board_name, board_kind, item_count, added_by);
    console.log(`[Database] Added board access: ${telegram_user_id} → ${board_name} (${board_id})`);
    return access;
  } catch (error) {
    console.error('[Database] Add board access failed:', error.message);
    throw error;
  }
}

/**
 * Remove board access
 * @param {string} telegram_user_id
 * @param {string} board_id
 */
function removeBoardAccess(telegram_user_id, board_id) {
  const stmt = db.prepare(`
    DELETE FROM board_access 
    WHERE telegram_user_id = ? AND board_id = ?
  `);
  
  const result = stmt.run(telegram_user_id, board_id);
  console.log(`[Database] Removed board access: ${telegram_user_id} → ${board_id}`);
  return result.changes > 0;
}

/**
 * Get all boards a user has access to
 * @param {string} telegram_user_id
 * @returns {array} - Array of board_access rows
 */
function getUserBoards(telegram_user_id) {
  const stmt = db.prepare(`
    SELECT * FROM board_access 
    WHERE telegram_user_id = ? 
    ORDER BY is_default DESC, created_at ASC
  `);
  return stmt.all(telegram_user_id);
}

/**
 * Set a board as the user's default
 * @param {string} telegram_user_id
 * @param {string} board_id
 */
function setDefaultBoard(telegram_user_id, board_id) {
  const transaction = db.transaction(() => {
    // Clear existing default
    const clearStmt = db.prepare(`
      UPDATE board_access 
      SET is_default = 0 
      WHERE telegram_user_id = ?
    `);
    clearStmt.run(telegram_user_id);
    
    // Set new default
    const setStmt = db.prepare(`
      UPDATE board_access 
      SET is_default = 1 
      WHERE telegram_user_id = ? AND board_id = ?
    `);
    setStmt.run(telegram_user_id, board_id);
  });
  
  transaction();
  console.log(`[Database] Set default board: ${telegram_user_id} → ${board_id}`);
}

/**
 * Get user's default board
 * @param {string} telegram_user_id
 * @returns {object|null} - Default board_access row or null
 */
function getDefaultBoard(telegram_user_id) {
  const stmt = db.prepare(`
    SELECT * FROM board_access 
    WHERE telegram_user_id = ? AND is_default = 1
  `);
  return stmt.get(telegram_user_id) || null;
}

/**
 * Update cached item count for a board
 * @param {string} telegram_user_id
 * @param {string} board_id
 * @param {number} count
 */
function updateBoardItemCount(telegram_user_id, board_id, count) {
  const stmt = db.prepare(`
    UPDATE board_access 
    SET item_count = ? 
    WHERE telegram_user_id = ? AND board_id = ?
  `);
  stmt.run(count, telegram_user_id, board_id);
}

// ============================================================
// AUDIT LOGGING
// ============================================================

/**
 * Log an action to the audit trail
 * @param {object} logData - { telegram_user_id, action, board_id, board_name, query_text, monday_query, result_summary, success, error_message, duration_ms }
 */
function logAction({ 
  telegram_user_id, 
  action, 
  board_id = null, 
  board_name = null, 
  query_text = null, 
  monday_query = null, 
  result_summary = null, 
  success = 1, 
  error_message = null, 
  duration_ms = null 
}) {
  const stmt = db.prepare(`
    INSERT INTO audit_logs (
      telegram_user_id, action, board_id, board_name, query_text, 
      monday_query, result_summary, success, error_message, duration_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  try {
    stmt.run(
      telegram_user_id, action, board_id, board_name, query_text,
      monday_query, result_summary, success, error_message, duration_ms
    );
  } catch (error) {
    console.error('[Database] Audit log failed:', error.message);
    // Don't throw - audit failures shouldn't break the main flow
  }
}

/**
 * Get recent actions for a user
 * @param {string} telegram_user_id
 * @param {number} limit
 * @returns {array} - Array of audit_log rows
 */
function getRecentActions(telegram_user_id, limit = 10) {
  const stmt = db.prepare(`
    SELECT * FROM audit_logs 
    WHERE telegram_user_id = ? 
    ORDER BY created_at DESC 
    LIMIT ?
  `);
  return stmt.all(telegram_user_id, limit);
}

/**
 * Get action statistics for a user
 * @param {string} telegram_user_id
 * @returns {object} - { total_queries, queries_today, most_used_board }
 */
function getActionStats(telegram_user_id) {
  const totalStmt = db.prepare(`
    SELECT COUNT(*) as total_queries 
    FROM audit_logs 
    WHERE telegram_user_id = ?
  `);
  
  const todayStmt = db.prepare(`
    SELECT COUNT(*) as queries_today 
    FROM audit_logs 
    WHERE telegram_user_id = ? 
    AND date(created_at) = date('now')
  `);
  
  const boardStmt = db.prepare(`
    SELECT board_name, COUNT(*) as count 
    FROM audit_logs 
    WHERE telegram_user_id = ? AND board_name IS NOT NULL 
    GROUP BY board_name 
    ORDER BY count DESC 
    LIMIT 1
  `);
  
  const total = totalStmt.get(telegram_user_id);
  const today = todayStmt.get(telegram_user_id);
  const topBoard = boardStmt.get(telegram_user_id);
  
  return {
    total_queries: total.total_queries,
    queries_today: today.queries_today,
    most_used_board: topBoard ? topBoard.board_name : null
  };
}

/**
 * Get global statistics (for admin)
 * @returns {object} - { total_users, active_today, total_queries }
 */
function getGlobalStats() {
  const usersStmt = db.prepare(`
    SELECT COUNT(*) as total_users 
    FROM users 
    WHERE is_active = 1
  `);
  
  const activeStmt = db.prepare(`
    SELECT COUNT(DISTINCT telegram_user_id) as active_today 
    FROM audit_logs 
    WHERE date(created_at) = date('now')
  `);
  
  const queriesStmt = db.prepare(`
    SELECT COUNT(*) as total_queries 
    FROM audit_logs
  `);
  
  const users = usersStmt.get();
  const active = activeStmt.get();
  const queries = queriesStmt.get();
  
  return {
    total_users: users.total_users,
    active_today: active.active_today,
    total_queries: queries.total_queries
  };
}

module.exports = {
  // Lifecycle
  initialize,
  close,
  
  // User CRUD
  createUser,
  getUser,
  getUserByMondayId,
  updateUser,
  deactivateUser,
  listActiveUsers,
  setOnboardingState,
  storeMondayToken,
  
  // Board Access
  addBoardAccess,
  removeBoardAccess,
  getUserBoards,
  setDefaultBoard,
  getDefaultBoard,
  updateBoardItemCount,
  
  // Audit
  logAction,
  getRecentActions,
  getActionStats,
  getGlobalStats
};