import { NextRequest, NextResponse } from 'next/server';
import { sendWhatsAppMessage, sendWhatsAppDocument, sendWhatsAppTemplate } from '@/lib/whatsapp';
import { saveMessage, saveContactProfile } from '@/lib/redis';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { to, message, sendBrochure, isBootcampLead, name, email, goal } = body;

  if (!to) {
    return NextResponse.json({ error: 'Missing recipient phone number (to)' }, { status: 400 });
  }

  // ── Automated AI Bootcamp Funnel: Message 1 ─────────────────────────────────
  if (isBootcampLead) {
    const studentName = (name || '').trim() || 'there';
    const studentEmail = (email || '').trim() || undefined;
    const studentGoal = (goal || '').trim() || 'Freelancing & Career Switch';

    const msg1 = `Assalam-o-Alaikum ${studentName}! 👋 This is Zoya from DataCrumbs.

We have received your application for the upcoming 16-Week AI & Data Science Bootcamp! 🚀

I saw on your form that your primary goal is ${studentGoal}.

Quick question to ensure this batch is the right fit: What is your educational background or current job role?`;

    console.log(`[whatsapp/send] Received bootcamp lead: ${studentName} (${to}) - Email: ${studentEmail || 'none'} - Goal: ${studentGoal}`);

    const templateName = process.env.WHATSAPP_BOOTCAMP_TEMPLATE || 'bootcamp_lead_welcome';
    try {
      // First try approved WhatsApp Template (required by Meta for cold/new form leads outside 24h window)
      try {
        await sendWhatsAppTemplate(to, templateName, [studentName], 'en');
        console.log(`[whatsapp/send] Template '${templateName}' (en) dispatched successfully to ${to}`);
      } catch (tmplErr: unknown) {
        const axErr = tmplErr as { response?: { data?: { error?: { code?: number; error_subcode?: number } } } };
        // If 'en' fails due to language mismatch, try 'en_US'
        if (axErr?.response?.data?.error?.code === 132001 || axErr?.response?.data?.error?.error_subcode === 2388043) {
          console.warn(`[whatsapp/send] Template not found with code 'en', trying 'en_US'...`);
          await sendWhatsAppTemplate(to, templateName, [studentName], 'en_US');
          console.log(`[whatsapp/send] Template '${templateName}' (en_US) dispatched successfully to ${to}`);
        } else {
          throw tmplErr;
        }
      }
    } catch (err: unknown) {
      console.warn('[whatsapp/send] Template dispatch failed, falling back to direct text message:', (err as { response?: { data?: unknown } })?.response?.data ?? (err as Error)?.message);
      try {
        await sendWhatsAppMessage(to, msg1);
        console.log(`[whatsapp/send] Fallback text message dispatched successfully to ${to}`);
      } catch (fallbackErr: unknown) {
        const axErr = fallbackErr as { response?: { status?: number; data?: unknown }; message?: string };
        console.error('[whatsapp/send] Meta API error sending Message 1:', JSON.stringify(axErr?.response?.data ?? axErr?.message ?? fallbackErr, null, 2));
        return NextResponse.json({
          error: 'Failed to send WhatsApp message via Meta API',
          details: axErr?.response?.data ?? axErr?.message,
        }, { status: 500 });
      }
    }

    // Save message history in MongoDB (visible in agent.datacrumbs.org/chats)
    await saveMessage({
      from: to,
      text: '',
      reply: msg1,
      timestamp: Date.now(),
    });

    // Save contact state in MongoDB
    await saveContactProfile({
      phone: to,
      name: studentName,
      email: studentEmail,
      bootcampLead: true,
      bootcampGoal: studentGoal,
      bootcampLeadPending: true,
    });

    return NextResponse.json({ ok: true, step: 'message_1_sent' });
  }

  if (!message && !sendBrochure) {
    return NextResponse.json({ error: 'Missing to or message' }, { status: 400 });
  }

  let sentDoc = false;
  if (sendBrochure) {
    try {
      await sendWhatsAppDocument(to);
      sentDoc = true;
    } catch (err) {
      console.error('Admin brochure send failed:', err instanceof Error ? err.message : err);
    }
  }
  if (message) {
    await sendWhatsAppMessage(to, message);
  }
  // Save with empty text to indicate admin-initiated (no customer message)
  await saveMessage({
    from: to, text: '', reply: message || '', timestamp: Date.now(),
    ...(sentDoc ? { mediaType: 'document' as const } : {}),
  });

  return NextResponse.json({ ok: true });
}
