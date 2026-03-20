const fs   = require('fs');
const path = require('path');

const DATA_DIR   = path.join(__dirname, '..', 'data');
const AUDIT_FILE = path.join(DATA_DIR, 'audit.log');

// Import database for V2 logging (with fallback)
let db = null;
try {
  db = require('./database');
} catch (error) {
  console.warn('[Audit] Database not available, using file-only logging');
}

function logAudit(entry) {
  const record = {
    timestamp: new Date().toISOString(),
    ...entry,
  };

  // V2: Database logging (if available)
  if (db && entry.telegram_user_id) {
    try {
      db.logAction({
        telegram_user_id: entry.telegram_user_id,
        action: entry.type || 'unknown',
        board_id: entry.board_id || null,
        board_name: entry.board_name || null,
        query_text: entry.message || null,
        monday_query: entry.query || null,
        result_summary: entry.result || null,
        success: entry.success !== false ? 1 : 0,
        error_message: entry.error || null,
        duration_ms: entry.duration || null
      });
    } catch (dbError) {
      console.error('[Audit] Database logging failed:', dbError.message);
      // Fall through to file logging
    }
  }

  // V1: File logging (always keep for backward compatibility)
  const line = JSON.stringify(record) + '\n';

  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.appendFileSync(AUDIT_FILE, line);
  } catch (err) {
    // Audit logging should never crash the app
    console.error('Audit write failed:', err.message);
  }
}

function getRecentAuditEntries(limit = 50) {
  try {
    const content = fs.readFileSync(AUDIT_FILE, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    return lines.slice(-limit).map(line => JSON.parse(line));
  } catch {
    return [];
  }
}

// V2: Enhanced audit functions
function logUserAction(telegram_user_id, action, details = {}) {
  logAudit({
    telegram_user_id,
    type: action,
    ...details
  });
}

function logOAuthEvent(telegram_user_id, event, details = {}) {
  logAudit({
    telegram_user_id,
    type: `oauth_${event}`,
    ...details
  });
}

function logAdminAction(admin_user_id, action, target_user_id = null, details = {}) {
  logAudit({
    telegram_user_id: admin_user_id,
    type: `admin_${action}`,
    target_user: target_user_id,
    ...details
  });
}

module.exports = { 
  logAudit, 
  getRecentAuditEntries,
  logUserAction,
  logOAuthEvent,
  logAdminAction
};
