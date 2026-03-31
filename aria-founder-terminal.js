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
const { initChain, callAriaChain, clearChatMemory } = require('./lib/aria-chain');
const { generateOperationId, isOperationExecuted, markOperationExecuted } = require('./lib/operation-tracker');
const { buildColumnMappings, translateColumnValues } = require('./lib/column-mapper');

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
    allowedChatIds: (process.env.TELEGRAM_ALLOWED_CHAT_IDS || process.env.TELEGRAM_FOUNDER_CHAT_ID || '').split(',').map(id => id.trim()).filter(Boolean),
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

const chatRateLimits = new Map();

// Store board column schemas and groups fetched at startup
const boardColumns = {
  sales: [],
  artists: [],
  staff: [],
};

const boardGroups = {
  sales: 'topics',
  artists: 'topics',
  staff: 'topics',
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

  return `You are ARIA — AI Chief of Staff for Sourabh Rajdev, Founder of Denicx Entertainment.

You are a QUERY GENERATOR ONLY. You do NOT format data. You do NOT present results. You ONLY generate GraphQL queries.

═══════════════════════════════════════════════════════════════
NUCLEAR RULES — VIOLATE THESE AND THE SYSTEM BREAKS
═══════════════════════════════════════════════════════════════

██ RULE 0: YOU ARE BLIND TO DATA ██
You NEVER see Monday.com results. You ONLY generate queries. The system formats results after you respond.

For READ operations:
- Set needs_data: true
- Generate queries[]
- Set message: "" (EMPTY STRING)
- The system will format and send the data

For WRITE operations:
- Set needs_data: true  
- Generate queries[]
- Set message: "Executing..." (3 words max)
- The system will confirm after execution

██ FORBIDDEN RESPONSES ██
NEVER EVER write these in your message field:
❌ "Found 20 items. Showing first 10:"
❌ "1. Priya Nair | Phone: +971..."
❌ "Here are the results:"
❌ "No items found"
❌ Any numbered list
❌ Any data formatting
❌ Any column values (names, phones, emails, etc)

✅ ALLOWED for reads: "" (empty) or "Fetching..." (1 word only)
✅ ALLOWED for writes: "Updating..." / "Creating..." / "Deleting..." (1 word only)

██ RULE 1: EVERY DATA QUERY MUST HAVE QUERIES[] ██
If user asks about data → needs_data: true + queries[] with real GraphQL
NEVER return needs_data: false for: show, list, get, find, how many, which, what, who, available, charge, price, status, tasks, clients, leads, artists, staff

██ RULE 2: USE REAL COLUMN IDS ██
Never use "COLUMN_ID" or "PHONE_COL_ID" placeholders
Use actual column_ids from the schema below (they look like "phone_mm1r65vd", "color_mm1rg1d5")

██ RULE 3: WRITE OPERATIONS GET CONFIRMATION ██
For mutations (create/update/delete):
- message: "Updating..." (1 word)
- needs_data: true
- queries: [actual mutation]
System will confirm after execution

██ RULE 4: NO COUNTING, NO FORMATTING ██
NEVER write counts like "20 items" or "5 leads"
NEVER format data into lists
The system counts and formats AFTER you respond

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

⚠️ CRITICAL — STAFF BOARD ITEM NAMES ARE CODES (STF-001, STF-002, etc.), NOT PERSON NAMES.
To find a staff member by person name, you MUST fetch ALL items and the system will filter locally:
  query { boards(ids: [${TB}]) { items_page(limit: 50) { items { id name column_values { id text value type } } } } }
The person's identity is in their email column (e.g. sourabh@denicx.com, yash@denicx.com).
NEVER search staff by name column with contains_text — it will always return 0 results.

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

⚠️ IMPORTANT FETCH STRATEGY:
For ANY query that involves filtering by status, assigned person, pipeline stage, or any column value:
→ Use GET ALL ITEMS (limit: 100) — the system will filter locally. DO NOT use query_params with column filters other than "name".
→ query_params filtering is unreliable for status/text/label columns and often returns empty results.
→ Only use query_params with column_id "name" and operator "contains_text" for Sales and Artists boards (NOT Staff — Staff uses codes).

── READ ──────────────────────────────────────────────────────

SEARCH BY NAME (Sales/Artists only — NOT Staff):
query { boards(ids: [BOARD_ID]) { items_page(limit: 20, query_params: {rules: [{column_id: "name", compare_value: ["TERM"], operator: contains_text}]}) { items { id name column_values { id text value type } } } } }

GET ALL ITEMS (preferred for filtered queries):
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
"promote [name] to manager"            → GET ALL staff → system finds ID → UPDATE Access Level "Manager"
"put [name] on leave"                  → GET ALL staff → system finds ID → UPDATE Status "On Leave"
"deactivate [name]"                    → GET ALL staff → system finds ID → UPDATE Status "Inactive"
"assign [name] to sales"              → GET ALL staff → system finds ID → UPDATE Assigned Pipeline "Sales"
"team overview"                        → GET ALL → count by Status + Access Level
"tasks for [name]"                     → GET ALL staff items (system filters by person name in column values)
"what is [name] working on"            → GET ALL staff items (system filters by person name)
"[name]'s tasks"                       → GET ALL staff items (system filters by person name)
"clients assigned to [name]"           → GET ALL items from SALES board (system filters by Assigned AE column matching [name])

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
RESPONSE FORMAT — ABSOLUTE RULES
═══════════════════════════════════════════════════════════════

Return ONLY valid JSON. No markdown. No backticks.

{
  "message": "",
  "needs_data": true,
  "queries": ["query { boards(ids: [${SB}]) { items_page(limit: 100) { items { id name column_values { id text } } } } }"],
  "action_type": "read",
  "follow_up": ""
}

██ MESSAGE FIELD RULES ██

FOR READ OPERATIONS (show, list, get, find, how many, which, available, charge, price):
✅ CORRECT: message: ""
✅ CORRECT: message: "Fetching"
❌ FORBIDDEN: message: "Found 20 items. Showing first 10:"
❌ FORBIDDEN: message: "1. Priya Nair | Phone: +971..."
❌ FORBIDDEN: message: "Here are your artists:"
❌ FORBIDDEN: Any list, any data, any count, any formatting

FOR WRITE OPERATIONS (create, update, delete, assign, mark, set):
✅ CORRECT: message: "Updating"
✅ CORRECT: message: "Creating"
✅ CORRECT: message: "Deleting"
❌ FORBIDDEN: message: "Done. Priya has been marked as contacted."
❌ FORBIDDEN: message: "Successfully updated 3 records"
❌ FORBIDDEN: Any confirmation with details

FOR QUESTIONS (truly ambiguous, need clarification):
✅ CORRECT: message: "Which board - Sales, Artists, or Staff?"
✅ CORRECT: message: "Multiple matches found. Which Priya - Priya Nair or Priya Shah?"

██ QUERIES FIELD RULES ██

EVERY data request MUST have queries[]:
- "show all artists" → queries: ["query { boards(ids: [${AB}]) { items_page(limit: 100) { items { id name column_values { id text } } } } }"]
- "how many leads" → queries: ["query { boards(ids: [${SB}]) { items_page(limit: 100) { items { id } } } }"]
- "find Priya" → queries: ["query { boards(ids: [${AB}]) { items_page(query_params: {rules: [{column_id: \\"name\\", compare_value: [\\"priya\\"], operator: contains_text}]}) { items { id name column_values { id text } } } } }"]

NEVER return empty queries[] for data requests.

██ FIELD DEFINITIONS ██

- "message": For reads: "" or "Fetching" (1 word max). For writes: "Updating" (1 word max). For questions: actual question.
- "needs_data": true when queries[] is non-empty. false only for pure chat.
- "queries": Array of REAL GraphQL. Use actual board IDs and column_ids from schema.
- "action_type": "read" | "write" | "question" | "chat"
- "follow_up": Internal note or ""

██ EXAMPLES ██

User: "show all artists"
Response:
{
  "message": "",
  "needs_data": true,
  "queries": ["query { boards(ids: [${AB}]) { items_page(limit: 100) { items { id name column_values { id text value type } } } } }"],
  "action_type": "read",
  "follow_up": ""
}

User: "mark Priya as contacted"
Response:
{
  "message": "Updating",
  "needs_data": true,
  "queries": [
    "query { boards(ids: [${SB}]) { items_page(query_params: {rules: [{column_id: \\"name\\", compare_value: [\\"priya\\"], operator: contains_text}]}) { items { id name } } } }",
    "mutation { change_multiple_column_values(board_id: ${SB}, item_id: ITEM_ID_PLACEHOLDER, column_values: \\"{\\\\\\"status_col_id\\\\\\":{\\\\\\"label\\\\\\":\\\\\\"Contacted\\\\\\"}}\\" ) { id } }"
  ],
  "action_type": "write",
  "follow_up": ""
}

User: "hello"
Response:
{
  "message": "Ready to assist.",
  "needs_data": false,
  "queries": [],
  "action_type": "chat",
  "follow_up": ""
}

═══════════════════════════════════════════════════════════════
FINAL WARNING
═══════════════════════════════════════════════════════════════

YOU ARE A QUERY GENERATOR. NOT A DATA FORMATTER.
The system formats data AFTER you respond.
Your job: Generate queries. Nothing else.

If you write formatted data in message field, the system BREAKS.
If you write counts in message field, the system BREAKS.
If you write lists in message field, the system BREAKS.

Keep message field EMPTY for reads. Let the system format.

You are Sourabh's query engine. Generate queries. Execute with precision.`;
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

// P1-2 FIX: Removed dead callGemini function (130 lines)
// P1-3 FIX: Removed conversationHistory management (handled by memory.js)
// P1-4 FIX: Removed queryCache (never used)

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
  
  // P1-1 FIX: Sanitize queries before execution
  const { sanitizeQueries } = require('./lib/sanitize');
  const sanitizeResult = sanitizeQueries(queries);
  
  if (!sanitizeResult.valid) {
    logger.error('Query sanitization failed', { errors: sanitizeResult.errors });
    return [{ error: `Invalid queries: ${sanitizeResult.errors.join(', ')}` }];
  }
  
  const results = [];
  
  for (const query of sanitizeResult.sanitized) {
    if (!query || query.trim() === '') continue;
    
    logger.info('Executing query', { query: query.substring(0, 100) });
    const result = await mondayQuery(query);
    
    // Check for rate limit errors
    if (result.error_code === 'ComplexityException' || 
        result.error_code === 'DAILY_LIMIT_EXCEEDED' ||
        result.error_code === 'IP_RATE_LIMIT_EXCEEDED' ||
        (result.error_message && /rate limit|minute limit|concurrency limit/i.test(result.error_message))) {
      const retryAfter = result.retry_in_seconds || 60;
      logger.error('Monday.com rate limit hit', { 
        errorCode: result.error_code,
        errorMessage: result.error_message,
        retryAfter 
      });
      return [{ 
        error: `Rate limit exceeded. Please wait ${retryAfter} seconds and try again.`,
        error_code: result.error_code,
        retry_in_seconds: retryAfter
      }];
    }
    
    // Log any other errors
    if (result.error || result.errors) {
      logger.error('Monday.com query error', { 
        error: result.error || result.errors,
        query: query.substring(0, 200)
      });
    }
    
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
      // FIX 4: Remove Markdown parse mode - user data is untrusted and can break formatting
      await axios.post(
        `${CONFIG.telegram.apiBase}/bot${CONFIG.telegram.botToken}/sendMessage`,
        {
          chat_id: chatId,
          text: chunk,
        },
        { timeout: 10000 }
      );
    } catch (err) {
      logger.error('Failed to send Telegram message', { error: err.message });
    }
  }
}

async function sendTypingIndicator(chatId) {
  try {
    await axios.post(
      `${CONFIG.telegram.apiBase}/bot${CONFIG.telegram.botToken}/sendChatAction`,
      { chat_id: chatId, action: 'typing' },
      { timeout: 10000 }
    );
  } catch (err) {
    // Ignore
  }
}

// ============================================================
// MAIN MESSAGE PROCESSOR - AGENT-AWARE
// ============================================================

async function processMessage(chatId, messageText) {
  logger.info('Message received', { chatId, message: messageText });

  // Security check
  if (CONFIG.telegram.allowedChatIds.length > 0 && !CONFIG.telegram.allowedChatIds.includes(chatId.toString())) {
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

  // Step 1: Invoke ARIA agent (with new decision protocol)
  let agentOutput;
  try {
    agentOutput = await callAriaChain(chatId, messageText);
    logger.info('Agent response received', {
      intent: agentOutput.intent,
      board: agentOutput.entities?.board,
      action_type: agentOutput.action_type,
      queries: agentOutput.queries?.length || 0,
    });
  } catch (chainError) {
    logger.error('Agent chain failed', { error: chainError.message, stack: chainError.stack });
    await sendTelegramMessage(chatId, "I'm having trouble processing that. Please try again in a moment.");
    return;
  }

  // Step 2: Handle based on action type
  
  // CHAT / GREETING / QUESTION - No data needed
  if (agentOutput.action_type === 'chat' || agentOutput.action_type === 'question') {
    await sendTelegramMessage(chatId, agentOutput.message);
    logAudit({
      type: agentOutput.action_type,
      intent: agentOutput.intent,
      message: messageText,
      queriesExecuted: 0,
    });
    return;
  }

  // ERROR - Something went wrong
  if (agentOutput.action_type === 'error') {
    await sendTelegramMessage(chatId, agentOutput.message || "I encountered an error processing that request.");
    logAudit({
      type: 'error',
      intent: agentOutput.intent,
      message: messageText,
      queriesExecuted: 0,
    });
    return;
  }

  // READ / WRITE - Execute queries
  if (!agentOutput.queries || agentOutput.queries.length === 0) {
    logger.warn('Agent returned no queries for data operation', {
      action_type: agentOutput.action_type,
      intent: agentOutput.intent,
    });
    await sendTelegramMessage(chatId, "I couldn't generate the right query for that. Can you rephrase?");
    return;
  }

  // Step 3: Check for duplicate operations (write safety)
  if (agentOutput.action_type === 'write') {
    const operationId = generateOperationId(
      agentOutput.intent,
      agentOutput.entities,
      agentOutput.action_type
    );
    
    if (isOperationExecuted(operationId)) {
      logger.warn('Duplicate operation detected - skipping execution', { operationId, intent: agentOutput.intent });
      await sendTelegramMessage(chatId, "I already executed that operation recently. If you want to do it again, please wait a moment or rephrase.");
      return;
    }
    
    // Mark operation as executed BEFORE execution to prevent race conditions
    markOperationExecuted(operationId, {
      intent: agentOutput.intent,
      board: agentOutput.entities?.board,
      person_name: agentOutput.entities?.person_name,
      timestamp: Date.now(),
    });
  }

  // Step 4: Translate semantic column names to real Monday.com column IDs
  const resolvedQueries = resolveQueryPlaceholders(agentOutput.queries).map(query => {
    // If this is a mutation with column_values, translate semantic fields to real IDs
    if (query.includes('column_values') && agentOutput.entities?.board) {
      return translateMutationQuery(query, agentOutput.entities.board);
    }
    return query;
  });
  
  // Phase 1: Execute lookup queries (queries without placeholders)
  const lookupQueries = resolvedQueries.filter(q => !q.includes('ITEM_ID_PLACEHOLDER'));
  const placeholderQueries = resolvedQueries.filter(q => q.includes('ITEM_ID_PLACEHOLDER'));

  let allResults = [];

  if (lookupQueries.length > 0) {
    const lookupResults = await executeQueries(lookupQueries);
    
    // Check for rate limit errors
    if (lookupResults.length > 0 && lookupResults[0].error_code) {
      const error = lookupResults[0];
      if (error.error_code === 'ComplexityException' || 
          error.error_code === 'DAILY_LIMIT_EXCEEDED' ||
          error.error_code === 'IP_RATE_LIMIT_EXCEEDED') {
        await sendTelegramMessage(chatId, error.error || "Rate limit exceeded. Please wait a moment and try again.");
        return;
      }
    }
    
    // Debug logging for search operations
    logger.info('Lookup query executed', {
      queryPreview: lookupQueries[0].substring(0, 150),
      resultsCount: lookupResults.length,
      hasBoards: lookupResults[0]?.boards ? 'yes' : 'no',
      boardsCount: lookupResults[0]?.boards?.length || 0,
      itemsFound: extractItemIds(lookupResults).length,
      personName: agentOutput.entities?.person_name || 'none',
      board: agentOutput.entities?.board || 'unknown',
    });
    
    allResults = [...lookupResults];

    // Phase 2: If there are placeholder queries, resolve them with IDs from lookup results
    if (placeholderQueries.length > 0) {
      let itemIds = extractItemIds(lookupResults);
      
      // FALLBACK STRATEGY: If no results and person name has multiple words, retry with first name
      if (itemIds.length === 0 && agentOutput.entities?.person_name && agentOutput.entities.person_name.includes(' ')) {
        const firstName = agentOutput.entities.person_name.split(' ')[0];
        logger.info('Retrying search with first name only', { 
          originalName: agentOutput.entities.person_name, 
          firstName 
        });
        
        // Generate new search query with first name only
        const retryQuery = lookupQueries[0].replace(
          new RegExp(agentOutput.entities.person_name.toLowerCase(), 'gi'),
          firstName.toLowerCase()
        );
        
        const retryResults = await executeQueries([retryQuery]);
        itemIds = extractItemIds(retryResults);
        
        if (itemIds.length > 0) {
          logger.info('Fallback search succeeded', { itemsFound: itemIds.length });
          allResults = [...retryResults]; // Update results with retry
        }
      }
      
      if (itemIds.length > 0) {
        const resolved = placeholderQueries.map(q => q.replace(/ITEM_ID_PLACEHOLDER/g, itemIds[0]));
        const mutationResults = await executeQueries(resolved);
        allResults = [...allResults, ...mutationResults];
      } else {
        // Build contextual error message
        let errorMsg = "I couldn't find ";
        if (agentOutput.entities?.person_name) {
          errorMsg += `"${agentOutput.entities.person_name}"`;
        } else {
          errorMsg += "that item";
        }
        
        if (agentOutput.entities?.board && agentOutput.entities.board !== 'unknown') {
          errorMsg += ` in the ${agentOutput.entities.board} board`;
        }
        
        errorMsg += ". Try using just the first name or check the exact spelling.";
        
        logger.warn('Item lookup failed after fallback', {
          personName: agentOutput.entities?.person_name,
          board: agentOutput.entities?.board,
          intent: agentOutput.intent,
          queriesExecuted: lookupQueries.length + (agentOutput.entities?.person_name?.includes(' ') ? 1 : 0),
        });
        
        await sendTelegramMessage(chatId, errorMsg);
        return;
      }
    }
  }

  // Step 4: Format and send response
  
  if (agentOutput.action_type === 'read') {
    // For reads: Use agent's entities to enhance formatting
    const formattedMessage = formatReadResultsWithContext(
      allResults,
      messageText,
      agentOutput.entities
    );
    await sendTelegramMessage(chatId, formattedMessage);

    // Send follow-up suggestion if provided
    if (agentOutput.follow_up) {
      await sendTelegramMessage(chatId, agentOutput.follow_up);
    }

  } else if (agentOutput.action_type === 'write') {
    // Step 5: Verify write operation succeeded
    const verificationResult = await verifyWriteOperation(allResults, agentOutput);
    
    if (verificationResult.success) {
      const confirmationMessage = agentOutput.message || 'Operation completed.';
      await sendTelegramMessage(chatId, confirmationMessage);
    } else {
      logger.error('Write verification failed', { reason: verificationResult.reason });
      await sendTelegramMessage(chatId, `Operation may have failed: ${verificationResult.reason}. Please verify manually.`);
    }
  }

  logAudit({
    type: agentOutput.action_type,
    intent: agentOutput.intent,
    board: agentOutput.entities?.board,
    message: messageText,
    queriesExecuted: allResults.length,
  });
}

// Translate mutation query with semantic column names to real Monday.com column IDs
function translateMutationQuery(query, board) {
  try {
    // Extract column_values JSON from the query
    const match = query.match(/column_values:\s*"([^"]+)"/);
    if (!match) return query;
    
    const escapedJson = match[1];
    // Unescape the JSON
    const jsonStr = escapedJson.replace(/\\\\/g, '\\').replace(/\\"/g, '"');
    const semanticValues = JSON.parse(jsonStr);
    
    // Translate semantic fields to real column IDs
    const translatedValues = translateColumnValues(board, semanticValues);
    
    // Re-escape for GraphQL
    const translatedJson = JSON.stringify(translatedValues).replace(/"/g, '\\"').replace(/\\/g, '\\\\');
    
    // Replace in query
    return query.replace(/column_values:\s*"[^"]+"/, `column_values: "${translatedJson}"`);
  } catch (err) {
    logger.error('Failed to translate mutation query', { error: err.message, query: query.substring(0, 100) });
    return query;
  }
}

// Verify write operation succeeded
async function verifyWriteOperation(results, agentOutput) {
  // Check if mutation returned an error
  for (const result of results) {
    if (result && result.error) {
      return { success: false, reason: result.error };
    }
  }
  
  // For mutations, check if we got an item ID back
  const lastResult = results[results.length - 1];
  if (lastResult && (lastResult.create_item || lastResult.change_multiple_column_values || lastResult.delete_item)) {
    return { success: true };
  }
  
  // If no clear success indicator, assume success (Monday.com doesn't always return detailed results)
  return { success: true };
}

// Check if an item matches a person name (search across all text column values)
function itemMatchesPerson(item, personName) {
  if (!personName) return true;
  const name = personName.toLowerCase();

  // Check item name first (for Sales and Artists boards)
  if (item.name && item.name.toLowerCase().includes(name)) return true;

  // For Staff board, check "Person Name" column specifically (not all columns)
  const personNameCol = (item.column_values || []).find(col => {
    const title = getColumnTitle(col.id).toLowerCase();
    return title === 'person name' || title === 'name' || title.includes('staff name');
  });
  
  if (personNameCol && personNameCol.text && personNameCol.text.toLowerCase().includes(name)) {
    return true;
  }
  
  // Don't match on other columns (like "Tasks" which might mention the person)
  return false;
}

// Format read results with agent context (NEW - uses agent's extracted entities)
function formatReadResultsWithContext(results, originalRequest, entities) {
  // Use agent's extracted filters OR person_name
  if (entities && (entities.filters?.length > 0 || entities.person_name)) {
    return formatReadResultsWithFilters(results, originalRequest, entities);
  }
  
  // Fallback to original formatter
  return formatReadResults(results, originalRequest);
}

// Format read results applying agent-extracted filters
function formatReadResultsWithFilters(results, originalRequest, entities) {
  if (!results || results.length === 0) {
    return 'No data found.';
  }

  let items = [];
  let boardName = '';
  
  for (const result of results) {
    if (!result || result.error) continue;

    if (result.boards) {
      for (const board of result.boards) {
        if (!boardName && board.name) boardName = board.name;
        const boardItems = board.items_page?.items || board.items || [];
        items = items.concat(boardItems);
      }
    }

    if (result.items) {
      items = items.concat(result.items);
    }
  }

  if (items.length === 0) {
    return 'No items found.';
  }

  // Apply agent-extracted filters
  for (const filter of entities.filters) {
    items = applyAgentFilter(items, filter);
  }

  // Apply person name filter if provided
  if (entities.person_name) {
    items = items.filter(item => itemMatchesPerson(item, entities.person_name));
  }

  if (items.length === 0) {
    const parts = [];
    if (entities.person_name) {
      parts.push(`person: ${entities.person_name}`);
    }
    if (entities.filters && entities.filters.length > 0) {
      const filterDesc = entities.filters.map(f => `${f.field} ${f.operator} ${f.value}`).join(', ');
      parts.push(filterDesc);
    }
    return parts.length > 0 
      ? `No items found matching: ${parts.join(' | ')}`
      : 'No items found.';
  }

  // Format results
  const isTasksQuery = /tasks?|working on|assigned to/i.test(originalRequest);
  const totalCount = items.length;
  const itemsToShow = items.slice(0, 10);
  
  const itemStrings = itemsToShow.map((item, idx) => formatSingleItem(item, idx + 1, isTasksQuery));
  
  let header = '';
  if (totalCount > 10) {
    header = `${totalCount} ${boardName ? boardName.replace(' Database', '').toLowerCase() + 's' : 'items'} found. Showing 1-10 — reply 'next' for more.\n\n`;
  } else {
    header = `${totalCount} ${boardName ? boardName.replace(' Database', '').toLowerCase() + 's' : 'items'} found:\n\n`;
  }

  return header + itemStrings.join('\n\n');
}

// Apply a single agent-extracted filter to items
function applyAgentFilter(items, filter) {
  return items.filter(item => {
    const columns = item.column_values || [];
    
    // Find column matching filter field
    let targetCol = null;
    
    if (filter.field === 'experience' || filter.field.includes('year')) {
      targetCol = columns.find(col => {
        const title = getColumnTitle(col.id).toLowerCase();
        return title.includes('experience') || title.includes('years');
      });
    } else if (filter.field === 'pricing' || filter.field === 'price') {
      targetCol = columns.find(col => {
        const title = getColumnTitle(col.id).toLowerCase();
        return title.includes('pricing') || title.includes('price') || title.includes('charge');
      });
    } else if (filter.field === 'art_form' || filter.field === 'artform') {
      targetCol = columns.find(col => {
        const title = getColumnTitle(col.id).toLowerCase();
        return title.includes('art') && title.includes('form');
      });
    } else if (filter.field === 'availability') {
      targetCol = columns.find(col => {
        const title = getColumnTitle(col.id).toLowerCase();
        return title.includes('availability');
      });
    } else if (filter.field === 'status' || filter.field.includes('stage')) {
      targetCol = columns.find(col => {
        const title = getColumnTitle(col.id).toLowerCase();
        return title.includes('status') || title.includes('stage') || title.includes('pipeline');
      });
    } else {
      // Generic field match
      targetCol = columns.find(col => {
        const title = getColumnTitle(col.id).toLowerCase();
        return title.includes(filter.field.toLowerCase());
      });
    }
    
    if (!targetCol || !targetCol.text) return false;
    
    const colValue = targetCol.text.toLowerCase();
    const filterValue = filter.value.toLowerCase();
    
    // Apply operator
    switch (filter.operator) {
      case 'equals':
        return colValue === filterValue;
      case 'contains':
        return colValue.includes(filterValue);
      case 'greater_than':
      case 'greater_equal':
      case 'less_than':
      case 'less_equal': {
        const numMatch = targetCol.text.match(/(\d+)/);
        if (!numMatch) return false;
        const itemValue = parseInt(numMatch[1]);
        const targetValue = parseInt(filter.value);
        if (filter.operator === 'greater_than') return itemValue > targetValue;
        if (filter.operator === 'greater_equal') return itemValue >= targetValue;
        if (filter.operator === 'less_than') return itemValue < targetValue;
        if (filter.operator === 'less_equal') return itemValue <= targetValue;
        return false;
      }
      case 'not_equals':
        return colValue !== filterValue;
      default:
        return true;
    }
  });
}

// Format read results without calling Gemini again (ORIGINAL - kept for fallback)
function formatReadResults(results, originalRequest) {
  if (!results || results.length === 0) {
    return 'No data found.';
  }

  let items = [];
  let boardName = '';
  
  for (const result of results) {
    if (!result || result.error) continue;

    // Handle boards query format
    if (result.boards) {
      for (const board of result.boards) {
        if (!boardName && board.name) boardName = board.name;
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

  const isTasksQuery = /tasks?|working on|assigned to/i.test(originalRequest);

  // FIX 5: Enforce 10-item pagination BEFORE formatting with clear header
  const totalCount = items.length;
  const itemsToShow = items.slice(0, 10);
  
  // FIX 3: Build as array of strings, then chunk at item boundaries for Telegram's 4096 limit
  const itemStrings = itemsToShow.map((item, idx) => formatSingleItem(item, idx + 1, isTasksQuery));
  
  // FIX 1: Generate count header post-data, never from Gemini
  let header = '';
  if (totalCount > 10) {
    header = `${totalCount} ${boardName ? boardName.replace(' Database', '').toLowerCase() + 's' : 'items'} found. Showing 1-10 — reply 'next' for more.\n\n`;
  } else {
    header = `${totalCount} ${boardName ? boardName.replace(' Database', '').toLowerCase() + 's' : 'items'} found:\n\n`;
  }

  // Chunk messages at item boundaries (max 3800 chars per message)
  const chunks = [];
  let currentChunk = header;
  
  for (const itemStr of itemStrings) {
    if ((currentChunk + itemStr + '\n\n').length > 3800) {
      chunks.push(currentChunk.trim());
      currentChunk = itemStr + '\n\n';
    } else {
      currentChunk += itemStr + '\n\n';
    }
  }
  
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  // Return first chunk (for now, multi-chunk support can be added later)
  return chunks[0] || 'No data to display.';
}

// Helper to get column title from ID
function getColumnTitle(colId) {
  for (const boardKey of ['sales', 'artists', 'staff']) {
    const boardCols = boardColumns[boardKey];
    if (boardCols) {
      const col = boardCols.find(c => c.id === colId);
      if (col) return col.title;
    }
  }
  return colId.replace(/_/g, ' ').replace(/mm1r\w+/g, '').trim() || colId;
}

// Resolve display name for an item — for staff codes (STF-XXX), extract name from email
function resolveDisplayName(item) {
  const rawName = item.name || 'Unnamed';
  // If it's a staff code like STF-001, try to get a human name from email or other columns
  if (/^STF-\d+$/i.test(rawName)) {
    const columns = item.column_values || [];
    // Try email column first (e.g. "sourabh@denicx.com" → "Sourabh")
    const emailCol = columns.find(col => col.id && col.id.startsWith('email') && col.text);
    if (emailCol && emailCol.text) {
      const localPart = emailCol.text.split('@')[0];
      return localPart.charAt(0).toUpperCase() + localPart.slice(1) + ` (${rawName})`;
    }
    // Fallback: use the role/title column
    const roleCol = columns.find(col => {
      const title = getColumnTitle(col.id).toLowerCase();
      return (title.includes('role') || title.includes('title') || title.includes('designation')) && col.text;
    });
    if (roleCol) return `${rawName} — ${roleCol.text}`;
  }
  return rawName;
}

// Format a single item with smart column selection
function formatSingleItem(item, index, isTasksQuery) {
  const name = resolveDisplayName(item);
  const columns = item.column_values || [];

  // For tasks queries, prioritize the "Current Tasks/Projects" column
  if (isTasksQuery) {
    const tasksCol = columns.find(col => {
      const title = getColumnTitle(col.id).toLowerCase();
      return title.includes('task') || title.includes('project') || title.includes('working');
    });

    if (tasksCol && tasksCol.text && tasksCol.text.trim()) {
      // FIX 2: Truncate long text at 80 characters
      const taskText = tasksCol.text.length > 80 ? tasksCol.text.substring(0, 77) + '...' : tasksCol.text;
      return `${index}. ${name}\n   Tasks: ${taskText}`;
    } else {
      return `${index}. ${name}\n   No tasks assigned`;
    }
  }

  // For general queries, show relevant non-empty columns (excluding Name column)
  // Prioritize: status/stage columns first, then assigned/AE, then phone, then others
  const relevantCols = columns.filter(col => {
    if (!col.text || col.text.trim() === '' || col.id === 'name') return false;
    const title = getColumnTitle(col.id).toLowerCase();
    if (title === 'name' || title === 'full name' || title === 'item name') return false;
    return true;
  });

  // Sort by priority: status/stage > assigned > pricing > phone > other
  relevantCols.sort((a, b) => {
    const priority = (col) => {
      const t = getColumnTitle(col.id).toLowerCase();
      if (t.includes('stage') || t.includes('pipeline')) return 0;
      if (t.includes('status') || t.includes('availability')) return 1;
      if (t.includes('assigned') || t.includes('ae')) return 2;
      if (t.includes('pricing') || t.includes('price')) return 3;
      if (t.includes('art form') || t.includes('role') || t.includes('department')) return 4;
      if (t.includes('phone')) return 5;
      if (t.includes('email')) return 6;
      return 7;
    };
    return priority(a) - priority(b);
  });

  const details = relevantCols
    .slice(0, 5)
    .map(col => {
      const colTitle = getColumnTitle(col.id);
      const colText = col.text.length > 80 ? col.text.substring(0, 77) + '...' : col.text;
      return `${colTitle}: ${colText}`;
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
  if (!queries || !Array.isArray(queries)) return [];
  return queries
    .filter(q => q && q.trim() !== '')
    .map(query => {
      let resolved = query;
      resolved = resolved.replace(/\$\{SB\}/g, CONFIG.monday.boards.sales.id);
      resolved = resolved.replace(/\$\{AB\}/g, CONFIG.monday.boards.artists.id);
      resolved = resolved.replace(/\$\{TB\}/g, CONFIG.monday.boards.staff.id);
      return resolved;
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
        `*ARIA V4 - PRODUCTION GRADE* 🚀\n\n` +
        `Your elite AI Chief of Staff for Denicx Entertainment.\n\n` +
        `*Connected Boards:*\n` +
        `• Sales Pipeline\n` +
        `• Artist Database\n` +
        `• Staff Database\n\n` +
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
      clearChatMemory(chatId);
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
    status: 'ARIA V4 - PRODUCTION GRADE',
    timestamp: new Date().toISOString(),
    uptime: Math.round(process.uptime()),
    boards: Object.keys(CONFIG.monday.boards).length,
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
  
  // Build semantic column mappings after fetching schemas
  buildColumnMappings(boardColumns);
  logger.info('Column mappings built for semantic field translation');
}

async function fetchBoardColumns() {
  for (const [key, board] of Object.entries(CONFIG.monday.boards)) {
    try {
      // Fetch both columns and groups
      const query = `query { boards(ids: [${board.id}]) { columns { id title type } groups { id title } } }`;
      const result = await mondayQuery(query);
    logger.info("After mondayQuery wait", { resultPreview: JSON.stringify(result).substring(0,100) });
      if (result?.boards?.[0]?.columns) {
        boardColumns[key] = result.boards[0].columns;
        logger.info(`Fetched ${boardColumns[key].length} columns for ${board.name}`);
      }
      // Store first group ID (or default to "topics")
      if (result?.boards?.[0]?.groups && result.boards[0].groups.length > 0) {
        boardGroups[key] = result.boards[0].groups[0].id;
        logger.info(`Using group "${boardGroups[key]}" for ${board.name}`);
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
  logger.info('  ARIA V4.1 - REASONING DISCIPLINE');
  logger.info('  Denicx Entertainment CRM');
  logger.info(`  Port: ${PORT}`);
  logger.info('═══════════════════════════════════════════════');
  await fetchBoardColumns();

  // Initialize LangChain chain after board columns are loaded
  try {
    await initChain({
      gemini: {
        apiKey: CONFIG.gemini.apiKey,
        model: CONFIG.gemini.model,
      },
      boardIds: {
        sales: CONFIG.monday.boards.sales.id,
        artists: CONFIG.monday.boards.artists.id,
        staff: CONFIG.monday.boards.staff.id,
      },
      salesColumns: boardColumns.sales,
      artistsColumns: boardColumns.artists,
      staffColumns: boardColumns.staff,
    });
    logger.info('LangChain ARIA chain initialized successfully');
  } catch (err) {
    logger.error('Failed to initialize LangChain chain', { error: err.message, stack: err.stack });
    logger.warn('System cannot start without LangChain - exiting');
    process.exit(1);
  }

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
