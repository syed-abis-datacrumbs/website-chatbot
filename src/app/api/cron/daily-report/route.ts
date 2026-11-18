import { NextRequest, NextResponse } from 'next/server';
import { generateDailyReportData, formatDailyReportMessage, sendDailyReport } from '@/lib/dailyReport';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret') || req.headers.get('authorization')?.replace('Bearer ', '');
  const isPreview = req.nextUrl.searchParams.get('preview') === 'true';
  const shouldSend = req.nextUrl.searchParams.get('send') === 'true';
  const customPhone = req.nextUrl.searchParams.get('to');
  const hours = parseInt(req.nextUrl.searchParams.get('hours') || '24', 10);

  // If preview is requested, generate data and return formatted message without sending
  if (isPreview) {
    try {
      const data = await generateDailyReportData(hours);
      const message = formatDailyReportMessage(data);
      return NextResponse.json({
        preview: true,
        data,
        formattedMessage: message,
      });
    } catch (err: any) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
  }

  // If send=true, verify secret and send
  if (shouldSend) {
    return handleSend(req, secret, customPhone, hours);
  }

  return NextResponse.json({
    status: 'active',
    description: 'Daily 5:00 PM PKT report endpoint. Use ?preview=true to preview, or POST / GET with ?send=true&secret=... to dispatch.',
    defaultRecipient: process.env.DAILY_REPORT_RECIPIENT || '923272128645',
  });
}

export async function POST(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret') || req.headers.get('authorization')?.replace('Bearer ', '');
  const customPhone = req.nextUrl.searchParams.get('to');
  const hours = parseInt(req.nextUrl.searchParams.get('hours') || '24', 10);

  return handleSend(req, secret, customPhone, hours);
}

async function handleSend(req: NextRequest, secret: string | null | undefined, customPhone: string | null, hours: number) {
  const expectedSecret = process.env.CRON_SECRET || 'datacrumbs_daily_secret';
  if (!secret || (secret !== expectedSecret && secret !== 'datacrumbs_followup_secret')) {
    return NextResponse.json({ error: 'Unauthorized: Valid secret required' }, { status: 401 });
  }

  const recipient = customPhone || process.env.DAILY_REPORT_RECIPIENT || '923272128645';
  const result = await sendDailyReport(recipient, hours);

  if (!result.success) {
    return NextResponse.json({ error: result.error, success: false }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    sentTo: recipient,
    wamId: result.wamId,
    message: result.message,
    data: result.data,
  });
}
