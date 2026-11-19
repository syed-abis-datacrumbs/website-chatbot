import { GoogleGenerativeAI } from '@google/generative-ai';
import { CORE_SYSTEM_PROMPT } from './knowledge';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

interface HistoryMessage {
  role: 'user' | 'model';
  parts: { text: string }[];
}

export async function getAIReply(
  userMessage: string,
  history: HistoryMessage[],
  systemPromptOverride?: string | null
): Promise<string> {
  const systemInstruction = systemPromptOverride ?? CORE_SYSTEM_PROMPT;
  const primaryModelName = process.env.GEMINI_MODEL || 'gemini-3.1-pro-preview';

  const safeHistory = [...history];
  while (safeHistory.length > 0 && safeHistory[0].role !== 'user') {
    safeHistory.shift();
  }

  const tryWithModel = async (modelName: string): Promise<string | null> => {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction,
      });

      const tryReply = async (hist: HistoryMessage[]): Promise<string | null> => {
        const chat = model.startChat({ history: hist });
        const result = await chat.sendMessage(userMessage);
        try {
          return result.response.text();
        } catch {
          console.warn(`[gemini:${modelName}] blocked:`, result.response.candidates?.[0]?.finishReason);
          return null;
        }
      };

      const first = await tryReply(safeHistory);
      if (first !== null) return first;

      const trimmed = safeHistory.slice(-4);
      while (trimmed.length > 0 && trimmed[0].role !== 'user') trimmed.shift();
      return await tryReply(trimmed);
    } catch (err: any) {
      console.warn(`[gemini:${modelName}] error:`, err?.message || err);
      return null;
    }
  };

  // 1. Try primary model (Gemini 3.1 Pro)
  const res = await tryWithModel(primaryModelName);
  if (res !== null) return res;

  // 2. Fallback to Gemini 3.8 Flash if primary had an issue
  if (primaryModelName !== 'gemini-3.8-flash') {
    console.warn('[gemini] trying fallback model: gemini-3.8-flash');
    const fallbackRes = await tryWithModel('gemini-3.8-flash');
    if (fallbackRes !== null) return fallbackRes;
  }

  // 3. Fallback message
  console.error('[gemini] all model attempts failed or blocked');
  return `I'm sorry, I wasn't able to process that right now. Please rephrase your question, or reach our team directly at *+92 329 2020497*.`;
}

export interface PaymentVerificationResult {
  isPaymentReceipt: boolean;
  isValid: boolean;
  confidence: 'high' | 'medium' | 'low';
  amount: number | null;
  accountTitle: string | null;
  bankOrWallet: string | null;
  transactionId: string | null;
  description: string;
  reason: string;
}

/**
 * Uses Gemini Vision to inspect uploaded images.
 * Determines if the image is an actual payment receipt vs a general screenshot/syllabus/photo,
 * and validates beneficiary, amount (Rs 7,499 / 7,500), and completed status.
 */
export async function verifyPaymentReceiptWithAI(
  imageBuffer: Buffer,
  mimeType: string = 'image/jpeg'
): Promise<PaymentVerificationResult> {
  const bankName = process.env.PAYMENT_BANK_NAME || 'HabibMetro Bank';
  const bankTitle = process.env.PAYMENT_BANK_TITLE || 'Data Crumbs';
  const walletTitle = process.env.PAYMENT_WALLET_TITLE || 'Abis Hussain Syed';
  const walletNumber = process.env.PAYMENT_WALLET_NUMBER || '0336-2507273';
  const primaryModelName = process.env.GEMINI_MODEL || 'gemini-3.1-pro-preview';

  const prompt = `You are an expert financial verification AI for DataCrumbs (an educational technology institute in Pakistan).
Carefully inspect this image.

STEP 1: Identify Image Type:
- Is this image an actual money transfer receipt, payment confirmation slip, bank deposit slip, or mobile wallet transaction slip (e.g. JazzCash, EasyPaisa, SadaPay, NayaPay, Raast, Bank Alfalah, HabibMetro, HBL, Meezan, ATM slip)?
- OR is it a non-payment image (e.g. course outline, syllabus, website screenshot, WhatsApp chat screenshot, error message, curriculum modules, selfie, meme, document)?
Set "isPaymentReceipt" to true ONLY if it is an actual financial payment/transfer receipt. If it is a website screenshot, syllabus, course outline, or anything else, set "isPaymentReceipt" to false.

STEP 2: If isPaymentReceipt is true, check against Official DataCrumbs Payment Criteria:
1. Destination / Beneficiary Name:
   - Bank Destination: "${bankName}" with Account Title "${bankTitle}" (or variations like "DataCrumbs")
   - OR Wallet / Mobile Account: "${walletNumber}" with Account Title "${walletTitle}" (or "Syed Abis Hussain" / "Abis Hussain")
2. Transaction Status:
   - Must be a completed / successful transaction with a visible reference/transaction ID (not pending, scheduled, or failed).
3. Transferred Amount:
   - Read and extract the transferred amount number (e.g. 5000, 7500, 6000, etc.). Any positive amount is accepted (students frequently receive approved discounts, scholarships, or promotional offers).

CRITICAL RULE FOR "isValid":
Set "isValid" to true if:
(1) It is an actual payment receipt,
(2) Beneficiary name matches "${bankTitle}" or "${walletTitle}", and
(3) Transaction status is completed/successful (not failed or cancelled).
Do NOT reject based on the amount—students can pay discounted fees.
If the beneficiary name does NOT match our official accounts, or the transaction is failed, set "isValid" to false and explain the issue in "reason".

Return ONLY a valid JSON object with the following fields (no markdown formatting, no backticks, just raw JSON):
{
  "isPaymentReceipt": boolean,
  "isValid": boolean,
  "confidence": "high" | "medium" | "low",
  "amount": number | null,
  "accountTitle": string | null,
  "bankOrWallet": string | null,
  "transactionId": string | null,
  "description": "Short description of what the image shows",
  "reason": "Detailed explanation of verification decision"
}`;

  const imagePart = {
    inlineData: {
      data: imageBuffer.toString('base64'),
      mimeType: mimeType || 'image/jpeg',
    },
  };

  const tryWithModel = async (modelName: string): Promise<PaymentVerificationResult | null> => {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent([prompt, imagePart]);
      const responseText = result.response.text().trim();
      const cleanJson = responseText.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
      const parsed = JSON.parse(cleanJson);

      return {
        isPaymentReceipt: Boolean(parsed.isPaymentReceipt),
        isValid: Boolean(parsed.isValid),
        confidence: parsed.confidence || 'medium',
        amount: typeof parsed.amount === 'number' ? parsed.amount : (parsed.amount ? parseFloat(parsed.amount) : null),
        accountTitle: parsed.accountTitle || null,
        bankOrWallet: parsed.bankOrWallet || null,
        transactionId: parsed.transactionId || null,
        description: parsed.description || '',
        reason: parsed.reason || '',
      };
    } catch (err: any) {
      console.warn(`[gemini-vision:${modelName}] verification error:`, err?.message || err);
      return null;
    }
  };

  // 1. Try primary model
  const res = await tryWithModel(primaryModelName);
  if (res !== null) return res;

  // 2. Try fallback model if primary fails
  if (primaryModelName !== 'gemini-3.8-flash') {
    const fallbackRes = await tryWithModel('gemini-3.8-flash');
    if (fallbackRes !== null) return fallbackRes;
  }

  return {
    isPaymentReceipt: false,
    isValid: false,
    confidence: 'low',
    amount: null,
    accountTitle: null,
    bankOrWallet: null,
    transactionId: null,
    description: 'Unknown image',
    reason: 'Could not automatically analyze image with AI Vision.',
  };
}

/**
 * Handles general image questions/screenshots using Gemini Vision.
 * Allows Gemini to see screenshots of the website, syllabus, LMS, errors, etc.,
 * and answer the user's inquiry naturally and helpfully.
 */
export async function getAIReplyWithImage(
  userMessage: string,
  imageBuffer: Buffer,
  mimeType: string = 'image/jpeg',
  history: HistoryMessage[] = [],
  systemPromptOverride?: string | null
): Promise<string> {
  const systemInstruction = systemPromptOverride ?? CORE_SYSTEM_PROMPT;
  const primaryModelName = process.env.GEMINI_MODEL || 'gemini-3.1-pro-preview';

  const imagePart = {
    inlineData: {
      data: imageBuffer.toString('base64'),
      mimeType: mimeType || 'image/jpeg',
    },
  };

  const promptText = userMessage && userMessage.trim() && userMessage !== '[image]'
    ? userMessage.trim()
    : 'The user sent this screenshot / image without additional text. Please look at what is shown in the image and provide a helpful, natural, concise response explaining or acknowledging what is shown in the context of DataCrumbs (or answering any question visible in the image).';

  const tryWithModel = async (modelName: string): Promise<string | null> => {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction,
      });

      const result = await model.generateContent([promptText, imagePart]);
      return result.response.text();
    } catch (err: any) {
      console.warn(`[gemini-vision:${modelName}] getAIReplyWithImage error:`, err?.message || err);
      return null;
    }
  };

  const res = await tryWithModel(primaryModelName);
  if (res !== null) return res;

  if (primaryModelName !== 'gemini-3.8-flash') {
    const fallback = await tryWithModel('gemini-3.8-flash');
    if (fallback !== null) return fallback;
  }

  return `Thanks for sharing this image! If you have any questions about our bootcamp, curriculum, or enrollment, please let me know.`;
}

export async function getAIReplyWithAudio(
  audioBuffer: Buffer,
  mimeType: string = 'audio/ogg',
  history: HistoryMessage[] = [],
  systemPromptOverride?: string | null
): Promise<string> {
  const systemInstruction = systemPromptOverride ?? CORE_SYSTEM_PROMPT;
  const primaryModelName = process.env.GEMINI_MODEL || 'gemini-3.1-pro-preview';

  // Normalize mime type for Gemini (audio/ogg, audio/mp3, audio/wav, audio/aac)
  let cleanMime = mimeType.split(';')[0].trim();
  if (!cleanMime || cleanMime === 'audio/opus') cleanMime = 'audio/ogg';

  const audioPart = {
    inlineData: {
      data: audioBuffer.toString('base64'),
      mimeType: cleanMime,
    },
  };

  const promptText = `Listen carefully to this audio voice message from a prospective or enrolled student.
Understand what they are asking or saying (they may speak in English, Urdu, or Roman Urdu).
Respond to them naturally, warmly, concisely, and helpfully in plain text according to DataCrumbs' official bootcamp information.`;

  const tryWithModel = async (modelName: string): Promise<string | null> => {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction,
      });

      const result = await model.generateContent([promptText, audioPart]);
      return result.response.text();
    } catch (err: any) {
      console.warn(`[gemini-audio:${modelName}] getAIReplyWithAudio error:`, err?.message || err);
      return null;
    }
  };

  // 1. Primary: Gemini 3.1 Pro
  const res = await tryWithModel(primaryModelName);
  if (res !== null) return res;

  // 2. Fallback: Gemini 3.8 Flash
  if (primaryModelName !== 'gemini-3.8-flash') {
    const fallback = await tryWithModel('gemini-3.8-flash');
    if (fallback !== null) return fallback;
  }

  return `Thanks for your voice message! 🙏 I received your audio, but had a slight issue listening to it. Could you please send a quick text message or rephrase your question?`;
}

// ── Student Background Intent Classification ────────────────────────────────
export interface BackgroundClassification {
  hasBackground: boolean;
  isTech: boolean;
  detectedBackground?: string;
}

/**
 * Uses Gemini LLM to accurately determine whether a student's WhatsApp reply
 * actually answers: "What is your educational background or current job role?".
 * Distinguishes genuine background statements (BSCS, Mechanical Eng, Teacher, Sales, FSc)
 * from unrelated inquiries ("when is it launching?", "what is the fee?", etc.) or general chatter.
 */
export async function classifyStudentBackgroundWithAI(
  userText: string
): Promise<BackgroundClassification> {
  const primaryModelName = process.env.GEMINI_MODEL || 'gemini-3.1-pro-preview';

  const prompt = `You are an admissions intent classifier for an educational institute (DataCrumbs).
A newly registered student was asked:
"What is your educational background or current job role?"

The student replied:
"""${userText}"""

Task:
Evaluate whether the student is genuinely answering the question by providing their educational background, degree, field of study, current job role, or professional status.

CRITICAL RULES:
1. If the user asks ANY question (e.g., "when is it launching?", "what is the fee?", "timing kya hai?", "is it online?", "who are you?", "admissions kab tak hain?"), or writes an unrelated remark/filler, hasBackground MUST BE false.
2. If the user states what they studied, their degree, qualification, or what they do for work (e.g., "BSCS", "Mechanical Engineering", "Teacher", "FSc pre medical", "working in sales", "developer", "student", "freelancer", "I am in marketing", "Intermediate", "pharmacist", "fresh graduate"), hasBackground MUST BE true.
3. If hasBackground is true, evaluate whether their background is in Computer Science, Software Engineering, Programming, IT, or Web/AI Tech (isTech: true), or non-CS/non-tech fields like business, medical, other engineering, humanities, sales, fresh intermediate (isTech: false).

Respond with valid JSON only in this exact format:
{
  "hasBackground": boolean,
  "isTech": boolean,
  "detectedBackground": "concise description of their background, or empty string"
}`;

  const tryWithModel = async (modelName: string): Promise<BackgroundClassification | null> => {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: { responseMimeType: 'application/json' },
      });
      const result = await model.generateContent(prompt);
      const raw = result.response.text().trim();
      const cleanJson = raw.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
      const parsed = JSON.parse(cleanJson);
      return {
        hasBackground: Boolean(parsed.hasBackground),
        isTech: Boolean(parsed.isTech),
        detectedBackground: typeof parsed.detectedBackground === 'string' ? parsed.detectedBackground.trim() : '',
      };
    } catch (err: any) {
      console.warn(`[gemini:${modelName}] classifyStudentBackgroundWithAI error:`, err?.message || err);
      return null;
    }
  };

  const res = await tryWithModel(primaryModelName);
  if (res !== null) return res;

  if (primaryModelName !== 'gemini-3.8-flash') {
    const fallbackRes = await tryWithModel('gemini-3.8-flash');
    if (fallbackRes !== null) return fallbackRes;
  }

  return {
    hasBackground: false,
    isTech: false,
    detectedBackground: '',
  };
}

export async function summarizeLeadChatWithAI(
  messages: { text: string; reply?: string }[],
  profile?: { name?: string; goal?: string; background?: string } | null
): Promise<string> {
  const primaryModelName = process.env.GEMINI_MODEL || 'gemini-3.1-pro-preview';

  const transcript = messages
    .filter(m => (m.text && !m.text.startsWith('[template:') && !m.text.startsWith('Template:') && m.text !== '[lead_welcome]') || m.reply?.trim())
    .map(m => {
      const parts = [];
      if (m.text) parts.push(`Student: "${m.text}"`);
      if (m.reply) parts.push(`Bot: "${m.reply}"`);
      return parts.join('\n');
    })
    .filter(Boolean)
    .join('\n');

  const metaContext: string[] = [];
  if (profile?.name) metaContext.push(`Name: ${profile.name}`);
  if (profile?.background) metaContext.push(`Background/Degree: ${profile.background}`);
  if (profile?.goal) metaContext.push(`Stated Goal: ${profile.goal}`);

  const prompt = `You are a sales CRM assistant for DataCrumbs (an AI & Tech Institute in Pakistan).
A prospective student had this conversation with our automated WhatsApp bot:

${metaContext.length > 0 ? `Student Profile Info:\n${metaContext.join('\n')}\n` : ''}
WhatsApp Conversation:
"""
${transcript}
"""

Task:
Write a single concise sentence (under 25 words) for a sales agent about to call this student.
It must summarize:
1. Who the student is / background or degree (if mentioned)
2. Their goal or main interest (e.g. Freelancing, Job, AI Agents)
3. What they asked or their current status (e.g. asked about fees, schedule, or confirmed interest)

Rules:
- Exactly 1 sentence. Direct, informative, and professional.
- Do NOT use meta intro phrases like "In this chat..." or "The conversation indicates...".
- Example: "CS student aiming for freelancing with AI; inquired about course fee and weekend batch timings."
- Plain text only, no quotes, no markdown asterisks.`;

  const tryWithModel = async (modelName: string): Promise<string | null> => {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
      });
      const result = await model.generateContent(prompt);
      const text = result.response.text().trim();
      return text.replace(/^["']|["']$/g, '').replace(/\n+/g, ' ');
    } catch (err: any) {
      console.warn(`[gemini:${modelName}] summarizeLeadChatWithAI error:`, err?.message || err);
      return null;
    }
  };

  const res = await tryWithModel(primaryModelName);
  if (res) return res;

  if (primaryModelName !== 'gemini-3.8-flash') {
    const fallbackRes = await tryWithModel('gemini-3.8-flash');
    if (fallbackRes) return fallbackRes;
  }

  // Graceful rule-based synthesis if AI is unavailable
  const parts: string[] = [];
  if (profile?.background) parts.push(`${profile.background} background`);
  if (profile?.goal) parts.push(`aiming for ${profile.goal}`);
  const lastMsg = messages.filter(m => m.text && !m.text.startsWith('[')).slice(-1)[0]?.text;
  if (lastMsg) parts.push(`last reply: "${lastMsg}"`);

  return parts.length > 0 ? parts.join('; ') : 'Student replied on WhatsApp; review chat history before calling.';
}

