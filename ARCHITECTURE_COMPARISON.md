# ARIA CRM Bot Architecture Comparison

## Current Architecture: Single-Tenant (v1)

### System Flow
```
┌─────────────────┐    ┌──────────────┐    ┌─────────────────┐    ┌──────────────┐
│   Founder       │───▶│  Telegram    │───▶│   ARIA Bot      │───▶│  Monday.com  │
│  (Sourabh)      │    │   Message    │    │   (Railway)     │    │   CRM API    │
│  Chat ID: 1098  │    │              │    │                 │    │              │
└─────────────────┘    └──────────────┘    └─────────────────┘    └──────────────┘
                                                    │
                                                    ▼
                                           ┌─────────────────┐
                                           │  Gemini AI      │
                                           │  (Google)       │
                                           └─────────────────┘
```

### Authentication Model
```
┌─────────────────────────────────────────────────────────────────┐
│                    HARDCODED SECURITY                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ✓ Single User: Founder Only (Chat ID: 1098008102)            │
│  ✓ Single Token: One Monday.com API Token                      │
│  ✓ Single Board: Inquiries Board (ID: 5027332893)             │
│  ✓ Single Company: Denicx Entertainment                        │
│                                                                 │
│  ❌ No Registration Process                                     │
│  ❌ No User Management                                          │
│  ❌ No Board Selection                                          │
│  ❌ No Multi-Company Support                                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Data Storage
```
┌─────────────────┐
│   File System   │
├─────────────────┤
│ conversation.json │ ← Chat History
│ app.log          │ ← Application Logs  
│ audit.log        │ ← Action Audit Trail
│ error.log        │ ← Error Logs
└─────────────────┘

❌ No User Database
❌ No Token Storage
❌ No Board Mapping
❌ No Access Control
```

### Configuration
```javascript
// Environment Variables (Static)
TELEGRAM_BOT_TOKEN=8686340025:AAFHBnqhiOz9EHo-Ll-R8lBLDaMtrkyUPTU
TELEGRAM_FOUNDER_CHAT_ID=1098008102
MONDAY_API_TOKEN=eyJhbGciOiJIUzI1NiJ9...
MONDAY_INQUIRIES_BOARD_ID=5027332893
GEMINI_API_KEY=AIzaSyAkAdo1C55xd7JtPiu4-EiT5oEqCo4u6cY

// Hardcoded in Code
const CONFIG = {
  telegram: { founderChatId: process.env.TELEGRAM_FOUNDER_CHAT_ID },
  monday: { inquiriesBoard: process.env.MONDAY_INQUIRIES_BOARD_ID }
};
```

### User Experience (Current)
```
┌─────────────────────────────────────────────────────────────────┐
│                      FOUNDER WORKFLOW                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. Founder sends: "show all leads"                            │
│  2. Bot validates: chatId === FOUNDER_CHAT_ID                  │
│  3. Bot queries: Monday.com with hardcoded token              │
│  4. Bot responds: "Found 23 leads in Inquiries board..."      │
│                                                                 │
│  ✓ Instant access (no setup)                                  │
│  ✓ Full CRM control                                           │
│  ❌ Only founder can use                                       │
│  ❌ Manual user addition requires code changes                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Proposed Architecture: Multi-Tenant (v2)

### System Flow
```
┌─────────────────┐    ┌──────────────┐    ┌─────────────────┐    ┌──────────────┐
│   Any Manager   │───▶│  Telegram    │───▶│   ARIA Bot      │───▶│ Monday.com   │
│   (Self-serve)  │    │   Message    │    │   (Railway)     │    │ OAuth API    │
└─────────────────┘    └──────────────┘    └─────────────────┘    └──────────────┘
                                                    │                       │
                                                    ▼                       ▼
                                           ┌─────────────────┐    ┌──────────────┐
                                           │  User Database  │    │ Multiple CRM │
                                           │   (SQLite)      │    │  Accounts    │
                                           └─────────────────┘    └──────────────┘
                                                    │
                                                    ▼
                                           ┌─────────────────┐
                                           │  Gemini AI      │
                                           │  (Google)       │
                                           └─────────────────┘
```

### Authentication Model
```
┌─────────────────────────────────────────────────────────────────┐
│                    DYNAMIC OAUTH SECURITY                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ✓ Multiple Users: Self-registration via /start               │
│  ✓ OAuth Tokens: Each user has their own Monday.com token     │
│  ✓ Multiple Boards: Users select which boards to access       │
│  ✓ Multiple Companies: Each user connects their own account    │
│                                                                 │
│  ✓ Registration Process: OAuth → Board Selection → Access     │
│  ✓ User Management: Admin panel for founders                  │
│  ✓ Board Selection: Dynamic board discovery                   │
│  ✓ Multi-Company Support: Isolated tenant data               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Data Storage
```
┌─────────────────────────────────────────────────────────────────┐
│                        DATABASE SCHEMA                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │     USERS       │  │  BOARD_ACCESS   │  │   AUDIT_LOGS    │ │
│  ├─────────────────┤  ├─────────────────┤  ├─────────────────┤ │
│  │ telegram_user_id│  │ telegram_user_id│  │ user_id         │ │
│  │ monday_token    │  │ board_id        │  │ action          │ │
│  │ monday_user_id  │  │ board_name      │  │ timestamp       │ │
│  │ company_name    │  │ access_level    │  │ board_id        │ │
│  │ created_at      │  │ added_by        │  │ query_executed  │ │
│  │ is_active       │  │ created_at      │  │ success         │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Configuration (Dynamic)
```javascript
// Environment Variables (OAuth)
MONDAY_CLIENT_ID=your_monday_app_client_id
MONDAY_CLIENT_SECRET=your_monday_app_secret
MONDAY_REDIRECT_URI=https://yourbot.com/auth/monday/callback

// Runtime User Context (Per Message)
async function getUserContext(telegram_user_id) {
  return {
    monday_token: decrypt(user.monday_token),
    boards: await getUserBoards(telegram_user_id),
    access_level: user.access_level,
    company: user.company_name
  };
}
```

### User Experience (Proposed)

#### New User Registration
```
┌─────────────────────────────────────────────────────────────────┐
│                    MANAGER ONBOARDING                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Manager: /start                                               │
│  Bot: Welcome! Connect your Monday.com account:                │
│       👆 Click: https://auth.monday.com/oauth2/authorize...    │
│                                                                 │
│  [Manager clicks → Monday.com OAuth → Authorizes]              │
│                                                                 │
│  Bot: ✅ Connected! Found your boards:                         │
│       1. 📋 Sales Inquiries (234 items)                       │
│       2. 📋 Project Pipeline (45 items)                       │
│       3. 📋 Team Tasks (12 items)                             │
│       Reply with numbers to activate (e.g., "1,2")            │
│                                                                 │
│  Manager: 1,2                                                  │
│  Bot: ✅ Access granted to Sales Inquiries & Project Pipeline  │
│       Try: "show all leads" or "create lead John Doe"          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### Daily Usage
```
┌─────────────────────────────────────────────────────────────────┐
│                     MULTI-BOARD WORKFLOW                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Manager: show leads                                            │
│  Bot: Which board?                                             │
│       1. 📋 Sales Inquiries (234 items)                       │
│       2. 📋 Project Pipeline (45 items)                       │
│                                                                 │
│  Manager: 1                                                     │
│  Bot: Sales Inquiries - Found 23 new leads:                   │
│       • Sarah Khan (New Inquiry)                              │
│       • Mike Johnson (Qualified)                              │
│       • Priya Sharma (New Inquiry)                            │
│                                                                 │
│  Manager: qualify Sarah Khan                                    │
│  Bot: ✅ Sarah Khan → Qualified (Sales Inquiries)             │
│                                                                 │
│  // Alternative: Direct syntax                                  │
│  Manager: show leads board:sales                               │
│  Bot: Sales Inquiries - Found 23 new leads...                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### Admin Management
```
┌─────────────────────────────────────────────────────────────────┐
│                      FOUNDER ADMIN PANEL                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Founder: /admin                                               │
│  Bot: 👑 Admin Panel                                           │
│       • 👥 Users: 15 active managers                          │
│       • 📊 Usage: 1,247 queries today                         │
│       • 🔐 Security: All tokens encrypted                     │
│                                                                 │
│       Commands:                                                │
│       /users - List all users                                 │
│       /grant @username board:name - Grant access              │
│       /revoke @username - Revoke access                       │
│       /analytics - Usage statistics                           │
│                                                                 │
│  Founder: /users                                               │
│  Bot: Active Users (15):                                       │
│       1. @sarah_manager - Sales Inquiries (47 queries)        │
│       2. @mike_lead - Project Pipeline (23 queries)           │
│       3. @priya_ops - Team Tasks (12 queries)                 │
│       ...                                                      │
│                                                                 │
│  Founder: /grant @new_manager board:sales                     │
│  Bot: ✅ @new_manager granted access to Sales Inquiries       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Architecture Comparison Summary

### Single-Tenant (Current)
```
┌─────────────────────────────────────────────────────────────────┐
│                         PROS                                    │
├─────────────────────────────────────────────────────────────────┤
│ ✅ Simple setup (5 minutes)                                    │
│ ✅ No database required                                         │
│ ✅ Instant deployment                                           │
│ ✅ Zero configuration                                           │
│ ✅ Perfect for single founder                                   │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                         CONS                                    │
├─────────────────────────────────────────────────────────────────┤
│ ❌ Only 1 user (founder)                                       │
│ ❌ Manual user addition                                         │
│ ❌ Code changes for new users                                   │
│ ❌ Shared credentials                                           │
│ ❌ No scalability                                               │
│ ❌ No multi-company support                                     │
└─────────────────────────────────────────────────────────────────┘
```

### Multi-Tenant (Proposed)
```
┌─────────────────────────────────────────────────────────────────┐
│                         PROS                                    │
├─────────────────────────────────────────────────────────────────┤
│ ✅ Unlimited users                                              │
│ ✅ Self-service registration                                    │
│ ✅ OAuth security                                               │
│ ✅ Multi-company support                                        │
│ ✅ Granular permissions                                         │
│ ✅ Admin management                                             │
│ ✅ Scalable architecture                                        │
│ ✅ Audit trails per user                                        │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                         CONS                                    │
├─────────────────────────────────────────────────────────────────┤
│ ❌ Complex setup (2-3 weeks dev)                               │
│ ❌ Database required                                            │
│ ❌ OAuth app registration                                       │
│ ❌ More moving parts                                            │
│ ❌ Higher maintenance                                           │
└─────────────────────────────────────────────────────────────────┘
```

---

## Migration Path

### Phase 1: Keep Current (Immediate)
- ✅ Founder continues using v1
- ✅ Zero disruption
- ✅ Proven stability

### Phase 2: Build v2 (Parallel)
- 🔄 Develop multi-tenant on separate branch
- 🔄 Test with 2-3 managers
- 🔄 Validate OAuth flow

### Phase 3: Gradual Migration
- 🔄 Founder migrates to v2
- 🔄 Onboard managers one by one
- 🔄 Sunset v1 when stable

### Phase 4: Scale
- 🚀 Open to all managers
- 🚀 Multi-company expansion
- 🚀 Advanced features

---

## Technical Implementation Effort

```
┌─────────────────────────────────────────────────────────────────┐
│                    DEVELOPMENT TIMELINE                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Week 1: Database + OAuth Foundation                           │
│  ├── SQLite schema design                                      │
│  ├── Monday.com OAuth integration                              │
│  ├── User registration flow                                    │
│  └── Token encryption/storage                                  │
│                                                                 │
│  Week 2: Dynamic Context + Multi-Board                        │
│  ├── Replace hardcoded CONFIG                                 │
│  ├── Board selection UI                                       │
│  ├── Dynamic query routing                                    │
│  └── User context loading                                     │
│                                                                 │
│  Week 3: Admin Panel + Testing                                │
│  ├── Admin commands (/admin, /users, /grant)                 │
│  ├── Usage analytics                                          │
│  ├── Security testing                                         │
│  └── Manager onboarding tests                                 │
│                                                                 │
│  Total: ~3 weeks development + 1 week testing                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

This comparison shows exactly where we are (simple but limited) vs where we could be (complex but scalable). Perfect for visual diagrams and stakeholder presentations!