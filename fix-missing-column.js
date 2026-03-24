#!/usr/bin/env node

require('dotenv').config();
const { queryMonday } = require('./lib/monday');

async function createNotesColumn() {
  const boardId = 5027403736; // Denicx Sales Pipeline
  
  const query = `
    mutation {
      create_column(
        board_id: ${boardId},
        title: "Notes",
        column_type: long_text
      ) {
        id
        title
      }
    }
  `;
  
  try {
    const data = await queryMonday(query);
    console.log('✓ Successfully created "Notes" column on Denicx Sales Pipeline');
    console.log(`  Column ID: ${data.create_column.id}`);
  } catch (error) {
    console.error('✗ Failed to create "Notes" column:', error.message);
    process.exit(1);
  }
}

createNotesColumn();
