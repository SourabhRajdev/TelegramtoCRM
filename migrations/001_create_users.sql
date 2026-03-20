-- Execute this migration on first boot
-- Users table: one row per Telegram user who connects their Monday.com account

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_user_id TEXT NOT NULL UNIQUE,
    telegram_username TEXT,
    telegram_first_name TEXT,
    monday_token_encrypted TEXT,          -- AES-256-GCM encrypted OAuth token
    monday_token_iv TEXT,                 -- Initialization vector for decryption
    monday_token_tag TEXT,                -- Authentication tag for integrity
    monday_user_id TEXT,                  -- Monday.com user ID from /me endpoint
    monday_account_id TEXT,              -- Monday.com account/company ID
    company_name TEXT,                    -- Human-readable company name
    access_level TEXT DEFAULT 'manager',  -- 'admin' | 'manager' | 'viewer'
    is_active INTEGER DEFAULT 1,          -- Soft delete (0 = deactivated)
    onboarding_state TEXT DEFAULT 'new',  -- 'new' | 'oauth_pending' | 'board_select' | 'active'
    last_active_at TEXT,                  -- ISO timestamp of last message
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_users_telegram ON users(telegram_user_id);
CREATE INDEX idx_users_monday ON users(monday_user_id);
CREATE INDEX idx_users_active ON users(is_active);