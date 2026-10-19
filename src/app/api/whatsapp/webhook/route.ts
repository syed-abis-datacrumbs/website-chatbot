import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import {
  wantsBrochure, wantsEnrollment, wantsDemo,
  sendWhatsAppMessage, sendWhatsAppDocument,
  downloadWhatsAppMedia,
} from '@/lib/whatsapp';
import { getAIReply } from '@/lib/gemini';
import { CORE_SYSTEM_PROMPT, WELCOME_GREETING } from '@/lib/knowledge';
import {
  saveMessage, getRecentMessagesByPhone, hasPriorMessages, claimNewLead,
  getActiveEnrollmentSession, saveEnrollmentSession,
  getContactProfile, saveContactProfile,
  saveDiscountRequest, updateDiscountRequestComment,
  saveDemoRequest,
  type EnrollmentSession,
} from '@/lib/redis';
import {
  uploadScreenshotToDrive, appendEnrollmentRow,
  appendDiscountRow, updateDiscountRowComment,
  appendDemoRow,
  appendLeadRow, updateLeadName,
} from '@/lib/google';

// ── GET: Meta webhook verification ───────────────────────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 });
  }
  return new NextResponse('Forbidden', { status: 403 });
}

// ── Payment details ───────────────────────────────────────────────────────────
function buildPaymentMsg() {
  return `Please complete the payment using any of these methods:

🏦 *${process.env.PAYMENT_BANK_NAME}*
Account Title: ${process.env.PAYMENT_BANK_TITLE}
IBAN: ${process.env.PAYMENT_BANK_IBAN}
Account Number: ${process.env.PAYMENT_BANK_ACCOUNT}

📱 *Easypaisa / Jazzcash / NayaPay*
Account Title: ${process.env.PAYMENT_WALLET_TITLE}
Account Number: ${process.env.PAYMENT_WALLET_NUMBER}

Fee: *${process.env.PAYMENT_FEE ?? 'Rs. 7,499/month'}*

Once you've paid, please send a *screenshot* here and we'll verify it and get you enrolled! ✅`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const EMAIL_RE = /[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+/;

// Strip common preamble phrases so "My name is John" → "John"
function cleanName(raw: string): string {
  return raw
    .replace(/\b(my name is|i am|i'm|name is|call me|and my email is|and email is|my email is|email address is|email id is|email is|email:)\b/gi, '')
    .replace(/@\S*/g, '')   // remove stray @fragments
    .replace(EMAIL_RE, '')  // remove any leftover email fragment
    // Strip leftover connector/filler words phrase-stripping can leave dangling
    // (e.g. "and my" from "...and my email is..." when only "email is" matched)
    .replace(/\b(and|my|is|the|also|email|address|mail|id)\b/gi, '')
    .replace(/[,;|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeName(text: string): boolean {
  const t = text.trim();
  if (!t || t.length < 2 || t.length > 40) return false;
  // Reject if contains any numbers, punctuation, or question marks
  if (/[0-9?!@#$%^&*()_+={}\[\]:;<>\\\/]/g.test(t)) return false;
  const words = t.split(/\s+/);
  if (words.length > 4) return false;
  // Real names never start with an article/pronoun/negation ("a student", "the sender", "not sure")
  if (/^(a|an|the|not|no|so|very|really|just|still)\b/i.test(t)) return false;

  const NON_NAME_WORDS = /\b(tell|something|related|internship|course|bootcamp|fee|price|cost|timing|class|classes|recording|missed|register|enroll|payment|pay|bank|easypaisa|jazzcash|nayapay|account|iban|screenshot|receipt|hi|hello|hey|salam|aoa|okay|ok|yes|no|thanks|thank|what|how|when|where|why|is|are|can|could|would|please|about|kya|kab|kaisa|bata|mujhe|aur|aap|student|beginner|learner|teacher|professional|engineer|freelancer|developer|programmer|newbie|fresher|graduate|undergraduate|guy|man|boy|girl|person|worker|employee|kid|adult|parent|teenager|discount|afford|budget|scholarship|expensive|struggling|confused|sender|forward)\b/i;
  return !NON_NAME_WORDS.test(t);
}

function extractEmailAndName(text: string): { email: string | null; name: string | null } {
  const emailMatch = text.match(EMAIL_RE);
  const email = emailMatch ? emailMatch[0].toLowerCase() : null;
  const nameCandidate = cleanName(text.replace(EMAIL_RE, ''));
  const name = looksLikeName(nameCandidate) ? nameCandidate : null;
  return { email, name };
}

// Extract explicit name introduced in conversation ("my name is Syed Abis", "I am Syed Abis")
function extractExplicitNameFromText(text: string): string | null {
  if (!text || text.length > 100) return null;
  const match = text.match(/\b(?:my name is|i am|i'm|call me|name is)\s+([A-Za-z\s]{2,35})/i);
  if (match) {
    const candidate = cleanName(match[1]);
    if (looksLikeName(candidate)) return candidate;
  }
  return null;
}

// Pure gratitude ONLY — e.g. "thank you so much" — must never be mistaken for a
// price complaint. Deliberately strict (every word must be gratitude-vocabulary):
// "thank you but I can only pay 4k" has real content beyond the "thank you" prefix,
// so this must NOT match it, or that message silently falls through to Gemini's
// raw canned escalation line instead of our discount flow.
function isPureGratitude(text: string): boolean {
  const cleaned = text.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return false;
  const GRATITUDE_WORDS = new Set([
    'thanks', 'thank', 'you', 'so', 'much', 'a', 'lot', 'very', 'really',
    'shukriya', 'shukria', 'jazak', 'appreciate', 'appreciated', 'thnx', 'tnx',
  ]);
  return cleaned.split(' ').every(w => GRATITUDE_WORDS.has(w));
}

// Explicit affordability / discount request — always fires, no context needed
function needsAffordabilityHelp(text: string): boolean {
  const t = text.toLowerCase();
  if (isPureGratitude(t)) return false;
  return (
    /too? (much|expensive|costly|high|pricey)/i.test(t) ||
    /(can.?t|cannot|can not|unable to|hard to|difficult to|struggling to)\s*afford/i.test(t) ||
    (/\bafford\b/i.test(t) && !/\b(can|could|will|able to)\s+afford\b/i.test(t)) ||
    /not affordable/i.test(t) ||
    /\bscholarship\b/i.test(t) ||
    /financial (help|support|issue|problem|hardship|constraint)/i.test(t) ||
    /\bfee (bari|barhi|zyada|ziada|kam|reduce)\b/i.test(t) ||
    /\bkoi discount\b/i.test(t) ||
    /discount (chahiye|dena|do|mil|de)/i.test(t) ||
    /i (want|need|require|wanna) (a |some )?discount/i.test(t) ||
    /give.{0,10}discount/i.test(t) ||
    /\bstudent (discount|rate|concession|deal|package)\b/i.test(t) ||
    /\bpersonal discount\b/i.test(t) ||
    /any (other |special |more )?discount/i.test(t) ||
    /out of (my )?budget/i.test(t) ||
    /\bbudget\b.{0,20}\b(low|tight|less|kam|short)\b/i.test(t) ||
    // Counter-offer / negotiation — "can only pay 4k", "pay 4000 only", "I'll only give 5k"
    /\bonly\b.{0,20}\b(pay|afford|give|offer|do)\b/i.test(t) ||
    /\b(pay|afford|give|offer)\b.{0,20}\bonly\b/i.test(t)
  );
}

// Vague sticker-shock reaction ("that's so much", "expensive", "mehnga").
// Ambiguous on its own — only meaningful right after we quoted the fee.
function isPriceShockReaction(text: string): boolean {
  const t = text.toLowerCase();
  if (isPureGratitude(t)) return false;
  return (
    /\b(so|too|to|that|that'?s|it'?s|its|bohat|bahut|buhat|boht|bht|kaafi|kafi|itna|itni)\s*(much|expensive|costly|high|pricey|mehnga|mehanga|menga|zyada|ziada|zada)\b/i.test(t) ||
    /\b(expensive|costly|pricey|mehnga|mehanga|menga|unaffordable)\b/i.test(t) ||
    /\bthat'?s? (a lot|alot)\b/i.test(t) ||
    /\b(a lot|alot) of money\b/i.test(t) ||
    /\b(high|heavy|big)\s*fee\b/i.test(t) ||
    /\bfee\b.{0,15}\b(high|much|zyada|ziada|bari|barhi)\b/i.test(t)
  );
}

// True if the message is a B2B / vendor / partnership pitch rather than a student enquiry
function isBusinessPitch(text: string): boolean {
  const t = text.toLowerCase();

  // Strong single signals — a student would never write these
  const strongSignals = [
    /\b(appointment|meeting)\s+(request|invitation)\b/i,
    /\brequest(ing)?\s+a?\s*(meeting|appointment|demo|call)\b/i,
    /\b(sales|marketing|business development|bd)\s+(executive|manager|officer|representative|rep)\b/i,
    /\b(pvt\.?\s*ltd|private limited|\(pvt\)|llc|inc\.|technologies|solutions)\b.{0,40}\b(www\.|http)/i,
    /\bschedule a (meeting|call|demo)\b/i,
    /\b(partnership|collaboration|reseller|vendor|B2B)\s+(opportunity|proposal|inquiry|offer)\b/i,
    /\bwe (offer|provide|specialize in|are a)\b.{0,60}\b(company|agency|platform|solution|service)\b/i,
    /\bour (company|firm|agency|organization) (offers|provides|specializes)/i,
    /\bdear (sir|madam|sir\/madam)\b[\s\S]{0,200}\b(meeting|discuss|platform|product|service|proposal)/i,
  ];
  if (strongSignals.some(re => re.test(t))) return true;

  // Weaker signals — need at least two together to be confident
  const weakSignals = [
    /\bdear (sir|madam|team|concerned)\b/i,
    /\b(best|kind|warm) regards\b/i,
    /\bhope this (message|email|finds you)\b/i,
    /\bi am writing to\b/i,
    /\bwww\.\S+\.\w{2,}/i,
    /\b(our|this) (innovative |new )?(platform|product|solution|software|system|tool)\b/i,
    /\b(would like to|wish to) (discuss|introduce|present)\b/i,
    /\bat your (convenience|earliest)\b/i,
    /\blooking forward to (your|hearing)\b/i,
  ];
  return weakSignals.filter(re => re.test(t)).length >= 2;
}

// True if the user's own message is about money — required before treating
// Gemini's redirect reply as a discount escalation
function isMoneyContext(text: string): boolean {
  return /\b(fee|fees|price|pricing|cost|charge|payment|pay|discount|afford|budget|scholarship|expensive|costly|money|rupees|rs\.?|paisa|mehnga|zyada)\b/i.test(text);
}

// User agreeing to have their discount request forwarded to management
function isAffirmative(text: string): boolean {
  const t = text.trim().toLowerCase();
  return /^(yes|yeah|yep|yup|sure|ok|okay|k|please|go ahead|do it|forward it|forward|send it|alright|fine|why not|haan|han|ji|ji haan|ji han|zaroor|bilkul|theek hai|thik hai|kar do|karo)\b/i.test(t);
}

// User declining the discount forward offer
function isNegative(text: string): boolean {
  const t = text.trim().toLowerCase();
  return /^(no|nah|nope|not now|never\s?mind|leave it|nahi|nai|chodo|rehnay do|rehne do)\b/i.test(t)
    || /\b(no thanks|not interested|don'?t bother)\b/i.test(t);
}

// True if the message is a plain conversational closer with no real content —
// "thanks", "ok", "no more questions", "that's all" — nothing that needs an AI answer.
// Conservative: EVERY word in the message must be in the whitelist, or it's not a closer.
function isConversationalCloser(text: string): boolean {
  const cleaned = text.toLowerCase().replace(/[^\w\s']/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned || cleaned.length > 60) return false;
  const CLOSER_WORDS = new Set([
    'ok', 'okay', 'okey', 'k', 'alright', 'allright', 'thanks', 'thank', 'thankyou', 'thnx', 'tnx',
    'no', 'not', 'more', 'questions', 'question', 'q', 'thats', "that's", 'that', 'all', 'got', 'it',
    'sounds', 'good', 'cool', 'nice', 'great', 'sure', 'fine', 'perfect', 'awesome', 'appreciated',
    'appreciate', 'bye', 'goodbye', 'done', 'yep', 'yeah', 'ya', 'shukriya', 'shukria', 'theek', 'thik',
    'hai', 'ji', 'acha', 'achha', 'bas', 'bs', 'samajh', 'gaya', 'gai', 'aya', 'ay', 'right',
  ]);
  const words = cleaned.split(' ');
  return words.every(w => CLOSER_WORDS.has(w));
}

// True if the message is nothing but emoji (a "reaction" typed as text — thumbs up,
// heart, fire, etc.) with no real words at all. isConversationalCloser can't catch
// these: stripping punctuation from a bare emoji leaves an empty string, which fails
// its word-whitelist check entirely, so it used to fall through to Gemini and produce
// a nonsensical reply instead of a graceful acknowledgment.
function isPureEmojiMessage(text: string): boolean {
  const stripped = text.replace(/[\s‍️]/gu, ''); // whitespace, zero-width joiner, variation selector
  if (!stripped) return false;
  return /^[\p{Extended_Pictographic}\p{Emoji_Modifier}]+$/u.test(stripped);
}

// True if the message is a plain greeting with no question attached —
// matches the exact cases CORE_SYSTEM_PROMPT's "Official Initial Greeting" rule covers.
function isPureGreeting(text: string): boolean {
  const t = text.trim();
  if (!t || t.includes('?') || t.length > 40) return false;
  // as+alam matches both "Asalam" and "Assalam" (1 or 2 s's) — common spelling variance
  return /^(hi+|hello+|hey+|salam|as+alam[u\s-]*o?[\s-]*alaikum|assallamo?\s?allikum|aoa|good\s?(morning|afternoon|evening))\s*(there)?[.!\s]*$/i.test(t);
}

// True if the message looks like a question the AI should answer
function isQuestion(text: string): boolean {
  if (text.trim().endsWith('?')) return true;
  const questionWords = /\b(what|how|when|where|why|tell|is|are|do|can|could|would|please|about|kya|kab|kaisa|bata|mujhe|fee|timing|course|duration|internship)\b/i;
  return questionWords.test(text);
}

type GeminiHistory = { role: 'user' | 'model'; parts: { text: string }[] }[];

// Strip any enrollment nudge Gemini added (system prompt tells it to redirect),
// so the code can control when nudges are appended.
function stripEnrollmentNudge(text: string): string {
  return text
    // "Also, please share your *email address*..." / "Please provide your full name..."
    .replace(/\n+(Also,?\s*)?(please\s+)?(share|provide|send)\s+your\s+[\*_]*(full\s+name|name|email\s+address|email|payment\s+screenshot|screenshot)[\*_]*.*/gi, '')
    // "To continue/proceed, please share your name/email..."
    .replace(/\n+To\s+(continue|proceed|get\s+started)[^.!?]*?(share|provide|send)\s+your\s+(name|email|screenshot).*/gi, '')
    // "You can also share/provide your email..."
    .replace(/\n+You\s+can\s+(also\s+)?(share|provide|send)\s+your\s+(name|email|screenshot).*/gi, '')
    // "When you're ready, please send a screenshot..."
    .replace(/\n+When\s+you're\s+ready[^.!?]*?send\s+a\s+screenshot.*/gi, '')
    .trim();
}

// Backfills the "agent leads" sheet row's Name column the first time we learn a
// contact's name — the row is written blank at first contact if the name isn't
// known yet, and would otherwise stay blank forever.
async function syncLeadNameIfNew(phone: string, priorName: string | null | undefined, newName: string) {
  if (priorName || !newName) return;
  try {
    await updateLeadName(phone, newName);
  } catch (err) {
    console.error('Failed to sync lead name to sheet:', err instanceof Error ? err.message : err);
  }
}

// Every first-ever message from a brand-new contact gets the brochure attached,
// regardless of content — greeting, question, whatever. This is the one chance
// to hand over the full info packet before they've seen anything else from us.
async function attachBrochureIfFirstContact(hadPriorMessages: boolean, from: string): Promise<boolean> {
  if (hadPriorMessages) return false;
  try {
    await sendWhatsAppDocument(from);
    return true;
  } catch (err) {
    console.error('Failed to send brochure on first contact:', err instanceof Error ? err.message : err);
    return false;
  }
}

function withNudgeIfNeeded(aiReply: string, nudge: string, checkRegex: RegExp): string {
  if (checkRegex.test(aiReply)) {
    return aiReply;
  }
  return `${aiReply}\n\n${nudge}`;
}

// ── Enrollment state machine ──────────────────────────────────────────────────
async function runEnrollmentMachine(
  from: string,
  session: EnrollmentSession,
  msgType: string,
  text: string,
  imageId?: string,
  imageMime?: string,
  history: GeminiHistory = [],
  explicitName?: string,
  priorContactName?: string | null,
): Promise<{ reply: string; mediaUrl?: string }> {
  let reply = '';
  let mediaUrl: string | undefined;

  // Prefer session.name, or explicit name stated by user in chat history
  const candidateName = session.name || explicitName;
  if (!session.name && candidateName && looksLikeName(candidateName)) {
    session.name = candidateName;
    await syncLeadNameIfNew(from, priorContactName, session.name);
  }

  // Prevent Gemini from adding its own enrollment nudge or assuming payment queries on pure greetings
  const enrollmentSystemPrompt = `${CORE_SYSTEM_PROMPT}\n\nIMPORTANT INSTRUCTIONS FOR IN-PROGRESS ENROLLMENT:
- If the user sends a simple greeting (e.g. "hi", "hello", "salam", "hey", "hi there"), greet them back naturally and ask how you can assist them today. Do NOT mention payment verification or enrollment status unless they explicitly ask about payment or receipt status.
- If the user asks a general question (curriculum, python, duration, timings, fee), answer their question directly and concisely.
- Do NOT append redundant reminders asking for name, email, or payment screenshots unless requested.`;

  switch (session.state) {

    case 'collecting_name': {
      // Image sent before name/email — upload to Drive for display only, redirect user
      if (msgType === 'image' && imageId) {
        try {
          const { buffer, mimeType } = await downloadWhatsAppMedia(imageId);
          const { fileId } = await uploadScreenshotToDrive(buffer, mimeType, from, Date.now());
          mediaUrl = fileId;
        } catch (err) {
          console.error('Drive upload failed (collecting_name):', err instanceof Error ? err.message : err);
        }
        const what = session.email ? '*full name*' : '*full name* and *email address*';
        reply = `Please share your ${what} first so we can get you enrolled! 😊`;
        break;
      }

      // Email already saved — only need name now
      if (session.email) {
        const nameOnly = cleanName(text);
        if (!nameOnly || !looksLikeName(nameOnly)) {
          if (enrollmentSystemPrompt && text.trim()) {
            reply = await getAIReply(text, history, enrollmentSystemPrompt);
          } else {
            reply = 'Please share your *full name* to continue.\n\nExample: _John Doe_';
          }
          break;
        }
        session.name = nameOnly;
        session.state = 'awaiting_screenshot';
        await syncLeadNameIfNew(from, priorContactName, session.name);
        reply = `Perfect, *${session.name}*! 🎉\n\n${buildPaymentMsg()}`;
        break;
      }

      // Try to extract both name and email
      const { email, name } = extractEmailAndName(text);

      if (name && email) {
        if (!looksLikeName(name)) {
          // Email found but extracted name is still messy — save email, ask for name
          session.email = email;
          reply = `Got your email! 😊 Could you share your *full name*?\n\nExample: _John Doe_`;
        } else {
          session.name = name;
          session.email = email;
          session.state = 'awaiting_screenshot';
          await syncLeadNameIfNew(from, priorContactName, session.name);
          reply = `Perfect, *${session.name}*! 🎉\n\n${buildPaymentMsg()}`;
        }
      } else if (email && !name) {
        session.email = email;
        reply = `Got your email! 😊 Could you also share your *full name*, please?\n\nExample: _John Doe_`;
      } else if (name && !email) {
        if (!looksLikeName(name)) {
          // Doesn't look like a name — use Gemini for any non-empty reply
          if (enrollmentSystemPrompt && text.trim()) {
            reply = await getAIReply(text, history, enrollmentSystemPrompt);
          } else {
            reply = `Please share your *full name* and *email address* to continue.\n\nExample: _John Doe, johndoe@gmail.com_`;
          }
        } else {
          session.name = name;
          session.state = 'collecting_email';
          await syncLeadNameIfNew(from, priorContactName, session.name);
          reply = `Thanks *${session.name}*! 😊 Now please share your *email address*.`;
        }
      } else {
        // Neither — use Gemini for any non-empty reply
        if (enrollmentSystemPrompt && text.trim()) {
          reply = await getAIReply(text, history, enrollmentSystemPrompt);
        } else {
          reply = `Please share your *full name* and *email address* to continue.\n\nExample: _John Doe, johndoe@gmail.com_`;
        }
      }
      break;
    }

    case 'collecting_email': {
      // Image sent before email — upload to Drive for display only, redirect user
      if (msgType === 'image' && imageId) {
        try {
          const { buffer, mimeType } = await downloadWhatsAppMedia(imageId);
          const { fileId } = await uploadScreenshotToDrive(buffer, mimeType, from, Date.now());
          mediaUrl = fileId;
        } catch (err) {
          console.error('Drive upload failed (collecting_email):', err instanceof Error ? err.message : err);
        }
        reply = `Please share your *email address* first (e.g. name@gmail.com) and then we'll get to the payment screenshot! 😊`;
        break;
      }
      const { email } = extractEmailAndName(text);
      if (!email) {
        // Use Gemini for any non-email reply (questions, "done", "okay", etc.)
        if (enrollmentSystemPrompt && text.trim()) {
          reply = await getAIReply(text, history, enrollmentSystemPrompt!);
        } else {
          reply = 'Please share a valid *email address* (e.g. name@gmail.com).';
        }
        break;
      }
      session.email = email;
      session.state = 'awaiting_screenshot';
      reply = `Perfect, *${session.name}*! 🎉\n\n${buildPaymentMsg()}`;
      break;
    }

    case 'awaiting_screenshot': {
      const isImage = msgType === 'image' || (msgType === 'document' && Boolean(imageId));
      if (isImage && imageId) {
        let fileId = '';
        let webViewLink = '';
        let rowIndex = -1;

        try {
          const { buffer, mimeType } = await downloadWhatsAppMedia(imageId);
          const ts = Date.now();
          const driveRes = await uploadScreenshotToDrive(
            buffer, mimeType, from, ts,
          );
          fileId = driveRes.fileId;
          webViewLink = driveRes.webViewLink;

          rowIndex = await appendEnrollmentRow({
            name: session.name || 'Student',
            email: session.email || 'unknown@datacrumbs.org',
            phone: from,
            timestamp: ts,
            driveLink: webViewLink,
          });
        } catch (err: unknown) {
          console.error('Failed to process screenshot on Drive/Sheets:', err instanceof Error ? err.message : err);
        }

        if (fileId) {
          session.driveFileId = fileId;
          session.driveFileUrl = webViewLink;
          mediaUrl = fileId;
        }
        if (rowIndex > 0) {
          session.sheetRowIndex = rowIndex;
        }
        session.state = 'screenshot_received';

        const validName = (session.name && looksLikeName(session.name)) ? session.name : null;
        const nameGreeting = validName ? `, *${validName}*` : '';
        reply = `✅ We've received your image! Our team will review and verify your payment receipt. Once verified, we will confirm your enrollment here.\n\nIn the meantime, please sign up on our LMS using the *same email address* you provided (${session.email}):\n🔗 https://lms.datacrumbs.org\n\nThank you${nameGreeting}! We're excited to have you join DataCrumbs 🚀`;
      } else if (msgType === 'text' && text.trim()) {
        const isPaymentQuery = /\b(pay|payment|bank|easypaisa|jazzcash|nayapay|account|iban|fee|receipt|ss|screenshot|transfer|paid)\b/i.test(text);
        if (enrollmentSystemPrompt) {
          const aiReply = await getAIReply(text, history, enrollmentSystemPrompt);
          if (isPaymentQuery) {
            reply = `${aiReply}\n\nWhen you're ready, please send a *screenshot* of your payment to proceed 😊`;
          } else {
            reply = aiReply;
          }
        } else {
          reply = `Please send a *screenshot* of your payment to proceed.\n\n${buildPaymentMsg()}`;
        }
      } else {
        reply = `Please send a *screenshot* of your payment to proceed.\n\n${buildPaymentMsg()}`;
      }
      break;
    }

    case 'screenshot_received': {
      const isImage = msgType === 'image' || (msgType === 'document' && Boolean(imageId));
      if (isImage && imageId) {
        let fileId = '';
        let webViewLink = '';
        try {
          const { buffer, mimeType } = await downloadWhatsAppMedia(imageId);
          const ts = Date.now();
          const driveRes = await uploadScreenshotToDrive(
            buffer, mimeType, from, ts,
          );
          fileId = driveRes.fileId;
          webViewLink = driveRes.webViewLink;
        } catch (err: unknown) {
          console.error('Failed to update screenshot on Drive:', err instanceof Error ? err.message : err);
        }

        if (fileId) {
          session.driveFileId = fileId;
          session.driveFileUrl = webViewLink;
          mediaUrl = fileId;
        }

        reply = `✅ Thanks! We've received your image upload. Our team will review and verify it to confirm your enrollment shortly.`;
      } else if (msgType === 'text' && text.trim() && enrollmentSystemPrompt) {
        reply = await getAIReply(text, history, enrollmentSystemPrompt);
      } else {
        reply = `We've received your image upload and our team is reviewing it! We will update you shortly. 😊`;
      }
      break;
    }

    case 'approved': {
      if ((msgType === 'image' || msgType === 'document') && imageId) {
        // Upload for dashboard display only — image doesn't mean anything enrollment-wise here
        try {
          const { buffer, mimeType } = await downloadWhatsAppMedia(imageId);
          const { fileId } = await uploadScreenshotToDrive(buffer, mimeType, from, Date.now());
          mediaUrl = fileId;
        } catch (err) {
          console.error('Drive upload failed (approved):', err instanceof Error ? err.message : err);
        }
        reply = `Please type your question in text 😊`;
      } else if (msgType === 'text' && text.trim()) {
        reply = await getAIReply(text, history, CORE_SYSTEM_PROMPT);
      } else {
        reply = `Please type your question in text 😊`;
      }
      break;
    }

    default:
      reply = `Your enrollment is being processed. Our team will confirm shortly. You can also send additional payment screenshots here if needed.`;
  }

  await saveEnrollmentSession(session);
  return { reply, mediaUrl };
}

// ── POST: Incoming WhatsApp messages ─────────────────────────────────────────
export async function POST(req: NextRequest) {
  const body = await req.json();

  // Forward to Agent 2 (Internal Chatbot) if message was sent to Number 2
  const phoneNumberId = body?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
  if (phoneNumberId === '1374955249033565') {
    // Fire-and-forget: don't await — the internal bot processes inline and
    // may take several seconds (Gemini AI call). Return 200 to Meta instantly
    // so it doesn't timeout or retry.
    fetch('https://whatsapp.datacrumbs.org/api/whatsapp/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(fwdErr => {
      console.error('[webhook] Failed to forward to internal bot:', fwdErr);
    });
    return NextResponse.json({ status: 'forwarded_to_agent_2' });
  }

  after(async () => {
    try {
      const value = body?.entry?.[0]?.changes?.[0]?.value;
      const message = value?.messages?.[0];
      if (!message) return;

      const from = message.from as string;
      const msgType = message.type as string;
      const text = msgType === 'text' ? (message.text?.body as string ?? '') : (message.image?.caption ?? message.document?.caption ?? '');
      // Accept any document as a potential payment screenshot — don't restrict by MIME/filename
      const imageId = message.image?.id ?? message.document?.id;
      const imageMime = message.image?.mime_type ?? message.document?.mime_type ?? 'image/jpeg';

      const [session, contactProfile, hadPriorMessages] = await Promise.all([
        getActiveEnrollmentSession(from),
        getContactProfile(from),
        hasPriorMessages(from),
      ]);

      /// Check if user explicitly stated their name in this message ("My name is John")
      const newlyStatedName = msgType === 'text' ? extractExplicitNameFromText(text) : null;
      if (newlyStatedName) {
        await saveContactProfile({ phone: from, name: newlyStatedName, nameAsked: false });
        await syncLeadNameIfNew(from, contactProfile?.name, newlyStatedName);
      }

      const explicitName = newlyStatedName || (contactProfile?.name && looksLikeName(contactProfile.name) ? contactProfile.name : undefined);

      // ── New lead → log to the "agent leads" Google Sheet tab (once per contact, ever) ──
      // Uses an atomic claim (claimNewLead), not hadPriorMessages — a plain existence
      // check has a race window where two near-simultaneous messages from the same
      // genuinely-new contact could both see "no prior messages" and both write a row.
      // This guarantees at most one row per phone no matter what: demo/discount/
      // enrollment requests from a RETURNING contact are still fully handled below,
      // they just never touch the leads sheet again since their number is already on file.
      if (await claimNewLead(from)) {
        try {
          await appendLeadRow({ name: explicitName ?? null, phone: from, timestamp: Date.now() });
        } catch (err) {
          console.error('Failed to append lead to sheet:', err instanceof Error ? err.message : err);
        }
      }

      // ── 0. Bot toggle ────────────────────────────────────────────────────
      if (contactProfile?.botDisabled) {
        if (msgType === 'text' && text) {
          await saveMessage({ from, text, reply: '', timestamp: Date.now() });
        }
        return;
      }

      // ── 0b. Brochure shortcut — checked before enrollment so ALL users get the PDF ──
      if (msgType === 'text' && wantsBrochure(text)) {
        const brochureBlurb = 'Here is our complete Data Science & AI Bootcamp brochure! It covers the full curriculum, pricing, internship details, and instructor profiles. Let me know if you have any questions 😊';
        // First-ever message from this contact — lead with the official intro, not just the PDF
        const reply = hadPriorMessages ? brochureBlurb : `${WELCOME_GREETING}\n\n${brochureBlurb}`;
        let sentDoc = false;
        try {
          await sendWhatsAppDocument(from);
          sentDoc = true;
        } catch (err) {
          console.error('Failed to send brochure document:', err instanceof Error ? err.message : err);
        }
        await sendWhatsAppMessage(from, reply);
        await saveMessage({ from, text, reply, timestamp: Date.now(), ...(sentDoc ? { mediaType: 'document' as const } : {}) });
        return;
      }

      // Conversation context — fetched once and reused by every branch below
      const recentMsgs = msgType === 'text' ? await getRecentMessagesByPhone(from, 10) : [];

      // ── 0b2. Discount offer confirmation ─────────────────────────────────
      // We've asked "should I forward this to management?" — wait for a clear
      // yes/no before ever asking for name/email. Anything ambiguous (like a
      // question) gets a short answer and the offer repeated, not a name/email demand.
      if (msgType === 'text' && contactProfile?.discountOfferPending) {
        const existingName = contactProfile.discountCollectedName
          || (contactProfile.name && looksLikeName(contactProfile.name) ? contactProfile.name : null);

        let offerReply: string;

        if (isAffirmative(text)) {
          if (existingName) {
            offerReply = `Great, *${existingName}*! 🙌 Please share your *email address* so I can forward this to our management team.\n\nExample: _johndoe@gmail.com_`;
          } else {
            offerReply = `Great! 🙌 Please share your *full name* and *email address* so I can forward this to our management team.\n\nExample: _John Doe, johndoe@gmail.com_`;
          }
          await saveContactProfile({
            phone: from,
            discountOfferPending: false,
            discountPending: true,
            ...(existingName ? { discountCollectedName: existingName } : {}),
          });
        } else if (isNegative(text)) {
          offerReply = `No problem at all! 😊 Feel free to ask me anything else — curriculum, schedule, or enrollment.`;
          await saveContactProfile({ phone: from, discountOfferPending: false });
        } else {
          // Ambiguous / a question — answer briefly, then repeat the offer (never demand contact info here)
          offerReply = `Our management reviews each request individually and may be able to offer you a special discount. 😊\n\nWould you like me to forward your request to them? (yes/no)`;
        }

        await sendWhatsAppMessage(from, offerReply);
        await saveMessage({ from, text, reply: offerReply, timestamp: Date.now() });
        return;
      }

      // ── 0c. Discount collection state ────────────────────────────────────
      // Runs BEFORE the enrollment-session branch so it applies to every user,
      // including those with an existing (e.g. approved) enrollment session.
      if (msgType === 'text' && contactProfile?.discountPending) {
        const collectedName = contactProfile.discountCollectedName;
        const collectedEmail = contactProfile.discountCollectedEmail;

        let finalName: string | null = collectedName ?? null;
        let finalEmail: string | null = collectedEmail ?? null;

        const { email: parsedEmail, name: parsedName } = extractEmailAndName(text);
        if (parsedEmail && !finalEmail) finalEmail = parsedEmail;
        if (parsedName && looksLikeName(parsedName) && !finalName) finalName = parsedName;
        // Raw text as name if short and looks like one
        if (!finalName && looksLikeName(text.trim())) finalName = text.trim();

        let discountReply: string;

        if (finalName && finalEmail) {
          const ts = Date.now();
          try {
            await saveDiscountRequest({ phone: from, name: finalName, email: finalEmail, message: contactProfile.discountOriginalMessage || text, timestamp: ts });
            await appendDiscountRow({ name: finalName, phone: from, email: finalEmail, message: contactProfile.discountOriginalMessage || text, timestamp: ts });
          } catch (err) {
            console.error('Failed to save discount request:', err instanceof Error ? err.message : err);
          }
          await saveContactProfile({ phone: from, name: finalName, discountPending: false, hasSubmittedDiscountRequest: true });
          await syncLeadNameIfNew(from, contactProfile?.name, finalName);
          discountReply = `✅ Thank you, *${finalName}*! Your request has been forwarded to our management team. They'll reach out to you directly on this WhatsApp number shortly. 😊`;
        } else if (finalEmail && !finalName) {
          await saveContactProfile({ phone: from, discountCollectedEmail: finalEmail });
          discountReply = `Got your email! 😊 Could you also share your *full name*, please?\n\nExample: _John Doe_`;
        } else if (finalName && !finalEmail) {
          await saveContactProfile({ phone: from, name: finalName, discountCollectedName: finalName });
          await syncLeadNameIfNew(from, contactProfile?.name, finalName);
          discountReply = `Thanks *${finalName}*! 😊 Could you also share your *email address*?\n\nExample: _johndoe@gmail.com_`;
        } else {
          discountReply = `Please share your *full name* and *email address* so we can forward your request to the management team.\n\nExample: _John Doe, johndoe@gmail.com_`;
        }

        await sendWhatsAppMessage(from, discountReply);
        await saveMessage({ from, text, reply: discountReply, timestamp: Date.now() });
        return;
      }

      // ── 0c2. Demo class collection state ─────────────────────────────────
      // Simpler than discount: no yes/no offer step — goes straight to
      // collecting name/email once a demo request was detected (0e2 below).
      if (msgType === 'text' && contactProfile?.demoPending) {
        const collectedName = contactProfile.demoCollectedName;
        const collectedEmail = contactProfile.demoCollectedEmail;

        let finalName: string | null = collectedName ?? null;
        let finalEmail: string | null = collectedEmail ?? null;

        const { email: parsedEmail, name: parsedName } = extractEmailAndName(text);
        if (parsedEmail && !finalEmail) finalEmail = parsedEmail;
        if (parsedName && looksLikeName(parsedName) && !finalName) finalName = parsedName;
        if (!finalName && looksLikeName(text.trim())) finalName = text.trim();

        let demoReply: string;

        if (finalName && finalEmail) {
          const ts = Date.now();
          try {
            await saveDemoRequest({ phone: from, name: finalName, email: finalEmail, message: contactProfile.demoOriginalMessage || text, timestamp: ts });
            await appendDemoRow({ name: finalName, phone: from, email: finalEmail, message: contactProfile.demoOriginalMessage || text, timestamp: ts });
          } catch (err) {
            console.error('Failed to save demo request:', err instanceof Error ? err.message : err);
          }
          await saveContactProfile({ phone: from, name: finalName, demoPending: false, hasSubmittedDemoRequest: true });
          await syncLeadNameIfNew(from, contactProfile?.name, finalName);
          demoReply = `✅ Thank you, *${finalName}*! I've shared your demo class request with our management team. They'll reach out to you directly on this WhatsApp number shortly. 😊`;
        } else if (finalEmail && !finalName) {
          await saveContactProfile({ phone: from, demoCollectedEmail: finalEmail });
          demoReply = `Got your email! 😊 Could you also share your *full name*, please?\n\nExample: _John Doe_`;
        } else if (finalName && !finalEmail) {
          await saveContactProfile({ phone: from, name: finalName, demoCollectedName: finalName });
          await syncLeadNameIfNew(from, contactProfile?.name, finalName);
          demoReply = `Thanks *${finalName}*! 😊 Could you also share your *email address*?\n\nExample: _johndoe@gmail.com_`;
        } else {
          demoReply = `Please share your *full name* and *email address* so I can share this with our management team.\n\nExample: _John Doe, johndoe@gmail.com_`;
        }

        await sendWhatsAppMessage(from, demoReply);
        await saveMessage({ from, text, reply: demoReply, timestamp: Date.now() });
        return;
      }

      // ── 0d. B2B / vendor pitch — decline politely, never route into student flows ──
      if (msgType === 'text' && isBusinessPitch(text)) {
        const pitchReply = `Thank you for reaching out! 🙏\n\nWe're a student-focused training platform and don't take vendor or partnership meetings through this channel.\n\nFor business enquiries, please email *info@datacrumbs.org*.`;
        await sendWhatsAppMessage(from, pitchReply);
        await saveMessage({ from, text, reply: pitchReply, timestamp: Date.now() });
        return;
      }

      // ── 0e. Discount collection trigger ──────────────────────────────────
      // Fires when: (a) explicit affordability/discount request, OR
      //             (b) vague sticker-shock reaction right after we quoted the fee, OR
      //             (c) group discount already explained AND they're STILL asking about discount
      const lastTwoReplies = recentMsgs.slice(-2).map(m => m.reply || '').join(' ');
      const feeJustQuoted = /7,?499|7499|per month|\/month|\bfee\b|\bprice\b/i.test(lastTwoReplies);

      const groupDiscountExplained = recentMsgs.some(m => m.reply && m.reply.includes('20%'));
      const stillAskingDiscount = /\bdiscount\b/i.test(text);

      const shouldCollectDiscount =
        msgType === 'text' && (
          needsAffordabilityHelp(text) ||
          (feeJustQuoted && isPriceShockReaction(text)) ||
          (groupDiscountExplained && stillAskingDiscount)
        );

      if (shouldCollectDiscount) {
        const existingName = contactProfile?.name && looksLikeName(contactProfile.name) ? contactProfile.name : null;

        // Already have a discount request on file for this contact — this is a follow-up
        // (e.g. a counter-offer after management responded), not a fresh request. Update
        // the existing record instead of re-asking for name/email or re-offering to forward.
        if (contactProfile?.hasSubmittedDiscountRequest) {
          try {
            await updateDiscountRequestComment(from, text);
            await updateDiscountRowComment(from, text);
          } catch (err) {
            console.error('Failed to update discount comment:', err instanceof Error ? err.message : err);
          }
          const followUpReply = `Got it${existingName ? `, *${existingName}*` : ''}! I've passed along your update to our management team. They'll follow up with you soon. 😊`;
          await sendWhatsAppMessage(from, followUpReply);
          await saveMessage({ from, text, reply: followUpReply, timestamp: Date.now() });
          return;
        }

        const groupDiscountNote = `By the way, we also offer a special *20% group discount* when 2+ students enroll together! 😊\n\n`;
        const greeting = existingName ? `I understand, *${existingName}*!` : `I understand your situation!`;
        const discountReply = `${greeting}\n\n${groupDiscountNote}I can forward your request to our management team — they sometimes offer a special discount based on individual circumstances.\n\nWould you like me to forward this to them? (yes/no)`;
        await saveContactProfile({
          phone: from,
          discountOfferPending: true,
          discountOriginalMessage: text,
          ...(existingName ? { discountCollectedName: existingName } : {}),
        });
        const sentDoc = await attachBrochureIfFirstContact(hadPriorMessages, from);
        await sendWhatsAppMessage(from, discountReply);
        await saveMessage({
          from, text, reply: discountReply, timestamp: Date.now(),
          ...(sentDoc ? { mediaType: 'document' as const } : {}),
        });
        return;
      }

      // ── 0e2. Demo class request trigger ──────────────────────────────────
      // We DO offer demo classes — confirm that directly and go straight to
      // collecting name/email (no yes/no offer step, unlike discount).
      if (msgType === 'text' && wantsDemo(text)) {
        const existingName = contactProfile?.name && looksLikeName(contactProfile.name) ? contactProfile.name : null;

        // Already have a demo request on file — don't re-collect, just reassure
        if (contactProfile?.hasSubmittedDemoRequest) {
          const alreadyReply = `You're all set${existingName ? `, *${existingName}*` : ''}! We've already shared your demo class request with our management team — they'll reach out to you soon. 😊`;
          await sendWhatsAppMessage(from, alreadyReply);
          await saveMessage({ from, text, reply: alreadyReply, timestamp: Date.now() });
          return;
        }

        const demoReply = existingName
          ? `Yes, we do offer demo classes, *${existingName}*! 😊 Please also share your *email address* so I can share this with our management team.\n\nExample: _johndoe@gmail.com_`
          : `Yes, we do offer demo classes! 😊 Please share your *full name* and *email address* so I can share this with our management team.\n\nExample: _John Doe, johndoe@gmail.com_`;

        await saveContactProfile({
          phone: from,
          demoPending: true,
          demoOriginalMessage: text,
          ...(existingName ? { demoCollectedName: existingName } : {}),
        });
        const sentDoc2 = await attachBrochureIfFirstContact(hadPriorMessages, from);
        await sendWhatsAppMessage(from, demoReply);
        await saveMessage({
          from, text, reply: demoReply, timestamp: Date.now(),
          ...(sentDoc2 ? { mediaType: 'document' as const } : {}),
        });
        return;
      }

      // ── 0f. Conversational closer ("thanks", "ok", "no more questions", or a bare emoji) ──
      // Checked BEFORE the enrollment-session branch so a stuck/abandoned session
      // (e.g. someone started enrolling, got distracted, never provided name+email)
      // can't hijack every later "ok"/"thanks" into runEnrollmentMachine's raw Gemini
      // fallback, which has no concept of "don't repeat yourself" — that was producing
      // a fresh verbose reply to every single closer instead of a short acknowledgment.
      const isEmojiOnlyClose = msgType === 'text' && isPureEmojiMessage(text);
      if (msgType === 'text' && (isConversationalCloser(text) || isEmojiOnlyClose)) {
        const existingName = contactProfile?.name && looksLikeName(contactProfile.name) ? contactProfile.name : null;
        let closerReply: string;
        if (contactProfile?.lastReplyWasClosing) {
          closerReply = '🙂';
        } else if (isEmojiOnlyClose) {
          closerReply = `Thank you so much${existingName ? `, *${existingName}*` : ''} for contacting! 😊 If you want to ask anything in the future or whenever, feel free to contact me anytime.`;
        } else {
          closerReply = `You're welcome${existingName ? `, *${existingName}*` : ''}! 😊 Feel free to reach out anytime you have more questions.`;
        }
        await saveContactProfile({ phone: from, lastReplyWasClosing: true });
        await sendWhatsAppMessage(from, closerReply);
        await saveMessage({ from, text, reply: closerReply, timestamp: Date.now() });
        return;
      }

      // ── 1. Active enrollment session ─────────────────────────────────────
      if (session) {
        const history: GeminiHistory = recentMsgs.flatMap(m => [
          ...(m.text && m.text !== '[image]' ? [{ role: 'user' as const, parts: [{ text: m.text }] }] : []),
          ...(m.reply ? [{ role: 'model' as const, parts: [{ text: m.reply }] }] : []),
        ]);

        const { reply, mediaUrl } = await runEnrollmentMachine(
          from, session, msgType, text, imageId, imageMime, history, explicitName, contactProfile?.name,
        );
        await sendWhatsAppMessage(from, reply);
        const isMediaMsg = msgType === 'image' || msgType === 'document';
        await saveMessage({
          from,
          text: isMediaMsg ? '[image]' : text,
          reply,
          timestamp: Date.now(),
          ...(isMediaMsg ? { mediaType: 'image' as const, ...(mediaUrl ? { mediaUrl } : {}) } : {}),
        });
        return;
      }

      // ── 2. Save non-text messages so they appear in the dashboard ────────
      if (msgType !== 'text') {
        if (msgType === 'image' || msgType === 'document') {
          let mediaUrl: string | undefined;
          if (imageId) {
            try {
              const { buffer, mimeType } = await downloadWhatsAppMedia(imageId);
              const { fileId } = await uploadScreenshotToDrive(buffer, mimeType, from, Date.now());
              mediaUrl = fileId;
            } catch (err) {
              console.error('Drive upload failed (non-enrollment):', err instanceof Error ? err.message : err);
            }
          }
          await attachBrochureIfFirstContact(hadPriorMessages, from);
          const imgReply = 'Please type your question in text 😊';
          await sendWhatsAppMessage(from, imgReply);
          await saveMessage({
            from, text: '[image]', reply: imgReply, timestamp: Date.now(),
            mediaType: 'image',
            ...(mediaUrl ? { mediaUrl } : {}),
          });
        }
        return;
      }

      // ── 4. Enrollment intent ──────────────────────────────────────────────
      if (wantsEnrollment(text)) {
        const newSession: EnrollmentSession = {
          phone: from,
          state: 'collecting_name',
          name: null,
          email: null,
          driveFileId: null,
          driveFileUrl: null,
          sheetRowIndex: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        const reply = `Great! I'll get you enrolled in the *4-Month AI & Data Science Bootcamp* 🎓\n\nPlease share your *full name* and *email address* together so we can get started!\n\nExample: _John Doe, johndoe@gmail.com_`;
        await saveEnrollmentSession(newSession);
        const sentDoc = await attachBrochureIfFirstContact(hadPriorMessages, from);
        await sendWhatsAppMessage(from, reply);
        await saveMessage({
          from, text, reply, timestamp: Date.now(),
          ...(sentDoc ? { mediaType: 'document' as const } : {}),
        });
        return;
      }

      // ── 4b. First-ever pure greeting → send official welcome + brochure together ──
      // Bypasses Gemini so the greeting text and the brochure attach are guaranteed
      // to arrive together, deterministically, on this contact's very first message.
      if (!hadPriorMessages && isPureGreeting(text)) {
        let sentDoc = false;
        try {
          await sendWhatsAppDocument(from);
          sentDoc = true;
        } catch (err) {
          console.error('Failed to send brochure on first greeting:', err instanceof Error ? err.message : err);
        }
        await sendWhatsAppMessage(from, WELCOME_GREETING);
        await saveMessage({
          from, text, reply: WELCOME_GREETING, timestamp: Date.now(),
          ...(sentDoc ? { mediaType: 'document' as const } : {}),
        });
        return;
      }

      // ── 5. Normal Gemini flow ─────────────────────────────────────────────
      if (contactProfile?.nameAsked && !contactProfile?.name && looksLikeName(text)) {
        await saveContactProfile({ phone: from, name: text.trim(), nameAsked: false });
        await syncLeadNameIfNew(from, contactProfile?.name, text.trim());
      }

      const history: GeminiHistory = recentMsgs.flatMap(m => [
        ...(m.text && m.text !== '[image]' ? [{ role: 'user' as const, parts: [{ text: m.text }] }] : []),
        ...(m.reply ? [{ role: 'model' as const, parts: [{ text: m.reply }] }] : []),
      ]);

      let reply = await getAIReply(text, history);

      // Every first-ever message gets the brochure, whatever it says — greeting,
      // direct question, anything. Catches any first message that reaches this
      // normal-flow path (didn't match the pure-greeting or brochure-keyword shortcuts).
      const sentDocWithReply = await attachBrochureIfFirstContact(hadPriorMessages, from);

      if (contactProfile?.lastReplyWasClosing) {
        await saveContactProfile({ phone: from, lastReplyWasClosing: false });
      }

      if (!contactProfile?.name && !contactProfile?.nameAsked && recentMsgs.length === 1) {
        reply += '\n\nBy the way, may I know your name? 😊';
        await saveContactProfile({ phone: from, nameAsked: true });
      }

      // Backup: detect escalation phrasing in Gemini's reply.
      // Gated on the USER's message being about money — otherwise a plain redirect
      // to support (e.g. for an off-topic enquiry) would wrongly start the discount flow.
      const isEscalation =
        isMoneyContext(text) && (
          /noted.{0,30}request/i.test(reply) ||
          /forward.{0,30}(request|management)/i.test(reply) ||
          /management.{0,50}reach.{0,20}out/i.test(reply) ||
          /team.{0,50}will.{0,20}(reach|contact)/i.test(reply) ||
          /contact our support team/i.test(reply)
        );

      if (isEscalation) {
        const existingName = contactProfile?.name && looksLikeName(contactProfile.name) ? contactProfile.name : null;

        if (contactProfile?.hasSubmittedDiscountRequest) {
          // Already have a discount request on file — treat this as a follow-up comment
          try {
            await updateDiscountRequestComment(from, text);
            await updateDiscountRowComment(from, text);
          } catch (err) {
            console.error('Failed to update discount comment:', err instanceof Error ? err.message : err);
          }
          reply = `Got it${existingName ? `, *${existingName}*` : ''}! I've passed along your update to our management team. They'll follow up with you soon. 😊`;
          await sendWhatsAppMessage(from, reply);
          await saveMessage({ from, text, reply, timestamp: Date.now() });
          return;
        }

        const greeting = existingName ? `I understand, *${existingName}*!` : `I understand your situation!`;
        reply = `${greeting} 😊 I can forward your request to our management team — they sometimes offer a special discount based on individual circumstances.\n\nWould you like me to forward this to them? (yes/no)`;
        await saveContactProfile({
          phone: from,
          discountOfferPending: true,
          discountOriginalMessage: text,
          ...(existingName ? { discountCollectedName: existingName } : {}),
        });
      }

      await sendWhatsAppMessage(from, reply);
      await saveMessage({
        from, text, reply, timestamp: Date.now(),
        ...(sentDocWithReply ? { mediaType: 'document' as const } : {}),
      });

    } catch (err: unknown) {
      console.error('Webhook error:', err instanceof Error ? err.message : err);
    }
  });

  return NextResponse.json({}, { status: 200 });
}
