-- Board access: many-to-many between users and Monday.com boards
-- A user can access multiple boards; a board can be accessed by multiple users

CREATE TABLE IF NOT EXISTS board_access (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_user_id TEXT NOT NULL,
    board_id TEXT NOT NULL,               -- Monday.com board ID
    board_name TEXT NOT NULL,             -- Cached board name for display
    board_kind TEXT DEFAULT 'public',     -- 'public' | 'private' | 'share'
    item_count INTEGER DEFAULT 0,         -- Cached item count (refreshed periodically)
    access_level TEXT DEFAULT 'full',     -- 'full' | 'read_only'
    is_default INTEGER DEFAULT 0,         -- 1 = auto-selected when user says "show leads"
    added_by TEXT,                         -- telegram_user_id of who granted access
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (telegram_user_id) REFERENCES users(telegram_user_id),
    UNIQUE(telegram_user_id, board_id)
);

CREATE INDEX idx_board_access_user ON board_access(telegram_user_id);
CREATE INDEX idx_board_access_board ON board_access(board_id);