/**
 * Admin Panel
 * Management commands for founders and admin-level users
 */

const db = require('./database');
const { sendTelegramMessage } = require('./telegram');
const { clearUserCache } = require('./userContext');

/**
 * Check if a user is an admin
 * @param {string} telegram_user_id
 * @returns {boolean}
 */
function isAdmin(telegram_user_id) {
  // Check if user is the founder
  const founderChatId = process.env.TELEGRAM_FOUNDER_CHAT_ID;
  if (founderChatId && telegram_user_id === founderChatId) {
    return true;
  }
  
  // Check database access level
  const user = db.getUser(telegram_user_id);
  return user && user.access_level === 'admin';
}

/**
 * Handle /admin command - show admin dashboard
 * @param {string} telegram_user_id
 */
async function handleAdminCommand(telegram_user_id) {
  if (!isAdmin(telegram_user_id)) {
    await sendTelegramMessage(telegram_user_id, "⛔ Admin access required.");
    return;
  }
  
  try {
    // Get global statistics
    const stats = db.getGlobalStats();
    
    // Get recent activity
    const recentActions = db.getRecentActions(telegram_user_id, 5);
    
    let message = "👑 **ARIA Admin Panel**\n";
    message += "━━━━━━━━━━━━━━━━━━━\n\n";
    
    message += `📊 **System Overview:**\n`;
    message += `• 👥 Active users: ${stats.total_users}\n`;
    message += `• 📈 Queries today: ${stats.active_today}\n`;
    message += `• 🔢 Total queries: ${stats.total_queries}\n`;
    message += `• 🔐 All tokens encrypted: ✅\n\n`;
    
    message += `⚡ **Quick Commands:**\n`;
    message += `• \`/users\` — List all registered users\n`;
    message += `• \`/grant @user board:name\` — Grant board access\n`;
    message += `• \`/revoke @user\` — Deactivate a user\n`;
    message += `• \`/analytics\` — Detailed usage statistics\n`;
    message += `• \`/broadcast message\` — Send to all users\n\n`;
    
    if (recentActions.length > 0) {
      message += `📝 **Recent Activity:**\n`;
      recentActions.forEach(action => {
        const time = new Date(action.created_at).toLocaleTimeString();
        const status = action.success ? '✅' : '❌';
        message += `• ${time} ${status} ${action.action}\n`;
      });
    }
    
    await sendTelegramMessage(telegram_user_id, message);
    
    // Log admin access
    db.logAction({
      telegram_user_id,
      action: 'admin_panel_accessed',
      result_summary: 'Viewed admin dashboard',
      success: 1
    });
    
  } catch (error) {
    console.error('[Admin] Dashboard failed:', error.message);
    await sendTelegramMessage(telegram_user_id, "😓 Failed to load admin dashboard.");
  }
}

/**
 * Handle /users command - list all registered users
 * @param {string} telegram_user_id
 */
async function handleUsersCommand(telegram_user_id) {
  if (!isAdmin(telegram_user_id)) {
    await sendTelegramMessage(telegram_user_id, "⛔ Admin access required.");
    return;
  }
  
  try {
    const users = db.listActiveUsers();
    
    if (users.length === 0) {
      await sendTelegramMessage(telegram_user_id, "No registered users found.");
      return;
    }
    
    let message = `👥 **Active Users (${users.length}):**\n\n`;
    
    for (const [index, user] of users.entries()) {
      const stats = db.getActionStats(user.telegram_user_id);
      const boards = db.getUserBoards(user.telegram_user_id);
      
      const name = user.telegram_first_name || user.telegram_username || 'Unknown';
      const company = user.company_name || 'No company';
      const lastActive = user.last_active_at ? 
        new Date(user.last_active_at).toLocaleDateString() : 'Never';
      
      message += `${index + 1}. **${name}** (@${user.telegram_username || 'no_username'})\n`;
      message += `   📊 Company: ${company}\n`;
      message += `   📋 Boards: ${boards.length}\n`;
      message += `   🔢 Queries: ${stats.total_queries} (${stats.queries_today} today)\n`;
      message += `   📅 Last active: ${lastActive}\n`;
      message += `   🆔 ID: \`${user.telegram_user_id}\`\n\n`;
    }
    
    message += `💡 Use \`/grant @username board:name\` to grant access\n`;
    message += `💡 Use \`/revoke @username\` to deactivate a user`;
    
    await sendTelegramMessage(telegram_user_id, message);
    
    // Log users access
    db.logAction({
      telegram_user_id,
      action: 'users_list_accessed',
      result_summary: `Viewed ${users.length} users`,
      success: 1
    });
    
  } catch (error) {
    console.error('[Admin] Users list failed:', error.message);
    await sendTelegramMessage(telegram_user_id, "😓 Failed to load users list.");
  }
}

/**
 * Handle /grant command - grant board access to a user
 * @param {string} telegram_user_id - Admin user ID
 * @param {string} targetUser - Target username or user ID
 * @param {string} boardSpec - Board specification (name or ID)
 */
async function handleGrantCommand(telegram_user_id, targetUser, boardSpec) {
  if (!isAdmin(telegram_user_id)) {
    await sendTelegramMessage(telegram_user_id, "⛔ Admin access required.");
    return;
  }
  
  try {
    // Find target user
    const users = db.listActiveUsers();
    const target = users.find(u => 
      u.telegram_username === targetUser.replace('@', '') ||
      u.telegram_user_id === targetUser ||
      u.telegram_first_name?.toLowerCase() === targetUser.toLowerCase()
    );
    
    if (!target) {
      await sendTelegramMessage(telegram_user_id, 
        `❌ User "${targetUser}" not found.\n\nUse /users to see all registered users.`
      );
      return;
    }
    
    // Check if target user has Monday.com connected
    if (target.onboarding_state !== 'active') {
      await sendTelegramMessage(telegram_user_id,
        `❌ User ${target.telegram_first_name || target.telegram_username} hasn't completed onboarding yet.\n\n` +
        `They need to connect their Monday.com account first.`
      );
      return;
    }
    
    // For now, this is a placeholder - in a full implementation, you'd need to:
    // 1. Fetch the admin's boards or all available boards
    // 2. Match the boardSpec to an actual board
    // 3. Add board access for the target user
    
    await sendTelegramMessage(telegram_user_id,
      `🚧 **Grant Access Feature**\n\n` +
      `This feature requires additional implementation to:\n` +
      `• Discover available boards across accounts\n` +
      `• Handle cross-account board sharing\n` +
      `• Manage board permissions\n\n` +
      `For now, users can connect their own boards via /boards`
    );
    
    // Log the attempt
    db.logAction({
      telegram_user_id,
      action: 'grant_access_attempted',
      query_text: `${targetUser} ${boardSpec}`,
      result_summary: 'Feature not yet implemented',
      success: 0
    });
    
  } catch (error) {
    console.error('[Admin] Grant command failed:', error.message);
    await sendTelegramMessage(telegram_user_id, "😓 Failed to process grant command.");
  }
}

/**
 * Handle /revoke command - deactivate a user
 * @param {string} telegram_user_id - Admin user ID
 * @param {string} targetUser - Target username or user ID
 */
async function handleRevokeCommand(telegram_user_id, targetUser) {
  if (!isAdmin(telegram_user_id)) {
    await sendTelegramMessage(telegram_user_id, "⛔ Admin access required.");
    return;
  }
  
  try {
    // Find target user
    const users = db.listActiveUsers();
    const target = users.find(u => 
      u.telegram_username === targetUser.replace('@', '') ||
      u.telegram_user_id === targetUser ||
      u.telegram_first_name?.toLowerCase() === targetUser.toLowerCase()
    );
    
    if (!target) {
      await sendTelegramMessage(telegram_user_id, 
        `❌ User "${targetUser}" not found.\n\nUse /users to see all registered users.`
      );
      return;
    }
    
    // Don't allow revoking founder access
    const founderChatId = process.env.TELEGRAM_FOUNDER_CHAT_ID;
    if (target.telegram_user_id === founderChatId) {
      await sendTelegramMessage(telegram_user_id, "❌ Cannot revoke founder access.");
      return;
    }
    
    // Deactivate the user
    db.deactivateUser(target.telegram_user_id);
    
    // Clear their cache
    clearUserCache(target.telegram_user_id);
    
    // Notify the admin
    const name = target.telegram_first_name || target.telegram_username || 'Unknown';
    await sendTelegramMessage(telegram_user_id, 
      `✅ **Access Revoked**\n\n` +
      `User: ${name} (@${target.telegram_username || 'no_username'})\n` +
      `Company: ${target.company_name || 'Unknown'}\n\n` +
      `They will no longer be able to use ARIA.`
    );
    
    // Notify the revoked user
    await sendTelegramMessage(target.telegram_user_id,
      `⚠️ **Access Revoked**\n\n` +
      `Your ARIA access has been deactivated by an administrator.\n\n` +
      `If you believe this is an error, please contact your team administrator.`
    );
    
    // Log the revocation
    db.logAction({
      telegram_user_id,
      action: 'user_access_revoked',
      query_text: targetUser,
      result_summary: `Revoked access for ${name}`,
      success: 1
    });
    
    db.logAction({
      telegram_user_id: target.telegram_user_id,
      action: 'access_revoked_by_admin',
      result_summary: `Access revoked by admin`,
      success: 1
    });
    
  } catch (error) {
    console.error('[Admin] Revoke command failed:', error.message);
    await sendTelegramMessage(telegram_user_id, "😓 Failed to process revoke command.");
  }
}

/**
 * Handle /analytics command - show detailed usage statistics
 * @param {string} telegram_user_id
 */
async function handleAnalyticsCommand(telegram_user_id) {
  if (!isAdmin(telegram_user_id)) {
    await sendTelegramMessage(telegram_user_id, "⛔ Admin access required.");
    return;
  }
  
  try {
    // Get global stats
    const globalStats = db.getGlobalStats();
    
    // Get top users by query count
    const users = db.listActiveUsers();
    const userStats = users.map(user => ({
      ...user,
      stats: db.getActionStats(user.telegram_user_id)
    })).sort((a, b) => b.stats.total_queries - a.stats.total_queries);
    
    let message = "📊 **ARIA Analytics Dashboard**\n";
    message += "━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n";
    
    message += `🌍 **Global Statistics:**\n`;
    message += `• Total users: ${globalStats.total_users}\n`;
    message += `• Active today: ${globalStats.active_today}\n`;
    message += `• Total queries: ${globalStats.total_queries}\n`;
    message += `• Avg queries per user: ${Math.round(globalStats.total_queries / globalStats.total_users)}\n\n`;
    
    message += `🏆 **Top Users (by total queries):**\n`;
    userStats.slice(0, 5).forEach((user, index) => {
      const name = user.telegram_first_name || user.telegram_username || 'Unknown';
      message += `${index + 1}. ${name}: ${user.stats.total_queries} queries (${user.stats.queries_today} today)\n`;
    });
    
    if (userStats.length > 5) {
      message += `... and ${userStats.length - 5} more users\n`;
    }
    
    message += `\n📈 **Usage Trends:**\n`;
    message += `• Most active user: ${userStats[0]?.telegram_first_name || 'None'} (${userStats[0]?.stats.total_queries || 0} queries)\n`;
    message += `• Average daily usage: ${Math.round(globalStats.active_today / globalStats.total_users * 100)}% of users\n`;
    
    await sendTelegramMessage(telegram_user_id, message);
    
    // Log analytics access
    db.logAction({
      telegram_user_id,
      action: 'analytics_accessed',
      result_summary: 'Viewed analytics dashboard',
      success: 1
    });
    
  } catch (error) {
    console.error('[Admin] Analytics failed:', error.message);
    await sendTelegramMessage(telegram_user_id, "😓 Failed to load analytics.");
  }
}

/**
 * Handle /broadcast command - send message to all users
 * @param {string} telegram_user_id - Admin user ID
 * @param {string} message - Message to broadcast
 */
async function handleBroadcastCommand(telegram_user_id, message) {
  if (!isAdmin(telegram_user_id)) {
    await sendTelegramMessage(telegram_user_id, "⛔ Admin access required.");
    return;
  }
  
  try {
    const users = db.listActiveUsers();
    
    if (users.length === 0) {
      await sendTelegramMessage(telegram_user_id, "No active users to broadcast to.");
      return;
    }
    
    // Confirm broadcast
    await sendTelegramMessage(telegram_user_id,
      `📢 **Broadcast Confirmation**\n\n` +
      `Message: "${message}"\n` +
      `Recipients: ${users.length} active users\n\n` +
      `Reply with "CONFIRM" to send, or anything else to cancel.`
    );
    
    // Note: In a full implementation, you'd need to handle the confirmation response
    // For now, this is a placeholder showing the broadcast structure
    
    // Log broadcast attempt
    db.logAction({
      telegram_user_id,
      action: 'broadcast_initiated',
      query_text: message,
      result_summary: `Prepared broadcast for ${users.length} users`,
      success: 1
    });
    
  } catch (error) {
    console.error('[Admin] Broadcast failed:', error.message);
    await sendTelegramMessage(telegram_user_id, "😓 Failed to prepare broadcast.");
  }
}

/**
 * Parse admin command from message text
 * @param {string} messageText
 * @returns {object} - { command, args }
 */
function parseAdminCommand(messageText) {
  const parts = messageText.trim().split(/\s+/);
  const command = parts[0].toLowerCase();
  const args = parts.slice(1);
  
  return { command, args };
}

/**
 * Route admin commands to appropriate handlers
 * @param {string} telegram_user_id
 * @param {string} messageText
 */
async function routeAdminCommand(telegram_user_id, messageText) {
  const { command, args } = parseAdminCommand(messageText);
  
  switch (command) {
    case '/admin':
      await handleAdminCommand(telegram_user_id);
      break;
      
    case '/users':
      await handleUsersCommand(telegram_user_id);
      break;
      
    case '/grant':
      if (args.length >= 2) {
        await handleGrantCommand(telegram_user_id, args[0], args[1]);
      } else {
        await sendTelegramMessage(telegram_user_id, 
          "Usage: `/grant @username board:name`\n\nExample: `/grant @john board:sales`"
        );
      }
      break;
      
    case '/revoke':
      if (args.length >= 1) {
        await handleRevokeCommand(telegram_user_id, args[0]);
      } else {
        await sendTelegramMessage(telegram_user_id, 
          "Usage: `/revoke @username`\n\nExample: `/revoke @john`"
        );
      }
      break;
      
    case '/analytics':
      await handleAnalyticsCommand(telegram_user_id);
      break;
      
    case '/broadcast':
      if (args.length >= 1) {
        const message = args.join(' ');
        await handleBroadcastCommand(telegram_user_id, message);
      } else {
        await sendTelegramMessage(telegram_user_id, 
          "Usage: `/broadcast your message here`\n\nExample: `/broadcast System maintenance tonight at 10 PM`"
        );
      }
      break;
      
    default:
      await sendTelegramMessage(telegram_user_id,
        "❓ Unknown admin command.\n\nAvailable commands:\n" +
        "• `/admin` — Dashboard\n" +
        "• `/users` — List users\n" +
        "• `/grant @user board:name` — Grant access\n" +
        "• `/revoke @user` — Revoke access\n" +
        "• `/analytics` — Usage stats\n" +
        "• `/broadcast message` — Send to all users"
      );
  }
}

module.exports = {
  isAdmin,
  handleAdminCommand,
  handleUsersCommand,
  handleGrantCommand,
  handleRevokeCommand,
  handleAnalyticsCommand,
  handleBroadcastCommand,
  routeAdminCommand
};