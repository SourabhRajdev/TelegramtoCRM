const axios = require('axios');
const fs = require('fs');
require('dotenv').config();

const timeout = 20000;
async function fetch() {
  const query = `query { boards(ids: [5027403725]) { items_page(limit: 100) { items { id name column_values { id text value type } } } } }`;
  try {
    const res = await axios.post(
      'https://api.monday.com/v2',
      { query },
      {
        headers: {
          'Authorization': process.env.MONDAY_API_TOKEN,
          'Content-Type': 'application/json',
          'API-Version': '2024-01',
        },
        timeout: timeout,
      }
    );
    console.log("Success!");
    console.log(JSON.stringify(res.data).substring(0, 1000));
  } catch (err) {
    if (err.response) {
      console.error(err.response.data);
    } else {
      console.error(err.message);
    }
  }
}
fetch();
