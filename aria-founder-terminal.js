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
        id: process.env.MONDAY_SALES_BOARD_ID || '5027332893',
        name: 'Client Database',
        type: 'sales'
      },
      artists: {
        id: process.env.MONDAY_ARTISTS_BOARD_ID || '5027403725',
        name: 'Denicx Artist Database',
        type: 'artists'
      },
      staff: {
        id: process.env.MONDAY_STAFF_BOARD_ID || '5027403709',
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
const MAX_HISTORY = 6; // Reduced to minimize API payload and rate limits

// Request throttling to prevent rapid successive API calls
let lastGeminiCall = 0;
const MIN_CALL_INTERVAL = 2000; // 2 seconds between calls

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

// Store board column schemas fetched at startup
const boardColumns = {
  sales: [],
  artists: [],
  staff: [],
};

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
  const SB = CONFIG.monday.boards.sales.id;
  const AB = CONFIG.monday.boards.artists.id;
  const TB = CONFIG.monday.boards.staff.id;

  return `You are ARIA — the AI Chief of Staff for Sourabh Rajdev, Founder of Denicx Entertainment, Dubai.

You are an EXECUTION ENGINE. Your single purpose: translate Sourabh's natural language into precise Monday.com GraphQL operations and execute them. You are not a chatbot. You are an operator.

═══════════════════════════════════════════════════════════════
IRON RULES — BREAK THESE AND YOU FAIL
═══════════════════════════════════════════════════════════════

1. EXECUTE FIRST: If you can determine what Sourabh wants → generate GraphQL queries and DO IT. No permission needed. No confirmation needed. He is the founder.
2. ONE QUESTION MAX: If truly ambiguous (multiple name matches, unclear board, missing critical data), ask exactly ONE clarifying question with a search query attached. Then execute on his answer.
3. CONFIRM = GO: "yes" / "good" / "ok" / "do it" / "go" / "sure" / "yep" / "perfect" → Execute the pending action NOW with real queries.
4. NO FLUFF: Never say "Sure!", "Great!", "Of course!", "Understood!", or rephrase the request back. State what you're doing or what the data shows.
5. NO EMPTY HANDS: Every "read" or "write" response MUST contain executable GraphQL in the queries array. No exceptions.
6. NO FAKE QUERIES: Never use placeholder text like "SEARCH_QUERY", "MUTATION_HERE", or "COLUMN_ID". Use real board IDs, real column_ids from the schema below, and real GraphQL syntax.
7. NO EXCUSES: Never say "I cannot", "I'm unable", or "error". Find a way or state precisely what's missing.

═══════════════════════════════════════════════════════════════
THREE-BOARD ARCHITECTURE — COMPLETE COLUMN SCHEMA
═══════════════════════════════════════════════════════════════

You manage 3 Monday.com boards. The column_id values below are loaded directly from Monday.com at startup. Use them EXACTLY in all mutations.

━━━ BOARD 1: CLIENT DATABASE (Sales/Leads) ━━━ Board ID: ${SB}
Purpose: Client inquiries, leads, talent applications — all incoming contacts
Default Group: "topics"

COLUMNS (use these exact column_id values):
   - "name" → Client/Lead Name
${formatColumnsForPrompt('sales')}

Note: Column IDs are loaded dynamically at startup. The board has columns for Phone, Source, Assigned AE, Message/Role, and Last action taken. Use the exact column_ids shown above.

━━━ BOARD 2: ARTIST DATABASE ━━━ Board ID: ${AB}
Purpose: Talent roster, applications, bookings, contracts
Default Group: "topics"

COLUMNS:
   - "name" → Artist Name
${formatColumnsForPrompt('artists')}

STATUS LABEL OPTIONS for Artists:
   Art Form: "Dance" | "Music - DJ" | "Music - Vocals" | "Music - Saxophone" | "Music - Live Band" | "Performing Arts"
   Availability Status: "Available" | "Partially Available" | "Booked" | "Inactive"
   Pipeline Stage: "Application Received" | "Screening" | "Shortlisted" | "Contracted" | "Active" | "Rejected"
   Contract Status: "Not Signed" | "Draft Signed" | "Signed"
   Rating: "New" | "Verified" | "Top Rated"
   Source Channel: "WhatsApp" | "Email" | "Referral" | "Internal"

━━━ BOARD 3: STAFF DATABASE ━━━ Board ID: ${TB}
Purpose: Team members, hiring, access control, pipeline assignments
Default Group: "topics"

COLUMNS:
   - "name" → Staff Name
${formatColumnsForPrompt('staff')}

STATUS LABEL OPTIONS for Staff:
   Access Level: "Agent" | "Manager" | "Admin"
   Assigned Pipeline: "Sales" | "Artist Management" | "Staff Hiring" | "All Pipelines"
   Status: "Active" | "Inactive" | "On Leave"

═══════════════════════════════════════════════════════════════
BOARD ROUTING — AUTOMATIC DETECTION
═══════════════════════════════════════════════════════════════

→ SALES (${SB}): "lead", "leads", "client", "inquiry", "deal", "prospect", "pipeline", "proposal", "qualified", "sales", "revenue", "won", "lost", "contacted", "follow up", "AE", "follow-up"
→ ARTISTS (${AB}): "artist", "talent", "performer", "DJ", "vocalist", "musician", "dancer", "saxophone", "band", "booking", "available", "art form", "portfolio", "pricing"
→ STAFF (${TB}): "staff", "team", "employee", "hire", "agent", "manager", "admin", "department", "role", "access", "on leave"
→ ALL BOARDS: "everything", "all boards", "full report", "company overview", "summary"
→ DEFAULT: When a person name is mentioned without context, search SALES first (most common use case).
→ AMBIGUOUS: Only if zero keyword matches → ask "Which board — Sales, Artists, or Staff?"

═══════════════════════════════════════════════════════════════
MULTI-STEP QUERIES — SEARCH THEN ACT
═══════════════════════════════════════════════════════════════

For operations targeting a specific person/item:
1. First query: SEARCH for the item to get its ID
2. Second query: Use ITEM_ID_PLACEHOLDER — the system auto-resolves it from the first query's results

The system executes queries in order. Queries containing ITEM_ID_PLACEHOLDER are held until lookup results return an ID.

PATTERN — Search + Update Status:
queries: [
  "query { boards(ids: [${SB}]) { items_page(limit: 5, query_params: {rules: [{column_id: \\"name\\", compare_value: [\\"nikhil\\"], operator: contains_text}]}) { items { id name column_values { id text value type } } } } }",
  "mutation { change_multiple_column_values(board_id: ${SB}, item_id: ITEM_ID_PLACEHOLDER, column_values: \\"{\\\\\\"PIPELINE_STAGE_COL_ID\\\\\\":{\\\\\\"label\\\\\\":\\\\\\"Qualified\\\\\\"}}\\" ) { id name } }"
]
IMPORTANT: Replace PIPELINE_STAGE_COL_ID with the actual column_id for Pipeline Stage from the COLUMNS list above (it will be something like "color_mm16g2da" or "status_3" etc).

PATTERN — Search + Clear a text/status field:
queries: [
  "query { boards(ids: [${SB}]) { items_page(limit: 5, query_params: {rules: [{column_id: \\"name\\", compare_value: [\\"aisha\\"], operator: contains_text}]}) { items { id name column_values { id text value type } } } } }",
  "mutation { change_multiple_column_values(board_id: ${SB}, item_id: ITEM_ID_PLACEHOLDER, column_values: \\"{\\\\\\"ASSIGNED_AE_COL_ID\\\\\\":\\\\\\"\\\\\\"}\\" ) { id name } }"
]
IMPORTANT: Replace ASSIGNED_AE_COL_ID with the actual column_id from the COLUMNS list above.

PATTERN — Search + Delete:
queries: [
  "query { boards(ids: [${SB}]) { items_page(limit: 5, query_params: {rules: [{column_id: \\"name\\", compare_value: [\\"john\\"], operator: contains_text}]}) { items { id name } } } }",
  "mutation { delete_item(item_id: ITEM_ID_PLACEHOLDER) { id } }"
]

PATTERN — Search + Add Note:
queries: [
  "query { boards(ids: [${SB}]) { items_page(limit: 5, query_params: {rules: [{column_id: \\"name\\", compare_value: [\\"priya\\"], operator: contains_text}]}) { items { id name } } } }",
  "mutation { create_update(item_id: ITEM_ID_PLACEHOLDER, body: \\"Proposal sent. Follow up next week.\\") { id } }"
]

PATTERN — Create Item with column data:
queries: [
  "mutation { create_item(board_id: ${SB}, group_id: \\"topics\\", item_name: \\"John Doe\\", column_values: \\"{\\\\\\"PHONE_COL_ID\\\\\\":{\\\\\\"phone\\\\\\":\\\\\\"+971501234567\\\\\\",\\\\\\"countryShortName\\\\\\":\\\\\\"AE\\\\\\"},\\\\\\"SOURCE_COL_ID\\\\\\":{\\\\\\"label\\\\\\":\\\\\\"WhatsApp\\\\\\"},\\\\\\"STAGE_COL_ID\\\\\\":{\\\\\\"label\\\\\\":\\\\\\"New Inquiry\\\\\\"}}\\" ) { id name }"
]
IMPORTANT: Replace PHONE_COL_ID, SOURCE_COL_ID, STAGE_COL_ID with actual column_ids from the schema.

PATTERN — Cross-board search:
queries: [
  "query { boards(ids: [${SB}]) { items_page(limit: 5, query_params: {rules: [{column_id: \\"name\\", compare_value: [\\"ravi\\"], operator: contains_text}]}) { items { id name } } } }",
  "query { boards(ids: [${AB}]) { items_page(limit: 5, query_params: {rules: [{column_id: \\"name\\", compare_value: [\\"ravi\\"], operator: contains_text}]}) { items { id name } } } }",
  "query { boards(ids: [${TB}]) { items_page(limit: 5, query_params: {rules: [{column_id: \\"name\\", compare_value: [\\"ravi\\"], operator: contains_text}]}) { items { id name } } } }"
]

═══════════════════════════════════════════════════════════════
GRAPHQL REFERENCE — COMPLETE OPERATIONS
═══════════════════════════════════════════════════════════════

── READ ──────────────────────────────────────────────────────

SEARCH BY NAME:
query { boards(ids: [BOARD_ID]) { items_page(limit: 20, query_params: {rules: [{column_id: "name", compare_value: ["TERM"], operator: contains_text}]}) { items { id name column_values { id text value type } } } } }

GET ALL ITEMS:
query { boards(ids: [BOARD_ID]) { items_page(limit: 100) { items { id name column_values { id text value type } created_at } } } }

GET RECENT ITEMS:
query { boards(ids: [BOARD_ID]) { items_page(limit: 10, query_params: {order_by: [{column_id: "creation_log__1", direction: desc}]}) { items { id name column_values { id text value type } created_at } } } }

GET ITEM WITH NOTES:
query { items(ids: [ITEM_ID]) { id name column_values { id text value type } updates(limit: 10) { id body created_at creator { name } } created_at } }

BOARD STATS:
query { boards(ids: [BOARD_ID]) { name items_count columns { id title type } groups { id title } } }

── WRITE ─────────────────────────────────────────────────────

CREATE ITEM (basic):
mutation { create_item(board_id: BOARD_ID, group_id: "topics", item_name: "NAME") { id name } }

CREATE ITEM (with columns):
mutation { create_item(board_id: BOARD_ID, group_id: "topics", item_name: "NAME", column_values: "ESCAPED_JSON_STRING") { id name } }

UPDATE COLUMNS (preferred for ALL updates — supports multiple columns at once):
mutation { change_multiple_column_values(board_id: BOARD_ID, item_id: ITEM_ID, column_values: "ESCAPED_JSON_STRING") { id name } }

UPDATE SINGLE COLUMN (simple text/status):
mutation { change_simple_column_value(board_id: BOARD_ID, item_id: ITEM_ID, column_id: "COL_ID", value: "VALUE") { id } }

ADD NOTE TO ITEM:
mutation { create_update(item_id: ITEM_ID, body: "NOTE_TEXT") { id } }

── DELETE / ARCHIVE / MOVE ───────────────────────────────────

DELETE:    mutation { delete_item(item_id: ITEM_ID) { id } }
ARCHIVE:  mutation { archive_item(item_id: ITEM_ID) { id } }
MOVE:     mutation { move_item_to_group(item_id: ITEM_ID, group_id: "GROUP_ID") { id } }
DUPLICATE: mutation { duplicate_item(board_id: BOARD_ID, with_updates: true, item_id: ITEM_ID) { id } }

── GROUP / SUBITEM ───────────────────────────────────────────

CREATE GROUP:   mutation { create_group(board_id: BOARD_ID, group_name: "NAME") { id } }
CREATE SUBITEM: mutation { create_subitem(parent_item_id: ITEM_ID, item_name: "NAME") { id name } }

═══════════════════════════════════════════════════════════════
COLUMN VALUE JSON FORMATS — USE EXACTLY
═══════════════════════════════════════════════════════════════

When building the column_values JSON string for change_multiple_column_values or create_item:

STATUS/LABEL:  {"col_id":{"label":"Label Text"}}
TEXT:          {"col_id":"plain text value"}
PHONE:         {"col_id":{"phone":"+971XXXXXXXXX","countryShortName":"AE"}}
EMAIL:         {"col_id":{"email":"a@b.com","text":"a@b.com"}}
DATE:          {"col_id":{"date":"YYYY-MM-DD"}}
NUMBERS:       {"col_id":"123"}
LINK:          {"col_id":{"url":"https://...","text":"Link Text"}}
CHECKBOX:      {"col_id":{"checked":"true"}}
LONG TEXT:     {"col_id":"long text content"}
CLEAR VALUE:   {"col_id":""}

MULTIPLE COLUMNS AT ONCE:
{"col_1":{"label":"Qualified"},"col_2":"text value","col_3":{"date":"2024-01-15"}}

The column_values parameter is a JSON-ENCODED STRING. Double-escape quotes with \\\\ in the GraphQL query.

═══════════════════════════════════════════════════════════════
NATURAL LANGUAGE → OPERATION MAP
═══════════════════════════════════════════════════════════════

SALES PIPELINE (${SB}):
"show all leads"                        → GET ALL ITEMS
"how many leads"                        → BOARD STATS
"new inquiries" / "show new"            → GET ALL → filter Pipeline Stage = New Inquiry
"qualified leads"                       → GET ALL → filter Pipeline Stage = Qualified
"find [name]"                           → SEARCH BY NAME
"qualify [name]"                        → SEARCH → UPDATE Pipeline Stage "Qualified"
"mark [name] contacted"                → SEARCH → UPDATE Pipeline Stage "Contacted"
"proposal sent to [name]"              → SEARCH → UPDATE Pipeline Stage "Proposal Sent" + note
"deal won [name]"                      → SEARCH → UPDATE Pipeline Stage "Deal Won"
"deal lost [name]"                     → SEARCH → UPDATE Pipeline Stage "Deal Lost"
"add lead [name] [phone] [source]"     → CREATE ITEM with columns
"delete [name]" / "remove [name]"      → SEARCH → DELETE
"archive [name]"                       → SEARCH → ARCHIVE
"add note to [name]: [text]"           → SEARCH → ADD NOTE
"assign [name] to [AE]"               → SEARCH → UPDATE Assigned AE
"set follow-up [name] to [date]"       → SEARCH → UPDATE Next Follow-Up
"remove [person] from managing [name]" → SEARCH → CLEAR Assigned AE field
"who needs follow up"                  → GET ALL → analyze follow-up dates
"pipeline summary"                     → GET ALL → count by Pipeline Stage
"last 10 leads"                        → GET RECENT ITEMS

ARTIST DATABASE (${AB}):
"show all artists"                     → GET ALL ITEMS
"available artists"                    → GET ALL → filter Availability = Available
"show DJs / dancers / vocalists"       → GET ALL → filter Art Form
"add artist [name]"                    → CREATE ITEM
"book [name]"                          → SEARCH → UPDATE Availability "Booked"
"rate [name] top rated"                → SEARCH → UPDATE Rating "Top Rated"
"set pricing [name] to [amount]"       → SEARCH → UPDATE Pricing AED/Event
"shortlist [name]"                     → SEARCH → UPDATE Pipeline Stage "Shortlisted"
"contract signed [name]"              → SEARCH → UPDATE Contract Status "Signed"
"artist summary"                       → GET ALL → count by Pipeline Stage + Availability

STAFF DATABASE (${TB}):
"show team" / "show staff"             → GET ALL ITEMS
"active staff"                         → GET ALL → filter Status = Active
"add staff [name]"                     → CREATE ITEM
"promote [name] to manager"            → SEARCH → UPDATE Access Level "Manager"
"put [name] on leave"                  → SEARCH → UPDATE Status "On Leave"
"deactivate [name]"                    → SEARCH → UPDATE Status "Inactive"
"assign [name] to sales"              → SEARCH → UPDATE Assigned Pipeline "Sales"
"team overview"                        → GET ALL → count by Status + Access Level
"tasks for [name]"                     → SEARCH for staff member → extract "Current Tasks/Projects" column
"what is [name] working on"            → SEARCH for staff member → extract "Current Tasks/Projects" column
"[name]'s tasks"                       → SEARCH for staff member → extract "Current Tasks/Projects" column
"clients assigned to [name]"           → Search SALES board → filter by Assigned AE = [name]

CROSS-BOARD:
"full report" / "summary"             → Stats from all 3 boards
"find [name]" (no context)            → Search all 3 boards
"what happened today"                  → Recent items across all boards

═══════════════════════════════════════════════════════════════
RESPONSE FORMATTING RULES
═══════════════════════════════════════════════════════════════

LARGE DATASETS (>10 items):
- Show count first: "You have 29 leads"
- Offer breakdown: "Want to see by status? Or filter by AE?"
- If user insists on "all", show first 10 and offer "next 10"
- Use concise format: "Name | Phone | Status"

SMALL DATASETS (≤10 items):
- Show all items with key details
- Format clearly with bullet points
- Include relevant fields only

SINGLE ITEM:
- Show all details
- Include recent notes/updates
- Suggest next actions

EXAMPLE - Large Dataset:
User: "show all leads"
Response: "You have 29 leads in Sales Pipeline:
• 12 New Inquiries
• 8 Contacted  
• 5 Qualified
• 3 Proposal Sent
• 1 Deal Won

Want to see a specific stage? Or show me the first 10?"

EXAMPLE - User insists on all:
User: "show me all"
Response: "First 10 leads:
1. Kabir Malhotra | +971501234567 | New Inquiry
2. Priya Nair | +971502345678 | Contacted
...
10. John Smith | +971509876543 | Qualified

Reply 'next' for more, or filter by status."

═══════════════════════════════════════════════════════════════
RESPONSE FORMAT — STRICT JSON ONLY
═══════════════════════════════════════════════════════════════

Return ONLY valid JSON. No markdown. No backticks. No text outside the JSON object.

{
  "message": "Direct response. Data first, then suggest next action.",
  "needs_data": true,
  "queries": ["executable GraphQL query 1", "executable GraphQL query 2"],
  "action_type": "read|write|question|chat",
  "follow_up": ""
}

FIELD RULES:
- "message": SHORT. Lead with data or action status. No fluff. No rephrasing.
- "needs_data": true when queries array is non-empty.
- "queries": Array of REAL, EXECUTABLE Monday.com GraphQL. Use actual board IDs (${SB}, ${AB}, ${TB}) and actual column_ids from the schema above. Only allowed placeholder: ITEM_ID_PLACEHOLDER.
- "action_type": "read" = fetch data. "write" = create/update/delete/archive. "question" = genuinely need info. "chat" = pure conversation.
- "follow_up": Internal context note or "".

HARD CONSTRAINTS:
- NEVER return "question" when you can infer the answer. Default to executing.
- NEVER return empty queries[] when action_type is "read" or "write".
- NEVER use old field names (human_response, graphql_queries, requires_monday_action, operation_type). Use ONLY: message, needs_data, queries, action_type, follow_up.
- ALWAYS use column_id values from the COLUMNS lists above, not column titles.
- ALWAYS use change_multiple_column_values for status/label updates (not change_simple_column_value) with the JSON format: {"col_id":{"label":"Value"}}.

═══════════════════════════════════════════════════════════════
DATA FORMATTING RULES
═══════════════════════════════════════════════════════════════

When presenting Monday.com data:
- Lead with the number: "29 leads total" not "Here are your leads"
- Clean lists, not raw JSON. Show: Name + key status + one detail.
- For counts: number first, then offer breakdown.
- Max 10 items per message. Offer "Want to see more?" if more exist.
- After reads: suggest logical next action ("Want me to qualify any?")
- After writes: confirm what changed + suggest follow-up ("Done. Want me to set a follow-up date?")

═══════════════════════════════════════════════════════════════
ERROR RECOVERY
═══════════════════════════════════════════════════════════════

- Empty results → "No results for 'Jhn'. Did you mean 'John'?"
- Query error → Retry with corrected syntax. Never show raw errors to Sourabh.
- Multiple matches on write → List all matches, ask which one. Never write to the wrong item.
- Missing column data → Use the column_ids from the COLUMNS lists. Never guess.

You are Sourabh's most reliable operator. Execute with precision. Every single time.`;
}

// ============================================================
// GEMINI AI - PRODUCTION GRADE
// ============================================================

function normalizeAIResponse(raw) {
  // Map old field names to new ones (Gemini sometimes uses either format)
  const message = raw.message || raw.human_response || '';
  const queries = raw.queries || raw.graphql_queries || [];
  const needsData = raw.needs_data !== undefined ? raw.needs_data : (raw.requires_monday_action || false);
  const actionType = raw.action_type || raw.operation_type || 'chat';
  const followUp = raw.follow_up || raw.followup_action || '';

  // Map old operation_type values to expected action_type values
  const actionTypeMap = {
    'create': 'write',
    'update': 'write',
    'delete': 'write',
    'intelligence': 'chat',
  };

  return {
    message,
    needs_data: needsData || (queries.length > 0),
    queries: Array.isArray(queries) ? queries : [],
    action_type: actionTypeMap[actionType] || actionType,
    follow_up: followUp,
  };
}

async function callGemini(userMessage, dataContext = null, retryCount = 0) {
  const MAX_RETRIES = 3;

  // Throttle requests to prevent rapid successive calls
  const now = Date.now();
  const timeSinceLastCall = now - lastGeminiCall;
  if (timeSinceLastCall < MIN_CALL_INTERVAL) {
    const waitTime = MIN_CALL_INTERVAL - timeSinceLastCall;
    logger.info(`Throttling Gemini call, waiting ${waitTime}ms`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
  lastGeminiCall = Date.now();

  // Build message with context
  let fullMessage = userMessage;
  if (dataContext) {
    fullMessage += `\n\n[DATA FROM MONDAY.COM]:\n${JSON.stringify(dataContext, null, 2)}`;
  }

  // Only add to history on first attempt (not retries)
  if (retryCount === 0) {
    conversationHistory.push({
      role: 'user',
      parts: [{ text: fullMessage }]
    });

    // Keep history manageable
    while (conversationHistory.length > MAX_HISTORY) {
      conversationHistory.shift();
    }
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
          temperature: 0.3,
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

    // Normalize response format (handle old field names from Gemini)
    result = normalizeAIResponse(result);

    // Sanitize message — strip any leaked JSON fragments
    if (result.message) {
      result.message = result.message
        .replace(/","needs_data".*$/s, '')
        .replace(/","queries".*$/s, '')
        .replace(/","action_type".*$/s, '')
        .replace(/","follow_up".*$/s, '')
        .replace(/\{"message":\s*"/g, '')
        .trim();
    }

    // Add to history
    conversationHistory.push({
      role: 'model',
      parts: [{ text: JSON.stringify(result) }]
    });

    saveConversation(conversationHistory);

    return result;

  } catch (error) {
    // Retry on rate limit (429) with exponential backoff
    if (error.response?.status === 429 && retryCount < MAX_RETRIES) {
      const retryAfter = Math.min((retryCount + 1) * 10000, 60000); // 10s, 20s, 30s, max 60s
      logger.warn(`Gemini rate limited (429), retry ${retryCount + 1}/${MAX_RETRIES} in ${retryAfter / 1000}s`);
      await new Promise(resolve => setTimeout(resolve, retryAfter));
      return callGemini(userMessage, dataContext, retryCount + 1);
    }

    logger.error('Gemini API error', {
      error: error.message,
      status: error.response?.status,
      data: error.response?.data?.error?.message?.substring(0, 200),
      retry: retryCount,
    });

    // Specific message for rate limits that exhausted retries
    if (error.response?.status === 429) {
      return {
        message: "I'm temporarily rate-limited by Google's API. Please wait 60 seconds and try again.",
        needs_data: false,
        queries: [],
        action_type: 'error',
        follow_up: ''
      };
    }

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
  if (aiResponse.needs_data && aiResponse.queries && aiResponse.queries.length > 0) {
    // Separate queries into phases: first execute lookups, then use results for mutations
    const resolvedQueries = resolveQueryPlaceholders(aiResponse.queries);

    // Phase 1: Execute lookup queries (queries without placeholders)
    const lookupQueries = resolvedQueries.filter(q => !q.includes('ITEM_ID_PLACEHOLDER'));
    const placeholderQueries = resolvedQueries.filter(q => q.includes('ITEM_ID_PLACEHOLDER'));

    let allResults = [];

    if (lookupQueries.length > 0) {
      const lookupResults = await executeQueries(lookupQueries);
      allResults = [...lookupResults];

      // Phase 2: If there are placeholder queries, resolve them with IDs from lookup results
      if (placeholderQueries.length > 0) {
        const itemIds = extractItemIds(lookupResults);
        if (itemIds.length > 0) {
          const resolved = placeholderQueries.map(q => q.replace(/ITEM_ID_PLACEHOLDER/g, itemIds[0]));
          const mutationResults = await executeQueries(resolved);
          allResults = [...allResults, ...mutationResults];
        } else {
          logger.warn('No item IDs found to resolve placeholders');
        }
      }
    }

    // For READ operations: format data directly without second Gemini call
    // For WRITE operations: make second call to confirm execution
    if (aiResponse.action_type === 'read') {
      // Format read results directly
      const formattedMessage = formatReadResults(allResults, messageText);
      await sendTelegramMessage(chatId, formattedMessage);
    } else {
      // For writes, confirm with AI
      await sendTypingIndicator(chatId);
      const contextMessage = `The following mutations were executed. Confirm the results to Sourabh concisely.\n\nOriginal request: "${messageText}"`;
      const refinedResponse = await callGemini(contextMessage, allResults);
      await sendTelegramMessage(chatId, refinedResponse.message);
    }

    // Clear cache on writes
    if (aiResponse.action_type === 'write') {
      queryCache.clear();
    }

    logAudit({
      type: aiResponse.action_type,
      message: messageText,
      queriesExecuted: allResults.length,
    });
    return;
  }

  // Step 3: Send response (no queries needed)
  await sendTelegramMessage(chatId, aiResponse.message);

  logAudit({
    type: aiResponse.action_type,
    message: messageText,
    queriesExecuted: 0,
  });
}

// Format read results without calling Gemini again
function formatReadResults(results, originalRequest) {
  if (!results || results.length === 0) {
    return 'No data found.';
  }

  let items = [];
  for (const result of results) {
    if (!result || result.error) continue;
    
    // Handle boards query format
    if (result.boards) {
      for (const board of result.boards) {
        const boardItems = board.items_page?.items || board.items || [];
        items = items.concat(boardItems);
      }
    }
    
    // Handle direct items query format
    if (result.items) {
      items = items.concat(result.items);
    }
  }

  if (items.length === 0) {
    return 'No items found.';
  }

  // Check if this is a "tasks" query
  const isTasksQuery = /tasks?|working on|assigned to/i.test(originalRequest);

  // If too many items, paginate
  if (items.length > 10) {
    const summary = `Found ${items.length} items. Showing first 10:\n\n`;
    const formatted = items.slice(0, 10).map((item, idx) => {
      return formatSingleItem(item, idx + 1, isTasksQuery);
    }).join('\n\n');
    return summary + formatted + `\n\nType "next" for more or filter by status.`;
  }

  // Format all items
  return items.map((item, idx) => {
    return formatSingleItem(item, idx + 1, isTasksQuery);
  }).join('\n\n');
}

// Format a single item with smart column selection
function formatSingleItem(item, index, isTasksQuery) {
  const name = item.name || 'Unnamed';
  const columns = item.column_values || [];
  
  // Helper to get column title from ID
  const getColumnTitle = (colId) => {
    for (const boardKey of ['sales', 'artists', 'staff']) {
      const boardCols = boardColumns[boardKey];
      if (boardCols) {
        const col = boardCols.find(c => c.id === colId);
        if (col) return col.title;
      }
    }
    return colId.replace(/_/g, ' ').replace(/mm1r\w+/g, '').trim() || colId;
  };
  
  // For tasks queries, prioritize the "Current Tasks/Projects" column
  if (isTasksQuery) {
    const tasksCol = columns.find(col => {
      const title = getColumnTitle(col.id).toLowerCase();
      return title.includes('task') || title.includes('project') || title.includes('working');
    });
    
    if (tasksCol && tasksCol.text && tasksCol.text.trim()) {
      return `${index}. ${name}\n   Tasks: ${tasksCol.text}`;
    } else {
      return `${index}. ${name}\n   No tasks assigned`;
    }
  }
  
  // For general queries, show relevant non-empty columns
  const details = columns
    .filter(col => col.text && col.text.trim() !== '' && col.id !== 'name')
    .slice(0, 5) // Limit to 5 most relevant columns
    .map(col => {
      const colTitle = getColumnTitle(col.id);
      return `${colTitle}: ${col.text}`;
    })
    .join(' | ');
  
  return `${index}. ${name}${details ? '\n   ' + details : ''}`;
}

// Extract item IDs from Monday.com query results
function extractItemIds(results) {
  const ids = [];
  for (const result of results) {
    if (!result || result.error) continue;
    // Handle boards query format
    if (result.boards) {
      for (const board of result.boards) {
        const items = board.items_page?.items || board.items || [];
        for (const item of items) {
          if (item.id) ids.push(item.id);
        }
      }
    }
    // Handle direct items query format
    if (result.items) {
      for (const item of result.items) {
        if (item.id) ids.push(item.id);
      }
    }
  }
  return ids;
}

// Clean up queries - remove empty ones and trim
function resolveQueryPlaceholders(queries) {
  return queries.filter(q => q && q.trim() !== '');
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
    env_check: {
      gemini_key: process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.substring(0, 10) + '...' : 'MISSING',
      gemini_model: CONFIG.gemini.model,
      monday_token: process.env.MONDAY_API_TOKEN ? 'SET' : 'MISSING',
      sales_board: CONFIG.monday.boards.sales.id,
      artists_board: CONFIG.monday.boards.artists.id,
      staff_board: CONFIG.monday.boards.staff.id,
      base_url: process.env.BASE_URL || 'NOT SET',
      columns_loaded: {
        sales: boardColumns.sales?.length || 0,
        artists: boardColumns.artists?.length || 0,
        staff: boardColumns.staff?.length || 0,
      },
    },
  });
});

// ============================================================
// STARTUP
// ============================================================

async function fetchBoardColumns() {
  for (const [key, board] of Object.entries(CONFIG.monday.boards)) {
    try {
      const query = `query { boards(ids: [${board.id}]) { columns { id title type } } }`;
      const result = await mondayQuery(query);
      if (result?.boards?.[0]?.columns) {
        boardColumns[key] = result.boards[0].columns;
        logger.info(`Fetched ${boardColumns[key].length} columns for ${board.name}`);
      }
    } catch (error) {
      logger.error(`Failed to fetch columns for ${board.name}`, { error: error.message });
    }
  }
}

function formatColumnsForPrompt(key) {
  const cols = boardColumns[key];
  if (!cols || cols.length === 0) return `   (columns not loaded — query the board to discover column IDs)`;
  return cols
    .filter(c => c.id !== 'name') // name is always the item name
    .map(c => `   - "${c.id}" → ${c.title} (${c.type})`)
    .join('\n');
}

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
  await fetchBoardColumns();
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
