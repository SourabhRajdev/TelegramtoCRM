/**
 * ============================================================
 * ARIA FOUNDER TERMINAL V2 - PRODUCTION GRADE
 * Denicx Entertainment — Dubai
 * ============================================================
 * 
 * Meta/Google-grade conversational AI for CRM management
 * - Multi-board intelligence (Sales, Artists, Staff)
 * - Contextual conversations with follow-up questions
 * - Zero errors, production reliability
 * - Natural language understanding
 * 
 * ============================================================
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const axios = require('axios');
const helmet = require('helmet');

const logger = require('./lib/logger');
const { sanitizeQueries } = require('./lib/sanitize');
const Cache = require('./lib/cache');
const { logAudit } = require('./lib/audit');

const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use(helmet());

// ============================================================
// CONFIGURATION
// ============================================================

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const CONFIG = {
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    founderChatId: process.env.TELEGRAM_FOUNDER_CHAT_ID,
    apiBase: 'https://api.telegram.org',
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY,
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    apiBase: 'https://generativelanguage.googleapis.com/v1beta',
  },
  monday: {
    apiToken: process.env.MONDAY_API_TOKEN,
    apiBase: 'https://api.monday.com/v2',
    boards: {
      sales: {
        id: '5027403736',
        name: 'Denicx Sales Pipeline',
        type: 'sales'
      },
      artists: {
        id: '5027403725',
        name: 'Denicx Artist Database',
        type: 'artists'
      },
      staff: {
        id: '5027403709',
        name: 'Denicx Staff Database',
        type: 'staff'
      }
    }
  },
};

// ============================================================
// CONVERSATION MANAGEMENT
// ============================================================

const CONVERSATION_FILE = path.join(DATA_DIR, 'conversation.json');
const MAX_HISTORY = 20; // Increased for better context

function loadConversation() {
  try {
    if (fs.existsSync(CONVERSATION_FILE)) {
      const data = fs.readFileSync(CONVERSATION_FILE, 'utf-8');
      return JSON.parse(data) || [];
    }
  } catch (err) {
    logger.warn('Failed to load conversation', { error: err.message });
  }
  return [];
}

function saveConversation(history) {
  try {
    fs.writeFileSync(CONVERSATION_FILE, JSON.stringify(history, null, 2));
  } catch (err) {
    logger.error('Failed to save conversation', { error: err.message });
  }
}

const conversationHistory = loadConversation();
const queryCache = new Cache(60000);
const chatRateLimits = new Map();

function checkChatRateLimit(chatId) {
  const now = Date.now();
  const key = chatId.toString();
  
  if (!chatRateLimits.has(key)) {
    chatRateLimits.set(key, { count: 1, windowStart: now });
    return true;
  }
  
  const entry = chatRateLimits.get(key);
  if (now - entry.windowStart > 60000) {
    chatRateLimits.set(key, { count: 1, windowStart: now });
    return true;
  }
  
  entry.count++;
  return entry.count <= 30;
}

// ============================================================
// PRODUCTION-GRADE SYSTEM PROMPT
// ============================================================

function buildSystemPrompt() {
  return `You are ARIA, the elite AI Chief of Staff for Sourabh Rajdev, Founder of Denicx Entertainment in Dubai.

You are NOT a typical chatbot. You are a Meta/Google-grade conversational AI with:
- Deep business context understanding
- Proactive intelligence
- Natural conversation flow
- Zero tolerance for errors

═══════════════════════════════════════════════════════════════
YOUR PERSONALITY & COMMUNICATION STYLE
═══════════════════════════════════════════════════════════════

✓ CONVERSATIONAL: You engage in natural back-and-forth dialogue
✓ PROACTIVE: Ask clarifying questions when needed
✓ INTELLIGENT: Understand context, intent, and business logic
✓ PRECISE: Give exact data, not vague responses
✓ PROFESSIONAL: Sharp, direct, founder-level communication
✗ NEVER say "I cannot" or "error" - always find a solution
✗ NEVER execute blindly - ask for missing information
✗ NEVER give generic responses - be specific with data

═══════════════════════════════════════════════════════════════
MULTI-BOARD SYSTEM
═══════════════════════════════════════════════════════════════

You manage 3 Monday.com boards:

1. SALES PIPELINE (ID: 5027403736)
   - Client inquiries and deals
   - Pipeline stages: New Inquiry → Contacted → Qualified → Proposal Sent → Deal Won/Lost
   - Key fields: Phone, Email, Source Channel, Pipeline Stage, AI Intent, Assigned AE

2. ARTIST DATABASE (ID: 5027403725)
   - Talent roster and applications
   - Art forms: Dance, Music (DJ/Vocals/Saxophone/Live Band), Performing Arts
   - Key fields: Phone, Email, Art Form, Availability Status, Pipeline Stage, Rating

3. STAFF DATABASE (ID: 5027403709)
   - Team members and hiring
   - Roles: Agent, Manager, Admin
   - Key fields: Phone, Email, Role, Access Level, Department, Status

BOARD INTELLIGENCE:
- When Sourabh says "leads" → Sales Pipeline
- When he says "artists" or "talent" → Artist Database
- When he says "team" or "staff" → Staff Database
- When ambiguous → Ask which board he means
- You can query multiple boards in one response

═══════════════════════════════════════════════════════════════
CONVERSATIONAL INTELLIGENCE
═══════════════════════════════════════════════════════════════

SCENARIO: "Update that proposal was sent to the client"
❌ BAD: Just add a note silently
✓ GOOD: "Which client? Can you give me their name or the deal you're referring to?"

SCENARIO: "How many leads?"
❌ BAD: Return a number
✓ GOOD: "You have 29 leads in the sales pipeline. Want to see them broken down by stage?"

SCENARIO: "Mark as qualified"
❌ BAD: Error or guess
✓ GOOD: "Which lead should I mark as qualified? Give me their name."

SCENARIO: "Show artists"
✓ GOOD: "Here are your artists... [data]. Want to filter by art form or availability?"

═══════════════════════════════════════════════════════════════
GRAPHQL OPERATIONS
═══════════════════════════════════════════════════════════════

UNIVERSAL QUERIES (work on any board):

GET ALL ITEMS:
query { boards(ids: [BOARD_ID]) { items_page(limit: 100) { items { id name column_values { id text title value } created_at } } } }

SEARCH BY NAME:
query { boards(ids: [BOARD_ID]) { items_page(limit: 20, query_params: {rules: [{column_id: "name", compare_value: ["SEARCH_TERM"], operator: contains_text}]}) { items { id name column_values { id text title value } } } } }

GET SINGLE ITEM WITH UPDATES:
query { items(ids: [ITEM_ID]) { id name board { id name } column_values { id text title value } updates(limit: 10) { id body created_at creator { name } } created_at } }

CREATE ITEM:
mutation { create_item(board_id: BOARD_ID, group_id: "topics", item_name: "ITEM_NAME") { id name } }

UPDATE COLUMN:
mutation { change_column_value(board_id: BOARD_ID, item_id: ITEM_ID, column_id: "COLUMN_ID", value: "VALUE") { id } }

ADD NOTE/UPDATE:
mutation { create_update(item_id: ITEM_ID, body: "NOTE_TEXT") { id } }

GET BOARD STATS:
query { boards(ids: [BOARD_ID]) { name items_count columns { id title type } } }

═══════════════════════════════════════════════════════════════
RESPONSE FORMAT
═══════════════════════════════════════════════════════════════

Return ONLY valid JSON (no markdown, no backticks):

{
  "message": "Your conversational response to Sourabh",
  "needs_data": true/false,
  "queries": ["graphql query 1", "query 2"],
  "action_type": "read|write|question|chat",
  "follow_up": "Optional follow-up question or next action"
}

EXAMPLES:

User: "how many leads"
{
  "message": "Let me check your sales pipeline...",
  "needs_data": true,
  "queries": ["query { boards(ids: [5027403736]) { items_count } }"],
  "action_type": "read",
  "follow_up": ""
}

User: "mark john as qualified"
{
  "message": "I found 3 people named John in your sales pipeline. Which one? (John Smith - Acme Corp, John Doe - Tech Inc, John Lee - Events Co)",
  "needs_data": true,
  "queries": ["query { boards(ids: [5027403736]) { items_page(query_params: {rules: [{column_id: \\"name\\", compare_value: [\\"john\\"], operator: contains_text}]}) { items { id name column_values { id text } } } } }"],
  "action_type": "question",
  "follow_up": "waiting for user to specify which John"
}

User: "proposal sent to acme corp"
{
  "message": "When did you send the proposal? I'll update the deal and add a note.",
  "needs_data": false,
  "queries": [],
  "action_type": "question",
  "follow_up": "waiting for date/time"
}

═══════════════════════════════════════════════════════════════
CRITICAL RULES
═══════════════════════════════════════════════════════════════

1. ALWAYS ask for clarification when information is ambiguous
2. NEVER execute destructive actions without confirmation
3. ALWAYS provide context with your responses (counts, names, details)
4. NEVER say "error" - handle gracefully and ask for help
5. ALWAYS be conversational - you're a colleague, not a robot
6. When showing data, format it clearly and offer next steps
7. Remember conversation context - reference previous messages
8. Be proactive - suggest actions based on data patterns

You are the best AI assistant Sourabh has ever used. Act like it.`;
}

// ============================================================
// GEMINI AI - PRODUCTION GRADE
// ============================================================

async function callGemini(userMessage, dataContext = null) {
  // Build message with context
  let fullMessage = userMessage;
  if (dataContext) {
    fullMessage += `\n\n[DATA FROM MONDAY.COM]:\n${JSON.stringify(dataContext, null, 2)}`;
  }
  
  // Add to history
  conversationHistory.push({
    role: 'user',
    parts: [{ text: fullMessage }]
  });
  
  // Keep history manageable
  while (conversationHistory.length > MAX_HISTORY) {
    conversationHistory.shift();
  }
  
  try {
    const response = await axios.post(
      `${CONFIG.gemini.apiBase}/models/${CONFIG.gemini.model}:generateContent?key=${CONFIG.gemini.apiKey}`,
      {
        system_instruction: {
          parts: [{ text: buildSystemPrompt() }]
        },
        contents: conversationHistory,
        generationConfig: {
          temperature: 0.7, // More creative for conversation
          topP: 0.95,
          topK: 40,
          maxOutputTokens: 2048,
        }
      },
      { timeout: 30000 }
    );
    
    const text = response.data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!text) {
      throw new Error('No response from Gemini');
    }
    
    // Parse JSON response
    let result;
    try {
      // Remove markdown code blocks if present
      const cleanText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      result = JSON.parse(cleanText);
    } catch (parseError) {
      logger.error('JSON parse failed', { text, error: parseError.message });
      // Fallback response
      result = {
        message: text.substring(0, 500),
        needs_data: false,
        queries: [],
        action_type: 'chat',
        follow_up: ''
      };
    }
    
    // Add to history
    conversationHistory.push({
      role: 'model',
      parts: [{ text: JSON.stringify(result) }]
    });
    
    saveConversation(conversationHistory);
    
    return result;
    
  } catch (error) {
    logger.error('Gemini API error', { error: error.message, response: error.response?.data });
    
    // Production-grade error handling
    return {
      message: "I'm having trouble processing that right now. Can you rephrase or try again?",
      needs_data: false,
      queries: [],
      action_type: 'error',
      follow_up: ''
    };
  }
}

// ============================================================
// MONDAY.COM - RELIABLE EXECUTION
// ============================================================

async function mondayQuery(query) {
  try {
    const response = await axios.post(
      CONFIG.monday.apiBase,
      { query },
      {
        headers: {
          'Authorization': CONFIG.monday.apiToken,
          'Content-Type': 'application/json',
          'API-Version': '2024-01',
        },
        timeout: 20000,
      }
    );
    
    if (response.data.errors) {
      logger.error('Monday.com errors', { errors: response.data.errors });
      return { error: response.data.errors[0]?.message || 'API error' };
    }
    
    return response.data.data;
    
  } catch (error) {
    if (error.response?.status === 429) {
      logger.warn('Rate limited, retrying...');
      await new Promise(resolve => setTimeout(resolve, 5000));
      return mondayQuery(query);
    }
    
    logger.error('Monday.com error', { error: error.message });
    return { error: error.message };
  }
}

async function executeQueries(queries) {
  if (!queries || queries.length === 0) return [];
  
  const results = [];
  
  for (const query of queries) {
    if (!query || query.trim() === '') continue;
    
    logger.info('Executing query', { query: query.substring(0, 100) });
    const result = await mondayQuery(query);
    results.push(result);
    
    // Small delay between queries
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  
  return results;
}

// ============================================================
// TELEGRAM
// ============================================================

async function sendTelegramMessage(chatId, text) {
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
          chat_id: chatId,
          text: chunk,
          parse_mode: 'Markdown',
        }
      );
    } catch (err) {
      // Retry without parse mode
      await axios.post(
        `${CONFIG.telegram.apiBase}/bot${CONFIG.telegram.botToken}/sendMessage`,
        { chat_id: chatId, text: chunk }
      );
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
    // Ignore
  }
}

// ============================================================
// MAIN MESSAGE PROCESSOR
// ============================================================

async function processMessage(chatId, messageText) {
  logger.info('Message received', { chatId, message: messageText });
  
  // Security check
  if (CONFIG.telegram.founderChatId && chatId.toString() !== CONFIG.telegram.founderChatId.toString()) {
    logger.warn('Unauthorized access', { chatId });
    await sendTelegramMessage(chatId, 'Unauthorized access.');
    return;
  }
  
  // Rate limit
  if (!checkChatRateLimit(chatId)) {
    await sendTelegramMessage(chatId, 'Too many requests. Please wait a moment.');
    return;
  }
  
  // Show typing
  await sendTypingIndicator(chatId);
  
  // Step 1: Get AI response
  const aiResponse = await callGemini(messageText);
  
  // Step 2: Execute queries if needed
  let mondayData = null;
  if (aiResponse.needs_data && aiResponse.queries && aiResponse.queries.length > 0) {
    const results = await executeQueries(aiResponse.queries);
    mondayData = results;
    
    // If this was a read operation, send data back to AI for formatting
    if (aiResponse.action_type === 'read') {
      const refinedResponse = await callGemini(
        'Format this data clearly for Sourabh',
        mondayData
      );
      await sendTelegramMessage(chatId, refinedResponse.message);
      return;
    }
  }
  
  // Step 3: Send response
  await sendTelegramMessage(chatId, aiResponse.message);
  
  // Step 4: Handle follow-up if needed
  if (aiResponse.follow_up && aiResponse.follow_up.trim() !== '') {
    // Context is maintained in conversation history
    logger.info('Follow-up pending', { follow_up: aiResponse.follow_up });
  }
  
  // Clear cache on writes
  if (aiResponse.action_type === 'write') {
    queryCache.clear();
  }
  
  logAudit({
    type: aiResponse.action_type,
    message: messageText,
    queriesExecuted: aiResponse.queries?.length || 0,
  });
}

// ============================================================
// WEBHOOK & ROUTES
// ============================================================

app.post(`/telegram/${CONFIG.telegram.botToken}`, async (req, res) => {
  res.sendStatus(200);
  
  try {
    const update = req.body;
    const message = update?.message || update?.edited_message;
    
    if (!message) return;
    
    const chatId = message.chat?.id;
    const text = message.text;
    
    if (!chatId || !text) return;
    
    // Commands
    if (text === '/start') {
      await sendTelegramMessage(chatId,
        `*ARIA V2 - PRODUCTION READY* 🚀\n\n` +
        `Your elite AI Chief of Staff for Denicx Entertainment.\n\n` +
        `*Connected Boards:*\n` +
        `• Sales Pipeline (29 leads)\n` +
        `• Artist Database (talent roster)\n` +
        `• Staff Database (team management)\n\n` +
        `*Try asking:*\n` +
        `• "How many leads do we have?"\n` +
        `• "Show me available artists"\n` +
        `• "Mark John Smith as qualified"\n` +
        `• "Add note: proposal sent today"\n\n` +
        `I'll ask clarifying questions when needed. Let's work!`
      );
      return;
    }
    
    if (text === '/clear') {
      conversationHistory.length = 0;
      saveConversation(conversationHistory);
      queryCache.clear();
      await sendTelegramMessage(chatId, 'Conversation cleared. Fresh start!');
      return;
    }
    
    // Process message
    await processMessage(chatId, text);
    
  } catch (error) {
    logger.error('Webhook error', { error: error.message, stack: error.stack });
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ARIA V2 - PRODUCTION READY',
    timestamp: new Date().toISOString(),
    uptime: Math.round(process.uptime()),
    boards: Object.keys(CONFIG.monday.boards).length,
    conversations: conversationHistory.length,
  });
});

// ============================================================
// STARTUP
// ============================================================

async function registerWebhook() {
  if (!CONFIG.telegram.botToken || !process.env.BASE_URL) {
    logger.warn('Skipping webhook registration');
    return;
  }
  
  const webhookUrl = `${process.env.BASE_URL}/telegram/${CONFIG.telegram.botToken}`;
  
  try {
    await axios.post(
      `${CONFIG.telegram.apiBase}/bot${CONFIG.telegram.botToken}/setWebhook`,
      { url: webhookUrl, drop_pending_updates: true }
    );
    logger.info('Webhook registered', { url: webhookUrl });
  } catch (error) {
    logger.error('Webhook registration failed', { error: error.message });
  }
}

const PORT = process.env.PORT || 3001;

app.listen(PORT, async () => {
  logger.info('═══════════════════════════════════════════════');
  logger.info('  ARIA V2 - PRODUCTION GRADE');
  logger.info('  Denicx Entertainment CRM');
  logger.info(`  Port: ${PORT}`);
  logger.info('═══════════════════════════════════════════════');
  await registerWebhook();
  logger.info('Ready for production. 🚀');
});

// Error handling
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason: String(reason) });
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  process.exit(1);
});

module.exports = { app, CONFIG };
