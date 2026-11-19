import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { getBrochure, updateBrochureMediaId } from '@/lib/redis';
import { getDriveFileBuffer } from '@/lib/google';

const BROCHURE_FILENAME = 'DataCrumbs-Bootcamp-Brochure.pdf';

const BROCHURE_KEYWORDS = [
  'brochure', 'broucher', 'brocher', 'brochur', 'broshure', 'broshur',
  'pdf', 'pamphlet', 'flyer', 'prospectus',
  'send me details', 'share details', 'more details', 'more info',
  'course details', 'programme details', 'program details',
  'course outline', 'syllabus', 'course content', 'curriculum',
  'send me info', 'share info', 'detailed info',
  'what is included', "what's included",
  'brochar', 'brouchar', 'brochar bhejo', 'broucher bhejo',
  'details bhejo', 'details send karo',
  'details chahiye', 'info chahiye', 'send karo',
  'course ka detail', 'programme ka detail', 'program ka detail',
  'zyada details', 'poori details', 'puri details',
  'kuch aur batao', 'aur info do', 'overview bhejo',
  'detail do', 'detail chahiye', 'full detail',
];

export function wantsBrochure(text: string): boolean {
  const lower = text.toLowerCase();
  if (BROCHURE_KEYWORDS.some(kw => lower.includes(kw))) return true;
  if (/bro[uo]?ch/.test(lower)) return true;
  return false;
}

const ENROLLMENT_KEYWORDS = [
  'enroll', 'register', 'admission', 'join now', 'want to join',
  'i want to buy', 'wanna buy', 'want to purchase',
  'i want to pay', 'ready to pay', 'i wanna enroll',
  'enroll karna', 'join karna', 'register karna',
  'dakhila', 'sign up', 'signup',
  'how to enroll', 'how do i enroll', 'how can i join',
];

export function wantsEnrollment(text: string): boolean {
  const lower = text.toLowerCase();
  return ENROLLMENT_KEYWORDS.some(kw => lower.includes(kw));
}

const DEMO_KEYWORDS = [
  'demo class', 'demo session', 'demo lecture', 'demo lesson', 'trial class',
  'trial session', 'trial lecture', 'free class', 'free session', 'free demo',
  'sample class', 'sample session', 'sample lecture', 'any demo', 'demo dete',
  'demo dena', 'demo milta', 'trial dete', 'demo lena', 'demo class hai',
  'demo class offer', 'do you offer demo', 'offer demo', 'demo lu', 'demo lo',
];

export function wantsDemo(text: string): boolean {
  const lower = text.toLowerCase();
  if (DEMO_KEYWORDS.some(kw => lower.includes(kw))) return true;
  // "demo" alone paired with a class/lecture/session word nearby
  return /\bdemo\b/i.test(lower) && /\b(class|session|lecture|lesson)\b/i.test(lower);
}

function apiUrl(path: string) {
  return `https://graph.facebook.com/v25.0/${process.env.PHONE_NUMBER_ID}${path}`;
}

function headers() {
  return {
    Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

export async function sendWhatsAppMessage(to: string, text: string): Promise<{ wamId?: string }> {
  const res = await axios.post(
    apiUrl('/messages'),
    { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } },
    { headers: headers() }
  );
  return { wamId: (res.data as { messages?: Array<{ id: string }> })?.messages?.[0]?.id };
}

export async function sendWhatsAppTemplate(
  to: string,
  templateName: string,
  parameters: string[] = [],
  languageCode: string = 'en'
): Promise<{ wamId?: string }> {
  const payload: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
    },
  };

  if (parameters.length > 0) {
    (payload.template as Record<string, unknown>).components = [
      {
        type: 'body',
        parameters: parameters.map(text => ({ type: 'text', text })),
      },
    ];
  }

  const res = await axios.post(apiUrl('/messages'), payload, { headers: headers() });
  return { wamId: (res.data as { messages?: Array<{ id: string }> })?.messages?.[0]?.id };
}

export async function downloadWhatsAppMedia(
  mediaId: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  // Step 1: get the temporary download URL
  const meta = await axios.get(
    `https://graph.facebook.com/v25.0/${mediaId}`,
    { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` } },
  );
  const { url, mime_type } = meta.data as { url: string; mime_type: string };

  // Step 2: download the raw bytes
  const res = await axios.get<ArrayBuffer>(url, {
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` },
    responseType: 'arraybuffer',
  });

  return { buffer: Buffer.from(res.data), mimeType: mime_type };
}

export async function uploadMediaToWhatsApp(
  buffer: Buffer,
  filename: string,
  mimeType: string = 'application/pdf'
): Promise<string> {
  const formData = new FormData();
  formData.append('messaging_product', 'whatsapp');
  formData.append('file', new Blob([new Uint8Array(buffer)], { type: mimeType }), filename);
  formData.append('type', mimeType);

  const url = apiUrl('/media');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
    },
    body: formData,
  });

  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.id) {
    throw new Error(`WhatsApp media upload failed (HTTP ${res.status}): ${JSON.stringify(data)}`);
  }
  return data.id as string;
}

export async function uploadActiveBrochureToWhatsApp(): Promise<{ mediaId: string; filename: string }> {
  const doc = await getBrochure();
  let buffer: Buffer | null = null;
  let filename = doc?.filename || BROCHURE_FILENAME;

  // 1. If stored in MongoDB
  if (doc?.data && doc.data.length > 0) {
    buffer = doc.data;
  }
  // 2. If stored in Google Drive
  else if (doc?.driveFileId) {
    try {
      const driveFile = await getDriveFileBuffer(doc.driveFileId);
      buffer = driveFile.buffer;
    } catch (e) {
      console.warn('[brochure] Failed to get brochure buffer from Google Drive:', e);
    }
  }

  // 3. Fallback: local static brochure in public/brochure.pdf
  if (!buffer) {
    const localPath = path.join(process.cwd(), 'public', 'brochure.pdf');
    if (fs.existsSync(localPath)) {
      buffer = fs.readFileSync(localPath);
      filename = 'DataCrumbs-Bootcamp-Brochure.pdf';
    }
  }

  if (!buffer) {
    throw new Error('No brochure file found to upload to WhatsApp');
  }

  console.log(`[brochure] Uploading active brochure (${buffer.length} bytes, filename: ${filename}) to WhatsApp Media API...`);
  const mediaId = await uploadMediaToWhatsApp(buffer, filename, 'application/pdf');
  console.log(`[brochure] Uploaded to WhatsApp Media API successfully. mediaId: ${mediaId}`);
  await updateBrochureMediaId(mediaId);

  return { mediaId, filename };
}

export async function getOrUploadBrochureMedia(): Promise<{ mediaId: string; filename: string }> {
  const doc = await getBrochure();
  const TWENTY_FIVE_DAYS_MS = 25 * 24 * 60 * 60 * 1000;

  if (doc?.whatsappMediaId && doc.whatsappMediaUploadedAt && (Date.now() - doc.whatsappMediaUploadedAt < TWENTY_FIVE_DAYS_MS)) {
    return { mediaId: doc.whatsappMediaId, filename: doc.filename };
  }

  return uploadActiveBrochureToWhatsApp();
}

export async function sendWhatsAppDocument(to: string) {
  const brochure = await getOrUploadBrochureMedia();
  const filename = brochure.filename || BROCHURE_FILENAME;

  const makePayload = (mediaId: string) => ({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'document',
    document: {
      id: mediaId,
      filename,
    },
  });

  try {
    const res = await axios.post(apiUrl('/messages'), makePayload(brochure.mediaId), { headers: headers() });
    console.log(`[brochure] WhatsApp document delivered to ${to} using mediaId ${brochure.mediaId} (wamId: ${res.data?.messages?.[0]?.id})`);
    return res.data;
  } catch (err: unknown) {
    const axErr = err as { response?: { status?: number; data?: unknown }; message?: string };
    console.warn('[brochure] WhatsApp document send with cached mediaId failed, refreshing media upload:', JSON.stringify(axErr?.response?.data ?? axErr?.message));

    // Force re-upload active brochure and retry once
    const refreshed = await uploadActiveBrochureToWhatsApp();
    const retryRes = await axios.post(apiUrl('/messages'), makePayload(refreshed.mediaId), { headers: headers() });
    console.log(`[brochure] Retry document delivered to ${to} using refreshed mediaId ${refreshed.mediaId}`);
    return retryRes.data;
  }
}
