/**
 * ARIA Prompt Loader — Reads ARIA_v6_System_Prompt.md on every call (no cache).
 * No caching: file is always re-read so edits to the prompt take effect immediately
 * without requiring a server restart.
 */

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const PROMPT_FILE = path.join(__dirname, '..', 'ARIA_v6_System_Prompt.md');

/**
 * Load the system prompt from ARIA_v6_System_Prompt.md.
 * Always reads from disk — no caching.
 * Substitutes {{PLACEHOLDER}} variables with runtime values.
 */
function loadSystemPrompt(vars = {}) {
  let raw;
  try {
    raw = fs.readFileSync(PROMPT_FILE, 'utf-8');
    logger.info('Loaded system prompt from ARIA_v6_System_Prompt.md', {
      length: raw.length,
    });
  } catch (err) {
    logger.error('Failed to load ARIA_v6_System_Prompt.md', { error: err.message });
    throw new Error('System prompt file not found: ' + PROMPT_FILE);
  }

  for (const [key, value] of Object.entries(vars)) {
    const pattern = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    raw = raw.replace(pattern, value || '');
  }

  return raw;
}

/**
 * No-op — kept for API compatibility. Caching removed; every call re-reads disk.
 */
function invalidateCache() {
  logger.info('invalidateCache() called — no-op (caching disabled)');
}

module.exports = { loadSystemPrompt, invalidateCache };
