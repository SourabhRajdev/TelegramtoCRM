# GENERIC ERROR ROOT CAUSE — COMPLETE ANALYSIS

## THE PROBLEM

Generic error message: **"I couldn't find that item. Check the name and try again."**

This appears in TWO different scenarios:
1. **Update operations** (line 861 in aria-founder-terminal.js)
2. **Agent-generated error responses** (from ARIA system prompt)

---

## ROOT CAUSE #1: BACKEND EXECUTION FAILURE (Line 861)

### Location
```javascript
// aria-founder-terminal.js, lines 858-862
const itemIds = extractItemIds(lookupResults);
if (itemIds.length > 0) {
  // execute mutation
} else {
  await sendTelegramMessage(chatId, "I couldn't find that item. Check the name and try again.");
  return;
}
```

### Why This Happens

**The generic error triggers when `extractItemIds(lookupResults)` returns an empty array.**

This happens because:

1. **Monday.com Search Sensitivity**
   - `contains_text` operator may be case-sensitive
   - Search with "ravi khanna" might not match "Ravi Khanna"
   - Full name searches are more fragile than single-word searches

2. **No Fallback Strategy**
   - If first search fails, system gives up immediately
   - No retry with lowercase
   - No retry with first name only
   - No fuzzy matching

3. **Zero Visibility**
   - No logging of actual Monday.com response
   - No logging of search term used
   - No logging of results count
   - Developer and user are both blind to what went wrong

### Evidence

**Working Query:**
```
User: "do we have sales lead named ravi?"
Agent: intent=search_by_name, person_name="Ravi"
Query: compare_value: ["ravi"]
Result: ✅ Found "Ravi Khanna"
```

**Failing Query:**
```
User: "update ravi khanna pipeline stage"
Agent: intent=update_item, person_name="Ravi Khanna"
Query: compare_value: ["ravi khanna"]
Result: ❌ 0 items found → generic error
```

**The Difference:** Single word "ravi" works, full name "ravi khanna" fails.

---

## ROOT CAUSE #2: AGENT REASONING LAYER (System Prompt)

### Location
`ARIA_SYSTEM_PROMPT.md` — Section: "OUTPUT (message field)"

### The Instruction

The system prompt says:

```markdown
**🔴 CRITICAL RULE — NO GENERIC FAILURE RESPONSES:**

**FORBIDDEN GENERIC RESPONSES:**
- ❌ "I couldn't find that"
- ❌ "Can you rephrase?"
- ❌ "Check the name and try again"

**REQUIRED BEHAVIOR:**
If you cannot find something, you must:
1. State what you searched for
2. Explain why it failed
3. Offer specific alternatives or clarification
```

### Why This Doesn't Work

**The agent NEVER sees the search failure.**

The execution flow is:
1. Agent generates reasoning + queries
2. Backend executes queries
3. **Backend fails at line 861 → sends generic error → RETURNS**
4. Agent never gets feedback about the failure
5. Agent never gets a chance to generate intelligent response

**The agent's intelligent error handling is bypassed by the backend's generic error.**

---

## ROOT CAUSE #3: PERSON NAME FILTERING (Separate Issue)

### Location
`formatReadResultsWithFilters()` function (lines 960-1100)

### The Problem

Even when search succeeds, person name filtering doesn't work correctly.

**Example:**
```
User: "what is yash working on"
Agent: ✅ Correctly extracts person_name="Yash", board="staff", filters=[]
Backend: ✅ Fetches all staff items
Formatter: ❌ Shows ALL 7 staff members instead of filtering to just Yash
```

### Why This Happens

The `itemMatchesPerson()` function (line 1020) checks if person name appears in ANY column:

```javascript
function itemMatchesPerson(item, personName) {
  const name = personName.toLowerCase();
  // Check item name
  if (item.name && item.name.toLowerCase().includes(name)) return true;
  // Check all column values
  for (const col of item.column_values || []) {
    if (col.text && col.text.toLowerCase().includes(name)) return true;
  }
  return false;
}
```

**Problem:** On Staff board, "Yash" appears in:
- Yash Kapoor's "Person Name" column ✅ (should match)
- Other staff members' "Tasks" column ❌ (false positive - "assigned to Yash")

So when filtering for Yash, it matches:
- Yash Kapoor (correct)
- Sourabh Sharma (has task "assigned to Yash")
- Ansh Mehta (has task "assigned to Yash")
- etc.

**Result:** Shows all 7 staff members instead of just Yash.

---

## THE THREE-LAYER FAILURE

```
┌─────────────────────────────────────────────────────────────┐
│ LAYER 1: AGENT REASONING                                    │
│ Status: ✅ WORKING                                          │
│ - Correctly extracts person_name                            │
│ - Correctly identifies board                                │
│ - Correctly generates search queries                        │
│ - Has intelligent error handling instructions               │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ LAYER 2: QUERY EXECUTION (Backend)                          │
│ Status: ❌ FAILING                                          │
│ - Monday.com search is case/format sensitive                │
│ - No fallback strategies                                    │
│ - No logging/visibility                                     │
│ - Generic error bypasses agent intelligence                 │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ LAYER 3: RESULT FORMATTING                                  │
│ Status: ❌ FAILING                                          │
│ - Person name filter matches too broadly                    │
│ - Shows all items instead of filtered subset                │
│ - No distinction between primary match and mentions         │
└─────────────────────────────────────────────────────────────┘
```

---

## WHY IT'S GENERIC

The error is generic because:

1. **Backend Error (Line 861)** has no context:
   - Doesn't know what person name was searched
   - Doesn't know what board was targeted
   - Doesn't know if 0 results or parsing error
   - Just says "I couldn't find that item"

2. **Agent Intelligence is Bypassed**:
   - Agent has instructions to provide specific errors
   - But backend returns early with generic message
   - Agent never gets to apply its reasoning

3. **No Logging**:
   - No visibility into Monday.com response
   - No visibility into search terms used
   - No visibility into why search failed

---

## THE FIX (3-Part Solution)

### FIX #1: Add Debug Logging (Immediate - P0)

**Location:** aria-founder-terminal.js, line 850 (after executeQueries)

```javascript
if (lookupQueries.length > 0) {
  const lookupResults = await executeQueries(lookupQueries);
  
  // 🔴 ADD THIS LOGGING
  logger.info('Lookup query executed', {
    queryPreview: lookupQueries[0].substring(0, 150),
    resultsCount: lookupResults.length,
    hasBoards: lookupResults[0]?.boards ? 'yes' : 'no',
    boardsCount: lookupResults[0]?.boards?.length || 0,
    itemsFound: extractItemIds(lookupResults).length,
    personName: agentOutput.entities?.person_name || 'none',
    board: agentOutput.entities?.board || 'unknown',
  });
  
  allResults = [...lookupResults];
  // ... rest of code
}
```

### FIX #2: Improve Error Message with Context (Immediate - P0)

**Location:** aria-founder-terminal.js, line 861

**BEFORE:**
```javascript
await sendTelegramMessage(chatId, "I couldn't find that item. Check the name and try again.");
```

**AFTER:**
```javascript
// Build contextual error message
let errorMsg = "I couldn't find ";
if (agentOutput.entities?.person_name) {
  errorMsg += `"${agentOutput.entities.person_name}"`;
} else {
  errorMsg += "that item";
}

if (agentOutput.entities?.board && agentOutput.entities.board !== 'unknown') {
  errorMsg += ` in the ${agentOutput.entities.board} board`;
}

errorMsg += ". Try using just the first name or check the exact spelling.";

logger.warn('Item lookup failed', {
  personName: agentOutput.entities?.person_name,
  board: agentOutput.entities?.board,
  intent: agentOutput.intent,
  queriesExecuted: lookupQueries.length,
});

await sendTelegramMessage(chatId, errorMsg);
```

### FIX #3: Add Fallback Search Strategy (Short-term - P1)

**Location:** aria-founder-terminal.js, line 858 (replace entire block)

```javascript
// Phase 2: If there are placeholder queries, resolve them with IDs from lookup results
if (placeholderQueries.length > 0) {
  let itemIds = extractItemIds(lookupResults);
  
  // 🔴 FALLBACK STRATEGY: If no results and person name has multiple words, retry with first name
  if (itemIds.length === 0 && agentOutput.entities?.person_name && agentOutput.entities.person_name.includes(' ')) {
    const firstName = agentOutput.entities.person_name.split(' ')[0];
    logger.info('Retrying search with first name only', { 
      originalName: agentOutput.entities.person_name, 
      firstName 
    });
    
    // Generate new search query with first name only
    const retryQuery = lookupQueries[0].replace(
      new RegExp(agentOutput.entities.person_name.toLowerCase(), 'gi'),
      firstName.toLowerCase()
    );
    
    const retryResults = await executeQueries([retryQuery]);
    itemIds = extractItemIds(retryResults);
    
    if (itemIds.length > 0) {
      logger.info('Fallback search succeeded', { itemsFound: itemIds.length });
      allResults = [...retryResults]; // Update results with retry
    }
  }
  
  if (itemIds.length > 0) {
    const resolved = placeholderQueries.map(q => q.replace(/ITEM_ID_PLACEHOLDER/g, itemIds[0]));
    const mutationResults = await executeQueries(resolved);
    allResults = [...allResults, ...mutationResults];
  } else {
    // Build contextual error message
    let errorMsg = "I couldn't find ";
    if (agentOutput.entities?.person_name) {
      errorMsg += `"${agentOutput.entities.person_name}"`;
    } else {
      errorMsg += "that item";
    }
    
    if (agentOutput.entities?.board && agentOutput.entities.board !== 'unknown') {
      errorMsg += ` in the ${agentOutput.entities.board} board`;
    }
    
    errorMsg += ". Try using just the first name or check the exact spelling.";
    
    logger.warn('Item lookup failed after fallback', {
      personName: agentOutput.entities?.person_name,
      board: agentOutput.entities?.board,
      intent: agentOutput.intent,
      queriesExecuted: lookupQueries.length + 1, // +1 for retry
    });
    
    await sendTelegramMessage(chatId, errorMsg);
    return;
  }
}
```

### FIX #4: Fix Person Name Filtering (Immediate - P0)

**Location:** aria-founder-terminal.js, line 1020 (itemMatchesPerson function)

**BEFORE:**
```javascript
function itemMatchesPerson(item, personName) {
  const name = personName.toLowerCase();
  // Check item name
  if (item.name && item.name.toLowerCase().includes(name)) return true;
  // Check all column values
  for (const col of item.column_values || []) {
    if (col.text && col.text.toLowerCase().includes(name)) return true;
  }
  return false;
}
```

**AFTER:**
```javascript
function itemMatchesPerson(item, personName) {
  const name = personName.toLowerCase();
  
  // Check item name first (for Sales and Artists boards)
  if (item.name && item.name.toLowerCase().includes(name)) return true;
  
  // For Staff board, check "Person Name" column specifically (not all columns)
  const personNameCol = (item.column_values || []).find(col => {
    const title = getColumnTitle(col.id).toLowerCase();
    return title === 'person name' || title === 'name' || title.includes('staff name');
  });
  
  if (personNameCol && personNameCol.text && personNameCol.text.toLowerCase().includes(name)) {
    return true;
  }
  
  // Don't match on other columns (like "Tasks" which might mention the person)
  return false;
}
```

---

## EXPECTED RESULTS AFTER FIXES

### Test Case 1: Update with Full Name
```
User: "update ravi khanna pipeline stage to will never contact"

BEFORE:
❌ "I couldn't find that item. Check the name and try again."

AFTER:
✅ First search: "ravi khanna" → 0 results
✅ Fallback search: "ravi" → Found "Ravi Khanna"
✅ "Updating Ravi Khanna — status to Will Never Contact"
```

### Test Case 2: Staff Query
```
User: "what is yash working on"

BEFORE:
❌ Shows all 7 staff members (Yash + everyone with tasks assigned to Yash)

AFTER:
✅ Shows only Yash Kapoor
✅ "1 staff found: Yash Kapoor | Tasks: Corporate Gala Atlantis | ..."
```

### Test Case 3: Failed Search with Context
```
User: "update john smith to contracted"

BEFORE:
❌ "I couldn't find that item. Check the name and try again."

AFTER:
✅ "I couldn't find "John Smith" in the sales board. Try using just the first name or check the exact spelling."
```

---

## PRIORITY

**P0 (Deploy Today):**
- ✅ Fix #2: Contextual error messages
- ✅ Fix #4: Person name filtering

**P1 (Deploy This Week):**
- ✅ Fix #1: Debug logging
- ✅ Fix #3: Fallback search strategy

**P2 (Future Enhancement):**
- Fuzzy matching for person names
- "Did you mean?" suggestions
- Search across name variations automatically

---

## CONCLUSION

**The root cause is NOT the system prompt or MD files.**

The root cause is:
1. ✅ Monday.com search sensitivity (case/format issues)
2. ✅ Backend error handling bypassing agent intelligence
3. ✅ Person name filtering matching too broadly
4. ✅ Zero visibility into search failures

**The fix is:**
1. Add logging to see what's happening
2. Improve error messages with context
3. Add fallback search strategies
4. Fix person name filtering to be more precise

---

**Status:** Root cause identified, fixes designed  
**Next Action:** Implement all 4 fixes  
**Priority:** P0 - affects user experience significantly
