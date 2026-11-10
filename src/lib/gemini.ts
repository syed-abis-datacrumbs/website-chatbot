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

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction,
  });

  const safeHistory = [...history];
  while (safeHistory.length > 0 && safeHistory[0].role !== 'user') {
    safeHistory.shift();
  }

  const tryReply = async (hist: HistoryMessage[]): Promise<string | null> => {
    const chat   = model.startChat({ history: hist });
    const result = await chat.sendMessage(userMessage);
    try {
      return result.response.text();
    } catch {
      console.warn('[gemini] blocked:', result.response.candidates?.[0]?.finishReason);
      return null;
    }
  };

  // First attempt with full history
  const first = await tryReply(safeHistory);
  if (first !== null) return first;

  // RECITATION — retry with last 2 exchanges only (shorter context reduces exact-match risk)
  console.warn('[gemini] retrying with trimmed history after block');
  const trimmed = safeHistory.slice(-4); // last 2 user+model pairs
  while (trimmed.length > 0 && trimmed[0].role !== 'user') trimmed.shift();
  const second = await tryReply(trimmed);
  if (second !== null) return second;

  // Both attempts blocked — return a safe fallback
  console.error('[gemini] both attempts blocked, returning fallback');
  return `I'm sorry, I wasn't able to process that right now. Please rephrase your question, or reach our team directly at *+92 329 2020497*.`;
}

export interface PaymentVerificationResult {
  isValid: boolean;
  confidence: 'high' | 'medium' | 'low';
  amount: number | null;
  accountTitle: string | null;
  bankOrWallet: string | null;
  transactionId: string | null;
  reason: string;
}

/**
 * Uses Gemini 2.5 Flash Vision to inspect bank transfer receipts & payment screenshots.
 * Checks for expected beneficiary (Data Crumbs / Abis Hussain Syed), amount (~Rs 7,500),
 * and successful completion status.
 */
export async function verifyPaymentReceiptWithAI(
  imageBuffer: Buffer,
  mimeType: string = 'image/jpeg'
): Promise<PaymentVerificationResult> {
  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
    });

    const prompt = `You are a financial verification AI for DataCrumbs (an educational institute in Pakistan).
Analyze this uploaded bank transfer receipt / screenshot carefully.

Expected Payment Criteria:
1. Beneficiary / Receiver Account Title or Name: Must relate to "Data Crumbs", "DataCrumbs", or "Abis Hussain Syed" / "Syed Abis Hussain" / "Abis Hussain".
2. Expected Fee Amount: Exactly 7,499 PKR or 7,500 PKR (Both 7,499 and 7,500 are completely valid, standard fee amounts and must be accepted).
3. Status: Must be a completed / successful transaction, not scheduled, pending, or failed.
4. Recognizable Pakistani Bank or Wallet: Raast, Easypaisa, JazzCash, Nayapay, SadaPay, HabibMetro, Meezan, HBL, Bank Alfalah, MCB, UBL, etc.

Analyze the image and return ONLY a valid JSON object with the following fields (no markdown, no backticks, just raw JSON):
{
  "isValid": true,
  "confidence": "high",
  "amount": 7500,
  "accountTitle": "Data Crumbs",
  "bankOrWallet": "HabibMetro",
  "transactionId": "TRX123456",
  "reason": "Successfully verified payment of Rs 7,500 to Data Crumbs"
}`;

    const imagePart = {
      inlineData: {
        data: imageBuffer.toString('base64'),
        mimeType: mimeType || 'image/jpeg',
      },
    };

    const result = await model.generateContent([prompt, imagePart]);
    const responseText = result.response.text().trim();

    // Clean code fences if present
    const cleanJson = responseText.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(cleanJson);

    return {
      isValid: Boolean(parsed.isValid),
      confidence: parsed.confidence || 'medium',
      amount: typeof parsed.amount === 'number' ? parsed.amount : (parsed.amount ? parseFloat(parsed.amount) : null),
      accountTitle: parsed.accountTitle || null,
      bankOrWallet: parsed.bankOrWallet || null,
      transactionId: parsed.transactionId || null,
      reason: parsed.reason || '',
    };
  } catch (err) {
    console.error('[gemini-vision] Payment verification error:', err);
    return {
      isValid: false,
      confidence: 'low',
      amount: null,
      accountTitle: null,
      bankOrWallet: null,
      transactionId: null,
      reason: 'Could not automatically read payment details from image.',
    };
  }
}
