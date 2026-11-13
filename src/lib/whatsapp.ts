import axios from 'axios';

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

export async function sendWhatsAppDocument(to: string) {
  // agent.datacrumbs.org/brochure.pdf is confirmed publicly accessible (200 OK, application/pdf, 5.7 MB).
  // Meta's servers can reach this domain — they already hit our webhook here.
  const brochureLink = 'https://agent.datacrumbs.org/brochure.pdf';
  console.log('[brochure] sending link:', brochureLink);
  try {
    await axios.post(
      apiUrl('/messages'),
      {
        messaging_product: 'whatsapp',
        to,
        type: 'document',
        document: { link: brochureLink, filename: BROCHURE_FILENAME },
      },
      { headers: headers() }
    );
    console.log('[brochure] document message accepted by WhatsApp API');
  } catch (err: unknown) {
    const axErr = err as { response?: { status?: number; data?: unknown }; message?: string };
    console.error('[brochure] WhatsApp API rejected:', JSON.stringify(axErr?.response?.data ?? axErr?.message ?? err));
    throw err;
  }
}
