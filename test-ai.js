/**
 * Test AI processing locally
 */

require('dotenv').config();
const { processWithAI } = require('./lib/ai');

async function test() {
  console.log('Testing AI with local environment...');
  console.log('API Key present:', !!process.env.GEMINI_API_KEY);
  console.log('Model:', process.env.GEMINI_MODEL);
  
  // Test with a simple query
  const userContext = {
    user: {
      telegram_user_id: '1098008102',
      telegram_username: 'founder',
      telegram_first_name: 'Sourabh',
      company_name: 'Denicx Entertainment',
      access_level: 'admin',
      onboarding_state: 'completed',
      monday_user_id: null,
      monday_account_id: null
    },
    monday_token: process.env.MONDAY_API_TOKEN,
    boards: [{
      board_id: '5027332893',
      board_name: 'New Board',
      item_count: 0,
      is_default: 1
    }],
    defaultBoard: {
      board_id: '5027332893',
      board_name: 'New Board',
      access_level: 'full'
    },
    isFounder: true,
    isActive: true
  };
  
  try {
    console.log('\n--- Testing: "show leads" ---');
    const result = await processWithAI('show leads', [], userContext);
    console.log('\nResult:', JSON.stringify(result, null, 2));
    
    console.log('\n--- Testing: "add a lead name sourabh" ---');
    const result2 = await processWithAI('add a lead name sourabh', [], userContext);
    console.log('\nResult:', JSON.stringify(result2, null, 2));
    
  } catch (error) {
    console.error('Test failed:', error.message);
    console.error(error.stack);
  }
}

test();
