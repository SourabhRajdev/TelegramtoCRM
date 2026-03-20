/**
 * Board Selection Flow
 * Interactive board selection after OAuth completion
 */

const db = require('./database');
const oauth = require('./oauth');
const { sendTelegramMessage } = require('./telegram');

/**
 * Present board selection to user via Telegram
 * @param {string} telegram_user_id
 * @returns {boolean} - Success status
 */
async function presentBoardSelection(telegram_user_id) {
  try {
    console.log(`[BoardSelector] Presenting board selection for user: ${telegram_user_id}`);
    
    // Fetch boards from Monday.com
    const boards = await oauth.fetchUserBoards(telegram_user_id);
    
    if (!boards || boards.length === 0) {
      await sendTelegramMessage(telegram_user_id, 
        "🤔 I couldn't find any boards in your Monday.com account.\n\n" +
        "Make sure you have at least one board created in Monday.com, then try /boards to refresh."
      );
      return false;
    }
    
    // Format board list
    let message = `📋 Found ${boards.length} boards in your Monday.com account:\n\n`;
    
    boards.forEach((board, index) => {
      const emoji = getBoardEmoji(board.board_kind);
      const itemText = board.items_count === 1 ? 'item' : 'items';
      message += `${index + 1}. ${emoji} ${board.name} (${board.items_count || 0} ${itemText})\n`;
    });
    
    message += `\n💡 **How to select boards:**\n`;
    message += `• Reply with numbers: \`1,2,3\`\n`;
    message += `• Reply with names: \`Sales, Projects\`\n`;
    message += `• Reply \`all\` to activate all boards\n\n`;
    message += `You can change this anytime with /boards`;
    
    await sendTelegramMessage(telegram_user_id, message);
    
    // Log the presentation
    db.logAction({
      telegram_user_id,
      action: 'board_selection_presented',
      result_summary: `Showed ${boards.length} boards`,
      success: 1
    });
    
    return true;
    
  } catch (error) {
    console.error('[BoardSelector] Present selection failed:', error.message);
    
    await sendTelegramMessage(telegram_user_id,
      "😓 Sorry, I couldn't fetch your boards from Monday.com.\n\n" +
      "This might be a temporary issue. Please try again in a moment, or use /disconnect to reconnect your account."
    );
    
    // Log the error
    db.logAction({
      telegram_user_id,
      action: 'board_selection_failed',
      error_message: error.message,
      success: 0
    });
    
    return false;
  }
}

/**
 * Process user's board selection response
 * @param {string} telegram_user_id
 * @param {string} selectionText - User's selection (e.g., "1,2", "all", "sales, pipeline")
 * @returns {object} - { success: true, boards: [...], defaultBoard: ... } or { success: false, error: ... }
 */
async function processSelection(telegram_user_id, selectionText) {
  try {
    console.log(`[BoardSelector] Processing selection for user ${telegram_user_id}: "${selectionText}"`);
    
    // Fetch current boards from Monday.com
    const availableBoards = await oauth.fetchUserBoards(telegram_user_id);
    
    if (!availableBoards || availableBoards.length === 0) {
      return { success: false, error: 'No boards available' };
    }
    
    let selectedBoards = [];
    const selection = selectionText.trim().toLowerCase();
    
    if (selection === 'all') {
      // Select all boards
      selectedBoards = availableBoards;
    } else if (/^[\d,\s]+$/.test(selection)) {
      // Number-based selection: "1,2,3"
      const indices = selection.split(',')
        .map(s => parseInt(s.trim()) - 1) // Convert to 0-based
        .filter(i => i >= 0 && i < availableBoards.length);
      
      selectedBoards = indices.map(i => availableBoards[i]);
    } else {
      // Name-based selection: "sales, pipeline"
      const names = selection.split(',').map(s => s.trim().toLowerCase());
      
      selectedBoards = availableBoards.filter(board => {
        const boardName = board.name.toLowerCase();
        return names.some(name => 
          boardName.includes(name) || name.includes(boardName)
        );
      });
    }
    
    if (selectedBoards.length === 0) {
      return { 
        success: false, 
        error: `No boards matched your selection "${selectionText}". Try using numbers (1,2) or board names.`
      };
    }
    
    // Store board access in database
    const activatedBoards = [];
    
    for (const [index, board] of selectedBoards.entries()) {
      const boardAccess = db.addBoardAccess(telegram_user_id, {
        board_id: board.id,
        board_name: board.name,
        board_kind: board.board_kind,
        item_count: board.items_count || 0,
        added_by: telegram_user_id // Self-added during onboarding
      });
      
      activatedBoards.push(boardAccess);
      
      // Set first board as default
      if (index === 0) {
        db.setDefaultBoard(telegram_user_id, board.id);
      }
    }
    
    // Update onboarding state to active
    db.setOnboardingState(telegram_user_id, 'active');
    
    // Log the selection
    db.logAction({
      telegram_user_id,
      action: 'boards_selected',
      result_summary: `Activated ${selectedBoards.length} boards: ${selectedBoards.map(b => b.name).join(', ')}`,
      success: 1
    });
    
    console.log(`[BoardSelector] Successfully activated ${selectedBoards.length} boards for user: ${telegram_user_id}`);
    
    return {
      success: true,
      boards: activatedBoards,
      defaultBoard: activatedBoards[0]
    };
    
  } catch (error) {
    console.error('[BoardSelector] Process selection failed:', error.message);
    
    // Log the error
    db.logAction({
      telegram_user_id,
      action: 'board_selection_error',
      query_text: selectionText,
      error_message: error.message,
      success: 0
    });
    
    return { success: false, error: 'Failed to process board selection' };
  }
}

/**
 * Add a board later (after initial setup)
 * @param {string} telegram_user_id
 * @param {string} boardIdentifier - Board name or ID
 * @returns {object} - { success: true, board } or { success: false, error }
 */
async function addBoard(telegram_user_id, boardIdentifier) {
  try {
    // Fetch all available boards
    const availableBoards = await oauth.fetchUserBoards(telegram_user_id);
    
    // Find the board
    const board = availableBoards.find(b => 
      b.id === boardIdentifier || 
      b.name.toLowerCase().includes(boardIdentifier.toLowerCase())
    );
    
    if (!board) {
      return { success: false, error: `Board "${boardIdentifier}" not found` };
    }
    
    // Check if already added
    const existingAccess = db.getUserBoards(telegram_user_id)
      .find(ba => ba.board_id === board.id);
    
    if (existingAccess) {
      return { success: false, error: `Board "${board.name}" is already activated` };
    }
    
    // Add board access
    const boardAccess = db.addBoardAccess(telegram_user_id, {
      board_id: board.id,
      board_name: board.name,
      board_kind: board.board_kind,
      item_count: board.items_count || 0,
      added_by: telegram_user_id
    });
    
    // If this is the user's first board, make it default
    const userBoards = db.getUserBoards(telegram_user_id);
    if (userBoards.length === 1) {
      db.setDefaultBoard(telegram_user_id, board.id);
    }
    
    // Log the addition
    db.logAction({
      telegram_user_id,
      action: 'board_added',
      board_id: board.id,
      board_name: board.name,
      result_summary: `Added board: ${board.name}`,
      success: 1
    });
    
    return { success: true, board: boardAccess };
    
  } catch (error) {
    console.error('[BoardSelector] Add board failed:', error.message);
    return { success: false, error: 'Failed to add board' };
  }
}

/**
 * Remove a board
 * @param {string} telegram_user_id
 * @param {string} boardIdentifier - Board name or ID
 * @returns {object} - { success: true } or { success: false, error }
 */
async function removeBoard(telegram_user_id, boardIdentifier) {
  try {
    // Get user's current boards
    const userBoards = db.getUserBoards(telegram_user_id);
    
    // Find the board to remove
    const board = userBoards.find(b => 
      b.board_id === boardIdentifier || 
      b.board_name.toLowerCase().includes(boardIdentifier.toLowerCase())
    );
    
    if (!board) {
      return { success: false, error: `Board "${boardIdentifier}" not found in your active boards` };
    }
    
    // Don't allow removing the last board
    if (userBoards.length === 1) {
      return { success: false, error: 'Cannot remove your last board. Add another board first.' };
    }
    
    // Remove board access
    const removed = db.removeBoardAccess(telegram_user_id, board.board_id);
    
    if (!removed) {
      return { success: false, error: 'Failed to remove board access' };
    }
    
    // If this was the default board, set a new default
    if (board.is_default) {
      const remainingBoards = db.getUserBoards(telegram_user_id);
      if (remainingBoards.length > 0) {
        db.setDefaultBoard(telegram_user_id, remainingBoards[0].board_id);
      }
    }
    
    // Log the removal
    db.logAction({
      telegram_user_id,
      action: 'board_removed',
      board_id: board.board_id,
      board_name: board.board_name,
      result_summary: `Removed board: ${board.board_name}`,
      success: 1
    });
    
    return { success: true };
    
  } catch (error) {
    console.error('[BoardSelector] Remove board failed:', error.message);
    return { success: false, error: 'Failed to remove board' };
  }
}

/**
 * Refresh board list from Monday.com (update cached names and item counts)
 * @param {string} telegram_user_id
 * @returns {object} - { success: true, updated: number } or { success: false, error }
 */
async function refreshBoards(telegram_user_id) {
  try {
    // Get current board access
    const userBoards = db.getUserBoards(telegram_user_id);
    
    if (userBoards.length === 0) {
      return { success: false, error: 'No boards to refresh' };
    }
    
    // Fetch latest data from Monday.com
    const availableBoards = await oauth.fetchUserBoards(telegram_user_id);
    
    let updatedCount = 0;
    
    // Update each board's cached data
    for (const userBoard of userBoards) {
      const latestBoard = availableBoards.find(b => b.id === userBoard.board_id);
      
      if (latestBoard) {
        // Update cached data
        db.addBoardAccess(telegram_user_id, {
          board_id: latestBoard.id,
          board_name: latestBoard.name,
          board_kind: latestBoard.board_kind,
          item_count: latestBoard.items_count || 0,
          added_by: userBoard.added_by
        });
        updatedCount++;
      }
    }
    
    // Log the refresh
    db.logAction({
      telegram_user_id,
      action: 'boards_refreshed',
      result_summary: `Updated ${updatedCount} boards`,
      success: 1
    });
    
    return { success: true, updated: updatedCount };
    
  } catch (error) {
    console.error('[BoardSelector] Refresh boards failed:', error.message);
    return { success: false, error: 'Failed to refresh boards' };
  }
}

/**
 * Set a board as default
 * @param {string} telegram_user_id
 * @param {string} boardIdentifier - Board name or ID
 * @returns {object} - { success: true, board } or { success: false, error }
 */
async function setDefault(telegram_user_id, boardIdentifier) {
  try {
    // Get user's boards
    const userBoards = db.getUserBoards(telegram_user_id);
    
    // Find the board
    const board = userBoards.find(b => 
      b.board_id === boardIdentifier || 
      b.board_name.toLowerCase().includes(boardIdentifier.toLowerCase())
    );
    
    if (!board) {
      return { success: false, error: `Board "${boardIdentifier}" not found in your active boards` };
    }
    
    // Set as default
    db.setDefaultBoard(telegram_user_id, board.board_id);
    
    // Log the change
    db.logAction({
      telegram_user_id,
      action: 'default_board_set',
      board_id: board.board_id,
      board_name: board.board_name,
      result_summary: `Set default board: ${board.board_name}`,
      success: 1
    });
    
    return { success: true, board };
    
  } catch (error) {
    console.error('[BoardSelector] Set default failed:', error.message);
    return { success: false, error: 'Failed to set default board' };
  }
}

/**
 * Get emoji for board type
 * @param {string} board_kind
 * @returns {string}
 */
function getBoardEmoji(board_kind) {
  switch (board_kind) {
    case 'public': return '📋';
    case 'private': return '🔒';
    case 'share': return '🔗';
    default: return '📋';
  }
}

module.exports = {
  presentBoardSelection,
  processSelection,
  addBoard,
  removeBoard,
  refreshBoards,
  setDefault
};