# ARIA V4 - QUICK CURL TESTS

## SYSTEM STATUS

✅ **ARIA V4 IS DEPLOYED AND RUNNING**

```bash
curl -s https://telegramtocrm-1.onrender.com/health | jq .
```

**Response shows:**
- Status: "ARIA V4 - PRODUCTION GRADE"
- Columns loaded: Sales (8), Artists (24), Staff (12)
- All systems operational

---

## SETUP

Set your environment variables:

```bash
export BOT_TOKEN="your_telegram_bot_token"
export CHAT_ID="your_telegram_chat_id"
export BASE_URL="https://telegramtocrm-1.onrender.com"
```

---

## CRITICAL TESTS (Run These First)

### TEST 1: Write Safety (Idempotency)

**Test duplicate operation prevention:**

```bash
# First request
curl -X POST "${BASE_URL}/telegram/${BOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"message\":{\"chat\":{\"id\":${CHAT_ID}},\"text\":\"Mark Priya as contacted\"}}"

# Wait 2 seconds
sleep 2

# Second request (should be blocked)
curl -X POST "${BASE_URL}/telegram/${BOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"message\":{\"chat\":{\"id\":${CHAT_ID}},\"text\":\"Mark Priya as contacted\"}}"
```

**Expected:**
- First: ✅ "Done — Priya is now marked as contacted"
- Second: ✅ "I already executed that operation recently..."

**Failure:**
- ❌ Second request executes (creates duplicate)

---

### TEST 2: Column ID Translation

**Test semantic field names are translated to real column IDs:**

```bash
curl -X POST "${BASE_URL}/telegram/${BOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"message\":{\"chat\":{\"id\":${CHAT_ID}},\"text\":\"Add lead Omar Saeed +971509876543 source WhatsApp assigned to Yash\"}}"
```

**Expected:**
- ✅ "Done — Omar Saeed added with phone +971509876543, source WhatsApp, assigned to Yash"
- ✅ Check Monday.com: ALL columns filled (phone, source, assigned_ae)

**Failure:**
- ❌ Lead created but columns are empty (silent failure)

---

### TEST 3: Agent Reasoning

**Test complex query with multiple filters:**

```bash
curl -X POST "${BASE_URL}/telegram/${BOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"message\":{\"chat\":{\"id\":${CHAT_ID}},\"text\":\"Show me available DJs under 4000 AED with 5+ years experience\"}}"
```

**Expected:**
- ✅ Filtered list matching ALL criteria
- ✅ Check logs: reasoning field 150+ characters

**Failure:**
- ❌ Shows all DJs (filters not applied)
- ❌ Reasoning < 150 chars or generic

---

### TEST 4: Human Responses

**Test natural language responses:**

```bash
curl -X POST "${BASE_URL}/telegram/${BOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"message\":{\"chat\":{\"id\":${CHAT_ID}},\"text\":\"Mark John as qualified\"}}"
```

**Expected:**
- ✅ "Done — John is now qualified" (natural, human-like)

**Failure:**
- ❌ "Updating..." (robotic)
- ❌ Empty response

---

### TEST 5: Cross-Board Intelligence

**Test staff member resolution by name:**

```bash
curl -X POST "${BASE_URL}/telegram/${BOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"message\":{\"chat\":{\"id\":${CHAT_ID}},\"text\":\"What is Yash working on?\"}}"
```

**Expected:**
- ✅ "Yash (STF-001)\nTasks: [task details]"

**Failure:**
- ❌ "No results found"
- ❌ Shows STF-001 without person name

---

## ADDITIONAL TESTS

### TEST 6: Follow-Up Context

```bash
# First query
curl -X POST "${BASE_URL}/telegram/${BOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"message\":{\"chat\":{\"id\":${CHAT_ID}},\"text\":\"Show me available DJs\"}}"

sleep 3

# Follow-up query
curl -X POST "${BASE_URL}/telegram/${BOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"message\":{\"chat\":{\"id\":${CHAT_ID}},\"text\":\"Now show me the ones under 3000\"}}"
```

**Expected:** Second query applies BOTH filters (available + under 3000)

---

### TEST 7: Error Handling

```bash
curl -X POST "${BASE_URL}/telegram/${BOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"message\":{\"chat\":{\"id\":${CHAT_ID}},\"text\":\"Mark NonExistentPerson as contacted\"}}"
```

**Expected:** "I couldn't find that item. Check the name and try again."

---

### TEST 8: Ambiguity Detection

```bash
curl -X POST "${BASE_URL}/telegram/${BOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"message\":{\"chat\":{\"id\":${CHAT_ID}},\"text\":\"Update Ravi\"}}"
```

**Expected:** "Which Ravi — Ravi Khanna (Sales lead) or Ravi Sharma (artist)? And what do you want to update?"

---

### TEST 9: Large Result Set

```bash
curl -X POST "${BASE_URL}/telegram/${BOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"message\":{\"chat\":{\"id\":${CHAT_ID}},\"text\":\"Show all leads\"}}"
```

**Expected:** "29 leads found. Showing 1-10 — reply 'next' for more."

---

### TEST 10: Simple Greeting

```bash
curl -X POST "${BASE_URL}/telegram/${BOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"message\":{\"chat\":{\"id\":${CHAT_ID}},\"text\":\"hey\"}}"
```

**Expected:** Brief, natural greeting (e.g., "What do you need?")

---

## MONITORING COMMANDS

### Check Logs (if you have access to Render dashboard)

Look for:
- `Operation tracker` — duplicate operation attempts
- `Column mappings built` — semantic field translation
- `Write verification` — mutation result checks
- `Agent reasoning` — validation passes/failures

### Check Monday.com

After write operations, verify:
- Records created/updated
- Columns filled with correct values
- No duplicate records
- Status changes applied

---

## PASS/FAIL CRITERIA

### ✅ SYSTEM IS WORKING IF:
- Test 1: Second request is blocked
- Test 2: All columns filled in Monday.com
- Test 3: Filters applied correctly
- Test 4: Responses sound human
- Test 5: Staff member found by name

### ❌ SYSTEM HAS ISSUES IF:
- Test 1: Duplicate operations execute
- Test 2: Columns empty (silent failure)
- Test 3: Filters ignored
- Test 4: Robotic responses
- Test 5: Staff queries fail

---

## QUICK ONE-LINER TESTS

```bash
# Health check
curl -s https://telegramtocrm-1.onrender.com/health | jq '.status'

# Test write safety (run twice)
curl -X POST "${BASE_URL}/telegram/${BOT_TOKEN}" -H "Content-Type: application/json" -d "{\"message\":{\"chat\":{\"id\":${CHAT_ID}},\"text\":\"Mark Priya as contacted\"}}" && sleep 2 && curl -X POST "${BASE_URL}/telegram/${BOT_TOKEN}" -H "Content-Type: application/json" -d "{\"message\":{\"chat\":{\"id\":${CHAT_ID}},\"text\":\"Mark Priya as contacted\"}}"

# Test column translation
curl -X POST "${BASE_URL}/telegram/${BOT_TOKEN}" -H "Content-Type: application/json" -d "{\"message\":{\"chat\":{\"id\":${CHAT_ID}},\"text\":\"Add lead Test User +971501234567 source WhatsApp\"}}"

# Test reasoning
curl -X POST "${BASE_URL}/telegram/${BOT_TOKEN}" -H "Content-Type: application/json" -d "{\"message\":{\"chat\":{\"id\":${CHAT_ID}},\"text\":\"Show me available DJs under 4000\"}}"

# Test staff query
curl -X POST "${BASE_URL}/telegram/${BOT_TOKEN}" -H "Content-Type: application/json" -d "{\"message\":{\"chat\":{\"id\":${CHAT_ID}},\"text\":\"What is Yash working on?\"}}"
```

---

## TROUBLESHOOTING

### If tests fail:

1. **Check environment variables:**
   ```bash
   echo $BOT_TOKEN
   echo $CHAT_ID
   ```

2. **Verify deployment:**
   ```bash
   curl -s https://telegramtocrm-1.onrender.com/health | jq '.status'
   ```
   Should show: "ARIA V4 - PRODUCTION GRADE"

3. **Check Telegram responses:**
   - Open Telegram chat with bot
   - Look for responses after curl commands

4. **Check Monday.com:**
   - Verify data changes
   - Check column values

5. **Check Render logs:**
   - Look for errors
   - Verify operation tracker logs
   - Check column translation logs

---

**System Version:** ARIA V4  
**Deployment:** Production  
**Status:** Live and Ready for Testing 🚀
