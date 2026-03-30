require('dotenv').config();
const { ChatGoogleGenerativeAI } = require('@langchain/google-genai');
const { HumanMessage } = require('@langchain/core/messages');

async function test() {
  try {
    const model = new ChatGoogleGenerativeAI({
      apiKey: process.env.GEMINI_API_KEY,
      model: 'gemini-2.5-flash',
    });
    console.log("Invoking...");
    const res = await model.invoke([new HumanMessage("Hello")]);
    console.log("Success:", res.content);
  } catch (err) {
    console.error("Error:", err.message);
  }
}
test();
