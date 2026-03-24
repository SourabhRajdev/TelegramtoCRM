# ARIA Bot Testing Plan

## System Overview

ARIA is a dual-mode Telegram bot for Monday.com CRM management:
- **V1 Mode**: Single-tenant, founder-only access with hardcoded credentials
- **V2 Mode**: Multi-tenant with OAuth, user management, and board selection

## Current Configuration Status

### Environment Variables (from .env)
✅ TELEGRAM_BOT_TOKEN - Configured
✅ TELEGRAM_FOUNDER_CHAT_ID - Configured  
✅ GEMINI_API_KEY - Configured
✅ GEMINI_MODEL - gemini-2.5-flash
✅ MONDAY_API_TOKEN - Configured (V1)
✅ MONDAY_INQUIRIES_BOARD_ID - 5027332893 (V1)
❌ MONDAY_CLIENT_ID - Not configured (V2)
❌ MONDAY_CLIENT_SECRET - Not configured (V2)
❌ ENCRYPTION_KEY - Not configured (V2)

**Current Mode**: V1 (Single-tenant)

### Monday.com Boards Created
1. **Denicx Staff Database** (ID: 5027403709) - 12 columns ✅
2. **Denicx Artist Database** (ID: 5027403725) - 22 columns ✅
3. **Denicx Sales Pipeline** (ID: 5027403736) - 15 columns ✅

## Test Categories

### 1. Core Functionality Tests (V1 Mode)

#### A. Telegram Webhook
- [ ] Webhook registration on startup
- [ ] Message reception and acknowledgment
- [ ] Rate limiting (30 messages per minute per chat)
- [ ] Unauthorized access blocking

#### B. AI Processing (Gemini)
- [ ] Natural language understanding
- [ ] GraphQL query generation
- [ ] JSON response parsing
- [ ] Conversation history management
- [ ] Error handling for AI failures

#### C. Monday.com Integration
- [ ] GraphQL query execution
- [ ] Board data retrieval
- [ ] Item creation
- [ ] Item updates
- [ ] Status changes
- [ ] Search functionality
- [ ] Error handling for API failures

#### D. Commands
- [ ] `/start` - Welcome message
- [ ] `/help` - Command reference
- [ ] `/clear` - Clear conversation history
- [ ] Natural language queries

### 2. Security Tests

#### A. Access Control
- [ ] Founder-only access verification
- [ ] Unauthorized chat ID rejection
- [ ] GraphQL query sanitization
- [ ] Board ID validation
- [ ] Rate limiting enforcement

#### B. Data Protection
- [ ] Environment variable security
- [ ] No credentials in logs
- [ ] Secure token handling
- [ ] Helmet security headers

### 3. Performance Tests

#### A. Caching
- [ ] Read query caching (60s TTL)
- [ ] Cache invalidation on writes
- [ ] Cache hit/miss logging

#### B. Response Times
- [ ] Typing indicator display
- [ ] AI response time (<15s)
- [ ] Monday.com query time (<15s)
- [ ] End-to-end response time

### 4. Error Handling Tests

#### A. External Service Failures
- [ ] Telegram API down
- [ ] Gemini API down
- [ ] Monday.com API down
- [ ] Network timeouts
- [ ] Rate limit responses

#### B. Invalid Input
- [ ] Malformed queries
- [ ] Invalid board IDs
- [ ] Missing required fields
- [ ] Oversized queries

### 5. V2 Mode Tests (When Configured)

#### A. OAuth Flow
- [ ] Authorization URL generation
- [ ] State parameter validation
- [ ] Token exchange
- [ ] User info retrieval
- [ ] Token encryption/decryption

#### B. User Management
- [ ] User registration
- [ ] Onboarding flow
- [ ] Board selection
- [ ] Multi-board access
- [ ] Default board setting

#### C. Database Operations
- [ ] User CRUD operations
- [ ] Board access management
- [ ] Audit logging
- [ ] Statistics generation

#### D. Admin Commands
- [ ] `/admin` - Dashboard
- [ ] `/users` - List users
- [ ] `/analytics` - Usage stats
- [ ] `/grant` - Grant access
- [ ] `/revoke` - Revoke access

## Test Scenarios

### Scenario 1: New Lead Inquiry
**Input**: "show new inquiries"
**Expected**:
1. AI understands intent
2. Generates GraphQL query for status="New Inquiry"
3. Executes query on board 5027332893
4. Formats results
5. Returns readable list to Telegram

### Scenario 2: Create Lead
**Input**: "create lead John Doe, phone +971501234567, from WhatsApp"
**Expected**:
1. AI extracts: name, phone, source
2. Generates create_item mutation
3. Executes on Monday.com
4. Returns confirmation with item ID

### Scenario 3: Update Status
**Input**: "qualify John Doe"
**Expected**:
1. AI searches for "John Doe"
2. Gets item ID
3. Updates status to "Qualified"
4. Returns confirmation

### Scenario 4: Analytics Request
**Input**: "how many leads today"
**Expected**:
1. AI generates query with date filter
2. Counts items created today
3. Returns count with breakdown

### Scenario 5: Multi-step Operation
**Input**: "mark Priya as spam and add note: duplicate entry"
**Expected**:
1. Search for Priya
2. Update status to "Spam"
3. Add update/note
4. Return confirmation

## Known Issues & Limitations

### Current Issues
1. ⚠️ V2 mode not configured (missing OAuth credentials)
2. ⚠️ Encryption key not set (required for V2)
3. ⚠️ Database not initialized (V2 only)
4. ⚠️ Test suite has teardown warnings (non-critical)

### Limitations
1. V1 mode: Single user (founder) only
2. V1 mode: Single board hardcoded
3. AI responses depend on Gemini availability
4. Rate limits: 30 msg/min per chat
5. Telegram message limit: 4096 characters

## Testing Checklist

### Pre-Test Setup
- [x] Environment variables configured
- [x] Monday.com boards created
- [x] Telegram bot token valid
- [x] Gemini API key valid
- [x] Webhook URL configured
- [ ] Bot server running

### Manual Testing Steps
1. Start the bot: `npm start`
2. Check health endpoint: `curl http://localhost:3001/health`
3. Send `/start` to bot on Telegram
4. Test basic queries
5. Test CRUD operations
6. Test error scenarios
7. Monitor logs in `data/app.log`

### Automated Testing
- [x] Unit tests passing (31/31)
- [x] Cache tests passing
- [x] Sanitization tests passing
- [ ] Integration tests (not implemented)
- [ ] E2E tests (not implemented)

## Success Criteria

### Minimum Viable
- ✅ Bot responds to Telegram messages
- ✅ AI processes natural language
- ✅ Monday.com queries execute
- ✅ Basic CRUD operations work
- ✅ Error handling functional

### Production Ready
- [ ] V2 OAuth flow working
- [ ] Multi-user support active
- [ ] All security measures enabled
- [ ] Comprehensive logging
- [ ] Performance monitoring
- [ ] Backup strategy
- [ ] Deployment automation

## Next Steps

1. **Immediate**: Test V1 mode with founder account
2. **Short-term**: Configure V2 OAuth credentials
3. **Medium-term**: Add integration tests
4. **Long-term**: Production deployment with monitoring
