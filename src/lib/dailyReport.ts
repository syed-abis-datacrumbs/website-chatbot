import { MongoClient, Db } from 'mongodb';
import { google } from 'googleapis';
import { sendWhatsAppMessage } from '@/lib/whatsapp';

const uri = process.env.MONGODB_URI!;
const SHEET_ID = process.env.GOOGLE_SHEET_ID!;
const PRIMARY_TAB = process.env.PRIMARY_SHEET_NAME || 'Pretty';
const CALL_LOGS_TAB = 'call-logs';

function getPrivateKey(): string {
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

function getGoogleAuth() {
  return new google.auth.JWT({
    email: process.env.GOOGLE_CLIENT_EMAIL,
    key: getPrivateKey(),
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
}

function parsePakistanDate(dateStr: string, timeStr?: string): Date | null {
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

export interface DailyReportData {
  reportDateStr: string;
  windowStartStr: string;
  windowEndStr: string;
  campaignStartDateStr: string;
  chatbot: {
    campaignTotalLeads: number;
    newLeads: number;
    totalContacts: number;
    messagesProcessed: number;
    receiptsReceived: number;
    approvedPaid: number;
    pendingReview: number;
    interventions: number;
    demoInquiries: number;
    discountInquiries: number;
  };
  salesCrm: {
    totalLeads: number;
    newLeads: number;
    connected: number;
    noAnswer: number;
    demos: number;
    confirmations: number;
    followUps: number;
    paymentPending: number;
    enrolledToday: number;
    totalEnrolled: number;
    lostToday: number;
    totalLost: number;
  };
  consolidated: {
    totalEnrolled: number;
    estimatedRevenue: number;
  };
}

export async function generateDailyReportData(customWindowHours: number = 24): Promise<DailyReportData> {
  const now = Date.now();
  const windowEnd = now;
  const windowStart = now - customWindowHours * 60 * 60 * 1000;

  const nowPk = new Date(now).toLocaleString('en-PK', {
    timeZone: 'Asia/Karachi',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const startPk = new Date(windowStart).toLocaleString('en-PK', {
    timeZone: 'Asia/Karachi',
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  // ─────────────────────────────────────────────────────────────
  // 1. GOOGLE SHEETS SALES CRM METRICS & AUTO-DETECT CAMPAIGN START
  // ─────────────────────────────────────────────────────────────
  let salesStats = {
    totalLeads: 0,
    newLeads: 0,
    connected: 0,
    noAnswer: 0,
    demos: 0,
    confirmations: 0,
    followUps: 0,
    paymentPending: 0,
    enrolledToday: 0,
    totalEnrolled: 0,
    lostToday: 0,
    totalLost: 0,
  };

  let campaignStartTime = windowStart - 14 * 24 * 60 * 60 * 1000; // fallback: 14 days ago
  let campaignStartDateStr = '';

  try {
    const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });

    // Fetch Preety sheet leads (try PRIMARY_TAB e.g. 'Pretty', fallback to 'Preety')
    let leadRows: any[][] = [];
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `'${PRIMARY_TAB.replace(/'/g, "''")}'!A2:Q`,
      });
      leadRows = res.data.values || [];
    } catch (tabErr: any) {
      if (tabErr.message?.includes('Unable to parse range') || tabErr.message?.includes('not found')) {
        const altTab = PRIMARY_TAB.toLowerCase() === 'pretty' ? 'Preety' : 'Pretty';
        const resAlt = await sheets.spreadsheets.values.get({
          spreadsheetId: SHEET_ID,
          range: `'${altTab}'!A2:Q`,
        });
        leadRows = resAlt.data.values || [];
      } else {
        throw tabErr;
      }
    }

    // Filter valid lead rows
    const validLeads = leadRows.filter(r => (r[2] || r[4] || r[5] || '').toString().trim() !== '');
    salesStats.totalLeads = validLeads.length;

    // Auto-detect the earliest (oldest) lead date in the active sheet to identify Campaign Start
    let earliestLeadMs = Infinity;

    for (const row of validLeads) {
      const dateStr = (row[0] || '').toString().trim();
      const timeStr = (row[1] || '').toString().trim();
      const status = (row[5] || '').toString().trim().toLowerCase();
      const confirmationCol = (row[13] || '').toString().trim().toLowerCase();

      const leadDate = parsePakistanDate(dateStr, timeStr);
      if (leadDate) {
        const leadMs = leadDate.getTime();
        if (leadMs < earliestLeadMs && leadMs > 0) {
          earliestLeadMs = leadMs;
        }

        // Check if lead arrived in 24h window
        if (leadMs >= windowStart && leadMs <= windowEnd) {
          salesStats.newLeads++;
        }
      }

      // Check CRM statuses strictly from the sheet
      if (status.includes('enrolled') || status.includes('paid') || confirmationCol.includes('closed')) {
        salesStats.totalEnrolled++;
        const closedMatch = confirmationCol.match(/closed\s*\((.*?)\)/i);
        const actionDate = closedMatch ? parsePakistanDate(closedMatch[1]) : leadDate;
        if (actionDate && actionDate.getTime() >= windowStart && actionDate.getTime() <= windowEnd) {
          salesStats.enrolledToday++;
        }
      } else if (status.includes('lost')) {
        salesStats.totalLost++;
        if (leadDate && leadDate.getTime() >= windowStart && leadDate.getTime() <= windowEnd) {
          salesStats.lostToday++;
        }
      } else if (status.includes('demo')) {
        salesStats.demos++;
      } else if (status.includes('payment pending') || status.includes('confirmation')) {
        salesStats.paymentPending++;
        salesStats.confirmations++;
      } else if (status.includes('follow up') || status.includes('awaiting') || status.includes('call later')) {
        salesStats.followUps++;
      } else if (status.includes('connected') || status.includes('call received')) {
        salesStats.connected++;
      } else if (status.includes('no answer') || status.includes('not received') || status.includes('not reachable') || status.includes('unreachable')) {
        salesStats.noAnswer++;
      }
    }

    if (earliestLeadMs !== Infinity) {
      campaignStartTime = earliestLeadMs;
      campaignStartDateStr = new Date(campaignStartTime).toLocaleDateString('en-PK', {
        timeZone: 'Asia/Karachi',
        month: 'short',
        day: 'numeric',
      });
    }
  } catch (sheetErr) {
    console.error('[dailyReport] Error reading Google Sheets:', sheetErr);
  }

  // ─────────────────────────────────────────────────────────────
  // 2. MONGODB CHATBOT METRICS (Scoped to Active Campaign)
  // ─────────────────────────────────────────────────────────────
  const client = new MongoClient(uri);
  let chatbotStats = {
    campaignTotalLeads: 0,
    newLeads: 0,
    totalContacts: 0,
    messagesProcessed: 0,
    receiptsReceived: 0,
    approvedPaid: 0,
    pendingReview: 0,
    interventions: 0,
    demoInquiries: 0,
    discountInquiries: 0,
  };

  try {
    await client.connect();
    const db: Db = client.db('datacrumbs_chatbot');

    const colMessages = db.collection('wa_messages');
    const colEnrollments = db.collection('enrollment_sessions');
    const colInterventions = db.collection('human_interventions');
    const colDemos = db.collection('demo_requests');
    const colDiscounts = db.collection('discount_requests');

    // Aggregate queries
    const [
      messagesProcessed,
      allFrom,
      campaignLeadsAgg,
      newLeads24hAgg,
      receiptsReceived,
      approvedPaid,
      pendingReview,
      interventions,
      demoInquiries,
      discountInquiries,
    ] = await Promise.all([
      colMessages.countDocuments({ timestamp: { $gte: windowStart, $lte: windowEnd } }),
      colMessages.distinct('from'),
      // Total leads received since the active campaign started (earliest date in sheet)
      colMessages.aggregate([
        { $group: { _id: '$from', firstContact: { $min: '$timestamp' } } },
        { $match: { firstContact: { $gte: campaignStartTime } } },
        { $count: 'count' },
      ]).toArray(),
      // New leads in last 24h
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

    chatbotStats = {
      campaignTotalLeads: campaignLeadsAgg[0]?.count || 0,
      newLeads: newLeads24hAgg[0]?.count || 0,
      totalContacts: allFrom.length,
      messagesProcessed,
      receiptsReceived,
      approvedPaid,
      pendingReview,
      interventions,
      demoInquiries,
      discountInquiries,
    };
  } catch (mongoErr) {
    console.error('[dailyReport] Error reading MongoDB:', mongoErr);
  } finally {
    try {
      await client.close();
    } catch {}
  }

  // ─────────────────────────────────────────────────────────────
  // 3. CONSOLIDATED SUMMARY
  // ─────────────────────────────────────────────────────────────
  const totalEnrolled = chatbotStats.approvedPaid + salesStats.enrolledToday;
  const estimatedRevenue = totalEnrolled * 7500;

  return {
    reportDateStr: nowPk,
    windowStartStr: startPk,
    windowEndStr: nowPk,
    campaignStartDateStr: campaignStartDateStr || 'Current Cohort',
    chatbot: chatbotStats,
    salesCrm: salesStats,
    consolidated: {
      totalEnrolled,
      estimatedRevenue,
    },
  };
}

export function formatDailyReportMessage(data: DailyReportData): string {
  const { chatbot, salesCrm, reportDateStr, campaignStartDateStr } = data;
  const totalInquiries = chatbot.demoInquiries + chatbot.discountInquiries;

  return `📊 *DATACRUMBS DAILY UPDATE*
🗓️ *Date:* ${reportDateStr} *(Last 24h)*
🎯 *Campaign Active Since:* ${campaignStartDateStr}
━━━━━━━━━━━━━━━━━━━━

🤖 *Chatbot Inbound (Campaign Total: ${chatbot.campaignTotalLeads}):*
• New Leads (24h): *${chatbot.newLeads}*
• Receipts Received: *${chatbot.receiptsReceived}*
• Inquiries (Today): *${totalInquiries}* *(Demo: ${chatbot.demoInquiries}, Discount: ${chatbot.discountInquiries})*

📞 *Sales Team CRM (${PRIMARY_TAB} Total: ${salesCrm.totalLeads}):*
• New Form Leads (24h): *${salesCrm.newLeads}*
• Total Enrollment: *${salesCrm.totalEnrolled}*
• Total Confirmations: *${salesCrm.confirmations}*
• Total Demo: *${salesCrm.demos}*
• Total Not Reachable: *${salesCrm.noAnswer}*
• Active Follow-ups: *${salesCrm.followUps}*
• Total Lost: *${salesCrm.totalLost}*

━━━━━━━━━━━━━━━━━━━━
🚀 *Automated Report by DataCrumbs Ops Engine*`;
}

export async function sendDailyReport(
  recipientPhone: string = '923272128645',
  customWindowHours: number = 24
): Promise<{ success: boolean; data: DailyReportData; message: string; wamId?: string; error?: string }> {
  try {
    const data = await generateDailyReportData(customWindowHours);
    const message = formatDailyReportMessage(data);

    // Clean phone number: remove '+', spaces, dashes
    const cleanPhone = recipientPhone.replace(/\D/g, '');

    const templateName = process.env.DAILY_REPORT_TEMPLATE || 'daily_sales_update';
    const totalInquiries = data.chatbot.demoInquiries + data.chatbot.discountInquiries;

    const templateParameters = [
      data.reportDateStr,                          // {{1}}
      data.campaignStartDateStr,                   // {{2}}
      String(data.chatbot.campaignTotalLeads),     // {{3}}
      String(data.chatbot.newLeads),               // {{4}}
      String(data.chatbot.receiptsReceived),       // {{5}}
      String(totalInquiries),                      // {{6}}
      String(data.salesCrm.totalLeads),            // {{7}}
      String(data.salesCrm.newLeads),              // {{8}}
      String(data.salesCrm.totalEnrolled),         // {{9}}
      String(data.salesCrm.confirmations),         // {{10}}
      String(data.salesCrm.demos),                 // {{11}}
      String(data.salesCrm.noAnswer),              // {{12}}
      String(data.salesCrm.followUps),             // {{13}}
      String(data.salesCrm.totalLost),             // {{14}}
    ];

    let wamId: string | undefined;

    // 1. Try sending via approved Meta Template (guaranteed delivery outside 24h window)
    try {
      console.log(`[dailyReport] Attempting to send template '${templateName}' to ${cleanPhone}...`);
      const { sendWhatsAppTemplate } = await import('@/lib/whatsapp');
      try {
        const tmplRes = await sendWhatsAppTemplate(cleanPhone, templateName, templateParameters, 'en');
        wamId = tmplRes.wamId;
      } catch (errLang: any) {
        if (errLang?.response?.data?.error?.code === 132001 || errLang?.response?.data?.error?.error_subcode === 2388043) {
          console.warn(`[dailyReport] Template not found with code 'en', trying 'en_US'...`);
          const tmplRes = await sendWhatsAppTemplate(cleanPhone, templateName, templateParameters, 'en_US');
          wamId = tmplRes.wamId;
        } else {
          throw errLang;
        }
      }
      console.log(`[dailyReport] Template '${templateName}' sent successfully! wamId: ${wamId}`);
    } catch (templateErr: any) {
      console.warn(`[dailyReport] Template dispatch failed (${templateErr.response?.data?.error?.message || templateErr.message}), falling back to direct text message...`);
      // 2. Fallback to direct freeform text
      const res = await sendWhatsAppMessage(cleanPhone, message);
      wamId = res.wamId;
    }

    return {
      success: true,
      data,
      message,
      wamId,
    };
  } catch (err: any) {
    console.error('[dailyReport] Failed to send report:', err.response?.data || err);
    return {
      success: false,
      data: {} as DailyReportData,
      message: '',
      error: err.response?.data?.error?.message || err.message || 'Unknown error sending report',
    };
  }
}
