/**
 * ============================================================
 * ARIA FOUNDER TERMINAL
 * Denicx Entertainment — Dubai
 * ============================================================
 *
 * This is YOUR personal command terminal as the founder.
 * You talk to it via Telegram.
 * Gemini understands what you want.
 * Monday.com does exactly what you say.
 *
 * FULL CRUD ACCESS:
 * - Read anything from your CRM
 * - Create leads, notes, items
 * - Update any status, any field
 * - Delete or archive items
 * - Get analytics and reports
 * - Draft WhatsApp replies
 * - Assign leads to team members
 * - Search anything
 *
 * INSTALL:
 * npm install
 *
 * ENV VARS (.env):
 * TELEGRAM_BOT_TOKEN=
 * TELEGRAM_FOUNDER_CHAT_ID=
 * GEMINI_API_KEY=
 * GEMINI_MODEL=gemini-2.5-flash
 * MONDAY_API_TOKEN=
 * MONDAY_INQUIRIES_BOARD_ID=
 * PORT=3001
 * BASE_URL=https://your-domain.com
 * ============================================================
 */

require('dotenv').config();
const fs      = require('fs');
const path    = require('path');
const express = require('express');
const axios   = require('axios');
const helmet  = require('helmet');
const rateLimit = require('express-rate-limit');

const logger              = require('./lib/logger');
const { sanitizeQueries } = require('./lib/sanitize');
const Cache               = require('./lib/cache');
const { logAudit }        = require('./lib/audit');

const app = express();
app.use(express.json());
app.use(helmet());

// General API rate limit (60 req/min per IP)
app.use(rateLimit({
  windowMs: 60000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
}));

// ============================================================
// DATA DIRECTORY
// ============================================================

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ============================================================
// CONFIG
// ============================================================

const CONFIG = {
  telegram: {
    botToken     : process.env.TELEGRAM_BOT_TOKEN,
    founderChatId: process.env.TELEGRAM_FOUNDER_CHAT_ID,
    apiBase      : 'https://api.telegram.org',
  },
  gemini: {
    apiKey : process.env.GEMINI_API_KEY,
    model  : process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    apiBase: 'https://generativelanguage.googleapis.com/v1beta',
  },
  monday: {
    apiToken      : process.env.MONDAY_API_TOKEN,
    inquiriesBoard: process.env.MONDAY_INQUIRIES_BOARD_ID,
    apiBase       : 'https://api.monday.com/v2',
  },
};

// ============================================================
// CONVERSATION PERSISTENCE
// ============================================================

const CONVERSATION_FILE = path.join(DATA_DIR, 'conversation.json');
const MAX_HISTORY = 10;

function loadConversation() {
  try {
    if (fs.existsSync(CONVERSATION_FILE)) {
      const data = fs.readFileSync(CONVERSATION_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (err) {
    logger.warn('Failed to load conversation history', { error: err.message });
  }
  return [];
}

function saveConversation(history) {
  try {
    fs.writeFileSync(CONVERSATION_FILE, JSON.stringify(history, null, 2));
  } catch (err) {
    logger.error('Failed to save conversation history', { error: err.message });
  }
}

const conversationHistory = loadConversation();

// ============================================================
// CACHE — read operations (60s TTL)
// ============================================================

const queryCache = new Cache(60000);

// ============================================================
// PER-CHAT RATE LIMITING
// ============================================================

const chatRateLimits = new Map();
const CHAT_RATE_WINDOW = 60000;
const CHAT_RATE_MAX    = 30;

function checkChatRateLimit(chatId) {
  const now = Date.now();
  const key = chatId.toString();

  if (!chatRateLimits.has(key)) {
    chatRateLimits.set(key, { count: 1, windowStart: now });
    return true;
  }

  const entry = chatRateLimits.get(key);
  if (now - entry.windowStart > CHAT_RATE_WINDOW) {
    chatRateLimits.set(key, { count: 1, windowStart: now });
    return true;
  }

  entry.count++;
  return entry.count <= CHAT_RATE_MAX;
}

// ============================================================
// ARIA FOUNDER SYSTEM PROMPT
// This is the brain. Full authority. No restrictions.
// Board ID is injected dynamically from CONFIG.
// ============================================================

const BOARD_ID = CONFIG.monday.inquiriesBoard;

function buildFounderPrompt() {
  return `
You are ARIA — the personal AI Chief of Staff for Sourabh Rajdev,
Founder of Denicx Entertainment, Dubai.

Sourabh has FULL authority over everything. He is the founder.
You execute whatever he asks, immediately, with precision.
You are not a chatbot. You are his personal operations brain.

═══════════════════════════════════════════════════════════════
MONDAY.COM COMPLETE SCHEMA
═══════════════════════════════════════════════════════════════

BOARD: Inquiries | ID: ${BOARD_ID} | Group ID: topics

COLUMNS (use exact IDs):
┌─────────────────────────────┬──────────────────────────┬───────────────┐
│ Column Name                 │ Column ID                │ Type          │
├─────────────────────────────┼──────────────────────────┼───────────────┤
│ Name (item title)           │ name                     │ text          │
│ Message                     │ text_mm16cs9s            │ text          │
│ Phone                       │ text_mm1643wg            │ text          │
│ Source                      │ text_mm16b94c            │ text          │
│ Assigned AE                 │ multiple_person_mm16e0s7 │ people        │
│ Status                      │ color_mm16g2da           │ status        │
│ Created Time                │ date_mm16ya              │ date          │
└─────────────────────────────┴──────────────────────────┴───────────────┘

STATUS OPTIONS (exact label text):
• "New Inquiry"
• "Qualified"
• "Spam"
• "Talent Application"

═══════════════════════════════════════════════════════════════
FULL GRAPHQL OPERATION LIBRARY
Use these exact patterns. Never deviate from these structures.
═══════════════════════════════════════════════════════════════

── READ OPERATIONS ────────────────────────────────────────────

GET ALL ITEMS:
query { boards(ids: [${BOARD_ID}]) { items_page(limit: 50) { items { id name column_values { id text } created_at } } } }

GET ITEMS BY STATUS:
query { items_page_by_column_values(limit: 50, board_id: ${BOARD_ID}, columns: [{column_id: "color_mm16g2da", column_values: ["STATUS_LABEL_HERE"]}]) { items { id name column_values { id text } created_at } } }

SEARCH BY NAME:
query { boards(ids: [${BOARD_ID}]) { items_page(limit: 20, query_params: {rules: [{column_id: "name", compare_value: ["SEARCH_TERM"], operator: contains_text}]}) { items { id name column_values { id text } } } } }

SEARCH BY PHONE:
query { items_page_by_column_values(limit: 5, board_id: ${BOARD_ID}, columns: [{column_id: "text_mm1643wg", column_values: ["PHONE_HERE"]}]) { items { id name column_values { id text } } } }

GET SINGLE ITEM:
query { items(ids: [ITEM_ID]) { id name column_values { id text value } updates(limit: 5) { body created_at } created_at } }

GET BOARD ANALYTICS:
query { boards(ids: [${BOARD_ID}]) { items_count groups { id title items_count } } }

GET RECENT ITEMS (last 10):
query { boards(ids: [${BOARD_ID}]) { items_page(limit: 10, query_params: {order_by: [{column_id: "creation_log__1", direction: desc}]}) { items { id name column_values { id text } created_at } } } }

GET ITEM UPDATES/NOTES:
query { items(ids: [ITEM_ID]) { updates(limit: 10) { id body created_at creator { name } } } }

── WRITE OPERATIONS ───────────────────────────────────────────

CREATE ITEM:
mutation { create_item(board_id: ${BOARD_ID}, group_id: "topics", item_name: "LEAD_NAME", column_values: "{\\"text_mm16cs9s\\":\\"MESSAGE\\",\\"text_mm1643wg\\":\\"PHONE\\",\\"text_mm16b94c\\":\\"SOURCE\\",\\"color_mm16g2da\\":{\\"label\\":\\"STATUS_LABEL\\"}}") { id name } }

UPDATE STATUS:
mutation { change_multiple_column_values(board_id: ${BOARD_ID}, item_id: ITEM_ID, column_values: "{\\"color_mm16g2da\\":{\\"label\\":\\"STATUS_LABEL\\"}}") { id name } }

UPDATE ANY COLUMN:
mutation { change_multiple_column_values(board_id: ${BOARD_ID}, item_id: ITEM_ID, column_values: "{\\"COLUMN_ID\\":\\"NEW_VALUE\\"}") { id name } }

UPDATE MULTIPLE COLUMNS AT ONCE:
mutation { change_multiple_column_values(board_id: ${BOARD_ID}, item_id: ITEM_ID, column_values: "{\\"color_mm16g2da\\":{\\"label\\":\\"Qualified\\"},\\"text_mm16b94c\\":\\"whatsapp\\"}") { id name } }

ADD NOTE/UPDATE TO ITEM:
mutation { create_update(item_id: ITEM_ID, body: "NOTE_TEXT_HERE") { id } }

DELETE ITEM:
mutation { delete_item(item_id: ITEM_ID) { id } }

ARCHIVE ITEM:
mutation { archive_item(item_id: ITEM_ID) { id } }

MOVE ITEM TO GROUP:
mutation { move_item_to_group(item_id: ITEM_ID, group_id: "GROUP_ID") { id } }

DUPLICATE ITEM:
mutation { duplicate_item(board_id: ${BOARD_ID}, with_updates: true, item_id: ITEM_ID) { id } }

CREATE SUBITEM:
mutation { create_subitem(parent_item_id: ITEM_ID, item_name: "SUBITEM_NAME") { id name } }

── BOARD OPERATIONS ───────────────────────────────────────────

CREATE NEW GROUP:
mutation { create_group(board_id: ${BOARD_ID}, group_name: "GROUP_NAME") { id } }

GET ALL GROUPS:
query { boards(ids: [${BOARD_ID}]) { groups { id title items_count } } }

═══════════════════════════════════════════════════════════════
WHAT SOURABH CAN ASK YOU
Understand natural language. Map to the right GraphQL.
═══════════════════════════════════════════════════════════════

REPORTING:
"show all leads"               → GET ALL ITEMS
"show new inquiries"           → GET BY STATUS "New Inquiry"
"show talent applications"     → GET BY STATUS "Talent Application"
"show qualified leads"         → GET BY STATUS "Qualified"
"how many leads today"         → GET ALL + filter by created_at = today
"give me a full report"        → GET ANALYTICS + counts per status
"show last 10 entries"         → GET RECENT ITEMS
"find [name]"                  → SEARCH BY NAME
"find phone [number]"          → SEARCH BY PHONE
"show notes for [name]"        → GET ITEM UPDATES

ACTIONS:
"qualify [name]"               → UPDATE STATUS to Qualified
"mark [name] as spam"          → UPDATE STATUS to Spam
"mark [name] as talent"        → UPDATE STATUS to Talent Application
"delete [name]"                → DELETE ITEM
"archive [name]"               → ARCHIVE ITEM
"add note to [name]: [text]"   → ADD UPDATE to item
"update phone for [name]: [x]" → UPDATE phone column
"assign [name] to [person]"    → UPDATE Assigned AE column

INTELLIGENCE:
"draft WhatsApp reply for [name]"  → Read their message, write personalised reply
"who should I follow up with"      → Analyse all leads, rank by priority
"what happened today"              → All items created/updated today
"any high value leads"             → Identify best opportunities
"summary"                          → Full CRM snapshot

═══════════════════════════════════════════════════════════════
MULTI-STEP OPERATIONS
When a request needs multiple GraphQL calls, chain them.
Return them as an array in graphql_queries field.
Example: "qualify Rahul" = first search by name to get ID, then update status.
═══════════════════════════════════════════════════════════════

═══════════════════════════════════════════════════════════════
OUTPUT FORMAT — STRICT JSON ONLY
NO markdown. NO backticks. NO extra text. EVER.
═══════════════════════════════════════════════════════════════

{
  "human_response": "What you say back to Sourabh. Clean. Short. Precise. Include actual data when you have it.",
  "requires_monday_action": true,
  "graphql_queries": ["query or mutation 1", "query or mutation 2"],
  "operation_type": "read | create | update | delete | analytics | intelligence",
  "followup_action": "any followup needed after Monday returns data, or empty string"
}

TONE RULES:
- You are talking to the founder. Be sharp, fast, direct.
- No "Sure!", "Great!", "Of course!" — ever.
- No emojis unless Sourabh uses them first.
- Give him data, not commentary.
- If something needs clarification, ask exactly one question.
- Never say "I cannot" — find a way or explain precisely why not.
`;
}

const ARIA_FOUNDER_PROMPT = buildFounderPrompt();

// ============================================================
// GEMINI — AI PROCESSING
// ============================================================

async function callGemini(userMessage, context = '') {
  const fullMessage = context
    ? `${userMessage}\n\nMONDAY DATA CONTEXT:\n${context}`
    : userMessage;

  // Add to conversation history for multi-turn context
  conversationHistory.push({ role: 'user', parts: [{ text: fullMessage }] });
  if (conversationHistory.length > MAX_HISTORY) {
    conversationHistory.shift();
  }

  try {
    const response = await axios.post(
      `${CONFIG.gemini.apiBase}/models/${CONFIG.gemini.model}:generateContent?key=${CONFIG.gemini.apiKey}`,
      {
        system_instruction: {
          parts: [{ text: ARIA_FOUNDER_PROMPT }],
        },
        contents: conversationHistory,
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'object',
            properties: {
              human_response        : { type: 'string' },
              requires_monday_action: { type: 'boolean' },
              graphql_queries       : { type: 'array', items: { type: 'string' } },
              operation_type        : { type: 'string' },
              followup_action       : { type: 'string' },
            },
            required: ['human_response', 'requires_monday_action', 'graphql_queries', 'operation_type'],
          },
        },
      },
      { timeout: 15000 }
    );

    const text   = response.data.candidates?.[0]?.content?.parts?.[0]?.text;
    const result = JSON.parse(text);

    // Add assistant response to history
    conversationHistory.push({
      role : 'model',
      parts: [{ text: JSON.stringify(result) }],
    });

    saveConversation(conversationHistory);

    return result;

  } catch (err) {
    logger.error('Gemini API error', { error: err.message });
    return {
      human_response        : 'ARIA error — could not process. Try again.',
      requires_monday_action: false,
      graphql_queries       : [],
      operation_type        : 'error',
      followup_action       : '',
    };
  }
}

// ============================================================
// MONDAY — GRAPHQL ENGINE
// ============================================================

async function mondayQuery(query) {
  try {
    const response = await axios.post(
      CONFIG.monday.apiBase,
      { query },
      {
        headers: {
          'Authorization': CONFIG.monday.apiToken,
          'Content-Type' : 'application/json',
          'API-Version'  : '2024-01',
        },
        timeout: 15000,
      }
    );

    if (response.data.errors) {
      logger.error('Monday.com API errors', { errors: response.data.errors });
      return { error: response.data.errors[0]?.message || 'Monday API error' };
    }

    return response.data.data;

  } catch (err) {
    if (err.response?.status === 429) {
      logger.warn('Monday.com rate limited, retrying in 5s');
      await sleep(5000);
      return mondayQuery(query);
    }
    logger.error('Monday.com API error', { error: err.message });
    return { error: err.message };
  }
}

/**
 * Execute multiple GraphQL queries sequentially.
 * Sanitizes all queries before execution.
 */
async function executeQueries(queries) {
  const sanitized = sanitizeQueries(queries, CONFIG.monday.inquiriesBoard);

  if (!sanitized.valid) {
    logger.warn('Query sanitization warnings', { errors: sanitized.errors });
  }

  const validQueries = sanitized.sanitized;
  if (!validQueries || validQueries.length === 0) {
    return [{ error: `All queries blocked: ${(sanitized.errors || []).join('; ')}` }];
  }

  const results = [];

  for (let i = 0; i < validQueries.length; i++) {
    const query = validQueries[i];
    if (!query || query.trim() === '') continue;

    logger.info(`Executing Monday.com query ${i + 1}/${validQueries.length}`);
    const result = await mondayQuery(query);
    results.push(result);
  }

  return results;
}

/**
 * Format Monday results into readable text for Gemini context
 */
function formatMondayResults(results) {
  if (!results || results.length === 0) return '';

  return results
    .map((result, i) => {
      if (!result) return `Query ${i + 1}: No result`;
      if (result.error) return `Query ${i + 1} Error: ${result.error}`;
      return `Query ${i + 1} Result:\n${JSON.stringify(result, null, 2)}`;
    })
    .join('\n\n');
}

// ============================================================
// TELEGRAM — SEND MESSAGES
// ============================================================

async function sendTelegramMessage(chatId, text) {
  // Split long messages — Telegram has 4096 char limit
  const chunks = [];
  let remaining = text;

  while (remaining.length > 0) {
    chunks.push(remaining.substring(0, 4000));
    remaining = remaining.substring(4000);
  }

  for (const chunk of chunks) {
    try {
      await axios.post(
        `${CONFIG.telegram.apiBase}/bot${CONFIG.telegram.botToken}/sendMessage`,
        {
          chat_id   : chatId,
          text      : chunk,
          parse_mode: 'HTML',
        }
      );
    } catch (err) {
      // Retry without parse_mode if HTML parsing fails
      try {
        await axios.post(
          `${CONFIG.telegram.apiBase}/bot${CONFIG.telegram.botToken}/sendMessage`,
          { chat_id: chatId, text: chunk }
        );
      } catch (retryErr) {
        logger.error('Telegram send failed', { error: retryErr.message });
      }
    }
  }
}

async function sendTypingIndicator(chatId) {
  try {
    await axios.post(
      `${CONFIG.telegram.apiBase}/bot${CONFIG.telegram.botToken}/sendChatAction`,
      { chat_id: chatId, action: 'typing' }
    );
  } catch (err) {
    // Non-critical, ignore
  }
}

// ============================================================
// CORE MESSAGE PROCESSOR
// The main brain loop
// ============================================================

async function processFounderMessage(chatId, messageText) {
  logger.info('Founder message received', { message: messageText });

  // Security — only founder can use this
  if (
    CONFIG.telegram.founderChatId &&
    chatId.toString() !== CONFIG.telegram.founderChatId.toString()
  ) {
    logger.warn('Unauthorized access attempt', { chatId });
    await sendTelegramMessage(chatId, 'Unauthorised.');
    logAudit({ type: 'unauthorized', chatId, message: messageText });
    return;
  }

  // Per-chat rate limit
  if (!checkChatRateLimit(chatId)) {
    logger.warn('Chat rate limit exceeded', { chatId });
    await sendTelegramMessage(chatId, 'Rate limit exceeded. Wait a moment.');
    return;
  }

  // Show typing indicator
  await sendTypingIndicator(chatId);

  // Step 1 — Ask Gemini what to do
  const aiResult = await callGemini(messageText);
  logger.info('AI operation determined', { operation: aiResult.operation_type });

  // Step 2 — Execute Monday queries if needed
  if (aiResult.requires_monday_action && aiResult.graphql_queries?.length > 0) {

    // Check cache for read operations
    const isRead = ['read', 'analytics', 'intelligence'].includes(aiResult.operation_type);
    const cacheKey = isRead ? JSON.stringify(aiResult.graphql_queries) : null;
    let mondayResults;

    const cachedResult = cacheKey ? queryCache.get(cacheKey) : null;
    if (cachedResult) {
      logger.info('Cache hit for read query');
      mondayResults = cachedResult;
    } else {
      mondayResults = await executeQueries(aiResult.graphql_queries);
      if (cacheKey) queryCache.set(cacheKey, mondayResults);
    }

    const mondayContext = formatMondayResults(mondayResults);

    // Step 3 — If this was a read operation, send Monday data back to Gemini
    // so it can format a proper human response
    if (isRead) {
      const refinedResult = await callGemini(
        `The Monday.com data has been retrieved. Format it clearly for the founder.`,
        mondayContext
      );
      await sendTelegramMessage(chatId, refinedResult.human_response);
      logAudit({
        type: aiResult.operation_type,
        message: messageText,
        queriesExecuted: aiResult.graphql_queries.length,
        cached: !!cachedResult,
      });
      return;
    }

    // Step 4 — For write operations check if followup needed
    if (aiResult.followup_action && aiResult.followup_action.trim() !== '') {
      const followupResult = await callGemini(
        aiResult.followup_action,
        mondayContext
      );

      if (followupResult.requires_monday_action && followupResult.graphql_queries?.length > 0) {
        await executeQueries(followupResult.graphql_queries);
      }

      await sendTelegramMessage(chatId, followupResult.human_response);
      queryCache.clear();
      logAudit({
        type: aiResult.operation_type,
        message: messageText,
        queriesExecuted: aiResult.graphql_queries.length,
        followup: true,
      });
      return;
    }

    // Invalidate cache on write operations
    if (['create', 'update', 'delete'].includes(aiResult.operation_type)) {
      queryCache.clear();
    }

    logAudit({
      type: aiResult.operation_type,
      message: messageText,
      queriesExecuted: aiResult.graphql_queries.length,
    });
  }

  // Step 5 — Send response to founder
  await sendTelegramMessage(chatId, aiResult.human_response);

  if (!aiResult.requires_monday_action) {
    logAudit({
      type: aiResult.operation_type,
      message: messageText,
      queriesExecuted: 0,
    });
  }
}

// ============================================================
// TELEGRAM WEBHOOK
// ============================================================

app.post(`/telegram/:token`, async (req, res) => {
  // Validate the token matches our bot
  if (req.params.token !== CONFIG.telegram.botToken) {
    res.sendStatus(404);
    return;
  }

  res.sendStatus(200); // Always acknowledge immediately

  try {
    const update  = req.body;
    const message = update?.message || update?.edited_message;

    if (!message) return;

    const chatId = message.chat?.id;
    const text   = message.text;

    if (!chatId || !text) return;

    // Handle /start command
    if (text === '/start') {
      await sendTelegramMessage(
        chatId,
        `ARIA ONLINE\n\nDenicx Entertainment CRM\nFounder Terminal Active\n\nYou have full access. Ask anything.\n\nExamples:\n• show new inquiries\n• qualify Rahul Sharma\n• give me a full report\n• who needs follow up\n• add note to Priya: called, very interested`
      );
      return;
    }

    // Handle /clear command — reset conversation history
    if (text === '/clear') {
      conversationHistory.length = 0;
      saveConversation(conversationHistory);
      queryCache.clear();
      await sendTelegramMessage(chatId, 'Conversation history cleared.');
      return;
    }

    // Handle /help command
    if (text === '/help') {
      await sendTelegramMessage(
        chatId,
        `ARIA COMMAND REFERENCE\n\nREPORTS:\nshow new inquiries\nshow talent applications\nshow qualified leads\nhow many leads today\ngive me a full report\nshow last 10 entries\n\nACTIONS:\nqualify [name]\nmark [name] as spam\ndelete [name]\narchive [name]\nadd note to [name]: [text]\nassign [name] to [person]\n\nINTELLIGENCE:\ndraft WhatsApp reply for [name]\nwho should I follow up with\nwhat happened today\nany high value leads\nsummary\n\n/clear — reset conversation\n/help — this menu`
      );
      return;
    }

    // Process all other messages
    await processFounderMessage(chatId, text);

  } catch (err) {
    logger.error('Telegram webhook error', { error: err.message, stack: err.stack });
  }
});

// ============================================================
// HEALTH CHECK
// ============================================================

app.get('/health', (req, res) => {
  res.json({
    status            : 'ARIA FOUNDER TERMINAL — ONLINE',
    timestamp         : new Date().toISOString(),
    uptime_seconds    : Math.round(process.uptime()),
    conversation_turns: conversationHistory.length,
    monday_board      : CONFIG.monday.inquiriesBoard,
    cache_size        : queryCache.size(),
  });
});

// ============================================================
// STARTUP
// ============================================================

async function registerTelegramWebhook() {
  if (!CONFIG.telegram.botToken) {
    logger.warn('No Telegram bot token found — skipping webhook registration');
    return;
  }

  const webhookUrl = `${process.env.BASE_URL}/telegram/${CONFIG.telegram.botToken}`;

  try {
    await axios.post(
      `${CONFIG.telegram.apiBase}/bot${CONFIG.telegram.botToken}/setWebhook`,
      { url: webhookUrl, drop_pending_updates: true }
    );
    logger.info('Telegram webhook registered', { url: webhookUrl });
  } catch (err) {
    logger.warn('Telegram webhook registration failed', { error: err.message });
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const PORT = process.env.PORT || 3001;

app.listen(PORT, async () => {
  logger.info('════════════════════════════════════════════════');
  logger.info('  FOUNDER TERMINAL');
  logger.info('  Entertainment — Dubai');
  logger.info(`  Port: ${PORT}`);
  logger.info('════════════════════════════════════════════════');
  await registerTelegramWebhook();
  logger.info('Ready. Sourabh can now command via Telegram.');
});

// ============================================================
// ERROR MONITORING
// ============================================================

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason: reason?.message || String(reason) });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception — shutting down', { error: err.message, stack: err.stack });
  if (CONFIG.telegram.botToken && CONFIG.telegram.founderChatId) {
    sendTelegramMessage(
      CONFIG.telegram.founderChatId,
      `ARIA CRITICAL ERROR — restarting.\n${err.message}`
    ).finally(() => process.exit(1));
  } else {
    process.exit(1);
  }
});

// ============================================================
// EXPORTS (for testing)
// ============================================================

module.exports = {
  app,
  formatMondayResults,
  checkChatRateLimit,
  queryCache,
  conversationHistory,
  CONFIG,
};
