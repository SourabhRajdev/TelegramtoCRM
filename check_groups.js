require('dotenv').config();
const axios = require('axios');

const MONDAY_API_TOKEN = process.env.MONDAY_API_TOKEN;
const BOARDS = {
  sales: process.env.MONDAY_SALES_BOARD_ID || '5027332893',
  artists: process.env.MONDAY_ARTISTS_BOARD_ID || '5027403725',
  staff: process.env.MONDAY_STAFF_BOARD_ID || '5027403709',
};

async function checkGroups() {
  console.log('Checking groups on all boards...\n');
  
  for (const [name, boardId] of Object.entries(BOARDS)) {
    try {
      const query = `query { boards(ids: [${boardId}]) { name groups { id title } } }`;
      
      const response = await axios.post(
        'https://api.monday.com/v2',
        { query },
        {
          headers: {
            'Authorization': MONDAY_API_TOKEN,
            'Content-Type': 'application/json',
          },
        }
      );
      
      const board = response.data.data.boards[0];
      console.log(`📋 ${name.toUpperCase()} BOARD: ${board.name}`);
      console.log(`   Board ID: ${boardId}`);
      
      if (board.groups && board.groups.length > 0) {
        console.log(`   Groups:`);
        board.groups.forEach(group => {
          console.log(`     - "${group.id}" (${group.title})`);
        });
      } else {
        console.log(`   ⚠️  No groups found!`);
      }
      console.log('');
      
    } catch (error) {
      console.error(`❌ Error checking ${name} board:`, error.message);
    }
  }
  
  console.log('\n✅ Use the group IDs shown above in your create_item mutations');
  console.log('   Example: group_id: "topics" or group_id: "new_group"');
}

checkGroups();
