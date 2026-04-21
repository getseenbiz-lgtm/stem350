const express = require("express");
const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(express.json());

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const SENDBLUE_API_KEY = process.env.SENDBLUE_API_KEY;
const SENDBLUE_API_SECRET = process.env.SENDBLUE_API_SECRET;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const PORT = process.env.PORT || 8080;

// ─── SUPABASE CLIENT ──────────────────────────────────────────────────────────
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ─── DR. BROOKS SYSTEM PROMPT ─────────────────────────────────────────────────
function buildSystemPrompt(contact) {
  const isMember = contact?.is_member === true;
  const name = contact?.name || null;

  const memberContext = isMember
    ? `This person is a CURRENT MEMBER of STEM350. Their name is ${name || "unknown"}. 
       Greet them warmly by name, skip the sales pitch entirely. 
       Help them with questions about their membership, treatments, scheduling, or anything else they need.
       Be like a helpful, knowledgeable friend who already knows them.`
    : `This person is a PROSPECT — not yet a member. 
       ${name ? `Their name is ${name}.` : "You don't know their name yet — try to learn it naturally."}
       Your goal is to educate, build trust, overcome objections, and guide them toward booking or signing up.`;

  return `You are Dr. Brooks, a knowledgeable and warm AI wellness consultant for STEM350 — a regenerative medicine membership program that provides cutting-edge stem cell therapy.

## WHO YOU'RE TALKING TO
${memberContext}

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
- This may be a group thread — if multiple people are talking, address the prospect directly

## CONVERSATION FLOW (PROSPECTS ONLY)
1. **Greeting**: Introduce yourself, ask what brought them to STEM350
2. **Discovery**: Learn what they're dealing with (pain, fatigue, injury, aging, etc.)
3. **Education**: Explain how stem cell therapy may help their situation
4. **Overcome objections**: Handle concerns about cost, safety, FDA, insurance, etc.
5. **Close**: Offer to book a free consultation OR send the signup link if they're ready

## COMMON OBJECTIONS & HOW TO HANDLE THEM
- "Is this FDA approved?" → Stem cell therapies are an evolving area of medicine. Our treatments use your body's own regenerative processes. Many clients see meaningful results. I'd love to share more — would a quick call help?
- "Is it covered by insurance?" → Most regenerative medicine programs aren't covered by insurance yet, which is why we built STEM350 as an affordable membership. At $350/month it's often less than a single specialist copay and PT combined.
- "How do I know it works?" → Results vary, but many of our members report reduced pain, better mobility, and more energy. Want to book a free consult first?
- "That's expensive" → Think of it as about $11/day for access to treatments that many people pay $2,000–$5,000 per session for elsewhere. And you get 2 full treatments a year included.
- "I need to think about it" → Of course! Can I ask what's your biggest hesitation? I want to make sure you have everything you need to feel confident.

## WHEN TO SEND LINKS
- Send booking link when: they want to learn more, ask about a consult, or seem interested but not ready to pay
- Send payment link when: they say they want to sign up, ask how to get started, or ask about payment
- Always send links on their own line for clarity

## WHAT YOU DON'T KNOW YET
Additional treatment details, specific conditions treated, and testimonials will be added soon. If asked something specific you don't know, say: "That's a great question — let me have one of our team members follow up with you directly on that. Can I grab your best email?"

Remember: You are Dr. Brooks. Warm, confident, helpful. Move the conversation forward.`;
}

// ─── FOLLOW-UP MESSAGES ───────────────────────────────────────────────────────
const FOLLOWUP_MESSAGES = [
  "Hey! It's Dr. Brooks from STEM350 👋 Just checking in — did you have any questions about stem cell therapy? Happy to help anytime.",
  "Hi, Dr. Brooks here again! I know life gets busy. If you're still curious about STEM350, I'd love to chat. Even a free consult can be really eye-opening: https://stem350.com/book",
  "Hey, one more check-in from Dr. Brooks at STEM350 🙏 Many people dealing with pain or inflammation find our program really helpful. If you'd like to learn more, just reply and I'm here!",
  "Last check-in from Dr. Brooks — I don't want to be a bother! If you're ever ready to explore stem cell therapy, we're here for you. Wishing you great health either way 💚",
];

// ─── GET OR CREATE CONTACT ────────────────────────────────────────────────────
async function getOrCreateContact(phoneNumber) {
  try {
    let { data, error } = await supabase
      .from("contacts")
      .select("*")
      .eq("phone", phoneNumber)
      .single();

    if (error && error.code === "PGRST116") {
      // Not found — create new contact
      const { data: newContact, error: insertError } = await supabase
        .from("contacts")
        .insert([
          {
            phone: phoneNumber,
            is_member: false,
            follow_up_count: 0,
            last_contacted_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
          },
        ])
        .select()
        .single();

      if (insertError) throw insertError;
      return newContact;
    }

    if (error) throw error;
    return data;
  } catch (err) {
    console.error("❌ getOrCreateContact error:", err.message);
    return null;
  }
}

// ─── UPDATE CONTACT LAST SEEN ─────────────────────────────────────────────────
async function updateContactLastSeen(phoneNumber) {
  try {
    await supabase
      .from("contacts")
      .update({
        last_contacted_at: new Date().toISOString(),
        follow_up_count: 0, // reset follow-up count when they respond
      })
      .eq("phone", phoneNumber);
  } catch (err) {
    console.error("❌ updateContactLastSeen error:", err.message);
  }
}

// ─── GET CONVERSATION HISTORY ─────────────────────────────────────────────────
async function getHistory(phoneNumber) {
  try {
    const { data, error } = await supabase
      .from("messages")
      .select("role, content")
      .eq("phone", phoneNumber)
      .order("created_at", { ascending: true })
      .limit(20);

    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error("❌ getHistory error:", err.message);
    return [];
  }
}

// ─── SAVE MESSAGE ─────────────────────────────────────────────────────────────
async function saveMessage(phoneNumber, role, content) {
  try {
    await supabase.from("messages").insert([
      {
        phone: phoneNumber,
        role,
        content,
        created_at: new Date().toISOString(),
      },
    ]);
  } catch (err) {
    console.error("❌ saveMessage error:", err.message);
  }
}

// ─── SEND A TEXT VIA SENDBLUE ─────────────────────────────────────────────────
async function sendText(toNumber, message, groupId = null) {
  try {
    const payload = {
      content: message,
    };

    if (groupId) {
      payload.group_id = groupId;
    } else {
      payload.number = toNumber;
    }

    const url = groupId
      ? "https://api.sendblue.co/api/send-group-message"
      : "https://api.sendblue.co/api/send-message";

    const response = await axios.post(
      url,
      payload,
      {
        headers: {
          "sb-api-key-id": SENDBLUE_API_KEY,
          "sb-api-secret-key": SENDBLUE_API_SECRET,
          "Content-Type": "application/json",
        },
      }
    );
    console.log(`✅ Sent to ${groupId || toNumber}`);
    return response.data;
  } catch (err) {
    console.error("❌ Sendblue send error:", err.response?.data || err.message);
    throw err;
  }
}

// ─── GET AI REPLY ─────────────────────────────────────────────────────────────
async function getAIReply(phoneNumber, userMessage, contact) {
  const history = await getHistory(phoneNumber);

  // Add new user message to history
  history.push({ role: "user", content: userMessage });

  try {
    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: "claude-sonnet-4-5",
        max_tokens: 300,
        system: buildSystemPrompt(contact),
        messages: history,
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

    // Save both messages to database
    await saveMessage(phoneNumber, "user", userMessage);
    await saveMessage(phoneNumber, "assistant", reply);

    return reply;
  } catch (err) {
    console.error("❌ Claude API error:", err.response?.data || err.message);
    return "Hey! I'm having a quick tech hiccup. Someone from our team will follow up with you shortly. 🙏";
  }
}

// ─── WEBHOOK ──────────────────────────────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  // Log full payload so we can see exact field names from Sendblue
  console.log("📦 Webhook payload:", JSON.stringify(req.body));

  const body = req.body;
  const content = body.content;
  const media_url = body.media_url;

  // Get group ID (Sendblue uses group_id for group threads)
  const group_id = body.group_id || null;

  // For group threads Sendblue uses from_number; for 1-on-1 it uses number
  const from_number = group_id ? body.from_number : body.number;

  if (!content && !media_url) return;
  if (!from_number) return;

  // Use group_id as conversation key for groups, phone for 1-on-1
  const contactKey = group_id || from_number;

  const incomingMessage = content || "[Image received]";
  console.log(`📱 Incoming from ${from_number} (group:${!!group_id}): ${incomingMessage}`);

  try {
    const contact = await getOrCreateContact(from_number);
    await updateContactLastSeen(from_number);
    const reply = await getAIReply(contactKey, incomingMessage, contact);
    // Reply to group thread or individual
    await sendText(from_number, reply, group_id);
  } catch (err) {
    console.error("❌ Pipeline error:", err.message);
  }
});

// ─── MARK AS MEMBER ───────────────────────────────────────────────────────────
app.post("/member", async (req, res) => {
  const { phone, name } = req.body;
  if (!phone) return res.status(400).json({ error: "phone required" });

  try {
    const { data, error } = await supabase
      .from("contacts")
      .upsert([{ phone, name, is_member: true }])
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, contact: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── FOLLOW-UP SCHEDULER ─────────────────────────────────────────────────────
// Runs every hour and checks who needs a follow-up
async function runFollowUpScheduler() {
  console.log("⏰ Running follow-up scheduler...");

  const followUpDays = [1, 3, 7, 14];

  try {
    // Get all non-member contacts who haven't been followed up to completion
    const { data: contacts, error } = await supabase
      .from("contacts")
      .select("*")
      .eq("is_member", false)
      .lt("follow_up_count", 4);

    if (error) throw error;
    if (!contacts || contacts.length === 0) return;

    const now = new Date();

    for (const contact of contacts) {
      const lastContacted = new Date(contact.last_contacted_at);
      const daysSince = Math.floor(
        (now - lastContacted) / (1000 * 60 * 60 * 24)
      );
      const followUpIndex = contact.follow_up_count;

      if (
        followUpIndex < followUpDays.length &&
        daysSince >= followUpDays[followUpIndex]
      ) {
        const message = FOLLOWUP_MESSAGES[followUpIndex];

        try {
          await sendText(contact.phone, message);
          await saveMessage(contact.phone, "assistant", message);

          // Update follow-up count and last contacted
          await supabase
            .from("contacts")
            .update({
              follow_up_count: followUpIndex + 1,
              last_contacted_at: now.toISOString(),
            })
            .eq("phone", contact.phone);

          console.log(
            `📤 Follow-up #${followUpIndex + 1} sent to ${contact.phone}`
          );
        } catch (sendErr) {
          console.error(
            `❌ Failed to send follow-up to ${contact.phone}:`,
            sendErr.message
          );
        }
      }
    }
  } catch (err) {
    console.error("❌ Scheduler error:", err.message);
  }
}

// Run scheduler every hour
setInterval(runFollowUpScheduler, 60 * 60 * 1000);

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get("/", async (req, res) => {
  const { count } = await supabase
    .from("contacts")
    .select("*", { count: "exact", head: true });

  res.json({
    status: "🟢 Dr. Brooks is online",
    agent: "STEM350 AI Agent v2",
    totalContacts: count || 0,
  });
});

app.listen(PORT, () => {
  console.log(`
🧬 STEM350 AI Agent v2 — Dr. Brooks
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Server running on port ${PORT}
🧠 Memory: Supabase
📅 Follow-ups: Day 1, 3, 7, 14
👥 Group threads: Supported
💚 Health check: GET /
`);

  // Run scheduler on startup too
  runFollowUpScheduler();
});
