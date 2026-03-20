-- Audit log: every CRM action tracked per user for compliance and analytics

CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_user_id TEXT NOT NULL,
    action TEXT NOT NULL,                 -- 'query_leads' | 'create_lead' | 'update_status' | 'oauth_connect' | etc.
    board_id TEXT,
    board_name TEXT,
    query_text TEXT,                      -- The user's raw message
    monday_query TEXT,                    -- The GraphQL query executed
    result_summary TEXT,                  -- Brief result ("Found 23 leads", "Created: John Doe")
    success INTEGER DEFAULT 1,
    error_message TEXT,
    ip_address TEXT,
    duration_ms INTEGER,                  -- How long the action took
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_audit_user ON audit_logs(telegram_user_id);
CREATE INDEX idx_audit_action ON audit_logs(action);
CREATE INDEX idx_audit_time ON audit_logs(created_at);