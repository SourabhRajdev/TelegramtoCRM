#!/usr/bin/env node

/**
 * Monday.com Board Setup Script for Denicx
 * Configures columns on three boards: Staff Database, Artist Database, Sales Pipeline
 */

require('dotenv').config();
const { queryMonday } = require('./lib/monday');

const BOARD_CONFIGS = {
  'Denicx Staff Database': [
    { title: 'Phone', type: 'phone' },
    { title: 'Email', type: 'email' },
    { title: 'WhatsApp', type: 'phone' },
    { title: 'Role', type: 'text' },
    { title: 'Access Level', type: 'status', labels: ['Agent', 'Manager', 'Admin'] },
    { title: 'Department', type: 'text' },
    { title: 'Assigned Pipeline', type: 'status', labels: ['Sales', 'Artist Management', 'Staff Hiring', 'All Pipelines'] },
    { title: 'Assigned Projects', type: 'long_text' },
    { title: 'Active Leads Count', type: 'numbers' },
    { title: 'Status', type: 'status', labels: ['Active', 'Inactive', 'On Leave'] },
    { title: 'Join Date', type: 'date' },
    { title: 'Notes', type: 'long_text' }
  ],
  'Denicx Artist Database': [
    { title: 'Phone', type: 'phone' },
    { title: 'Email', type: 'email' },
    { title: 'WhatsApp', type: 'phone' },
    { title: 'Art Form', type: 'status', labels: ['Dance', 'Music - DJ', 'Music - Vocals', 'Music - Saxophone', 'Music - Live Band', 'Performing Arts'] },
    { title: 'Specialisation', type: 'text' },
    { title: 'Experience Years', type: 'numbers' },
    { title: 'Languages', type: 'text' },
    { title: 'Location', type: 'text' },
    { title: 'Area Coverage', type: 'text' },
    { title: 'Pricing AED Per Event', type: 'numbers' },
    { title: 'Pricing Notes', type: 'long_text' },
    { title: 'Availability Status', type: 'status', labels: ['Available', 'Partially Available', 'Booked', 'Inactive'] },
    { title: 'Current Projects', type: 'long_text' },
    { title: 'Pipeline Stage', type: 'status', labels: ['Application Received', 'Screening', 'Shortlisted', 'Contracted', 'Active', 'Rejected'] },
    { title: 'Assigned Manager', type: 'text' },
    { title: 'Portfolio Link', type: 'link' },
    { title: 'Dropbox Docs', type: 'link' },
    { title: 'Contract Status', type: 'status', labels: ['Not Signed', 'Draft Signed', 'Signed'] },
    { title: 'Rating', type: 'status', labels: ['New', 'Verified', 'Top Rated'] },
    { title: 'Source Channel', type: 'status', labels: ['WhatsApp', 'Email', 'Referral', 'Internal'] },
    { title: 'Application Date', type: 'date' },
    { title: 'Notes', type: 'long_text' }
  ],
  'Denicx Sales Pipeline': [
    { title: 'Phone', type: 'phone' },
    { title: 'Email', type: 'email' },
    { title: 'Source Channel', type: 'status', labels: ['WhatsApp', 'Email', 'Manual'] },
    { title: 'Pipeline Stage', type: 'status', labels: ['New Inquiry', 'Contacted', 'Qualified', 'Proposal Sent', 'Deal Won', 'Deal Lost'] },
    { title: 'AI Intent', type: 'status', labels: ['inquiry', 'complaint', 'order', 'followup', 'unknown'] },
    { title: 'AI Sentiment', type: 'status', labels: ['positive', 'neutral', 'negative'] },
    { title: 'AI Confidence', type: 'numbers' },
    { title: 'Suggested Reply', type: 'long_text' },
    { title: 'Assigned AE', type: 'text' },
    { title: 'Last Contacted', type: 'date' },
    { title: 'Next Follow-Up', type: 'date' },
    { title: 'WA Session Active', type: 'checkbox' },
    { title: 'PandaDoc Link', type: 'link' },
    { title: 'Correlation ID', type: 'text' },
    { title: 'Notes', type: 'long_text' }
  ]
};

async function searchBoard(boardName) {
  const query = `
    query {
      boards(limit: 100) {
        id
        name
      }
    }
  `;
  
  const data = await queryMonday(query);
  const board = data.boards.find(b => b.name === boardName);
  
  return board ? board.id : null;
}

async function createBoard(boardName) {
  const query = `
    mutation {
      create_board(
        board_name: "${boardName}",
        board_kind: public
      ) {
        id
        name
      }
    }
  `;
  
  const data = await queryMonday(query);
  return data.create_board.id;
}

async function getBoardColumns(boardId) {
  const query = `
    query {
      boards(ids: [${boardId}]) {
        columns {
          id
          title
          type
        }
      }
    }
  `;
  
  const data = await queryMonday(query);
  return data.boards[0].columns;
}

async function createColumn(boardId, columnConfig) {
  const { title, type, labels } = columnConfig;
  
  let query;
  
  if (type === 'status' && labels) {
    // Create status column with labels
    const labelsJson = JSON.stringify(labels.reduce((acc, label, index) => {
      acc[index] = label;
      return acc;
    }, {}));
    
    query = `
      mutation {
        create_column(
          board_id: ${boardId},
          title: "${title}",
          column_type: ${type},
          defaults: "{\\"labels\\":${labelsJson.replace(/"/g, '\\"')}}"
        ) {
          id
          title
        }
      }
    `;
  } else {
    // Create regular column
    query = `
      mutation {
        create_column(
          board_id: ${boardId},
          title: "${title}",
          column_type: ${type}
        ) {
          id
          title
        }
      }
    `;
  }
  
  const data = await queryMonday(query);
  return data.create_column;
}

async function configureBoard(boardName, columns) {
  console.log(`\n=== Configuring: ${boardName} ===`);
  
  const result = {
    board_name: boardName,
    board_id: null,
    columns_created: [],
    columns_skipped: [],
    errors: []
  };
  
  try {
    // Step 1: Search for board or create if not exists
    console.log(`Searching for board: ${boardName}...`);
    result.board_id = await searchBoard(boardName);
    
    if (!result.board_id) {
      console.log(`Board not found. Creating new board: ${boardName}...`);
      result.board_id = await createBoard(boardName);
      console.log(`✓ Created board ID: ${result.board_id}`);
    } else {
      console.log(`✓ Found board ID: ${result.board_id}`);
    }
    
    // Step 2: Get existing columns
    console.log(`Fetching existing columns...`);
    const existingColumns = await getBoardColumns(result.board_id);
    const existingTitles = existingColumns.map(col => col.title);
    console.log(`✓ Found ${existingColumns.length} existing columns`);
    
    // Step 3: Create columns
    for (const columnConfig of columns) {
      try {
        if (existingTitles.includes(columnConfig.title)) {
          console.log(`⊘ Skipping "${columnConfig.title}" (already exists)`);
          result.columns_skipped.push(columnConfig.title);
        } else {
          console.log(`Creating column: ${columnConfig.title} (${columnConfig.type})...`);
          await createColumn(result.board_id, columnConfig);
          console.log(`✓ Created "${columnConfig.title}"`);
          result.columns_created.push(columnConfig.title);
          
          // Rate limiting - wait 500ms between column creations
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (error) {
        console.error(`✗ Failed to create "${columnConfig.title}": ${error.message}`);
        result.errors.push({
          column: columnConfig.title,
          error: error.message
        });
      }
    }
    
  } catch (error) {
    console.error(`✗ Board configuration failed: ${error.message}`);
    result.errors.push({
      column: 'BOARD_SETUP',
      error: error.message
    });
  }
  
  return result;
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║  Denicx Monday.com Board Configuration                ║');
  console.log('╚════════════════════════════════════════════════════════╝');
  
  const summary = {
    boards_configured: []
  };
  
  // Configure each board sequentially
  for (const [boardName, columns] of Object.entries(BOARD_CONFIGS)) {
    const result = await configureBoard(boardName, columns);
    summary.boards_configured.push(result);
  }
  
  // Print summary
  console.log('\n\n╔════════════════════════════════════════════════════════╗');
  console.log('║  CONFIGURATION SUMMARY                                 ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');
  console.log(JSON.stringify(summary, null, 2));
  
  // Exit with error code if any errors occurred
  const hasErrors = summary.boards_configured.some(b => b.errors.length > 0);
  process.exit(hasErrors ? 1 : 0);
}

main().catch(error => {
  console.error('\n✗ Fatal error:', error.message);
  process.exit(1);
});
