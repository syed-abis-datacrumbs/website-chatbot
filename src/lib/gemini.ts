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

  // 1. Try Gemini 3.1 Pro
  const res = await tryWithModel(primaryModelName);
  if (res !== null) return res;

  // 2. Fallback to Gemini 2.5 Pro if primary had an issue
  if (primaryModelName !== 'gemini-2.5-pro') {
    console.warn('[gemini] trying fallback model: gemini-2.5-pro');
    const fallbackRes = await tryWithModel('gemini-2.5-pro');
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
2. Expected Fee Amount:
   - Exactly 7,499 PKR or 7,500 PKR (Both 7,499 and 7,500 are standard fee amounts and completely valid).
3. Status:
   - Must be a completed / successful transaction with a visible reference/transaction ID (not pending, scheduled, or failed).

CRITICAL RULE FOR "isValid":
Set "isValid" to true ONLY IF all 3 conditions are met:
(1) It is an actual payment receipt,
(2) Beneficiary name matches "${bankTitle}" or "${walletTitle}", and
(3) Fee amount matches 7,499 or 7,500 PKR.
If the name or amount does NOT match, set "isValid" to false and state the exact mismatch in "reason" (e.g. "Amount is 1,000 instead of 7,500" or "Account title does not match Data Crumbs / Abis Hussain Syed").

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
  if (primaryModelName !== 'gemini-2.5-pro') {
    const fallbackRes = await tryWithModel('gemini-2.5-pro');
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

  if (primaryModelName !== 'gemini-2.5-pro') {
    const fallback = await tryWithModel('gemini-2.5-pro');
    if (fallback !== null) return fallback;
  }

  return `Thanks for sharing this image! If you have any questions about our bootcamp, curriculum, or enrollment, please let me know.`;
}
