/**
 * ============================================================
 * ARIA Agent Simulation Test
 * ============================================================
 * 
 * Tests the new agent decision protocol with real queries.
 * Validates that the agent:
 *   - Generates reasoning (not generic)
 *   - Classifies intent correctly
 *   - Extracts entities and filters
 *   - Produces valid GraphQL queries
 *   - Handles follow-ups with context
 * 
 * Run: node test_agent_simulation.js
 * ============================================================
 */

require('dotenv').config();
const { initChain, invokeAgent } = require('./lib/aria-chain');
const logger = require('./lib/logger');

// Test board IDs
const BOARD_IDS = {
  sales: process.env.MONDAY_SALES_BOARD_ID || '5027332893',
  artists: process.env.MONDAY_ARTISTS_BOARD_ID || '5027403725',
  staff: process.env.MONDAY_STAFF_BOARD_ID || '5027403709',
};

// Test cases covering all intents
const TEST_CASES = [
  // LIST ALL
  {
    name: 'List all artists',
    input: 'show all artists',
    expectedIntent: 'list_all',
    expectedBoard: 'artists',
    expectedFilters: 0,
  },
  
  // LIST FILTERED (single filter)
  {
    name: 'Available DJs',
    input: 'available DJs',
    expectedIntent: 'list_filtered',
    expectedBoard: 'artists',
    expectedFilters: 2, // availability + art_form
  },
  
  // LIST FILTERED (multiple filters + numeric)
  {
    name: 'Complex filter query',
    input: 'show me DJs with more than 5 years experience under AED 4000',
    expectedIntent: 'list_filtered',
    expectedBoard: 'artists',
    expectedFilters: 3, // art_form + experience + pricing
  },
  
  // COUNT
  {
    name: 'Count leads',
    input: 'how many leads do we have',
    expectedIntent: 'count',
    expectedBoard: 'sales',
    expectedFilters: 0,
  },
  
  // SEARCH BY NAME
  {
    name: 'Find person',
    input: 'find Priya',
    expectedIntent: 'search_by_name',
    expectedBoard: 'artists', // default for person names
    expectedPersonName: 'Priya',
  },
  
  // CROSS-BOARD SEARCH
  {
    name: 'Cross-board search',
    input: 'find Ravi across all boards',
    expectedIntent: 'cross_board_search',
    expectedBoard: 'all',
    expectedPersonName: 'Ravi',
  },
  
  // UPDATE ITEM
  {
    name: 'Update status',
    input: 'mark Ravi Khanna as contracted',
    expectedIntent: 'update_item',
    expectedBoard: 'sales',
    expectedPersonName: 'Ravi Khanna',
    expectedAction: 'write',
  },
  
  // CREATE ITEM
  {
    name: 'Create lead',
    input: 'add lead Omar Saeed +971509876543 whatsapp source',
    expectedIntent: 'create_item',
    expectedBoard: 'sales',
    expectedPersonName: 'Omar Saeed',
    expectedAction: 'write',
  },
  
  // STAFF TASKS
  {
    name: 'Staff tasks query',
    input: 'what is Yash working on',
    expectedIntent: 'list_filtered',
    expectedBoard: 'staff',
    expectedPersonName: 'Yash',
  },
  
  // GREETING
  {
    name: 'Greeting',
    input: 'hey',
    expectedIntent: 'greeting',
    expectedAction: 'chat',
  },
  
  // FOLLOW-UP
  {
    name: 'Follow-up with filter',
    input: 'now show me the ones under 3000',
    expectedIntent: 'follow_up',
    expectedFilters: 1, // pricing filter
  },
  
  // CLARIFY
  {
    name: 'Ambiguous query',
    input: 'update Ravi',
    expectedIntent: 'clarify',
    expectedAction: 'question',
  },
  
  // QUALIFIED LEADS
  {
    name: 'Status filter',
    input: 'qualified leads',
    expectedIntent: 'list_filtered',
    expectedBoard: 'sales',
    expectedFilters: 1, // status filter
  },
];

// Validation functions
function validateReasoning(reasoning) {
  const issues = [];
  
  if (!reasoning || reasoning.length < 30) {
    issues.push('Reasoning too short (< 30 chars)');
  }
  
  const genericPatterns = [
    /^the user (wants|is asking|asked)/i,
    /^user wants/i,
    /^this is a/i,
    /^i will/i,
  ];
  
  if (reasoning && genericPatterns.some(p => p.test(reasoning.trim()))) {
    issues.push('Reasoning is generic');
  }
  
  return issues;
}

function validateTestCase(testCase, output) {
  const failures = [];
  
  // Validate reasoning
  const reasoningIssues = validateReasoning(output.reasoning);
  if (reasoningIssues.length > 0) {
    failures.push(...reasoningIssues);
  }
  
  // Validate intent
  if (testCase.expectedIntent && output.intent !== testCase.expectedIntent) {
    failures.push(`Intent mismatch: expected "${testCase.expectedIntent}", got "${output.intent}"`);
  }
  
  // Validate board
  if (testCase.expectedBoard && output.entities?.board !== testCase.expectedBoard) {
    failures.push(`Board mismatch: expected "${testCase.expectedBoard}", got "${output.entities?.board}"`);
  }
  
  // Validate filters
  if (testCase.expectedFilters !== undefined) {
    const actualFilters = output.entities?.filters?.length || 0;
    if (actualFilters !== testCase.expectedFilters) {
      failures.push(`Filter count mismatch: expected ${testCase.expectedFilters}, got ${actualFilters}`);
    }
  }
  
  // Validate person name
  if (testCase.expectedPersonName && output.entities?.person_name !== testCase.expectedPersonName) {
    failures.push(`Person name mismatch: expected "${testCase.expectedPersonName}", got "${output.entities?.person_name}"`);
  }
  
  // Validate action type
  if (testCase.expectedAction && output.action_type !== testCase.expectedAction) {
    failures.push(`Action type mismatch: expected "${testCase.expectedAction}", got "${output.action_type}"`);
  }
  
  // Validate queries for data operations
  if (['read', 'write'].includes(output.action_type)) {
    if (!output.queries || output.queries.length === 0) {
      failures.push('Data operation but no queries generated');
    }
  }
  
  return failures;
}

// Run tests
async function runTests() {
  console.log('============================================================');
  console.log('ARIA AGENT SIMULATION TEST');
  console.log('============================================================\n');
  
  try {
    // Initialize chain
    console.log('Initializing ARIA chain...');
    await initChain({
      gemini: {
        apiKey: process.env.GEMINI_API_KEY,
        model: process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp',
      },
    });
    console.log('✓ Chain initialized\n');
    
    let passed = 0;
    let failed = 0;
    
    for (const testCase of TEST_CASES) {
      console.log(`\n[TEST] ${testCase.name}`);
      console.log(`Input: "${testCase.input}"`);
      
      try {
        const output = await invokeAgent(testCase.input, 'test-chat', BOARD_IDS);
        
        console.log(`\nReasoning: ${output.reasoning.substring(0, 100)}...`);
        console.log(`Intent: ${output.intent}`);
        console.log(`Board: ${output.entities?.board}`);
        console.log(`Filters: ${output.entities?.filters?.length || 0}`);
        console.log(`Person: ${output.entities?.person_name || 'none'}`);
        console.log(`Action: ${output.action_type}`);
        console.log(`Queries: ${output.queries?.length || 0}`);
        
        // Validate
        const failures = validateTestCase(testCase, output);
        
        if (failures.length === 0) {
          console.log('✓ PASS');
          passed++;
        } else {
          console.log('✗ FAIL');
          failures.forEach(f => console.log(`  - ${f}`));
          failed++;
        }
        
      } catch (error) {
        console.log('✗ ERROR');
        console.log(`  ${error.message}`);
        failed++;
      }
    }
    
    console.log('\n============================================================');
    console.log('TEST SUMMARY');
    console.log('============================================================');
    console.log(`Total: ${TEST_CASES.length}`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log(`Success Rate: ${Math.round((passed / TEST_CASES.length) * 100)}%`);
    
    if (failed === 0) {
      console.log('\n🎉 ALL TESTS PASSED!');
      process.exit(0);
    } else {
      console.log('\n⚠️  SOME TESTS FAILED');
      process.exit(1);
    }
    
  } catch (error) {
    console.error('\n❌ TEST SUITE FAILED');
    console.error(error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  runTests();
}

module.exports = { runTests, TEST_CASES, validateTestCase };
