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

const logger              = require('./lib/logger');
const { sanitizeQueries } = require('./lib/sanitize');
const Cache               = require('./lib/cache');
const { logAudit }        = require('./lib/audit');

// V2 Multi-tenant imports
let db, oauth, userContext, boardSelector, admin, ai, telegram;
let isV2Mode = false;

// Initialize V2 modules if OAuth is configured
try {
  if (process.env.MONDAY_CLIENT_ID && process.env.ENCRYPTION_KEY) {
    db = require('./lib/database');
    oauth = require('./lib/oauth');
    userContext = require('./lib/userContext');
    boardSelector = require('./lib/boardSelector');
    admin = require('./lib/admin');
    ai = require('./lib/ai');
    telegram = require('./lib/telegram');
    isV2Mode = true;
    console.log('[ARIA] V2 Multi-tenant mode enabled');
  } else {
    console.log('[ARIA] V1 Single-tenant mode (missing OAuth config)');
  }
} catch (error) {
  console.warn('[ARIA] V2 modules not available, running in V1 mode:', error.message);
}

const app = express();
// Trust proxy for Railway/Cloudflare reverse proxy
app.set('trust proxy', 1);
app.use(express.json());
app.use(helmet());

// Rate limiting disabled temporarily for Railway deployment
// TODO: Re-enable after deployment is stable

// ============================================================
// V2 OAUTH ROUTES (Multi-tenant)
// ============================================================

if (isV2Mode) {
  // OAuth start - redirect user to Monday.com
  app.get('/auth/monday/start/:telegramUserId', (req, res) => {
    try {
      const telegramUserId = req.params.telegramUserId;
      const authUrl = oauth.getAuthorizationUrl(telegramUserId);
      res.redirect(authUrl);
    } catch (error) {
      console.error('[OAuth] Start failed:', error.message);
      res.status(500).send('OAuth initialization failed');
    }
  });

  // OAuth callback - handle Monday.com response
  app.get('/auth/monday/callback', async (req, res) => {
    try {
      const { code, state, error } = req.query;
      
      if (error) {
        res.send(`
          <html><body style="font-family: Arial; text-align: center; padding: 50px;">
            <h2>❌ Authorization Cancelled</h2>
            <p>You cancelled the Monday.com connection.</p>
            <p>Go back to Telegram and send /start to try again.</p>
          </body></html>
        `);
        return;
      }
      
      if (!code || !state) {
        res.status(400).send('Missing authorization code or state');
        return;
      }
      
      const result = await oauth.handleCallback(code, state);
      
      if (result.success) {
        // Notify user via Telegram
        await telegram.sendTelegramMessage(result.telegram_user_id,
          `✅ **Connected Successfully!**\n\n` +
          `Welcome, ${result.monday_user_name} from ${result.company_name}.\n\n` +
          `Let me find your boards...`
        );
        
        // Trigger board selection
        await boardSelector.presentBoardSelection(result.telegram_user_id);
        
        res.send(`
          <html><body style="font-family: Arial; text-align: center; padding: 50px;">
            <h2>✅ Connection Successful!</h2>
            <p>Welcome, ${result.monday_user_name}!</p>
            <p>Go back to Telegram to complete your setup.</p>
            <script>setTimeout(() => window.close(), 3000);</script>
          </body></html>
        `);
      } else {
        res.send(`
          <html><body style="font-family: Arial; text-align: center; padding: 50px;">
            <h2>❌ Connection Failed</h2>
            <p>Error: ${result.error}</p>
            <p>Go back to Telegram and send /start to try again.</p>
          </body></html>
        `);
      }
    } catch (error) {
      console.error('[OAuth] Callback failed:', error.message);
      res.status(500).send('OAuth processing failed');
    }
  });

  // Success page
  app.get('/auth/success', (req, res) => {
    res.send(`
      <html><body style="font-family: Arial; text-align: center; padding: 50px;">
        <h2>✅ ARIA Connected!</h2>
        <p>Your Monday.com account is now connected.</p>
        <p>Return to Telegram to start using ARIA.</p>
        <script>setTimeout(() => window.close(), 3000);</script>
      </body></html>
    `);
  });
}

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
query { boards(ids: [${BOARD_ID}]) { items_count groups { id title } } }

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
query { boards(ids: [${BOARD_ID}]) { groups { id title } } }

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
  // Use V2 telegram module if available
  if (isV2Mode && telegram) {
    return await telegram.sendTelegramMessage(chatId, text);
  }
  
  // V1 fallback
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
  // Use V2 telegram module if available
  if (isV2Mode && telegram) {
    return await telegram.sendTypingIndicator(chatId);
  }
  
  // V1 fallback
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

// ============================================================
// V2 MESSAGE PROCESSING (Multi-tenant with V1 fallback)
// ============================================================

async function processMessage(chatId, messageText) {
  if (isV2Mode) {
    return await processV2Message(chatId, messageText);
  } else {
    return await processFounderMessage(chatId, messageText);
  }
}

async function processV2Message(chatId, messageText) {
  logger.info('V2 message received', { chatId, message: messageText });

  try {
    // Load user context
    const context = await userContext.loadContext(chatId.toString());
    
    // Handle different user states
    if (context.error === 'not_registered') {
      return await handleNewUser(chatId, messageText);
    }
    
    if (context.error === 'oauth_pending') {
      return await sendAuthLink(chatId);
    }
    
    if (context.error === 'board_select') {
      return await handleBoardSelection(chatId, messageText);
    }
    
    if (context.error === 'deactivated') {
      await telegram.sendTelegramMessage(chatId, 
        "⚠️ Your ARIA access has been deactivated.\n\n" +
        "Please contact your administrator for assistance."
      );
      return;
    }
    
    if (context.error === 'decrypt_failed') {
      await telegram.sendTelegramMessage(chatId,
        "🔐 Your connection needs to be refreshed.\n\n" +
        "Click here to reconnect: /start"
      );
      return;
    }
    
    // Handle admin commands
    if (messageText.startsWith('/') && admin.isAdmin(chatId.toString())) {
      return await admin.routeAdminCommand(chatId.toString(), messageText);
    }
    
    // Handle regular commands
    if (messageText.startsWith('/')) {
      return await handleV2Commands(chatId, messageText, context);
    }
    
    // Per-chat rate limit
    if (!checkChatRateLimit(chatId)) {
      logger.warn('Chat rate limit exceeded', { chatId });
      await telegram.sendTelegramMessage(chatId, 'Rate limit exceeded. Wait a moment.');
      return;
    }
    
    // Show typing indicator
    await sendTypingIndicator(chatId);
    
    // Resolve which board this query targets
    const boardContext = await userContext.resolveBoard(context, messageText);
    
    if (boardContext.needsSelection) {
      return await sendBoardPicker(chatId, boardContext.boards);
    }
    
    if (boardContext.error) {
      await telegram.sendTelegramMessage(chatId, boardContext.message);
      return;
    }
    
    // Process with AI using user context
    const aiResult = await ai.processWithAI(messageText, conversationHistory, {
      userName: context.user.telegram_first_name,
      companyName: context.user.company_name,
      boardId: boardContext.board_id,
      boardName: boardContext.board_name,
      accessLevel: context.user.access_level,
      availableBoards: context.boards,
      isFounder: context.isFounder
    });
    
    logger.info('AI operation determined', { operation: aiResult.operation_type });
    
    // Execute Monday.com queries if needed
    if (aiResult.requires_monday_action && aiResult.graphql_queries?.length > 0) {
      const isRead = ['read', 'analytics', 'intelligence'].includes(aiResult.operation_type);
      const cacheKey = isRead ? JSON.stringify(aiResult.graphql_queries) : null;
      let mondayResults;
      
      const cachedResult = cacheKey ? queryCache.get(cacheKey) : null;
      if (cachedResult) {
        logger.info('Cache hit for read query');
        mondayResults = cachedResult;
      } else {
        // Execute with user's own token
        mondayResults = [];
        for (const query of aiResult.graphql_queries) {
          const result = await userContext.executeWithUserToken(chatId.toString(), query);
          mondayResults.push(result);
        }
        if (cacheKey) queryCache.set(cacheKey, mondayResults);
      }
      
      const mondayContext = formatMondayResults(mondayResults);
      
      // For read operations, format response with AI
      if (isRead) {
        const refinedResult = await ai.processWithAI(
          `The Monday.com data has been retrieved. Format it clearly for the user.`,
          conversationHistory,
          {
            userName: context.user.telegram_first_name,
            companyName: context.user.company_name,
            boardName: boardContext.board_name
          }
        );
        await telegram.sendTelegramMessage(chatId, refinedResult.human_response);
        return;
      }
      
      // Handle followup actions
      if (aiResult.followup_action && aiResult.followup_action.trim() !== '') {
        const followupResult = await ai.processWithAI(
          aiResult.followup_action,
          conversationHistory,
          {
            userName: context.user.telegram_first_name,
            companyName: context.user.company_name,
            boardName: boardContext.board_name
          }
        );
        
        if (followupResult.requires_monday_action && followupResult.graphql_queries?.length > 0) {
          for (const query of followupResult.graphql_queries) {
            await userContext.executeWithUserToken(chatId.toString(), query);
          }
        }
        
        await telegram.sendTelegramMessage(chatId, followupResult.human_response);
        queryCache.clear();
        return;
      }
      
      // Clear cache on write operations
      if (['create', 'update', 'delete'].includes(aiResult.operation_type)) {
        queryCache.clear();
      }
    }
    
    // Send AI response
    await telegram.sendTelegramMessage(chatId, aiResult.human_response);
    
  } catch (error) {
    logger.error('V2 message processing failed', { error: error.message, chatId });
    await telegram.sendTelegramMessage(chatId, 
      "😓 I encountered an error processing your request. Please try again in a moment."
    );
  }
}

// V2 Helper functions
async function handleNewUser(chatId, messageText) {
  // Create user record
  const user = db.createUser({
    telegram_user_id: chatId.toString(),
    telegram_username: null, // Will be updated from message if available
    telegram_first_name: null
  });
  
  // Send welcome message with OAuth link
  const authUrl = `${process.env.BASE_URL}/auth/monday/start/${chatId}`;
  
  await telegram.sendTelegramMessage(chatId,
    "👋 **Welcome to ARIA** — your AI-powered CRM assistant!\n\n" +
    "I help managers interact with their Monday.com boards using natural language right here in Telegram.\n\n" +
    "To get started, I need to connect your Monday.com account. This is a one-time setup that takes about 30 seconds.\n\n" +
    `👆 [Connect Monday.com](${authUrl})\n\n` +
    "Your data stays private — I only access boards you authorize."
  );
  
  db.setOnboardingState(chatId.toString(), 'oauth_pending');
  
  db.logAction({
    telegram_user_id: chatId.toString(),
    action: 'user_registered',
    result_summary: 'New user started onboarding',
    success: 1
  });
}

async function sendAuthLink(chatId) {
  const authUrl = `${process.env.BASE_URL}/auth/monday/start/${chatId}`;
  
  await telegram.sendTelegramMessage(chatId,
    "🔗 **Connect Your Monday.com Account**\n\n" +
    `👆 [Click here to connect](${authUrl})\n\n` +
    "This will open Monday.com where you can authorize ARIA to access your boards."
  );
}

async function handleBoardSelection(chatId, messageText) {
  // Check if this is a board selection response
  if (/^[\d,\s]+$/.test(messageText.trim()) || 
      messageText.toLowerCase().trim() === 'all' ||
      messageText.includes(',')) {
    
    const result = await boardSelector.processSelection(chatId.toString(), messageText);
    
    if (result.success) {
      const boardNames = result.boards.map(b => b.board_name).join(', ');
      await telegram.sendTelegramMessage(chatId,
        `🎉 **You're all set!** Activated boards:\n\n` +
        result.boards.map((b, i) => 
          `${i === 0 ? '✅' : '•'} ${b.board_name}${i === 0 ? ' (default)' : ''}`
        ).join('\n') +
        `\n\n💡 **Try these commands:**\n` +
        `• "show leads" — View items in your default board\n` +
        `• "create lead John Doe" — Add a new item\n` +
        `• "search Acme Corp" — Search across all boards\n` +
        `• "board 2: show tasks" — Query a specific board\n` +
        `• /boards — Manage board access\n` +
        `• /status — Check your connection\n\n` +
        `Ask me anything about your CRM! 💬`
      );
    } else {
      await telegram.sendTelegramMessage(chatId, 
        `❌ ${result.error}\n\nPlease try again or use /boards to see your available boards.`
      );
    }
  } else {
    // Show board selection again
    await boardSelector.presentBoardSelection(chatId.toString());
  }
}

async function handleV2Commands(chatId, messageText, context) {
  const command = messageText.toLowerCase().trim();
  
  switch (command) {
    case '/start':
      await telegram.sendTelegramMessage(chatId,
        `👋 **Welcome back, ${context.user.telegram_first_name || 'there'}!**\n\n` +
        `🏢 Company: ${context.user.company_name}\n` +
        `📋 Connected boards: ${context.boards.length}\n` +
        `🎯 Default board: ${context.defaultBoard?.board_name || 'None set'}\n\n` +
        `💡 **Quick commands:**\n` +
        `• "show leads" — View your CRM data\n` +
        `• "create lead [name]" — Add new items\n` +
        `• /boards — Manage board access\n` +
        `• /status — Connection status\n` +
        `• /help — Full command list`
      );
      break;
      
    case '/boards':
      await boardSelector.presentBoardSelection(chatId.toString());
      break;
      
    case '/status':
      const verification = await oauth.verifyToken(chatId.toString());
      await telegram.sendTelegramMessage(chatId,
        `📊 **ARIA Connection Status**\n\n` +
        `👤 User: ${context.user.telegram_first_name || 'Unknown'}\n` +
        `🏢 Company: ${context.user.company_name || 'Unknown'}\n` +
        `🔗 Monday.com: ${verification.valid ? '✅ Connected' : '❌ Disconnected'}\n` +
        `📋 Active boards: ${context.boards.length}\n` +
        `🎯 Default board: ${context.defaultBoard?.board_name || 'None'}\n` +
        `📅 Last active: ${context.user.last_active_at ? new Date(context.user.last_active_at).toLocaleDateString() : 'Now'}\n\n` +
        `${verification.valid ? '✅ All systems operational' : '⚠️ Reconnection needed - use /disconnect then /start'}`
      );
      break;
      
    case '/disconnect':
      oauth.revokeToken(chatId.toString());
      await telegram.sendTelegramMessage(chatId,
        `🔌 **Disconnected from Monday.com**\n\n` +
        `Your connection has been removed for security.\n\n` +
        `To reconnect, send /start`
      );
      break;
      
    case '/help':
      await telegram.sendTelegramMessage(chatId,
        `📚 **ARIA Command Reference**\n\n` +
        `**📊 Reports:**\n` +
        `• show leads / show items\n` +
        `• show new inquiries\n` +
        `• show qualified leads\n` +
        `• give me a full report\n` +
        `• what happened today\n\n` +
        `**✏️ Actions:**\n` +
        `• create lead [name]\n` +
        `• qualify [name]\n` +
        `• update [name] status [value]\n` +
        `• add note to [name]: [text]\n` +
        `• delete [name]\n\n` +
        `**🔍 Search:**\n` +
        `• search [term]\n` +
        `• find [name]\n` +
        `• find phone [number]\n\n` +
        `**⚙️ System:**\n` +
        `• /boards — Manage board access\n` +
        `• /status — Connection status\n` +
        `• /disconnect — Remove connection\n` +
        `• /clear — Reset conversation\n\n` +
        `**💡 Multi-board:**\n` +
        `• "board 2: show leads"\n` +
        `• "board:sales show items"\n` +
        `• Use board names in your queries`
      );
      break;
      
    case '/clear':
      conversationHistory.length = 0;
      saveConversation(conversationHistory);
      queryCache.clear();
      await telegram.sendTelegramMessage(chatId, '🧹 Conversation history cleared.');
      break;
      
    default:
      await telegram.sendTelegramMessage(chatId, 
        `❓ Unknown command: ${command}\n\nUse /help to see all available commands.`
      );
  }
}

async function sendBoardPicker(chatId, boards) {
  let message = `📋 **Which board?**\n\n`;
  boards.forEach((board, index) => {
    const emoji = board.is_default ? '🎯' : '📋';
    message += `${board.index}. ${emoji} ${board.board_name} (${board.item_count} items)\n`;
  });
  message += `\nReply with a number (e.g., "2") or board name.`;
  
  await telegram.sendTelegramMessage(chatId, message);
}

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

app.post(`/telegram/${CONFIG.telegram.botToken}`, async (req, res) => {
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
    await processMessage(chatId, text);

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
    monday_board      : CONFIG.monday.inquiriesBoard || 'not_configured',
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

  if (!process.env.BASE_URL || process.env.BASE_URL.includes('your-railway-domain')) {
    logger.warn('BASE_URL not configured properly — skipping webhook registration');
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
  
  // Initialize V2 database if in V2 mode
  if (isV2Mode) {
    try {
      await db.initialize();
      logger.info('✅ Database initialized');
      
      // Auto-migrate founder to V2 if needed
      await autoMigrateFounder();
    } catch (error) {
      logger.error('❌ Database initialization failed:', error.message);
      process.exit(1);
    }
  }
  
  await registerTelegramWebhook();
  logger.info(`Ready. ${isV2Mode ? 'Multi-tenant' : 'Single-tenant'} mode active.`);
});

// ============================================================
// V2 AUTO-MIGRATION & SHUTDOWN
// ============================================================

async function autoMigrateFounder() {
  const founderChatId = process.env.TELEGRAM_FOUNDER_CHAT_ID;
  if (!founderChatId) return;
  
  // Check if founder already exists in V2
  const existingUser = db.getUser(founderChatId);
  if (existingUser) return;
  
  logger.info('Auto-migrating founder to V2...');
  
  try {
    // Create founder user
    const user = db.createUser({
      telegram_user_id: founderChatId,
      telegram_username: 'founder',
      telegram_first_name: 'Sourabh'
    });
    
    // Set as admin
    db.updateUser(founderChatId, {
      access_level: 'admin',
      onboarding_state: 'active',
      company_name: 'Denicx Entertainment'
    });
    
    // Migrate V1 token if available
    if (process.env.MONDAY_API_TOKEN && process.env.MONDAY_INQUIRIES_BOARD_ID) {
      const { encrypt } = require('./lib/encryption');
      const encryptedToken = encrypt(process.env.MONDAY_API_TOKEN);
      
      db.storeMondayToken(founderChatId, {
        encrypted: encryptedToken.encrypted,
        iv: encryptedToken.iv,
        tag: encryptedToken.tag,
        monday_user_id: 'migrated_v1',
        monday_account_id: 'migrated_v1',
        company_name: 'Denicx Entertainment'
      });
      
      // Add V1 board access
      db.addBoardAccess(founderChatId, {
        board_id: process.env.MONDAY_INQUIRIES_BOARD_ID,
        board_name: 'Inquiries (V1)',
        board_kind: 'public',
        item_count: 0,
        added_by: founderChatId
      });
      
      db.setDefaultBoard(founderChatId, process.env.MONDAY_INQUIRIES_BOARD_ID);
    }
    
    logger.info('✅ Founder auto-migrated to V2');
  } catch (error) {
    logger.error('❌ Founder auto-migration failed:', error.message);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully...');
  if (isV2Mode && db) {
    await db.close();
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully...');
  if (isV2Mode && db) {
    await db.close();
  }
  process.exit(0);
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
