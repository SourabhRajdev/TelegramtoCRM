# ARIA V4 — COMPREHENSIVE TEST SCENARIOS

## TEST CATEGORIES

1. **Write Safety (Idempotency)**
2. **Column ID Translation**
3. **Agent Reasoning Quality**
4. **Human Responses**
5. **Cross-Board Intelligence**
6. **Follow-Up Context**
7. **Error Handling**
8. **Edge Cases**

---

## 1. WRITE SAFETY TESTS (Operation Idempotency)

### TEST 1.1: Duplicate Write Prevention
**Goal:** Verify same operation cannot execute twice

```
Step 1: "Mark Priya as contacted"
Expected: ✅ "Done — Priya is now marked as contacted"

Step 2: Immediately send again: "Mark Priya as contacted"
Expected: ✅ "I already executed that operation recently. If you want to do it again, please wait a moment or rephrase."

Step 3: Wait 6 minutes, then: "Mark Priya as contacted"
Expected: ✅ Should execute again (operation expired)
```

**What to Check:**
- First execution succeeds
- Second execution is blocked
- After 5+ minutes, operation can execute again
- Check logs for operation ID generation

**Failure Indicators:**
- ❌ Second execution creates duplicate
- ❌ No blocking message
- ❌ Operation never expires

---

### TEST 1.2: Different Operations Don't Conflict
**Goal:** Verify different operations get different IDs

```
Step 1: "Mark Priya as contacted"
Expected: ✅ Executes

Step 2: "Mark Ravi as contacted"
Expected: ✅ Executes (different person = different operation ID)

Step 3: "Mark Priya as qualified"
Expected: ✅ Executes (different status = different operation ID)
```

**What to Check:**
- All three operations execute
- No blocking messages
- Different operation IDs generated

**Failure Indicators:**
- ❌ Second or third operation blocked
- ❌ Same operation ID for different operations

---

## 2. COLUMN ID TRANSLATION TESTS

### TEST 2.1: Create Lead with Semantic Fields
**Goal:** Verify semantic field names are translated to real column IDs

```
"Add lead Omar Saeed +971509876543 source WhatsApp assigned to Yash"

Expected: ✅ "Done — Omar Saeed added with phone +971509876543, source WhatsApp, assigned to Yash"
```

**What to Check in Monday.com:**
- Lead "Omar Saeed" exists
- Phone column has +971509876543
- Source column has "WhatsApp"
- Assigned AE column has "Yash"

**Failure Indicators:**
- ❌ Lead created but columns are empty (silent failure)
- ❌ Error about unknown column IDs
- ❌ Phone/source/AE not set

---

### TEST 2.2: Update with Semantic Fields
**Goal:** Verify mutations use real column IDs

```
"Mark Kabir as qualified"

Expected: ✅ "Done — Kabir is now qualified"
```

**What to Check in Monday.com:**
- Kabir's pipeline status changed to "Qualified"
- Not a new column created
- Existing status column updated

**Failure Indicators:**
- ❌ Status not changed
- ❌ New column created with name "status"
- ❌ Error in logs about column ID

---

### TEST 2.3: Multiple Semantic Fields
**Goal:** Verify multiple fields translated correctly

```
"Add artist DJ Ravi +971501234567 art form DJ availability Available pricing 3500"

Expected: ✅ "Done — DJ Ravi added with phone +971501234567, art form Music - DJ, availability Available, pricing 3500"
```

**What to Check in Monday.com:**
- Artist "DJ Ravi" exists
- Phone: +971501234567
- Art Form: Music - DJ
- Availability: Available
- Pricing: 3500

**Failure Indicators:**
- ❌ Any column empty
- ❌ Wrong column types
- ❌ Values in wrong columns

---

## 3. AGENT REASONING QUALITY TESTS

### TEST 3.1: Detailed Reasoning
**Goal:** Verify agent provides 150+ character reasoning

```
"Show me available DJs under 4000 AED with 5+ years experience"

Expected: ✅ Agent should generate detailed reasoning explaining:
- Board detection (artists)
- Filter extraction (availability, art form, pricing, experience)
- Query strategy (fetch all, filter locally)
```

**What to Check in Logs:**
- Reasoning field is 150+ characters
- Mentions all three filters
- Explains board selection
- No generic phrases like "user wants data"

**Failure Indicators:**
- ❌ Reasoning < 150 chars
- ❌ Generic reasoning: "user wants to see artists"
- ❌ Missing filter explanation

---

### TEST 3.2: Ambiguity Detection
**Goal:** Verify agent asks clarifying questions

```
"Update Ravi"

Expected: ✅ "Which Ravi — Ravi Khanna (Sales lead) or Ravi Sharma (artist)? And what do you want to update?"
```

**What to Check:**
- Agent detects ambiguity
- Asks specific question
- Doesn't guess

**Failure Indicators:**
- ❌ Agent guesses which Ravi
- ❌ Generic question: "Can you clarify?"
- ❌ Executes without asking

---

## 4. HUMAN RESPONSE TESTS

### TEST 4.1: Natural Write Confirmations
**Goal:** Verify responses sound human

```
"Mark Priya as contacted"

Expected: ✅ One of:
- "Done — Priya is now marked as contacted"
- "Priya is now contacted"
- "Updated — Priya marked as contacted"

NOT: "Updating..." or empty string
```

**What to Check:**
- Response is human-readable
- Confirms what was done
- Not robotic

**Failure Indicators:**
- ❌ "Updating..."
- ❌ Empty response
- ❌ "Operation completed"

---

### TEST 4.2: Proactive Suggestions
**Goal:** Verify agent suggests next steps

```
"Mark John as qualified"

Expected: ✅ "Done — John is now qualified. Want me to assign him to an AE?"
```

**What to Check:**
- Confirmation included
- Proactive suggestion
- Natural language

**Failure Indicators:**
- ❌ No suggestion
- ❌ Robotic confirmation only

---

## 5. CROSS-BOARD INTELLIGENCE TESTS

### TEST 5.1: Staff Tasks Query
**Goal:** Verify staff board person name resolution

```
"What is Yash working on?"

Expected: ✅ "1 result found:
Yash (STF-001)
Tasks: [task details]"
```

**What to Check:**
- Finds staff member by person name (not code)
- Resolves display name correctly
- Shows tasks

**Failure Indicators:**
- ❌ "No results found"
- ❌ Shows STF-001 without person name
- ❌ Searches wrong board

---

### TEST 5.2: Cross-Board Search
**Goal:** Verify searches multiple boards

```
"Find Ravi across all boards"

Expected: ✅ Results from Sales, Artists, and Staff boards
```

**What to Check:**
- Searches all three boards
- Shows results from each
- Indicates which board each result is from

**Failure Indicators:**
- ❌ Only searches one board
- ❌ No board indication
- ❌ Missing results

---

## 6. FOLLOW-UP CONTEXT TESTS

### TEST 6.1: Filter Refinement
**Goal:** Verify follow-up adds filters

```
Step 1: "Show me available DJs"
Expected: ✅ [List of available DJs]

Step 2: "Now show me the ones under 3000"
Expected: ✅ [Filtered list: available DJs under 3000 AED]
```

**What to Check:**
- Second query applies BOTH filters (availability + pricing)
- Not just pricing filter
- Results are subset of first query

**Failure Indicators:**
- ❌ Second query ignores first filter
- ❌ Shows all artists under 3000 (not just DJs)
- ❌ No context awareness

---

### TEST 6.2: Pronoun Resolution
**Goal:** Verify agent resolves "him", "her", "them"

```
Step 1: "Find Priya"
Expected: ✅ [Priya's details]

Step 2: "Assign her to Yash"
Expected: ✅ "Done — Priya assigned to Yash"
```

**What to Check:**
- "her" resolves to "Priya"
- Correct person updated
- Context maintained

**Failure Indicators:**
- ❌ "Who do you mean by 'her'?"
- ❌ Wrong person updated
- ❌ No context awareness

---

## 7. ERROR HANDLING TESTS

### TEST 7.1: Item Not Found
**Goal:** Verify graceful handling of missing items

```
"Mark NonExistentPerson as contacted"

Expected: ✅ "I couldn't find that item. Check the name and try again."
```

**What to Check:**
- Clear error message
- Suggests action
- No crash

**Failure Indicators:**
- ❌ System error
- ❌ Empty response
- ❌ Generic error

---

### TEST 7.2: Invalid Board Detection
**Goal:** Verify agent asks when board is unclear

```
"Show me all items"

Expected: ✅ "Which board — Sales, Artists, or Staff?"
```

**What to Check:**
- Agent detects ambiguity
- Lists options
- Doesn't guess

**Failure Indicators:**
- ❌ Shows random board
- ❌ Error message
- ❌ No clarification

---

## 8. EDGE CASE TESTS

### TEST 8.1: Empty Results
**Goal:** Verify handling of no results

```
"Show me artists with 20+ years experience charging under 1000 AED"

Expected: ✅ "No items found matching filters: experience >= 20, pricing < 1000"
```

**What to Check:**
- Clear message
- Shows what filters were applied
- No crash

**Failure Indicators:**
- ❌ "No data found" (too generic)
- ❌ Empty response
- ❌ Error

---

### TEST 8.2: Large Result Sets
**Goal:** Verify pagination works

```
"Show all leads"

Expected: ✅ "29 leads found. Showing 1-10 — reply 'next' for more.
[First 10 items]"
```

**What to Check:**
- Shows count
- Limits to 10 items
- Offers pagination

**Failure Indicators:**
- ❌ Shows all 29 items (too long)
- ❌ No count
- ❌ No pagination offer

---

### TEST 8.3: Special Characters in Names
**Goal:** Verify handling of names with apostrophes, hyphens

```
"Find O'Brien"
"Find Al-Rashid"

Expected: ✅ Finds items correctly
```

**What to Check:**
- Search works with special chars
- No query errors
- Results returned

**Failure Indicators:**
- ❌ Query syntax error
- ❌ No results (but item exists)
- ❌ Escaped incorrectly

---

## 9. WRITE VERIFICATION TESTS

### TEST 9.1: Successful Write Verification
**Goal:** Verify system confirms write succeeded

```
"Add lead Test User +971501234567"

Expected: ✅ "Done — Test User added with phone +971501234567"
```

**What to Check in Logs:**
- Write verification passed
- Monday.com returned success
- No verification errors

**Failure Indicators:**
- ❌ Verification failed but user told success
- ❌ No verification logged

---

### TEST 9.2: Failed Write Detection
**Goal:** Verify system detects write failures

```
[Simulate Monday.com error by using invalid board ID in test]

Expected: ✅ "Operation may have failed: [error reason]. Please verify manually."
```

**What to Check:**
- Error detected
- User informed
- Specific reason given

**Failure Indicators:**
- ❌ User told "Done" but operation failed
- ❌ Silent failure
- ❌ Generic error

---

## 10. STRESS TESTS

### TEST 10.1: Rapid Successive Requests
**Goal:** Verify rate limiting works

```
Send 5 requests rapidly:
1. "Show leads"
2. "Show artists"
3. "Show staff"
4. "Show leads"
5. "Show artists"

Expected: ✅ All requests processed OR rate limit message after 3-4
```

**What to Check:**
- Rate limiting activates
- Clear message if limited
- No crashes

**Failure Indicators:**
- ❌ System crashes
- ❌ Requests ignored silently
- ❌ No rate limit enforcement

---

### TEST 10.2: Long Input
**Goal:** Verify handling of very long messages

```
"Show me all available DJs with more than 5 years of experience who charge under 4000 AED and are available for bookings in the next month and have performed at corporate events and weddings and have their own equipment and can provide references and are based in Dubai and speak English and Arabic and have a portfolio and are rated top rated and have signed contracts and..."

Expected: ✅ Processes or returns "Message too long, please simplify"
```

**What to Check:**
- Doesn't crash
- Handles gracefully
- Extracts key filters

**Failure Indicators:**
- ❌ System crash
- ❌ Timeout
- ❌ Ignores most of message

---

## TEST EXECUTION CHECKLIST

### Before Testing
- [ ] System deployed to production
- [ ] Logs accessible
- [ ] Monday.com boards accessible
- [ ] Test data prepared

### During Testing
- [ ] Record all responses
- [ ] Check Monday.com after writes
- [ ] Monitor logs for errors
- [ ] Note response times

### After Testing
- [ ] Verify no duplicate data created
- [ ] Check operation tracker logs
- [ ] Verify column translations worked
- [ ] Review reasoning quality
- [ ] Document any failures

---

## EXPECTED PASS RATE

**Critical Tests (Must Pass):**
- Write Safety: 100%
- Column ID Translation: 100%
- Write Verification: 100%

**Important Tests (Should Pass):**
- Agent Reasoning: 90%+
- Human Responses: 90%+
- Cross-Board Intelligence: 90%+

**Nice-to-Have Tests (Can Fail):**
- Follow-Up Context: 70%+
- Edge Cases: 70%+
- Stress Tests: 60%+

---

## FAILURE RESPONSE PROTOCOL

### If Critical Test Fails:
1. **STOP** using system for production
2. Check logs for root cause
3. Verify column mappings loaded
4. Verify operation tracker initialized
5. Fix and redeploy

### If Important Test Fails:
1. Document failure
2. Check if workaround exists
3. Create issue for fix
4. Continue testing other areas

### If Nice-to-Have Test Fails:
1. Document as known limitation
2. Add to enhancement backlog
3. Continue testing

---

## QUICK TEST SUITE (5 minutes)

Run these 5 tests for quick validation:

1. **Write Safety:** "Mark Priya as contacted" (twice)
2. **Column Translation:** "Add lead Test User +971501234567 source WhatsApp"
3. **Reasoning:** "Show available DJs under 4000"
4. **Human Response:** Check if response sounds natural
5. **Cross-Board:** "What is Yash working on?"

If all 5 pass → System is working
If any fail → Run full test suite

---

**Test Document Version:** 1.0  
**System Version:** ARIA V4  
**Last Updated:** 2026-03-31
