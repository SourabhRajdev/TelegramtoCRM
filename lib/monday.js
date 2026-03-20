/**
 * Monday.com GraphQL Client
 * Handles all Monday.com API interactions with per-user token support
 */

const axios = require('axios');
const db = require('./database');

/**
 * Execute Monday.com GraphQL query
 * @param {string} query - GraphQL query string
 * @param {object} variables - GraphQL variables (optional)
 * @param {string} token - Monday.com API token (optional, falls back to env)
 * @returns {object} - Query result
 */
async function queryMonday(query, variables = {}, token = null) {
  const apiToken = token || process.env.MONDAY_API_TOKEN;
  
  if (!apiToken) {
    throw new Error('No Monday.com API token available');
  }
  
  try {
    const response = await axios.post('https://api.monday.com/v2', {
      query,
      variables
    }, {
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
    
    if (response.data.errors) {
      const error = response.data.errors[0];
      throw new Error(error.message);
    }
    
    return response.data.data;
    
  } catch (error) {
    console.error('[Monday] Query failed:', error.message);
    throw error;
  }
}

/**
 * Validate that a query only accesses boards the user has permission for
 * @param {string} query - GraphQL query
 * @param {string} telegram_user_id - User ID to check permissions
 * @returns {boolean} - True if query is allowed
 */
function validateBoardAccess(query, telegram_user_id) {
  // Extract board IDs from the query
  const boardIdMatches = query.match(/boards?\s*\(\s*ids?\s*:\s*\[([^\]]+)\]/gi);
  
  if (!boardIdMatches) {
    // No board IDs in query - allow (might be a general query like 'me')
    return true;
  }
  
  // Get user's accessible boards
  const userBoards = db.getUserBoards(telegram_user_id);
  const accessibleBoardIds = userBoards.map(board => board.board_id);
  
  // Check each board ID in the query
  for (const match of boardIdMatches) {
    const idsString = match.match(/\[([^\]]+)\]/)[1];
    const boardIds = idsString.split(',').map(id => id.trim().replace(/['"]/g, ''));
    
    for (const boardId of boardIds) {
      if (!accessibleBoardIds.includes(boardId)) {
        console.warn(`[Monday] User ${telegram_user_id} attempted to access unauthorized board: ${boardId}`);
        return false;
      }
    }
  }
  
  return true;
}

/**
 * Execute query with user context and validation
 * @param {string} telegram_user_id - User ID
 * @param {string} query - GraphQL query
 * @param {object} variables - GraphQL variables
 * @returns {object} - Query result
 */
async function executeUserQuery(telegram_user_id, query, variables = {}) {
  // Validate board access
  if (!validateBoardAccess(query, telegram_user_id)) {
    throw new Error('Access denied: Query contains unauthorized board IDs');
  }
  
  // Get user's token (this will be handled by userContext.js)
  const user = db.getUser(telegram_user_id);
  if (!user || !user.monday_token_encrypted) {
    throw new Error('User not connected to Monday.com');
  }
  
  // Use the executeWithUserToken from userContext.js
  const { executeWithUserToken } = require('./userContext');
  return await executeWithUserToken(telegram_user_id, query, variables);
}

module.exports = {
  queryMonday,
  validateBoardAccess,
  executeUserQuery
};