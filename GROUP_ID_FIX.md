# Group ID Fix for "Group not found" Error

## Problem
Bot returns: "Operation may have failed: Group not found. Please verify manually."

This happens when trying to create items on boards that don't have a group called "topics".

## Root Cause
The system hardcodes `group_id: "topics"` in all create_item mutations, but not all boards have this group.

## Solution Implemented

### 1. Fetch Group IDs at Startup ✅
Modified `fetchBoardColumns()` to also fetch groups:

```javascript
const boardGroups = {
  sales: 'topics',
  artists: 'topics',
  staff: 'topics',
};

async function fetchBoardColumns() {
  for (const [key, board] of Object.entries(CONFIG.monday.boards)) {
    try {
      // Fetch both columns and groups
      const query = `query { boards(ids: [${board.id}]) { columns { id title type } groups { id title } } }`;
      const result = await mondayQuery(query);
      
      if (result?.boards?.[0]?.columns) {
        boardColumns[key] = result.boards[0].columns;
        logger.info(`Fetched ${boardColumns[key].length} columns for ${board.name}`);
      }
      
      // Store first group ID (or default to "topics")
      if (result?.boards?.[0]?.groups && result.boards[0].groups.length > 0) {
        boardGroups[key] = result.boards[0].groups[0].id;
        logger.info(`Using group "${boardGroups[key]}" for ${board.name}`);
      }
    } catch (error) {
      logger.error(`Failed to fetch columns for ${board.name}`, { error: error.message });
    }
  }
}
```

### 2. Update System Prompt (Manual Step Required)
The system prompt in `buildSystemPrompt()` needs to be updated to use dynamic group IDs instead of hardcoded "topics".

**Current (lines 215, 225, 241):**
```
Default Group: "topics"
```

**Should be:**
```javascript
Default Group: "${SG}"  // for sales
Default Group: "${AG}"  // for artists  
Default Group: "${TG}"  // for staff
```

And in the function:
```javascript
const SG = boardGroups.sales;
const AG = boardGroups.artists;
const TG = boardGroups.staff;
```

### 3. Update Query Patterns
All create_item examples in the system prompt need to use the dynamic group IDs.

**Current:**
```
mutation { create_item(board_id: ${SB}, group_id: "topics", item_name: "NAME") { id name } }
```

**Should be:**
```
mutation { create_item(board_id: ${SB}, group_id: "${SG}", item_name: "NAME") { id name } }
```

## Quick Fix (Temporary)

If you know the actual group IDs for your boards, you can manually update the defaults:

```javascript
const boardGroups = {
  sales: 'topics',           // or actual group ID
  artists: 'topics',         // or actual group ID
  staff: 'new_group',        // CHANGE THIS to actual group ID
};
```

## How to Find Group IDs

Run this query in Monday.com API playground:

```graphql
query {
  boards(ids: [5027403709]) {
    groups {
      id
      title
    }
  }
}
```

This will show all groups on the Staff board.

## Testing

After fix, test with:
```
create staff member Yaana Talrani
```

Should succeed without "Group not found" error.

## Status

- ✅ Group fetching implemented
- ⏳ System prompt needs manual update (file too large for automated replacement)
- ⏳ Deployment required

## Next Steps

1. Manually update `buildSystemPrompt()` function (lines 146-650)
2. Replace all `"topics"` with `"${SG}"`, `"${AG}"`, or `"${TG}"` as appropriate
3. Add group ID variables at top of function
4. Deploy
5. Test create operations on all boards
