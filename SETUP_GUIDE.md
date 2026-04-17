# 🧬 STEM350 AI Agent — Dr. Brooks
## Complete Setup & Deployment Guide

---

## What You Have

| File | Purpose |
|---|---|
| `server.js` | The AI agent brain — handles all SMS logic |
| `package.json` | Node.js dependencies |
| `.env.example` | Template for your secret keys |
| `.gitignore` | Keeps secrets out of GitHub |

---

## Step 1: Get Your API Keys

### Sendblue Keys
1. Log into your Sendblue dashboard
2. Go to **Settings → API**
3. Copy your **API Key** and **API Secret**

### Anthropic (Claude) Key
1. Go to https://console.anthropic.com
2. Click **API Keys → Create Key**
3. Copy the key (you only see it once)

---

## Step 2: Deploy to Railway

### 2a. Push code to GitHub
```bash
# In your terminal, from this folder:
git init
git add .
git commit -m "STEM350 Dr. Brooks agent"
# Create a new repo on github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/stem350-agent.git
git push -u origin main
```

### 2b. Create Railway project
1. Go to https://railway.app and sign up (free)
2. Click **New Project → Deploy from GitHub repo**
3. Select your `stem350-agent` repo
4. Railway auto-detects Node.js and deploys

### 2c. Add environment variables in Railway
1. Click your project → **Variables** tab
2. Add these one by one:
   - `SENDBLUE_API_KEY` = your key
   - `SENDBLUE_API_SECRET` = your secret
   - `ANTHROPIC_API_KEY` = your Claude key
3. Railway automatically restarts your server

### 2d. Get your Railway URL
- Go to **Settings → Networking → Generate Domain**
- You'll get something like: `https://stem350-agent-production.up.railway.app`
- **Save this URL** — you need it for Sendblue

---

## Step 3: Connect Sendblue Webhook

1. Log into Sendblue dashboard
2. Go to **Settings → Webhooks** (or Integrations)
3. Set your webhook URL to:
   ```
   https://YOUR-RAILWAY-URL.up.railway.app/webhook
   ```
4. Save

That's it. Every incoming text now routes through Dr. Brooks.

---

## Step 4: Test It

### Quick health check
Open your Railway URL in a browser. You should see:
```json
{ "status": "🟢 Dr. Brooks is online" }
```

### Test a conversation
Send a POST request to your `/test` endpoint:
```bash
curl -X POST https://YOUR-RAILWAY-URL/test \
  -H "Content-Type: application/json" \
  -d '{"number": "+15551234567", "message": "Hi, I heard about stem cell treatments?"}'
```

Or just text your Sendblue number from your own phone.

---

## Step 5: Teach Dr. Brooks More (Anytime)

When you're ready to add more knowledge, open `server.js` and find the `SYSTEM_PROMPT` section. You can add:

- Specific conditions you treat (knee pain, inflammation, fatigue, etc.)
- Your origin story / why you started STEM350
- Client testimonials (anonymized)
- More objection responses
- Staff handoff instructions ("if they ask for a human, say...")

After editing, just commit and push to GitHub — Railway redeploys automatically in ~60 seconds.

---

## Monthly Cost Estimate

| Service | Cost |
|---|---|
| Railway hosting | ~$5/mo |
| Claude API | ~$10-30/mo (scales with volume) |
| Sendblue | Your existing plan |
| **Total** | **~$15-35/mo** |

---

## Troubleshooting

**Dr. Brooks isn't responding to texts**
- Check Railway logs for errors
- Verify your Sendblue webhook URL is correct
- Make sure all 3 env variables are set in Railway

**Getting generic error messages**
- Your Anthropic API key may be invalid or out of credits
- Check https://console.anthropic.com for usage/billing

**Want to reset a conversation** (start fresh with a contact)
- Conversations reset when the server restarts
- For persistent memory across restarts, we can add a database later

---

## Need to Add a Human Handoff?

When Dr. Brooks can't answer something, it prompts for their email. To get notified:
- Add your email or Slack webhook to the server for alerts
- This can be built in as a next step

---

*Built for STEM350 | Dr. Brooks AI Agent v1.0*
