# Adding Telegram Group Chat to ARIA

## Group Chat Added
**Group Name:** Sourabh & Agency Operations Bot  
**Group Chat ID:** `-5188730938`  
**Members:** 3

---

## LOCAL ENVIRONMENT ✅

Updated `.env` file:
```
TELEGRAM_ALLOWED_CHAT_IDS=1098008102,5119572473,6646682241,1235697025,-5188730938
```

---

## PRODUCTION ENVIRONMENT (Render) ⚠️

You need to update the environment variable on Render:

### Steps:

1. Go to [Render Dashboard](https://dashboard.render.com/)
2. Select your service: `telegramtocrm-1`
3. Go to **Environment** tab
4. Find `TELEGRAM_ALLOWED_CHAT_IDS`
5. Update the value to:
   ```
   1098008102,5119572473,6646682241,1235697025,-5188730938
   ```
6. Click **Save Changes**
7. Render will automatically redeploy with the new environment variable

---

## TESTING

After updating on Render, test in the group:

```
hi
what is yash working on
show all leads
```

**Expected:** Bot should respond normally (no "Unauthorized access" message)

---

## IMPORTANT NOTES

### Group Chat ID Format
- Group chat IDs are **negative numbers** (start with `-`)
- Individual chat IDs are **positive numbers**
- Current allowed IDs:
  - `1098008102` - Individual (Sourabh)
  - `5119572473` - Individual
  - `6646682241` - Individual
  - `1235697025` - Individual
  - `-5188730938` - **Group (NEW)**

### Security
- Only authorized chat IDs can use the bot
- Unauthorized chats receive "Unauthorized access" message
- This prevents random people from accessing your CRM data

### Adding More Chats
To add more chats in the future:
1. Get the chat ID (bot logs it when someone messages)
2. Add to comma-separated list in `TELEGRAM_ALLOWED_CHAT_IDS`
3. Update on Render
4. Redeploy

---

## ALTERNATIVE: Quick Deploy

If you want to deploy immediately with the new chat ID:

```bash
# Commit the change
git add .env
git commit -m "Add group chat -5188730938 to allowed chats"

# Push to production
git push origin production-stable
```

Then update the environment variable on Render to match.

---

## VERIFICATION

Check logs after deployment:
```bash
# Should see successful message processing
grep "chat.*-5188730938" data/app.log

# Should NOT see unauthorized warnings
grep "Unauthorized access.*-5188730938" data/app.log
```

---

## STATUS

- ✅ Local `.env` updated
- ⏳ Render environment variable needs update
- ⏳ Testing required after Render update

**Next Step:** Update `TELEGRAM_ALLOWED_CHAT_IDS` on Render dashboard
