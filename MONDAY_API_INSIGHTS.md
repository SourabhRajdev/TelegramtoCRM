# MONDAY.COM API INSIGHTS — Critical Findings

## KEY DISCOVERIES FROM API DOCUMENTATION

### 1. SEARCH LIMITATIONS

The Monday.com API documentation does NOT explicitly document the `query_params` with `contains_text` operator behavior regarding:
- Case sensitivity
- Exact match vs partial match
- Multi-word search behavior

**This means our search failures are likely due to undocumented API behavior.**

### 2. COMPLEXITY LIMITS

Every API call has a complexity cost:
- Individual query limit: 5,000,000 complexity points
- Per-minute budget: 5M-10M depending on auth method
- High complexity queries count as 1+ daily calls

**Our current implementation:**
- Fetches `limit: 100` items for filtered queries
- Fetches `limit: 50` items for staff queries
- May be hitting complexity limits on large boards

### 3. RATE LIMITS

**Minute limits:**
- Enterprise: 5,000 queries/minute
- Pro: 2,500 queries/minute
- Other: 1,000 queries/minute

**Daily limits:**
- Free/Trial: 200 calls/day
- Standard/Basic: 1,000 calls/day
- Pro: 10,000 calls/day
- Enterprise: 25,000 calls/day

**Our fallback search strategy adds extra API calls** — need to be mindful of rate limits.

### 4. ITEMS QUERY ENDPOINT LIMIT

**CRITICAL:** The `items` query endpoint has a hard limit of **100 items per request**.

From docs:
> "Items query: 100 items"

**This means:**
- Our `items_page(limit: 100)` is at the maximum
- If a board has >100 items, we're only searching the first 100
- This could cause "not found" errors for items beyond position 100

### 5. RETRY LOGIC

From docs:
> "All requests count towards the stated limits, even those that fail or return an error. You can prevent unnecessary API usage by waiting for the time indicated in the retry_in_seconds field before retrying the call."

**Our fallback search should:**
- Check for rate limit errors
- Respect `retry_in_seconds` field
- Not retry immediately

### 6. COMPLEXITY FIELD

We can add `complexity` field to queries to monitor usage:

```graphql
mutation {
  complexity {
    query
    before
    after
  }
  create_item(board_id:1234567890, item_name:"test item") {
    id
  }
}
```

**This costs only 0.1 daily calls** — we should add this to all queries for monitoring.

---

## IMPLICATIONS FOR OUR FIXES

### Issue #1: Search Failures

**Root Cause (Updated):**
- `contains_text` operator behavior is undocumented
- Likely case-sensitive or requires exact token matching
- Multi-word searches ("ravi khanna") may not work as expected

**Solution:**
- ✅ Fallback to first name search (already implemented)
- ✅ Lowercase normalization (already implemented via regex replace)
- ⚠️ Consider using `items` query without `query_params` and filtering locally

### Issue #2: 100 Item Limit

**Root Cause:**
- `items_page(limit: 100)` is the maximum
- Boards with >100 items will have incomplete results
- Person searches may fail if the person is item #101+

**Solution:**
- Implement pagination using `items_page` cursor
- OR: Use multiple queries with different page cursors
- OR: Accept the limitation and document it

### Issue #3: Rate Limits

**Root Cause:**
- Fallback search adds extra API calls
- Each failed search + retry = 2 calls
- Could hit daily limits on Free/Trial accounts (200 calls/day)

**Solution:**
- ✅ Log rate limit errors
- Add `retry_in_seconds` handling
- Consider caching search results

### Issue #4: Complexity Monitoring

**Root Cause:**
- No visibility into complexity costs
- Could be hitting complexity limits without knowing

**Solution:**
- Add `complexity` field to all queries
- Log complexity usage
- Alert when approaching limits

---

## RECOMMENDED FIXES (Updated)

### FIX #1: Add Complexity Monitoring (P0)

Add complexity field to all queries to track usage:

```javascript
// In executeQueries function
const queryWithComplexity = `
  query {
    complexity { before after query }
    ${originalQuery}
  }
`;
```

### FIX #2: Handle Rate Limit Errors (P0)

Check for rate limit errors and respect retry timing:

```javascript
// In executeQueries function
if (result.error_code === 'ComplexityException' || 
    result.error_message?.includes('rate limit')) {
  const retryAfter = result.retry_in_seconds || 60;
  logger.warn('Rate limit hit', { retryAfter, error: result.error_message });
  // Don't retry immediately - return error to user
  throw new Error(`Rate limit exceeded. Please wait ${retryAfter} seconds.`);
}
```

### FIX #3: Improve Search Strategy (P1)

Instead of using `query_params` with `contains_text`, fetch all items and filter locally:

```javascript
// For person name searches, always fetch all and filter locally
// This avoids undocumented contains_text behavior
const query = `
  query { 
    boards(ids: [${boardId}]) { 
      items_page(limit: 100) { 
        items { 
          id 
          name 
          column_values { id text value type } 
        } 
      } 
    } 
  }
`;
// Then filter results locally by person name
```

### FIX #4: Document 100 Item Limitation (P2)

Add to system prompt:

```markdown
⚠️ LIMITATION: Monday.com API returns maximum 100 items per query.
If searching for a person and not found, they may be beyond the first 100 items.
In such cases, suggest the user to narrow the search or check Monday.com directly.
```

### FIX #5: Implement Pagination (P2 - Future)

For boards with >100 items, implement cursor-based pagination:

```javascript
// Use cursor to fetch next page
const query = `
  query { 
    boards(ids: [${boardId}]) { 
      items_page(limit: 100, cursor: "${cursor}") { 
        cursor
        items { id name column_values { id text value type } } 
      } 
    } 
  }
`;
```

---

## CRITICAL INSIGHT: WHY SEARCH FAILS

After reading the API docs, I believe the search fails because:

1. **`contains_text` is case-sensitive** (not documented, but likely)
2. **Multi-word searches require exact token matching** (not documented)
3. **Search with "ravi khanna" expects both tokens to match exactly**

**Evidence:**
- Search "ravi" → matches "Ravi Khanna" ✅ (single token, case-insensitive)
- Search "ravi khanna" → no match ❌ (expects exact case "ravi khanna", but stored as "Ravi Khanna")

**Solution:**
- Always lowercase search terms in queries
- OR: Fetch all items and filter locally (more reliable)

---

## UPDATED IMPLEMENTATION PRIORITY

**P0 (Deploy Today):**
1. ✅ Contextual error messages (already done)
2. ✅ Person name filtering fix (already done)
3. ✅ Fallback search with first name (already done)
4. ⚠️ Add rate limit error handling
5. ⚠️ Add complexity monitoring

**P1 (This Week):**
1. Switch from `query_params` to fetch-all + local filtering
2. Document 100 item limitation
3. Add retry logic with exponential backoff

**P2 (Future):**
1. Implement pagination for large boards
2. Add caching layer
3. Fuzzy matching for person names

---

## CONCLUSION

The Monday.com API documentation reveals:
- ✅ Our fixes are on the right track
- ⚠️ We need rate limit handling
- ⚠️ We need complexity monitoring
- ⚠️ 100 item limit may cause issues on large boards
- ✅ Fallback search strategy is correct approach

**Next steps:**
1. Add rate limit error handling
2. Add complexity monitoring
3. Test with boards >100 items
4. Consider switching to fetch-all + local filter strategy
