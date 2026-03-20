/**
 * Gemini AI Integration
 * Handles AI processing with dynamic user context
 */

const axios = require('axios');

/**
 * Build dynamic system prompt based on user context
 * @param {object} userContext - User context from loadContext()
 * @returns {string} - System prompt
 */
function buildSystemPrompt(userContext = {}) {
  // V1 fallback - if no user context, use hardcoded prompt
  if (!userContext.user) {
    return buildV1SystemPrompt();
  }
  
  const { user, boards, defaultBoard } = userContext;
  
  let prompt = `You are ARIA, a CRM assistant for ${user.company_name || 'your company'}.

User: ${user.telegram_first_name || 'User'}
Access level: ${user.access_level || 'manager'}

Connected boards:`;

  if (boards && boards.length > 0) {
    boards.forEach((board, index) => {
      const defaultMarker = board.is_default ? ' [DEFAULT]' : '';
      prompt += `\n${index + 1}. ${board.board_name} (ID: ${board.board_id}, ${board.item_count} items)${defaultMarker}`;
    });
  } else {
    prompt += '\nNo boards connected';
  }
  
  if (defaultBoard) {
    prompt += `\n\nCurrent board: ${defaultBoard.board_name} (ID: ${defaultBoard.board_id})`;
  } else {
    prompt += '\n\nCurrent board: Not selected';
  }
  
  prompt += `

Available commands:
- show leads / show items — List items from the current board
- create lead [name] — Create a new item
- update [name] status [value] — Update item status
- search [term] — Search across connected boards`;

  if (user.access_level === 'admin' || userContext.isFounder) {
    prompt += `
- /admin — Admin panel
- /analytics — Usage stats`;
  }

  prompt += `

Always specify which board you're operating on in your responses.
If the user's query is ambiguous about which board, ask them to clarify.

GRAPHQL OPERATION LIBRARY:
Use these exact patterns for Monday.com queries:

GET ALL ITEMS:
query { boards(ids: [BOARD_ID]) { items_page(limit: 50) { items { id name column_values { id text } created_at } } } }

GET ITEMS BY STATUS:
query { items_page_by_column_values(limit: 50, board_id: BOARD_ID, columns: [{column_id: "color_mm16g2da", column_values: ["STATUS_LABEL"]}]) { items { id name column_values { id text } created_at } } }

SEARCH BY NAME:
query { boards(ids: [BOARD_ID]) { items_page(limit: 20, query_params: {rules: [{column_id: "name", compare_value: ["SEARCH_TERM"], operator: contains_text}]}) { items { id name column_values { id text } } } } }

CREATE ITEM:
mutation { create_item(board_id: BOARD_ID, group_id: "topics", item_name: "LEAD_NAME", column_values: "{\\"text_mm16cs9s\\":\\"MESSAGE\\",\\"text_mm1643wg\\":\\"PHONE\\",\\"text_mm16b94c\\":\\"SOURCE\\",\\"color_mm16g2da\\":{\\"label\\":\\"STATUS_LABEL\\"}}") { id name } }

UPDATE STATUS:
mutation { change_multiple_column_values(board_id: BOARD_ID, item_id: ITEM_ID, column_values: "{\\"color_mm16g2da\\":{\\"label\\":\\"STATUS_LABEL\\"}}") { id name } }

OUTPUT FORMAT — STRICT JSON ONLY:
{
  "human_response": "What you say back to the user. Clean. Short. Precise.",
  "requires_monday_action": true,
  "graphql_queries": ["query or mutation 1", "query or mutation 2"],
  "operation_type": "read | create | update | delete | analytics | intelligence",
  "followup_action": "any followup needed after Monday returns data, or empty string"
}`;

  return prompt;
}

/**
 * Build V1 system prompt (fallback for backward compatibility)
 * @returns {string}
 */
function buildV1SystemPrompt() {
  const BOARD_ID = process.env.MONDAY_INQUIRIES_BOARD_ID || '5027332893';
  
  return `You are ARIA, a CRM assistant for Denicx Entertainment.
You manage the Inquiries board (ID: ${BOARD_ID}).

Available commands:
- show leads — List all items
- create lead [name] — Create new item
- update [name] status [value] — Update status
- search [term] — Search items

Use the GraphQL patterns provided and return JSON responses only.`;
}

/**
 * Process message with AI using dynamic user context
 * @param {string} userMessage - User's message
 * @param {array} conversationHistory - Previous conversation
 * @param {object} userContext - User context (optional, falls back to V1)
 * @returns {object} - AI response
 */
async function processWithAI(userMessage, conversationHistory = [], userContext = {}) {
  const systemPrompt = buildSystemPrompt(userContext);
  
  // Build conversation for Gemini
  const messages = [
    { role: 'user', parts: [{ text: userMessage }] }
  ];
  
  // Add conversation history
  if (conversationHistory && conversationHistory.length > 0) {
    // Add recent history (last 5 exchanges)
    const recentHistory = conversationHistory.slice(-5);
    messages.unshift(...recentHistory);
  }
  
  try {
    console.log('[AI] Making request to Gemini API...');
    console.log('[AI] API Key present:', !!process.env.GEMINI_API_KEY);
    console.log('[AI] Model:', process.env.GEMINI_MODEL || 'gemini-2.5-flash');
    
    const response = await axios.post(
      `${process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta'}/models/${process.env.GEMINI_MODEL || 'gemini-2.5-flash'}:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        system_instruction: {
          parts: [{ text: systemPrompt }]
        },
        contents: messages,
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 2048
        }
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000
      }
    );
    
    console.log('[AI] Response received, status:', response.status);
    
    if (response.data.candidates && response.data.candidates[0]) {
      const aiText = response.data.candidates[0].content.parts[0].text;
      console.log('[AI] Raw AI response:', aiText.substring(0, 200) + '...');
      
      // Parse JSON response
      try {
        // Try to extract JSON from markdown code blocks if present
        let jsonText = aiText;
        const jsonMatch = aiText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
        if (jsonMatch) {
          jsonText = jsonMatch[1];
          console.log('[AI] Extracted JSON from markdown block');
        }
        
        const aiResult = JSON.parse(jsonText);
        
        // Validate required fields
        if (!aiResult.human_response) {
          throw new Error('Missing human_response field');
        }
        
        console.log('[AI] Successfully parsed JSON response');
        return aiResult;
      } catch (parseError) {
        console.error('[AI] JSON parse failed:', parseError.message);
        console.error('[AI] Full raw response:', aiText);
        
        // Fallback response
        return {
          human_response: "I had trouble processing that request. Could you try rephrasing it?",
          requires_monday_action: false,
          graphql_queries: [],
          operation_type: "error",
          followup_action: ""
        };
      }
    } else {
      console.error('[AI] No candidates in response:', JSON.stringify(response.data));
      throw new Error('No response from Gemini');
    }
    
  } catch (error) {
    console.error('[AI] Processing failed:', error.message);
    if (error.response) {
      console.error('[AI] API Error Status:', error.response.status);
      console.error('[AI] API Error Data:', JSON.stringify(error.response.data));
    }
    
    return {
      human_response: "Sorry, I'm having trouble connecting to my AI brain right now. Please try again in a moment.",
      requires_monday_action: false,
      graphql_queries: [],
      operation_type: "error",
      followup_action: ""
    };
  }
}

module.exports = {
  processWithAI,
  buildSystemPrompt
};