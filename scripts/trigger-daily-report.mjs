import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';
import { google } from 'googleapis';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Load .env
function loadEnv() {
  const envPath = path.resolve(__dirname, '../.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnv();

const uri = process.env.MONGODB_URI;
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const PRIMARY_TAB = process.env.PRIMARY_SHEET_NAME || 'Pretty';
const CALL_LOGS_TAB = 'call-logs';
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const TARGET_PHONE = process.argv[2] || process.env.DAILY_REPORT_RECIPIENT || '923272128645';

function getPrivateKey() {
  let key = process.env.GOOGLE_PRIVATE_KEY ?? '';
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1);
  }
  key = key.replace(/\\n/g, '\n').replace(/\\r/g, '');
  return key
    .split('\n')
    .map(line => line.replace(/\\/g, '').trim())
    .filter(Boolean)
    .join('\n');
}

function parsePakistanDate(dateStr, timeStr) {
  if (!dateStr || !dateStr.trim()) return null;
  const cleanDate = dateStr.trim();
  const cleanTime = (timeStr || '').trim();

  let day = 1, month = 0, year = 2026;
  const dateParts = cleanDate.split(/[\/\-\.]/);
  if (dateParts.length === 3) {
    const p0 = parseInt(dateParts[0], 10);
    const p1 = parseInt(dateParts[1], 10);
    const p2 = parseInt(dateParts[2], 10);
    if (p2 > 1000) {
      // In Pakistan locale en-PK, date is DD/MM/YYYY
      day = p0;
      month = p1 - 1;
      year = p2;
    } else if (p0 > 1000) {
      // YYYY/MM/DD
      year = p0;
      month = p1 - 1;
      day = p2;
    }
  }

  let hours = 12, minutes = 0, seconds = 0;
  if (cleanTime) {
    const timeMatch = cleanTime.match(/(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?\s*(AM|PM)?/i);
    if (timeMatch) {
      hours = parseInt(timeMatch[1], 10);
      minutes = parseInt(timeMatch[2], 10);
      seconds = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
      const meridiem = (timeMatch[4] || '').toUpperCase();
      if (meridiem === 'PM' && hours < 12) hours += 12;
      if (meridiem === 'AM' && hours === 12) hours = 0;
    }
  }

  // Construct in Asia/Karachi (PKT = UTC+5)
  const utcMs = Date.UTC(year, month, day, hours, minutes, seconds) - (5 * 60 * 60 * 1000);
  const d = new Date(utcMs);
  return isNaN(d.getTime()) ? null : d;
}

async function main() {
  console.log(`\n========================================`);
  console.log(`🚀 Starting Daily 5 PM PKT Report Generator`);
  console.log(`📱 Recipient Phone: ${TARGET_PHONE}`);
  console.log(`========================================\n`);

  const now = Date.now();
  const windowEnd = now;
  const windowStart = now - 24 * 60 * 60 * 1000;

  const nowPk = new Date(now).toLocaleString('en-PK', {
    timeZone: 'Asia/Karachi',
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  // 1. Query Google Sheets (100% Read-Only) & Auto-Detect Campaign Start
  console.log(`📑 Connecting to Google Sheets (${SHEET_ID})...`);
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_CLIENT_EMAIL,
    key: getPrivateKey(),
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  let sheetRes;
  try {
    sheetRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `'${PRIMARY_TAB}'!A2:Q`,
    });
  } catch (err) {
    sheetRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `'Preety'!A2:Q`,
    });
  }

  const rows = (sheetRes.data.values || []).filter(r => (r[2] || r[4] || r[5] || '').toString().trim() !== '');
  let sheetNewLeads = 0;
  let connected = 0;
  let noAnswer = 0;
  let demos = 0;
  let confirmations = 0;
  let followUps = 0;
  let paymentPending = 0;
  let enrolledToday = 0;
  let totalEnrolled = 0;
  let lostToday = 0;
  let totalLost = 0;

  let earliestLeadMs = Infinity;

  for (const r of rows) {
    const leadDate = parsePakistanDate(r[0], r[1]);
    const status = (r[5] || '').toString().trim().toLowerCase();
    const confCol = (r[13] || '').toString().trim().toLowerCase();

    if (leadDate) {
      const leadMs = leadDate.getTime();
      if (leadMs < earliestLeadMs && leadMs > 0) {
        earliestLeadMs = leadMs;
      }
      if (leadMs >= windowStart && leadMs <= windowEnd) {
        sheetNewLeads++;
      }
    }

    if (status.includes('enrolled') || status.includes('paid') || confCol.includes('closed')) {
      totalEnrolled++;
      const closedMatch = confCol.match(/closed\s*\((.*?)\)/i);
      const actionDate = closedMatch ? parsePakistanDate(closedMatch[1]) : leadDate;
      if (actionDate && actionDate.getTime() >= windowStart && actionDate.getTime() <= windowEnd) {
        enrolledToday++;
      }
    } else if (status.includes('lost')) {
      totalLost++;
      if (leadDate && leadDate.getTime() >= windowStart && leadDate.getTime() <= windowEnd) {
        lostToday++;
      }
    } else if (status.includes('demo')) {
      demos++;
    } else if (status.includes('payment pending') || status.includes('confirmation')) {
      paymentPending++;
      confirmations++;
    } else if (status.includes('follow up') || status.includes('awaiting') || status.includes('call later')) {
      followUps++;
    } else if (status.includes('connected') || status.includes('call received')) {
      connected++;
    } else if (status.includes('no answer') || status.includes('not received') || status.includes('not reachable') || status.includes('unreachable')) {
      noAnswer++;
    }
  }

  const campaignStartTime = earliestLeadMs !== Infinity ? earliestLeadMs : windowStart - 14 * 24 * 60 * 60 * 1000;
  const campaignStartDateStr = earliestLeadMs !== Infinity
    ? new Date(campaignStartTime).toLocaleDateString('en-PK', { timeZone: 'Asia/Karachi', month: 'short', day: 'numeric' })
    : 'Current Cohort';

  console.log(`✅ Google Sheet Data Retrieved: ${rows.length} total leads in ${PRIMARY_TAB}. Campaign active since: ${campaignStartDateStr}`);

  // 2. Query MongoDB (100% Read-Only, Scoped to Active Campaign)
  console.log(`📡 Connecting to MongoDB Atlas (datacrumbs_chatbot)...`);
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('datacrumbs_chatbot');

  const colMessages = db.collection('wa_messages');
  const colEnrollments = db.collection('enrollment_sessions');
  const colInterventions = db.collection('human_interventions');
  const colDemos = db.collection('demo_requests');
  const colDiscounts = db.collection('discount_requests');

  const [
    messagesProcessed,
    allContacts,
    campaignLeadsAgg,
    newLeadsAgg,
    receiptsReceived,
    approvedPaid,
    pendingReview,
    interventions,
    demoInquiries,
    discountInquiries,
  ] = await Promise.all([
    colMessages.countDocuments({ timestamp: { $gte: windowStart, $lte: windowEnd } }),
    colMessages.distinct('from'),
    colMessages.aggregate([
      { $group: { _id: '$from', firstContact: { $min: '$timestamp' } } },
      { $match: { firstContact: { $gte: campaignStartTime } } },
      { $count: 'count' },
    ]).toArray(),
    colMessages.aggregate([
      { $group: { _id: '$from', firstContact: { $min: '$timestamp' } } },
      { $match: { firstContact: { $gte: windowStart, $lte: windowEnd } } },
      { $count: 'count' },
    ]).toArray(),
    colEnrollments.countDocuments({
      $or: [
        { updatedAt: { $gte: windowStart, $lte: windowEnd } },
        { createdAt: { $gte: windowStart, $lte: windowEnd } },
      ],
      state: { $in: ['screenshot_received', 'approved', 'rejected'] },
    }),
    colEnrollments.countDocuments({
      state: 'approved',
      updatedAt: { $gte: windowStart, $lte: windowEnd },
    }),
    colEnrollments.countDocuments({ state: 'screenshot_received' }),
    colInterventions.countDocuments({
      flaggedAt: { $gte: windowStart, $lte: windowEnd },
    }),
    colDemos.countDocuments({
      $or: [
        { createdAt: { $gte: windowStart, $lte: windowEnd } },
        { timestamp: { $gte: windowStart, $lte: windowEnd } },
      ],
    }),
    colDiscounts.countDocuments({
      $or: [
        { createdAt: { $gte: windowStart, $lte: windowEnd } },
        { timestamp: { $gte: windowStart, $lte: windowEnd } },
      ],
    }),
  ]);

  await client.close();
  const campaignTotalChatbotLeads = campaignLeadsAgg[0]?.count || 0;
  console.log(`✅ MongoDB Data Retrieved: ${campaignTotalChatbotLeads} campaign leads (all-time: ${allContacts.length}), ${messagesProcessed} messages in 24h.`);

  const consolidatedEnrolled = approvedPaid + enrolledToday;
  const totalRevenue = consolidatedEnrolled * 7500;

  console.log(`✅ Google Sheet Data Retrieved: ${rows.length} total leads in ${PRIMARY_TAB}.`);

  // 3. Format message (Option 2: Clean 2-Card Summary with Auto-Detected Campaign)
  const newChatbotLeads = newLeadsAgg[0]?.count || 0;
  const totalInquiries = demoInquiries + discountInquiries;

  const message = `📊 *DATACRUMBS DAILY UPDATE*
🗓️ *Date:* ${nowPk} *(Last 24h)*
🎯 *Campaign Active Since:* ${campaignStartDateStr}
━━━━━━━━━━━━━━━━━━━━

🤖 *Chatbot Inbound (Campaign Total: ${campaignTotalChatbotLeads}):*
• New Leads (24h): *${newChatbotLeads}*
• Receipts Received: *${receiptsReceived}*
• Inquiries (Today): *${totalInquiries}* *(Demo: ${demoInquiries}, Discount: ${discountInquiries})*

📞 *Sales Team CRM (${PRIMARY_TAB} Total: ${rows.length}):*
• New Form Leads (24h): *${sheetNewLeads}*
• Total Enrollment: *${totalEnrolled}*
• Total Confirmations: *${confirmations}*
• Total Demo: *${demos}*
• Total Not Reachable: *${noAnswer}*
• Active Follow-ups: *${followUps}*
• Total Lost: *${totalLost}*

━━━━━━━━━━━━━━━━━━━━
🚀 *Automated Report by DataCrumbs Ops Engine*`;

  console.log(`\n--- FORMATTED WHATSAPP MESSAGE ---`);
  console.log(message);
  console.log(`---------------------------------\n`);

  // 4. Send via WhatsApp Meta Cloud API (Template with fallback)
  const cleanPhone = TARGET_PHONE.replace(/\D/g, '');
  console.log(`📲 Sending WhatsApp message to ${cleanPhone}...`);

  const templateName = process.env.DAILY_REPORT_TEMPLATE || 'daily_sales_update';
  const templateParameters = [
    nowPk,
    campaignStartDateStr,
    String(campaignTotalChatbotLeads),
    String(newChatbotLeads),
    String(receiptsReceived),
    String(totalInquiries),
    String(rows.length),
    String(sheetNewLeads),
    String(totalEnrolled),
    String(confirmations),
    String(demos),
    String(noAnswer),
    String(followUps),
    String(totalLost),
  ];

  let wamId;

  try {
    console.log(`[trigger] Attempting template '${templateName}' dispatch...`);
    const tmplRes = await axios.post(
      `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to: cleanPhone,
        type: 'template',
        template: {
          name: templateName,
          language: { code: 'en' },
          components: [
            {
              type: 'body',
              parameters: templateParameters.map(text => ({ type: 'text', text })),
            },
          ],
        },
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
    wamId = tmplRes.data?.messages?.[0]?.id;
    console.log(`🎉 SUCCESS! Sent via template '${templateName}' (wamId: ${wamId})`);
  } catch (tmplErr) {
    console.warn(`Template dispatch failed, trying direct text message fallback:`, tmplErr.response?.data?.error?.message || tmplErr.message);
    const response = await axios.post(
      `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to: cleanPhone,
        type: 'text',
        text: { body: message },
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
    wamId = response.data?.messages?.[0]?.id;
    console.log(`🎉 SUCCESS! Sent via direct text message (wamId: ${wamId})`);
  }
}

main().catch(err => {
  console.error(`❌ Error in daily report runner:`, err.response?.data || err.message);
  process.exit(1);
});
