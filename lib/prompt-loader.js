/**
 * ARIA Prompt Loader — Reads ARIA_SYSTEM_PROMPT.md and substitutes template variables
 * Uses RecursiveCharacterTextSplitter for future scalability (500+ artist rosters)
 */

const fs = require('fs');
const path = require('path');
const { RecursiveCharacterTextSplitter } = require('langchain/text_splitter');
const logger = require('./logger');

const PROMPT_FILE = path.join(__dirname, '..', 'ARIA_SYSTEM_PROMPT.md');

let _cachedPrompt = null;
let _splitter = null;

/**
 * Load and cache the system prompt from ARIA_SYSTEM_PROMPT.md.
 * Substitutes {{PLACEHOLDER}} variables with runtime values.
 */
function loadSystemPrompt(vars = {}) {
  if (!_cachedPrompt) {
    try {
      _cachedPrompt = fs.readFileSync(PROMPT_FILE, 'utf-8');
      logger.info('Loaded system prompt from ARIA_SYSTEM_PROMPT.md', {
        length: _cachedPrompt.length,
      });
    } catch (err) {
      logger.error('Failed to load ARIA_SYSTEM_PROMPT.md', { error: err.message });
      throw new Error('System prompt file not found: ' + PROMPT_FILE);
    }
  }

  let prompt = _cachedPrompt;

  for (const [key, value] of Object.entries(vars)) {
    const pattern = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    prompt = prompt.replace(pattern, value || '');
  }

  return prompt;
}

/**
 * Split the prompt into chunks by section headers for future RAG use.
 */
async function getPromptChunks(vars = {}) {
  if (!_splitter) {
    _splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 2000,
      chunkOverlap: 200,
      separators: ['\n## ', '\n### ', '\n---\n', '\n\n', '\n'],
    });
  }

  const fullPrompt = loadSystemPrompt(vars);
  return _splitter.splitText(fullPrompt);
}

/**
 * Invalidate the cached prompt (call after editing the MD file at runtime).
 */
function invalidateCache() {
  _cachedPrompt = null;
  logger.info('System prompt cache invalidated');
}

module.exports = { loadSystemPrompt, getPromptChunks, invalidateCache };
