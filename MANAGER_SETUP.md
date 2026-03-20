# ARIA CRM Bot - Manager Setup Guide

## Bot Information
- **Bot Name:** Agency Operations Bot
- **Bot Username:** @DenicxCRMBot (or similar)
- **Status:** ✅ Live and operational

## How to Get Your Telegram User ID

### Method 1: Use @userinfobot
1. Open Telegram
2. Search for `@userinfobot`
3. Start a chat with the bot
4. Send any message
5. The bot will reply with your User ID (a number like `1234567890`)

### Method 2: Use @RawDataBot
1. Search for `@RawDataBot` in Telegram
2. Start a chat and send any message
3. Look for `"id":` in the response - that's your User ID

### Method 3: Forward a Message
1. Forward any message to `@userinfobot`
2. It will show the sender's User ID

## What to Send to IT Team

Send this information to get access:

```
ARIA CRM Bot Access Request

Name: [Your Full Name]
Role: [Manager/Team Lead/etc.]
Telegram Username: @[your_username]
Telegram User ID: [your_user_id_number]
Department: [Sales/Operations/etc.]

Requested Access Level: Manager
```

## Current Bot Capabilities

### Lead Management
- `show all leads` - View all inquiries
- `show new inquiries` - Filter by status
- `show qualified leads` - View qualified prospects
- `create lead name John Doe` - Add new lead
- `qualify [name]` - Update lead status
- `delete [name]` - Remove lead

### Search & Reports
- `find [name]` - Search by lead name
- `find phone [number]` - Search by phone
- `give me a full report` - Complete CRM summary
- `show last 10 entries` - Recent activity
- `what happened today` - Daily summary

### Intelligence Features
- `draft WhatsApp reply for [name]` - AI-generated responses
- `who should I follow up with` - Priority recommendations
- `any high value leads` - Opportunity identification

## Usage Examples

```
Manager: show new inquiries
Bot: Found 3 new inquiries: Sarah Khan, Mike Johnson, Priya Sharma...

Manager: qualify Sarah Khan
Bot: Sarah Khan's status updated to Qualified.

Manager: draft WhatsApp reply for Mike Johnson
Bot: Based on Mike's inquiry about video production...
```

## Important Notes

- Only authorized users can access the bot
- All actions are logged and auditable
- Bot operates 24/7 via Railway cloud hosting
- Responses are powered by Google Gemini AI
- Data syncs directly with Monday.com CRM

## Support

For technical issues or access requests:
- Contact: IT Team
- Bot Status: https://telegramtocrm-production-15e4.up.railway.app/health