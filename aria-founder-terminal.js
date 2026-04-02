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
const { buildColumnMappings, translateColumnValues, getColumnId } = require('./lib/column-mapper');
const { getLastContext } = require('./lib/memory');

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

const chatRateLimits = new Map();

// Store board column schemas and groups fetched at startup
const boardColumns = {
  sales: [],
  artists: [],
  staff: [],
};

const boardGroups = {
  sales: 'group_mm1mfka4',      // denicx_demo_data
  artists: 'group_mm1rccy4',    // denicx_artist_database
  staff: 'group_mm1ry7p4',      // denicx_staff_database
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

// NOTE: System prompt is loaded from ARIA_SYSTEM_PROMPT.md via lib/aria-chain.js
// The inline buildSystemPrompt was removed — it was dead code from pre-LangChain architecture.

// ============================================================
// MONDAY.COM - RELIABLE EXECUTION
// ============================================================

/*
 * DEAD CODE REMOVED: ~450 lines of inline buildSystemPrompt(), normalizeAIResponse(), and old comments.
 * System prompt is now loaded from ARIA_SYSTEM_PROMPT.md via lib/aria-chain.js.
 * AI response normalization is handled by lib/output-parser.js.
 */

async function mondayQuery(query, _retryCount = 0) {
  const MAX_RETRIES = 3;
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
    if (error.response?.status === 429 && _retryCount < MAX_RETRIES) {
      const delay = 5000 * (_retryCount + 1);
      logger.warn(`Rate limited, retry ${_retryCount + 1}/${MAX_RETRIES} after ${delay}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return mondayQuery(query, _retryCount + 1);
    }

    logger.error('Monday.com error', { error: error.message, retries: _retryCount });
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

// Keep typing indicator alive for long operations (Telegram expires it after 5s)
function startTypingIndicator(chatId) {
  sendTypingIndicator(chatId);
  const interval = setInterval(() => sendTypingIndicator(chatId), 4000);
  return () => clearInterval(interval);
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

  // Show typing — keep alive until response is ready (Telegram expires after 5s)
  const stopTyping = startTypingIndicator(chatId);
  try {

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

  // Step 1b: Detect and break stale clarification loops
  // If the agent is repeating a clarification question the user already moved on from, reset it
  if (agentOutput.action_type === 'question' || agentOutput.intent === 'clarify') {
    const lastContext = getLastContext(chatId);
    if (lastContext && lastContext.action_type === 'question') {
      // Previous turn was ALSO a clarification — check if user is stuck in a loop
      const hasDataKeywords = /\b(leads?|clients?|artists?|staff|team|show|tell|find|how many|list|get|give|report)\b/i.test(messageText);
      const isRejection = /^(no|nope|nevermind|never mind|forget it|cancel|stop|not that|nah)[\s!.?]*$/i.test(messageText.trim());

      if (hasDataKeywords || isRejection) {
        // User has moved on but model is stuck — override to a fresh interpretation
        logger.warn('Breaking stale clarification loop', {
          previousAction: lastContext.action_type,
          currentMessage: messageText,
          reason: hasDataKeywords ? 'user_has_data_keywords' : 'user_rejected',
        });

        if (isRejection) {
          await sendTelegramMessage(chatId, "OK. What do you need?");
          return;
        }

        // Force re-invocation without memory pollution
        // Clear memory to break the loop, then re-invoke
        const { clearMemory } = require('./lib/memory');
        clearMemory(chatId);
        logger.info('Cleared stale memory, re-invoking agent');

        try {
          agentOutput = await callAriaChain(chatId, messageText);
          logger.info('Re-invocation after loop break', {
            intent: agentOutput.intent,
            action_type: agentOutput.action_type,
          });
        } catch (retryError) {
          logger.error('Re-invocation failed', { error: retryError.message });
          await sendTelegramMessage(chatId, "Let me try that again. What do you need?");
          return;
        }
      }
    }
  }

  // Step 1c: Programmatic follow-up context merging
  // If agent detected follow_up intent, merge previous filters with new ones
  if (agentOutput.intent === 'follow_up' && agentOutput.action_type === 'read') {
    const lastContext = getLastContext(chatId);
    if (lastContext) {
      // Inherit board from previous context if current is unknown
      if ((!agentOutput.entities.board || agentOutput.entities.board === 'unknown') && lastContext.board) {
        agentOutput.entities.board = lastContext.board;
        logger.info('Follow-up: inherited board from context', { board: lastContext.board });
      }

      // Merge previous filters with new filters (deduplicate by field)
      if (lastContext.filters && lastContext.filters.length > 0) {
        const currentFields = new Set((agentOutput.entities.filters || []).map(f => f.field));
        const mergedFilters = [...(agentOutput.entities.filters || [])];
        for (const prevFilter of lastContext.filters) {
          if (!currentFields.has(prevFilter.field)) {
            mergedFilters.push(prevFilter);
            logger.info('Follow-up: merged previous filter', { field: prevFilter.field, value: prevFilter.value });
          }
        }
        agentOutput.entities.filters = mergedFilters;
      }

      // Inherit person_name if not set in current query
      if (!agentOutput.entities.person_name && lastContext.person_name) {
        agentOutput.entities.person_name = lastContext.person_name;
        logger.info('Follow-up: inherited person_name from context', { person_name: lastContext.person_name });
      }
    }
  }

  // Step 2: Handle based on action type

  // CHAT / GREETING / QUESTION / NONE - No data needed
  // v6 uses action_type 'none' for greetings/clarifications; keep 'chat'/'question' for backward compat
  if (agentOutput.action_type === 'none' || agentOutput.action_type === 'chat' || agentOutput.action_type === 'question') {
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

  // P1-4 FIX: Block critically invalid outputs from reaching execution
  if (agentOutput._validation_failed) {
    const critical = (agentOutput._validation_reasons || []).some(r => r.includes('CRITICAL'));
    if (critical) {
      logger.error('Blocked critically invalid agent output from execution', {
        reasons: agentOutput._validation_reasons,
      });
      await sendTelegramMessage(chatId, "I had trouble understanding that. Can you be more specific about what you need?");
      return;
    }
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
  //         and fix group_id references
  const resolvedQueries = resolveQueryPlaceholders(agentOutput.queries).map(query => {
    // P0-3 FIX: Replace "topics" or any wrong group_id with real group ID for the target board
    if (query.includes('group_id')) {
      const board = agentOutput.entities?.board || 'sales';
      const realGroupId = boardGroups[board] || boardGroups.sales;
      query = query.replace(/group_id:\s*\\"topics\\"/g, `group_id: \\"${realGroupId}\\"`);
      query = query.replace(/group_id:\s*"topics"/g, `group_id: "${realGroupId}"`);
    }
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
      const confirmationMessage = agentOutput.message || 'Done.';
      await sendTelegramMessage(chatId, confirmationMessage);
    } else {
      // Check if it's a group ID error and we can retry
      if (verificationResult.reason.includes('board configuration')) {
        // Log for admin but tell user it's being handled
        logger.error('Group ID configuration issue detected', { 
          board: agentOutput.entities?.board,
          intent: agentOutput.intent 
        });
        await sendTelegramMessage(chatId, "I'm having trouble with that. Let me check the board setup and try again in a moment.");
      } else {
        // Other errors - provide the helpful message
        await sendTelegramMessage(chatId, verificationResult.reason);
      }
    }
  }

  logAudit({
    type: agentOutput.action_type,
    intent: agentOutput.intent,
    board: agentOutput.entities?.board,
    message: messageText,
    queriesExecuted: allResults.length,
  });
  } finally {
    stopTyping();
  }
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
      // Parse Monday.com errors and provide helpful messages
      const errorMsg = result.error.toLowerCase();
      
      if (errorMsg.includes('group not found') || errorMsg.includes('group_id')) {
        // Group ID issue - try to recover or provide clear guidance
        logger.error('Group ID error - board configuration issue', { error: result.error });
        return { 
          success: false, 
          reason: "I couldn't create that item. The board configuration needs to be updated. I'll notify the admin."
        };
      }
      
      if (errorMsg.includes('column') && errorMsg.includes('not found')) {
        logger.error('Column not found error', { error: result.error });
        return { 
          success: false, 
          reason: "I couldn't update that field. The board structure may have changed."
        };
      }
      
      if (errorMsg.includes('permission') || errorMsg.includes('unauthorized')) {
        logger.error('Permission error', { error: result.error });
        return { 
          success: false, 
          reason: "I don't have permission to do that. Please check my access level."
        };
      }
      
      // Generic error - don't expose technical details
      logger.error('Monday.com mutation error', { error: result.error });
      return { 
        success: false, 
        reason: "Something went wrong. Let me try that again in a moment."
      };
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

  // Apply agent-extracted filters (pass board for column-mapper resolution)
  for (const filter of entities.filters) {
    items = applyAgentFilter(items, filter, entities.board);
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

  return chunkItemsForTelegram(header, itemStrings);
}

// Chunk formatted items for Telegram's 4096 char limit (return first chunk)
function chunkItemsForTelegram(header, itemStrings) {
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

  return chunks[0] || 'No data to display.';
}

// Apply a single agent-extracted filter to items
// P1-5 FIX: Use column-mapper IDs first, title matching as fallback
function applyAgentFilter(items, filter, board) {
  // Log the filter being applied
  logger.info('Applying agent filter', {
    field: filter.field,
    operator: filter.operator,
    value: filter.value,
    board: board,
  });

  return items.filter(item => {
    const columns = item.column_values || [];

    // Strategy 1: Use column-mapper to find exact column ID
    let targetCol = null;
    const mappedColId = getColumnId(board, filter.field);
    
    // Log column resolution result
    logger.debug('Column resolution', {
      field: filter.field,
      mappedColId: mappedColId || 'not_found',
      strategy: mappedColId ? 'column-mapper' : 'will_try_title_match',
    });
    
    if (mappedColId) {
      targetCol = columns.find(col => col.id === mappedColId);
    }

    // Strategy 2: Fallback to title matching if mapper didn't resolve
    if (!targetCol) {
      targetCol = columns.find(col => {
        const title = getColumnTitle(col.id).toLowerCase();
        return title.includes(filter.field.toLowerCase());
      });
      
      // Log fallback result
      if (targetCol) {
        logger.debug('Column resolved via title match', {
          field: filter.field,
          columnId: targetCol.id,
          columnTitle: getColumnTitle(targetCol.id),
        });
      } else {
        logger.warn('Column not found', {
          field: filter.field,
          availableColumns: columns.map(c => ({ id: c.id, title: getColumnTitle(c.id) })),
        });
      }
    }

    if (!targetCol || !targetCol.text) return false;

    const colValue = targetCol.text.toLowerCase();
    const filterValue = filter.value.toLowerCase();

    // Apply operator
    switch (filter.operator) {
      case 'equals':
        // Fuzzy equals: exact match or substring containment
        return colValue === filterValue || colValue.includes(filterValue) || filterValue.includes(colValue);
      case 'contains':
        return colValue.includes(filterValue);
      case 'greater_than':
      case 'greater_equal':
      case 'less_than':
      case 'less_equal': {
        const numMatch = targetCol.text.match(/[\d,]+\.?\d*/);
        
        // Log numeric extraction result
        logger.debug('Numeric extraction', {
          field: filter.field,
          columnText: targetCol.text,
          regexMatch: numMatch ? numMatch[0] : 'no_match',
          operator: filter.operator,
        });
        
        if (!numMatch) return false;
        const itemValue = parseFloat(numMatch[0].replace(/,/g, ''));
        const targetValue = parseFloat(filter.value.replace(/,/g, ''));
        if (isNaN(itemValue) || isNaN(targetValue)) return false;
        
        let comparisonResult = false;
        if (filter.operator === 'greater_than') comparisonResult = itemValue > targetValue;
        if (filter.operator === 'greater_equal') comparisonResult = itemValue >= targetValue;
        if (filter.operator === 'less_than') comparisonResult = itemValue < targetValue;
        if (filter.operator === 'less_equal') comparisonResult = itemValue <= targetValue;
        
        // Log comparison result
        logger.debug('Numeric comparison', {
          field: filter.field,
          itemValue: itemValue,
          targetValue: targetValue,
          operator: filter.operator,
          result: comparisonResult ? 'include' : 'exclude',
        });
        
        return comparisonResult;
      }
      case 'not_equals':
        return colValue !== filterValue && !colValue.includes(filterValue);
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

  return chunkItemsForTelegram(header, itemStrings);
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
      // Fetch both columns and groups
      const query = `query { boards(ids: [${board.id}]) { columns { id title type } groups { id title } } }`;
      const result = await mondayQuery(query);
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

  // Build semantic column mappings after fetching schemas
  buildColumnMappings(boardColumns);
  logger.info('Column mappings built for semantic field translation');
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

// Only start server if not in test mode
if (process.env.NODE_ENV !== 'test') {
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
        boardGroups: boardGroups,
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
}

// Error handling
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason: String(reason) });
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  process.exit(1);
});

module.exports = { app, CONFIG };
