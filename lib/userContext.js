/**
 * User Context Loader
 * Replaces hardcoded CONFIG with dynamic per-message user context
 */

const db = require('./database');
const { decrypt } = require('./encryption');
const Cache = require('./cache');
const axios = require('axios');

// Create cache instance
const cache = new Cache(60000); // 60 seconds default TTL

// Cache keys
const CONTEXT_CACHE_PREFIX = 'user_context:';
const TOKEN_CACHE_PREFIX = 'decrypted_token:';
const CONTEXT_TTL = 60; // 60 seconds
const TOKEN_TTL = 300; // 5 minutes

/**
 * Load full context for a Telegram message
 * @param {string} telegram_user_id
 * @returns {object} - User context or error object
 */
async function loadContext(telegram_user_id) {
  const cacheKey = CONTEXT_CACHE_PREFIX + telegram_user_id;
  
  // Check cache first
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }
  
  try {
    // Get user from database
    const user = db.getUser(telegram_user_id);
    if (!user) {
      const errorContext = { error: 'not_registered' };
      cache.set(cacheKey, errorContext, 30); // Cache error for 30 seconds
      return errorContext;
    }
    
    // Check if user is active
    if (!user.is_active) {
      const errorContext = { error: 'deactivated' };
      cache.set(cacheKey, errorContext, CONTEXT_TTL);
      return errorContext;
    }
    
    // Check onboarding state
    if (user.onboarding_state === 'oauth_pending') {
      const errorContext = { error: 'oauth_pending' };
      cache.set(cacheKey, errorContext, 30);
      return errorContext;
    }
    
    if (user.onboarding_state === 'board_select') {
      const errorContext = { error: 'board_select' };
      cache.set(cacheKey, errorContext, 30);
      return errorContext;
    }
    
    // Decrypt Monday.com token
    let monday_token = null;
    if (user.monday_token_encrypted) {
      monday_token = getDecryptedToken(telegram_user_id, {
        encrypted: user.monday_token_encrypted,
        iv: user.monday_token_iv,
        tag: user.monday_token_tag
      });
      
      if (!monday_token) {
        // Token decryption failed - reset to oauth_pending
        db.setOnboardingState(telegram_user_id, 'oauth_pending');
        db.logAction({
          telegram_user_id,
          action: 'token_decryption_failed',
          error_message: 'Token decryption failed',
          success: 0
        });
        
        const errorContext = { error: 'decrypt_failed' };
        cache.set(cacheKey, errorContext, 30);
        return errorContext;
      }
    }
    
    // Get user's boards
    const boards = db.getUserBoards(telegram_user_id);
    const defaultBoard = db.getDefaultBoard(telegram_user_id);
    
    // Check if user is founder (admin)
    const founderChatId = process.env.TELEGRAM_FOUNDER_CHAT_ID;
    const isFounder = founderChatId && telegram_user_id === founderChatId;
    
    // Build context object
    const context = {
      user: {
        telegram_user_id: user.telegram_user_id,
        telegram_username: user.telegram_username,
        telegram_first_name: user.telegram_first_name,
        company_name: user.company_name,
        access_level: user.access_level,
        onboarding_state: user.onboarding_state,
        monday_user_id: user.monday_user_id,
        monday_account_id: user.monday_account_id
      },
      monday_token,
      boards,
      defaultBoard,
      isFounder: isFounder || user.access_level === 'admin',
      isActive: true,
      rateLimitKey: `rate_limit:${telegram_user_id}`
    };
    
    // Cache the context
    cache.set(cacheKey, context, CONTEXT_TTL);
    
    // Update last active timestamp
    db.updateUser(telegram_user_id, { 
      last_active_at: new Date().toISOString() 
    });
    
    return context;
    
  } catch (error) {
    console.error('[UserContext] Load context failed:', error.message);
    const errorContext = { error: 'system_error' };
    cache.set(cacheKey, errorContext, 10); // Short cache for errors
    return errorContext;
  }
}

/**
 * Get decrypted token with caching
 * @param {string} telegram_user_id
 * @param {object} encryptedData - { encrypted, iv, tag }
 * @returns {string|null} - Decrypted token or null
 */
function getDecryptedToken(telegram_user_id, encryptedData) {
  const cacheKey = TOKEN_CACHE_PREFIX + telegram_user_id;
  
  // Check cache first
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }
  
  // Decrypt token
  const token = decrypt(encryptedData);
  if (token) {
    // Cache decrypted token for 5 minutes
    cache.set(cacheKey, token, TOKEN_TTL);
  }
  
  return token;
}

/**
 * Resolve which board a query targets
 * @param {object} userContext - User context from loadContext()
 * @param {string} userMessage - The user's message
 * @returns {object} - Board context or selection needed
 */
async function resolveBoard(userContext, userMessage) {
  const { boards, defaultBoard } = userContext;
  
  if (!boards || boards.length === 0) {
    return { 
      error: 'no_boards',
      message: 'You don\'t have access to any boards. Use /boards to connect some.'
    };
  }
  
  // Check for explicit board specification in message
  const boardMatch = userMessage.match(/board:(\w+)/i) || 
                    userMessage.match(/board\s+(\d+):/i);
  
  if (boardMatch) {
    const boardSpec = boardMatch[1];
    
    // Try to match by index (1-based)
    if (/^\d+$/.test(boardSpec)) {
      const index = parseInt(boardSpec) - 1;
      if (index >= 0 && index < boards.length) {
        return {
          board_id: boards[index].board_id,
          board_name: boards[index].board_name,
          access_level: boards[index].access_level
        };
      }
    }
    
    // Try to match by name (fuzzy)
    const matchedBoard = boards.find(board => 
      board.board_name.toLowerCase().includes(boardSpec.toLowerCase())
    );
    
    if (matchedBoard) {
      return {
        board_id: matchedBoard.board_id,
        board_name: matchedBoard.board_name,
        access_level: matchedBoard.access_level
      };
    }
    
    return {
      error: 'board_not_found',
      message: `Board "${boardSpec}" not found. Available boards: ${boards.map((b, i) => `${i+1}. ${b.board_name}`).join(', ')}`
    };
  }
  
  // Check for board name mentioned in message
  for (const board of boards) {
    const boardWords = board.board_name.toLowerCase().split(/\s+/);
    const messageWords = userMessage.toLowerCase().split(/\s+/);
    
    // If any significant word from board name appears in message
    const significantWords = boardWords.filter(word => word.length > 3);
    if (significantWords.some(word => messageWords.includes(word))) {
      return {
        board_id: board.board_id,
        board_name: board.board_name,
        access_level: board.access_level
      };
    }
  }
  
  // If user has only one board, use it automatically
  if (boards.length === 1) {
    return {
      board_id: boards[0].board_id,
      board_name: boards[0].board_name,
      access_level: boards[0].access_level
    };
  }
  
  // If user has a default board, use it
  if (defaultBoard) {
    return {
      board_id: defaultBoard.board_id,
      board_name: defaultBoard.board_name,
      access_level: defaultBoard.access_level
    };
  }
  
  // Multiple boards, no clear target - ask user to specify
  return {
    needsSelection: true,
    boards: boards.map((board, index) => ({
      index: index + 1,
      board_id: board.board_id,
      board_name: board.board_name,
      item_count: board.item_count,
      is_default: board.is_default
    }))
  };
}

/**
 * Execute a Monday.com query with the user's own token
 * @param {string} telegram_user_id
 * @param {string} query - GraphQL query
 * @param {object} variables - GraphQL variables
 * @returns {object} - Query result
 */
async function executeWithUserToken(telegram_user_id, query, variables = {}) {
  const startTime = Date.now();
  
  try {
    // Load user context
    const context = await loadContext(telegram_user_id);
    if (context.error) {
      throw new Error(`User context error: ${context.error}`);
    }
    
    if (!context.monday_token) {
      throw new Error('No Monday.com token available');
    }
    
    // Execute query
    const response = await axios.post('https://api.monday.com/v2', {
      query,
      variables
    }, {
      headers: {
        'Authorization': `Bearer ${context.monday_token}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
    
    const duration = Date.now() - startTime;
    
    if (response.data.errors) {
      const error = response.data.errors[0];
      
      // Log the error
      db.logAction({
        telegram_user_id,
        action: 'monday_query_error',
        monday_query: query.substring(0, 500), // Truncate long queries
        error_message: error.message,
        duration_ms: duration,
        success: 0
      });
      
      throw new Error(error.message);
    }
    
    // Log successful query
    db.logAction({
      telegram_user_id,
      action: 'monday_query_success',
      monday_query: query.substring(0, 500),
      result_summary: 'Query executed successfully',
      duration_ms: duration,
      success: 1
    });
    
    return response.data.data;
    
  } catch (error) {
    const duration = Date.now() - startTime;
    
    console.error('[UserContext] Monday.com query failed:', error.message);
    
    // Log the failure
    db.logAction({
      telegram_user_id,
      action: 'monday_query_failed',
      monday_query: query.substring(0, 500),
      error_message: error.message,
      duration_ms: duration,
      success: 0
    });
    
    throw error;
  }
}

/**
 * Clear cached context for a user (useful after updates)
 * @param {string} telegram_user_id
 */
function clearUserCache(telegram_user_id) {
  cache.delete(CONTEXT_CACHE_PREFIX + telegram_user_id);
  cache.delete(TOKEN_CACHE_PREFIX + telegram_user_id);
}

module.exports = {
  loadContext,
  resolveBoard,
  executeWithUserToken,
  clearUserCache
};