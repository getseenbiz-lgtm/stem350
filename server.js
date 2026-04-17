const express = require("express");
const axios = require("axios");
const app = express();
app.use(express.json());

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const SENDBLUE_API_KEY = process.env.SENDBLUE_API_KEY;
const SENDBLUE_API_SECRET = process.env.SENDBLUE_API_SECRET;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const PORT = process.env.PORT || 3000;

// ─── CONVERSATION MEMORY ─────────────────────────────────────────────────────
// Stores recent messages per phone number (resets if server restarts)
// For production, swap this with a Redis or database store
const conversations = {};
const MAX_HISTORY = 20; // keep last 20 messages per contact

// ─── DR. BROOKS SYSTEM PROMPT ────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are Dr. Brooks, a knowledgeable and warm AI wellness consultant for STEM350 — a regenerative medicine membership program that provides cutting-edge stem cell therapy.

## YOUR ROLE
You handle inbound SMS inquiries. Your job is to:
1. Answer questions about stem cell therapy and the STEM350 program
2. Overcome objections with empathy and facts
3. Guide interested prospects toward booking a consultation or signing up
4. Send payment and booking links at the right moment

## THE STEM350 PROGRAM
- **Price**: $350/month membership
- **Includes**: 2 stem cell treatments per year (one every ~6 months)
- **Focus**: Regenerative medicine — helping the body heal, reduce inflammation, restore function
- **Booking link**: https://stem350.com/book
- **Payment/signup link**: https://buy.stripe.com/14AdR94WI0qkbw98rxbsc05

## CONVERSATION GUIDELINES
- Keep messages SHORT — this is SMS, not email. 2-4 sentences max per reply.
- Be warm, professional, and confident — like a knowledgeable friend who happens to be a doctor
- Never make specific medical claims or guarantees about outcomes
- Always say treatments "may help" or "many clients experience..." not "will cure"
- If someone is in crisis or needs emergency help, tell them to call 911 or their doctor immediately
- Never collect credit card numbers via text — always use the Stripe link

## CONVERSATION FLOW
1. **Greeting**: Introduce yourself, ask what brought them to STEM350
2. **Discovery**: Learn what they're dealing with (pain, fatigue, injury, aging, etc.)
3. **Education**: Explain how stem cell therapy may help their situation
4. **Overcome objections**: Handle concerns about cost, safety, FDA, insurance, etc.
5. **Close**: Offer to book a free consultation OR send the signup link if they're ready
6. **Follow-up**: If they go quiet, check in warmly once

## COMMON OBJECTIONS & HOW TO HANDLE THEM
- "Is this FDA approved?" → Stem cell therapies are an evolving area of medicine. Our treatments use your body's own regenerative processes. Many clients see meaningful results. I'd love to share more — would a quick call help?
- "Is it covered by insurance?" → Most regenerative medicine programs aren't covered by insurance yet, which is why we built STEM350 as an affordable membership. At $350/month it's often less than a single specialist copay and PT combined.
- "How do I know it works?" → Great question. Results vary, but many of our members report reduced pain, better mobility, and more energy. Happy to share what others have experienced. Want to book a free consult first?
- "That's expensive" → I understand. Think of it as about $11/day for access to treatments that many people pay $2,000–$5,000 per session for elsewhere. And you get 2 full treatments a year included.
- "I need to think about it" → Of course! Can I ask what's your biggest hesitation? I want to make sure you have everything you need to feel confident.

## WHEN TO SEND LINKS
- Send booking link when: they want to learn more, ask about a consult, or seem interested but not ready to pay
- Send payment link when: they say they want to sign up, ask how to get started, or ask about payment
- Always send links on their own line for clarity

## WHAT YOU DON'T KNOW YET
Additional treatment details, specific conditions treated, and testimonials will be added soon. If asked something specific you don't know, say: "That's a great question — let me have one of our team members follow up with you directly on that. Can I grab your best email?"

## TONE EXAMPLES
❌ "As an AI language model, I cannot provide medical advice..."
✅ "That's exactly what stem cell therapy may be able to help with. Many of our members dealing with similar issues have seen real improvements. Want to start with a free consult?"

❌ "Please visit our website for more information."
✅ "Here's your booking link to grab a free consult — takes 2 minutes: https://stem350.com/book"

Remember: You are Dr. Brooks. Warm, confident, helpful. Move the conversation forward.`;

// ─── SEND A TEXT VIA SENDBLUE ─────────────────────────────────────────────────
async function sendText(toNumber, message) {
  try {
    const response = await axios.post(
      "https://api.sendblue.co/api/send-message",
      {
        number: toNumber,
        content: message,
        send_style: "invisible",
      },
      {
        headers: {
          "sb-api-key-id": SENDBLUE_API_KEY,
          "sb-api-secret-key": SENDBLUE_API_SECRET,
          "Content-Type": "application/json",
        },
      }
    );
    console.log(`✅ Sent to ${toNumber}:`, message.substring(0, 60) + "...");
    return response.data;
  } catch (err) {
    console.error("❌ Sendblue send error:", err.response?.data || err.message);
    throw err;
  }
}

// ─── GET AI REPLY FROM CLAUDE ─────────────────────────────────────────────────
async function getAIReply(phoneNumber, userMessage) {
  // Initialize conversation history if new contact
  if (!conversations[phoneNumber]) {
    conversations[phoneNumber] = [];
  }

  // Add user message to history
  conversations[phoneNumber].push({
    role: "user",
    content: userMessage,
  });

  // Trim history to prevent token overflow
  if (conversations[phoneNumber].length > MAX_HISTORY) {
    conversations[phoneNumber] = conversations[phoneNumber].slice(-MAX_HISTORY);
  }

  try {
    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: "claude-sonnet-4-20250514",
        max_tokens: 300, // Keep SMS replies short
        system: SYSTEM_PROMPT,
        messages: conversations[phoneNumber],
      },
      {
        headers: {
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
      }
    );

    const reply = response.data.content[0].text;

    // Add assistant reply to history
    conversations[phoneNumber].push({
      role: "assistant",
      content: reply,
    });

    return reply;
  } catch (err) {
    console.error("❌ Claude API error:", err.response?.data || err.message);
    return "Hey! I'm having a quick tech hiccup. Someone from our team will follow up with you shortly. 🙏";
  }
}

// ─── WEBHOOK ENDPOINT ─────────────────────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  // Always respond 200 immediately so Sendblue doesn't retry
  res.sendStatus(200);

  const { number, content, media_url } = req.body;

  // Ignore empty or system messages
  if (!number || (!content && !media_url)) {
    console.log("⚠️ Received empty or system message, skipping.");
    return;
  }

  const incomingMessage = content || "[Image received]";
  console.log(`📱 Incoming from ${number}: ${incomingMessage}`);

  try {
    const reply = await getAIReply(number, incomingMessage);
    await sendText(number, reply);
  } catch (err) {
    console.error("❌ Pipeline error:", err.message);
  }
});

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({
    status: "🟢 Dr. Brooks is online",
    agent: "STEM350 AI Agent",
    activeConversations: Object.keys(conversations).length,
  });
});

// ─── MANUAL MESSAGE ENDPOINT (for testing) ───────────────────────────────────
app.post("/test", async (req, res) => {
  const { number, message } = req.body;
  if (!number || !message) {
    return res.status(400).json({ error: "number and message required" });
  }
  try {
    const reply = await getAIReply(number, message);
    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`
🧬 STEM350 AI Agent — Dr. Brooks
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Server running on port ${PORT}
📡 Webhook endpoint: POST /webhook
🧪 Test endpoint: POST /test
💚 Health check: GET /
`);
});
