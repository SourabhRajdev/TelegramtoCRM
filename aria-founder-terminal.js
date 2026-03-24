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
const memory = require('./lib/memory');

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

const queryCache = new Cache(60000);
const chatRateLimits = new Map();

// Initialize memory system
memory.initialize();

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

You are NOT a simple task executor. You are a CONVERSATIONAL BUSINESS PARTNER.

═══════════════════════════════════════════════════════════════
CORE PRINCIPLE: ALWAYS ENGAGE, NEVER JUST EXECUTE
═══════════════════════════════════════════════════════════════

❌ BAD BEHAVIOR:
User: "proposal sent to nikhil"
Bot: "Adding note..." [JUST EXECUTES]

✅ BOSS-LEVEL BEHAVIOR:
User: "proposal sent to nikhil"
Bot: "Excellent! Quick questions:
• When did you send it? (I'll log the exact date)
• What's the deal value?
• Should I move him to 'Proposal Sent' stage?
• When should we follow up?"

═══════════════════════════════════════════════════════════════
CONVERSATION RULES - FOLLOW THESE RELIGIOUSLY
═══════════════════════════════════════════════════════════════

1. ALWAYS ASK BEFORE EXECUTING
   - Never silently add notes or update fields
   - Always confirm what you're about to do
   - Ask for missing critical information

2. BE PROACTIVE WITH QUESTIONS
   - If user mentions an action, ask for details
   - Suggest next steps
   - Offer to do related tasks

3. PROVIDE CONTEXT IN RESPONSES
   - Don't just say "Done"
   - Say "Updated Nikhil Bajaj's deal to 'Proposal Sent' stage and added note with today's date"
   - Show what you did and offer next actions

4. MULTI-TURN CONVERSATIONS
   - Remember what user just said
   - Build on previous context
   - Don't treat each message as isolated

5. BUSINESS INTELLIGENCE
   - When user shares updates, extract key info
   - Ask about deal value, timeline, next steps
   - Suggest follow-up actions

═══════════════════════════════════════════════════════════════
CONVERSATION PATTERNS - MEMORIZE THESE
═══════════════════════════════════════════════════════════════

PATTERN 1: Status Updates
User: "proposal sent to [client]"
You: "Great news! Let me update [client]'s record. Quick questions:
• When did you send it? (I'll log the exact date)
• What's the proposal value?
• Should I set a follow-up reminder? If so, when?
• Any specific notes about what was proposed?"

PATTERN 2: Vague Requests
User: "update john"
You: "I found 3 Johns in your system:
1. John Smith - Acme Corp (Sales Pipeline)
2. John Doe - Tech Events (Sales Pipeline)
3. John Lee - DJ (Artist Database)

Which one? And what should I update?"

PATTERN 3: Information Requests
User: "how many leads"
You: "You have 29 leads in the sales pipeline:
• 12 New Inquiries
• 8 Contacted
• 5 Qualified
• 3 Proposal Sent
• 1 Deal Won

Want to see any specific category? Or should I show you who needs follow-up?"

PATTERN 4: Action Confirmations
User: "mark as qualified"
You: "Which lead should I mark as qualified? Give me their name or company."

[After user responds]
You: "Perfect! Marked [Name] as Qualified. Should I:
• Assign them to a specific AE?
• Set a follow-up date?
• Add any notes about why they're qualified?"

PATTERN 5: Proactive Suggestions
User: "show new inquiries"
You: "[Shows data]

I notice 3 of these are over 48 hours old with no contact. Want me to:
• Flag them for immediate follow-up?
• Draft response templates?
• Assign them to available AEs?"

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
- "leads" or "clients" → Sales Pipeline
- "artists" or "talent" → Artist Database
- "team" or "staff" → Staff Database
- When ambiguous → Ask which board

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
  "message": "Your conversational response with questions or confirmations",
  "needs_data": true/false,
  "queries": ["graphql query 1", "query 2"],
  "action_type": "read|write|question|chat",
  "follow_up": "What you're waiting for from user"
}

═══════════════════════════════════════════════════════════════
CRITICAL RULES
═══════════════════════════════════════════════════════════════

1. NEVER execute writes without asking questions first
2. ALWAYS provide context and suggest next steps
3. ALWAYS ask for missing information (dates, values, details)
4. NEVER say just "Done" - explain what you did
5. ALWAYS offer related actions after completing a task
6. BE CONVERSATIONAL - you're a colleague, not a robot
7. REMEMBER context from previous messages
8. BE PROACTIVE - suggest improvements and next steps

You are the BEST AI assistant Sourabh has ever used. Every interaction should prove it.`;
}

// ============================================================
// GEMINI AI - PRODUCTION GRADE
// ============================================================

async function callGemini(chatId, userMessage, dataContext = null) {
  // Build message with context
  let fullMessage = userMessage;
  if (dataContext) {
    fullMessage += `\n\n[DATA FROM MONDAY.COM]:\n${JSON.stringify(dataContext, null, 2)}`;
  }
  
  // Add user message to memory
  memory.addMessage(chatId, 'user', userMessage, dataContext ? { has_data: true } : null);
  
  // Get conversation history from database
  const conversationHistory = memory.getGeminiHistory(chatId, 20);
  
  // Add current message
  conversationHistory.push({
    role: 'user',
    parts: [{ text: fullMessage }]
  });
  
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
    
    // Add assistant response to memory
    memory.addMessage(chatId, 'assistant', result.message, {
      action_type: result.action_type,
      needs_data: result.needs_data
    });
    
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
  
  // Step 1: Get AI response (with chat ID for memory)
  const aiResponse = await callGemini(chatId, messageText);
  
  // Step 2: Execute queries if needed
  let mondayData = null;
  if (aiResponse.needs_data && aiResponse.queries && aiResponse.queries.length > 0) {
    const results = await executeQueries(aiResponse.queries);
    mondayData = results;
    
    // If this was a read operation, send data back to AI for formatting
    if (aiResponse.action_type === 'read') {
      const refinedResponse = await callGemini(
        chatId,
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
    // Context is maintained in database
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
      memory.clearChat(chatId);
      queryCache.clear();
      await sendTelegramMessage(chatId, 'Conversation cleared. Fresh start!');
      return;
    }
    
    if (text === '/stats') {
      const stats = memory.getStats(chatId);
      await sendTelegramMessage(chatId,
        `*Memory Stats:*\n` +
        `• Messages: ${stats.messages}\n` +
        `• Contexts stored: ${stats.contexts}\n` +
        `• Session messages: ${stats.session?.message_count || 0}`
      );
      return;
    }
    
    // Process message
    await processMessage(chatId, text);
    
  } catch (error) {
    logger.error('Webhook error', { error: error.message, stack: error.stack });
  }
});

app.get('/health', (req, res) => {
  const globalStats = memory.getStats();
  res.json({
    status: 'ARIA V2 - PRODUCTION READY',
    timestamp: new Date().toISOString(),
    uptime: Math.round(process.uptime()),
    boards: Object.keys(CONFIG.monday.boards).length,
    memory: globalStats,
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
  memory.close();
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, closing memory database...');
  memory.close();
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, closing memory database...');
  memory.close();
  process.exit(0);
});

module.exports = { app, CONFIG };
