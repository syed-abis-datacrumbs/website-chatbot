import { NextRequest, NextResponse } from 'next/server';
import {
  getInactiveUnpaidContacts,
  getActiveEnrollmentSession,
  saveContactProfile,
  saveMessage,
} from '@/lib/redis';
import { sendWhatsAppMessage } from '@/lib/whatsapp';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return handleFollowUps(req);
}

export async function POST(req: NextRequest) {
  return handleFollowUps(req);
}

async function handleFollowUps(req: NextRequest) {
  try {
    // Optional bearer/secret check
    const secret = req.nextUrl.searchParams.get('secret') || req.headers.get('authorization')?.replace('Bearer ', '');
    const expectedSecret = process.env.CRON_SECRET || 'datacrumbs_followup_secret';
    if (secret && secret !== expectedSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 12 hours minimum inactivity, max 23 hours (strictly inside Meta's 24-hr customer service window)
    const candidates = await getInactiveUnpaidContacts(
      12 * 60 * 60 * 1000,
      23 * 60 * 60 * 1000
    );

    const results = {
      totalFound: candidates.length,
      sent: 0,
      skippedPaid: 0,
      errors: 0,
      details: [] as { phone: string; name?: string; status: string }[],
    };

    for (const contact of candidates) {
      // 1. Check if student already submitted payment or was approved
      const session = await getActiveEnrollmentSession(contact.phone);
      if (session?.state === 'approved' || session?.state === 'screenshot_received') {
        results.skippedPaid++;
        results.details.push({ phone: contact.phone, name: contact.name, status: 'skipped_paid_or_pending' });
        continue;
      }

      // 2. Format student greeting
      const studentName = contact.name && contact.name.trim() !== 'Student' && contact.name.trim() !== 'there' ? contact.name.trim() : '';
      const greeting = studentName ? `Assalam-o-Alaikum ${studentName}! 👋` : `Assalam-o-Alaikum! 👋`;

      const followUpMsg = `${greeting}
Just following up regarding the 16-Week AI & Data Science Bootcamp... You're welcome to join our open WhatsApp Discussion Group:
🔗 https://chat.whatsapp.com/FVhBoXyalQm4ki5CWX1Xnl`;

      try {
        await sendWhatsAppMessage(contact.phone, followUpMsg);

        // Mark as sent so this contact never receives a duplicate follow-up
        await saveContactProfile({
          phone: contact.phone,
          followUpGroupSent: true,
          followUpGroupSentAt: Date.now(),
        });

        // Record in chat history
        await saveMessage({
          from: contact.phone,
          text: '',
          reply: followUpMsg,
          timestamp: Date.now(),
        });

        results.sent++;
        results.details.push({ phone: contact.phone, name: contact.name, status: 'sent_12hr_followup' });
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown send error';
        console.error(`[cron/follow-up] Failed to send follow-up to ${contact.phone}:`, errorMsg);
        results.errors++;
        results.details.push({ phone: contact.phone, name: contact.name, status: `error: ${errorMsg}` });
      }
    }

    return NextResponse.json(results);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown cron error';
    console.error('[cron/follow-up] Fatal error:', errorMsg);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}

