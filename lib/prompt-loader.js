/**
 * ARIA Prompt Loader — 60-second TTL cache.
 * Edits to ARIA_v6_System_Prompt.md take effect within 60 seconds
 * without requiring a server restart, while avoiding per-message disk I/O.
 */

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const PROMPT_FILE = path.join(__dirname, '..', 'ARIA_v7_System_Prompt.md');
const CACHE_TTL_MS = 60_000; // 60 seconds

let _cache = null;      // raw file content
let _cacheTime = 0;     // timestamp of last read

/**
 * Load the system prompt from ARIA_v6_System_Prompt.md.
 * Caches for 60 seconds — edits apply on next cache expiry.
 * Substitutes {{PLACEHOLDER}} variables with runtime values.
 */
function loadSystemPrompt(vars = {}) {
  const now = Date.now();

  if (!_cache || now - _cacheTime > CACHE_TTL_MS) {
    try {
      _cache = fs.readFileSync(PROMPT_FILE, 'utf-8');
      _cacheTime = now;
      logger.info('Loaded system prompt from ARIA_v6_System_Prompt.md', { length: _cache.length });
    } catch (err) {
      logger.error('Failed to load ARIA_v6_System_Prompt.md', { error: err.message });
      throw new Error('System prompt file not found: ' + PROMPT_FILE);
    }
  }

  let raw = _cache;
  for (const [key, value] of Object.entries(vars)) {
    const pattern = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    raw = raw.replace(pattern, value || '');
  }

  return raw;
}

/**
 * Force cache invalidation — prompt reloads on next call.
 */
function invalidateCache() {
  _cache = null;
  _cacheTime = 0;
  logger.info('Prompt cache invalidated — will reload on next call');
}

module.exports = { loadSystemPrompt, invalidateCache };
