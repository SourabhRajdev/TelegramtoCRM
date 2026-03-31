#!/bin/bash

# ARIA V4 - Production Testing via curl
# Run these commands to test the deployed system

BASE_URL="https://telegramtocrm-1.onrender.com"
BOT_TOKEN="${TELEGRAM_BOT_TOKEN}"  # Set this to your actual bot token
CHAT_ID="${TELEGRAM_FOUNDER_CHAT_ID}"  # Set this to your chat ID

echo "=========================================="
echo "ARIA V4 - PRODUCTION TESTING"
echo "=========================================="
echo ""

# TEST 0: Health Check
echo "TEST 0: Health Check"
echo "--------------------"
curl -s "${BASE_URL}/health" | jq .
echo ""
echo ""

# TEST 1: Write Safety (Idempotency)
echo "TEST 1: Write Safety - Duplicate Operation Prevention"
echo "------------------------------------------------------"
echo "Sending: 'Mark Priya as contacted'"
curl -s -X POST "${BASE_URL}/telegram/${BOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"message\": {
      \"chat\": {\"id\": ${CHAT_ID}},
      \"text\": \"Mark Priya as contacted\"
    }
  }"
echo ""
echo "Waiting 2 seconds..."
sleep 2
echo "Sending SAME request again (should be blocked):"
curl -s -X POST "${BASE_URL}/telegram/${BOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"message\": {
      \"chat\": {\"id\": ${CHAT_ID}},
      \"text\": \"Mark Priya as contacted\"
    }
  }"
echo ""
echo "Expected: Second request should be blocked with duplicate operation message"
echo ""
echo ""

# TEST 2: Column ID Translation
echo "TEST 2: Column ID Translation - Semantic Fields"
echo "------------------------------------------------"
echo "Sending: 'Add lead Test User +971501234567 source WhatsApp assigned to Yash'"
curl -s -X POST "${BASE_URL}/telegram/${BOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"message\": {
      \"chat\": {\"id\": ${CHAT_ID}},
      \"text\": \"Add lead Test User +971501234567 source WhatsApp assigned to Yash\"
    }
  }"
echo ""
echo "Expected: Lead created with ALL columns filled (phone, source, assigned_ae)"
echo "Check Monday.com to verify columns are not empty"
echo ""
echo ""

# TEST 3: Agent Reasoning Quality
echo "TEST 3: Agent Reasoning - Complex Query"
echo "----------------------------------------"
echo "Sending: 'Show me available DJs under 4000 AED with 5+ years experience'"
curl -s -X POST "${BASE_URL}/telegram/${BOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"message\": {
      \"chat\": {\"id\": ${CHAT_ID}},
      \"text\": \"Show me available DJs under 4000 AED with 5+ years experience\"
    }
  }"
echo ""
echo "Expected: Filtered list of DJs matching ALL criteria"
echo "Check logs for reasoning field (should be 150+ chars)"
echo ""
echo ""

# TEST 4: Human Responses
echo "TEST 4: Human Responses - Natural Language"
echo "-------------------------------------------"
echo "Sending: 'Mark John as qualified'"
curl -s -X POST "${BASE_URL}/telegram/${BOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"message\": {
      \"chat\": {\"id\": ${CHAT_ID}},
      \"text\": \"Mark John as qualified\"
    }
  }"
echo ""
echo "Expected: Natural response like 'Done — John is now qualified'"
echo "NOT: 'Updating...' or empty string"
echo ""
echo ""

# TEST 5: Cross-Board Intelligence
echo "TEST 5: Cross-Board Intelligence - Staff Query"
echo "-----------------------------------------------"
echo "Sending: 'What is Yash working on?'"
curl -s -X POST "${BASE_URL}/telegram/${BOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"message\": {
      \"chat\": {\"id\": ${CHAT_ID}},
      \"text\": \"What is Yash working on?\"
    }
  }"
echo ""
echo "Expected: Staff member found by name with tasks displayed"
echo ""
echo ""

# TEST 6: Follow-Up Context
echo "TEST 6: Follow-Up Context - Filter Refinement"
echo "----------------------------------------------"
echo "Sending: 'Show me available DJs'"
curl -s -X POST "${BASE_URL}/telegram/${BOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"message\": {
      \"chat\": {\"id\": ${CHAT_ID}},
      \"text\": \"Show me available DJs\"
    }
  }"
echo ""
echo "Waiting 3 seconds..."
sleep 3
echo "Sending follow-up: 'Now show me the ones under 3000'"
curl -s -X POST "${BASE_URL}/telegram/${BOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"message\": {
      \"chat\": {\"id\": ${CHAT_ID}},
      \"text\": \"Now show me the ones under 3000\"
    }
  }"
echo ""
echo "Expected: Filtered list with BOTH filters (available + under 3000)"
echo ""
echo ""

# TEST 7: Error Handling
echo "TEST 7: Error Handling - Item Not Found"
echo "----------------------------------------"
echo "Sending: 'Mark NonExistentPerson as contacted'"
curl -s -X POST "${BASE_URL}/telegram/${BOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"message\": {
      \"chat\": {\"id\": ${CHAT_ID}},
      \"text\": \"Mark NonExistentPerson as contacted\"
    }
  }"
echo ""
echo "Expected: Clear error message about item not found"
echo ""
echo ""

# TEST 8: Ambiguity Detection
echo "TEST 8: Ambiguity Detection - Clarifying Question"
echo "--------------------------------------------------"
echo "Sending: 'Update Ravi'"
curl -s -X POST "${BASE_URL}/telegram/${BOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"message\": {
      \"chat\": {\"id\": ${CHAT_ID}},
      \"text\": \"Update Ravi\"
    }
  }"
echo ""
echo "Expected: Clarifying question about which Ravi and what to update"
echo ""
echo ""

# TEST 9: Large Result Set
echo "TEST 9: Large Result Set - Pagination"
echo "--------------------------------------"
echo "Sending: 'Show all leads'"
curl -s -X POST "${BASE_URL}/telegram/${BOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"message\": {
      \"chat\": {\"id\": ${CHAT_ID}},
      \"text\": \"Show all leads\"
    }
  }"
echo ""
echo "Expected: Count + first 10 items + pagination offer"
echo ""
echo ""

# TEST 10: Greeting
echo "TEST 10: Greeting - Natural Response"
echo "-------------------------------------"
echo "Sending: 'hey'"
curl -s -X POST "${BASE_URL}/telegram/${BOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"message\": {
      \"chat\": {\"id\": ${CHAT_ID}},
      \"text\": \"hey\"
    }
  }"
echo ""
echo "Expected: Brief, natural greeting response"
echo ""
echo ""

echo "=========================================="
echo "TESTING COMPLETE"
echo "=========================================="
echo ""
echo "Check your Telegram chat for responses"
echo "Check Monday.com for data changes"
echo "Check logs for operation tracker and column translation"
echo ""
