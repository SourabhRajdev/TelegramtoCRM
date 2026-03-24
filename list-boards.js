#!/usr/bin/env node

require('dotenv').config();
const { queryMonday } = require('./lib/monday');

async function listBoards() {
  const query = `
    query {
      boards(limit: 100) {
        id
        name
        description
      }
    }
  `;
  
  const data = await queryMonday(query);
  
  console.log('\n=== Available Monday.com Boards ===\n');
  data.boards.forEach((board, index) => {
    console.log(`${index + 1}. ${board.name}`);
    console.log(`   ID: ${board.id}`);
    if (board.description) {
      console.log(`   Description: ${board.description}`);
    }
    console.log('');
  });
  
  console.log(`Total boards: ${data.boards.length}\n`);
}

listBoards().catch(error => {
  console.error('Error:', error.message);
  process.exit(1);
});
