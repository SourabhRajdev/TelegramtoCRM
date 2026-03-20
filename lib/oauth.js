/**
 * Monday.com OAuth 2.0 Integration
 * Handles authorization flow, token exchange, and user board discovery
 */

const axios = require('axios');
const crypto = require('crypto');
const { encrypt, decrypt } = require('./encryption');
const db = require('./database');

// OAuth state management (in-memory with TTL)
const oauthStates = new Map();
const STATE_TTL = 10 * 60 * 1000; // 10 minutes

/**
 * Clean up expired OAuth states
 */
function cleanupExpiredStates() {
  const now = Date.now();
  for (const [state, data] of oauthStates.entries()) {
    if (now > data.expires) {
      oauthStates.delete(state);
    }
  }
}

// Cleanup expired states every 5 minutes
setInterval(cleanupExpiredStates, 5 * 60 * 1000);

/**
 * Generate OAuth authorization URL for a Telegram user
 * @param {string} telegram_user_id
 * @returns {string} - Authorization URL
 */
function getAuthorizationUrl(telegram_user_id) {
  const clientId = process.env.MONDAY_CLIENT_ID;
  const redirectUri = process.env.MONDAY_REDIRECT_URI;
  
  if (!clientId || !redirectUri) {
    throw new Error('Monday.com OAuth not configured. Missing MONDAY_CLIENT_ID or MONDAY_REDIRECT_URI');
  }
  
  // Generate cryptographically secure state parameter
  const state = crypto.randomBytes(32).toString('hex');
  
  // Store state with expiration
  oauthStates.set(state, {
    telegram_user_id,
    expires: Date.now() + STATE_TTL
  });
  
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    state: state,
    scope: 'me:read boards:read boards:write workspaces:read'
  });
  
  const authUrl = `https://auth.monday.com/oauth2/authorize?${params.toString()}`;
  
  console.log(`[OAuth] Generated auth URL for user: ${telegram_user_id}`);
  return authUrl;
}

/**
 * Handle OAuth callback - exchange code for token
 * @param {string} code - Authorization code from Monday.com
 * @param {string} state - State parameter for CSRF protection
 * @returns {object} - { success: true, telegram_user_id, monday_user_name, company_name } or { success: false, error }
 */
async function handleCallback(code, state) {
  try {
    // Validate state parameter (CSRF protection)
    const stateData = oauthStates.get(state);
    if (!stateData) {
      return { success: false, error: 'Invalid or expired state parameter' };
    }
    
    if (Date.now() > stateData.expires) {
      oauthStates.delete(state);
      return { success: false, error: 'OAuth session expired' };
    }
    
    const telegram_user_id = stateData.telegram_user_id;
    oauthStates.delete(state); // Clean up used state
    
    // Exchange code for access token
    const tokenResponse = await exchangeCodeForToken(code);
    if (!tokenResponse.success) {
      return { success: false, error: tokenResponse.error };
    }
    
    const accessToken = tokenResponse.access_token;
    
    // Get user info from Monday.com
    const userInfo = await getMondayUserInfo(accessToken);
    if (!userInfo.success) {
      return { success: false, error: userInfo.error };
    }
    
    // Encrypt and store the token
    const encryptedToken = encrypt(accessToken);
    
    db.storeMondayToken(telegram_user_id, {
      encrypted: encryptedToken.encrypted,
      iv: encryptedToken.iv,
      tag: encryptedToken.tag,
      monday_user_id: userInfo.user.id,
      monday_account_id: userInfo.user.account.id,
      company_name: userInfo.user.account.name
    });
    
    // Update onboarding state
    db.setOnboardingState(telegram_user_id, 'board_select');
    
    // Log the OAuth completion
    db.logAction({
      telegram_user_id,
      action: 'oauth_completed',
      result_summary: `Connected to ${userInfo.user.account.name}`,
      success: 1
    });
    
    console.log(`[OAuth] Successfully connected user ${telegram_user_id} to Monday.com account: ${userInfo.user.account.name}`);
    
    return {
      success: true,
      telegram_user_id,
      monday_user_name: userInfo.user.name,
      company_name: userInfo.user.account.name
    };
    
  } catch (error) {
    console.error('[OAuth] Callback handling failed:', error.message);
    
    // Log the failure if we have a user ID
    if (stateData && stateData.telegram_user_id) {
      db.logAction({
        telegram_user_id: stateData.telegram_user_id,
        action: 'oauth_failed',
        error_message: error.message,
        success: 0
      });
    }
    
    return { success: false, error: 'OAuth processing failed' };
  }
}

/**
 * Exchange authorization code for access token
 * @param {string} code
 * @returns {object} - { success: true, access_token } or { success: false, error }
 */
async function exchangeCodeForToken(code) {
  try {
    const response = await axios.post('https://auth.monday.com/oauth2/token', {
      client_id: process.env.MONDAY_CLIENT_ID,
      client_secret: process.env.MONDAY_CLIENT_SECRET,
      redirect_uri: process.env.MONDAY_REDIRECT_URI,
      grant_type: 'authorization_code',
      code: code
    }, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });
    
    if (response.data.access_token) {
      return { success: true, access_token: response.data.access_token };
    } else {
      return { success: false, error: 'No access token in response' };
    }
    
  } catch (error) {
    console.error('[OAuth] Token exchange failed:', error.response?.data || error.message);
    return { success: false, error: 'Failed to exchange code for token' };
  }
}

/**
 * Get Monday.com user information
 * @param {string} accessToken
 * @returns {object} - { success: true, user } or { success: false, error }
 */
async function getMondayUserInfo(accessToken) {
  try {
    const query = `
      query {
        me {
          id
          name
          email
          account {
            id
            name
          }
        }
      }
    `;
    
    const response = await axios.post('https://api.monday.com/v2', {
      query: query
    }, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });
    
    if (response.data.errors) {
      return { success: false, error: response.data.errors[0].message };
    }
    
    if (response.data.data && response.data.data.me) {
      return { success: true, user: response.data.data.me };
    } else {
      return { success: false, error: 'Invalid user data response' };
    }
    
  } catch (error) {
    console.error('[OAuth] User info fetch failed:', error.response?.data || error.message);
    return { success: false, error: 'Failed to fetch user information' };
  }
}

/**
 * Fetch all boards the user has access to
 * @param {string} telegram_user_id
 * @returns {array} - [{ id, name, board_kind, items_count }] or throws error
 */
async function fetchUserBoards(telegram_user_id) {
  const user = db.getUser(telegram_user_id);
  if (!user || !user.monday_token_encrypted) {
    throw new Error('User not found or not connected to Monday.com');
  }
  
  // Decrypt token
  const token = decrypt({
    encrypted: user.monday_token_encrypted,
    iv: user.monday_token_iv,
    tag: user.monday_token_tag
  });
  
  if (!token) {
    throw new Error('Failed to decrypt Monday.com token');
  }
  
  try {
    const query = `
      query {
        boards(limit: 50) {
          id
          name
          board_kind
          items_count
        }
      }
    `;
    
    const response = await axios.post('https://api.monday.com/v2', {
      query: query
    }, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });
    
    if (response.data.errors) {
      throw new Error(response.data.errors[0].message);
    }
    
    const boards = response.data.data?.boards || [];
    
    console.log(`[OAuth] Fetched ${boards.length} boards for user: ${telegram_user_id}`);
    return boards;
    
  } catch (error) {
    console.error('[OAuth] Board fetch failed:', error.message);
    
    // Log the failure
    db.logAction({
      telegram_user_id,
      action: 'board_fetch_failed',
      error_message: error.message,
      success: 0
    });
    
    throw new Error('Failed to fetch boards from Monday.com');
  }
}

/**
 * Verify a user's token is still valid
 * @param {string} telegram_user_id
 * @returns {object} - { valid: true, user_name, account_name } or { valid: false, error }
 */
async function verifyToken(telegram_user_id) {
  try {
    const user = db.getUser(telegram_user_id);
    if (!user || !user.monday_token_encrypted) {
      return { valid: false, error: 'No token found' };
    }
    
    // Decrypt token
    const token = decrypt({
      encrypted: user.monday_token_encrypted,
      iv: user.monday_token_iv,
      tag: user.monday_token_tag
    });
    
    if (!token) {
      return { valid: false, error: 'Token decryption failed' };
    }
    
    // Test token with a simple query
    const userInfo = await getMondayUserInfo(token);
    
    if (userInfo.success) {
      return {
        valid: true,
        user_name: userInfo.user.name,
        account_name: userInfo.user.account.name
      };
    } else {
      return { valid: false, error: userInfo.error };
    }
    
  } catch (error) {
    console.error('[OAuth] Token verification failed:', error.message);
    return { valid: false, error: 'Verification failed' };
  }
}

/**
 * Revoke token and reset user to oauth_pending state
 * @param {string} telegram_user_id
 */
function revokeToken(telegram_user_id) {
  try {
    // Clear token data
    db.updateUser(telegram_user_id, {
      monday_token_encrypted: null,
      monday_token_iv: null,
      monday_token_tag: null,
      monday_user_id: null,
      monday_account_id: null,
      company_name: null,
      onboarding_state: 'oauth_pending'
    });
    
    // Remove all board access
    const boards = db.getUserBoards(telegram_user_id);
    for (const board of boards) {
      db.removeBoardAccess(telegram_user_id, board.board_id);
    }
    
    // Log the revocation
    db.logAction({
      telegram_user_id,
      action: 'token_revoked',
      result_summary: 'User disconnected from Monday.com',
      success: 1
    });
    
    console.log(`[OAuth] Revoked token for user: ${telegram_user_id}`);
    
  } catch (error) {
    console.error('[OAuth] Token revocation failed:', error.message);
    throw error;
  }
}

module.exports = {
  getAuthorizationUrl,
  handleCallback,
  fetchUserBoards,
  verifyToken,
  revokeToken
};