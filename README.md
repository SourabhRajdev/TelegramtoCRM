# ARIA Founder Terminal

**Denicx Entertainment — Dubai**

Personal AI-powered CRM terminal for the founder. Manage your Monday.com CRM board entirely through natural language Telegram messages, powered by Google Gemini.

## Architecture

```
Telegram Message → Express Webhook → Gemini AI → Monday.com GraphQL → Gemini (format) → Telegram Response
```

**Two-pass AI flow:** For read operations, Monday.com data goes back through Gemini to get formatted into a human-readable response before being sent to Telegram.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Fill in your `.env`:

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Token from [@BotFather](https://t.me/BotFather) |
| `TELEGRAM_FOUNDER_CHAT_ID` | Your personal Telegram chat ID |
| `GEMINI_API_KEY` | Google AI Studio API key |
| `GEMINI_MODEL` | Model name (default: `gemini-2.5-flash`) |
| `MONDAY_API_TOKEN` | Monday.com API token |
| `MONDAY_INQUIRIES_BOARD_ID` | Your Inquiries board ID |
| `BASE_URL` | Your deployed URL (for webhook registration) |
| `PORT` | Server port (default: `3001`) |

### 3. Run

```bash
# Production
npm start

# Development (auto-reload)
npm run dev
```

## Telegram Commands

### Reports
- `show all leads` / `show new inquiries` / `show qualified leads`
- `how many leads today` / `give me a full report`
- `find [name]` / `find phone [number]`
- `show notes for [name]`

### Actions
- `qualify [name]` / `mark [name] as spam` / `mark [name] as talent`
- `delete [name]` / `archive [name]`
- `add note to [name]: [text]`
- `assign [name] to [person]`

### Intelligence
- `draft WhatsApp reply for [name]`
- `who should I follow up with`
- `summary` / `what happened today`

### System
- `/start` — Welcome message
- `/clear` — Reset conversation memory
- `/help` — Command reference

## Project Structure

```
├── aria-founder-terminal.js   # Main application
├── lib/
│   ├── logger.js              # Structured logging (Winston)
│   ├── sanitize.js            # GraphQL query sanitization
│   ├── cache.js               # In-memory TTL cache
│   └── audit.js               # Operation audit trail
├── data/                      # Runtime data (gitignored)
│   ├── conversation.json      # Persistent conversation history
│   ├── audit.log              # Audit trail
│   ├── app.log                # Application logs
│   └── error.log              # Error logs
├── test/                      # Jest tests
├── Dockerfile                 # Container build
├── .github/workflows/ci.yml   # CI pipeline
└── package.json
```

## Security

- **Founder-only access** — Chat ID verification on every message
- **GraphQL sanitization** — Blocks introspection, unauthorized boards, oversized queries
- **Rate limiting** — Per-IP (Express) + per-chat (application-level)
- **Helmet** — Security headers on all responses
- **Credentials** — All secrets in `.env`, never committed

## Testing

```bash
npm test              # Run tests with coverage
npm run test:watch    # Watch mode
```

## Docker

```bash
docker build -t aria-founder-terminal .
docker run -p 3001:3001 --env-file .env aria-founder-terminal
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 18+ |
| Framework | Express |
| AI | Google Gemini 2.5 Flash |
| CRM | Monday.com GraphQL API |
| Messaging | Telegram Bot API |
| Logging | Winston |
| Security | Helmet, express-rate-limit |
