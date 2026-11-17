import { NextRequest, NextResponse } from 'next/server';
import { sendWhatsAppMessage, sendWhatsAppDocument, sendWhatsAppTemplate } from '@/lib/whatsapp';
import { saveMessage, saveContactProfile } from '@/lib/redis';

function normalizePhoneNumber(raw: string): string {
  let cleaned = (raw || '').replace(/\D/g, '');
  if (cleaned.startsWith('03') && cleaned.length === 11) {
    cleaned = '92' + cleaned.slice(1);
  } else if (cleaned.startsWith('3') && cleaned.length === 10) {
    cleaned = '92' + cleaned;
  } else if (cleaned.startsWith('0092')) {
    cleaned = cleaned.slice(2);
  } else if (cleaned.startsWith('092') && cleaned.length === 13) {
    cleaned = cleaned.slice(1);
  }
  return cleaned;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { to, message, sendBrochure, isBootcampLead, name, email, goal } = body;

  if (!to) {
    return NextResponse.json({ error: 'Missing recipient phone number (to)' }, { status: 400 });
  }

  const recipientPhone = normalizePhoneNumber(to);

  // ── Automated AI Bootcamp Funnel: Message 1 ─────────────────────────────────
  if (isBootcampLead) {
    const studentName = (name || '').trim() || 'there';
    const studentEmail = (email || '').trim() || undefined;
    const studentGoal = (goal || '').trim() || 'Freelancing & Career Switch';

    const msg1 = `Assalam-o-Alaikum ${studentName}! 👋 This is Zoya from DataCrumbs.

We have received your application for the upcoming 16-Week AI & Data Science Bootcamp! 🚀

I saw on your form that your primary goal is ${studentGoal}.

Quick question to ensure this batch is the right fit: What is your educational background or current job role?`;

    console.log(`[whatsapp/send] Received bootcamp lead: ${studentName} (${recipientPhone}) - Email: ${studentEmail || 'none'} - Goal: ${studentGoal}`);

    const templateName = process.env.WHATSAPP_BOOTCAMP_TEMPLATE || 'bootcamp_lead_welcome';
    let dispatchedWamId: string | undefined;
    let dispatchError: string | undefined;
    let initialDeliveryStatus: 'sent' | 'failed' = 'sent';

    try {
      // First try approved WhatsApp Template (required by Meta for cold/new form leads outside 24h window)
      try {
        const res = await sendWhatsAppTemplate(recipientPhone, templateName, [studentName], 'en');
        dispatchedWamId = res.wamId;
        console.log(`[whatsapp/send] Template '${templateName}' (en) dispatched successfully to ${recipientPhone} (wamId: ${dispatchedWamId})`);
      } catch (tmplErr: unknown) {
        const axErr = tmplErr as { response?: { data?: { error?: { code?: number; error_subcode?: number; message?: string } } } };
        // If 'en' fails due to language mismatch, try 'en_US'
        if (axErr?.response?.data?.error?.code === 132001 || axErr?.response?.data?.error?.error_subcode === 2388043) {
          console.warn(`[whatsapp/send] Template not found with code 'en', trying 'en_US'...`);
          const res = await sendWhatsAppTemplate(recipientPhone, templateName, [studentName], 'en_US');
          dispatchedWamId = res.wamId;
          console.log(`[whatsapp/send] Template '${templateName}' (en_US) dispatched successfully to ${recipientPhone} (wamId: ${dispatchedWamId})`);
        } else {
          throw tmplErr;
        }
      }
    } catch (err: unknown) {
      console.warn('[whatsapp/send] Template dispatch failed, falling back to direct text message:', (err as { response?: { data?: unknown } })?.response?.data ?? (err as Error)?.message);
      try {
        const res = await sendWhatsAppMessage(recipientPhone, msg1);
        dispatchedWamId = res.wamId;
        console.log(`[whatsapp/send] Fallback text message dispatched successfully to ${recipientPhone} (wamId: ${dispatchedWamId})`);
      } catch (fallbackErr: unknown) {
        const axErr = fallbackErr as { response?: { status?: number; data?: { error?: { message?: string } } }; message?: string };
        const rawErrMsg = axErr?.response?.data?.error?.message || axErr?.message || 'Meta API rejected message delivery';
        console.error('[whatsapp/send] Meta API error sending Message 1:', JSON.stringify(axErr?.response?.data ?? axErr?.message ?? fallbackErr, null, 2));
        dispatchError = rawErrMsg;
        initialDeliveryStatus = 'failed';
      }
    }

    // ALWAYS save message history and contact profile in MongoDB (visible in agent.datacrumbs.org/chats)
    try {
      await saveMessage({
        from: recipientPhone,
        text: '',
        reply: msg1,
        timestamp: Date.now(),
        wamId: dispatchedWamId,
        deliveryStatus: initialDeliveryStatus,
        deliveryError: dispatchError,
      });

      await saveContactProfile({
        phone: recipientPhone,
        name: studentName,
        email: studentEmail,
        bootcampLead: true,
        bootcampGoal: studentGoal,
        bootcampLeadPending: true,
      });
    } catch (dbErr) {
      console.error('[whatsapp/send] Failed to save lead to database:', dbErr);
    }

    if (initialDeliveryStatus === 'failed') {
      return NextResponse.json({
        ok: false,
        warning: 'Lead saved to dashboard, but Meta message failed',
        error: dispatchError,
        step: 'lead_saved_delivery_failed',
      }, { status: 200 });
    }

    return NextResponse.json({ ok: true, step: 'message_1_sent' });
  }

  if (!message && !sendBrochure) {
    return NextResponse.json({ error: 'Missing to or message' }, { status: 400 });
  }

  let sentDoc = false;
  let adminWamId: string | undefined;
  if (sendBrochure) {
    try {
      await sendWhatsAppDocument(recipientPhone);
      sentDoc = true;
    } catch (err) {
      console.error('Admin brochure send failed:', err instanceof Error ? err.message : err);
    }
  }
  if (message) {
    const res = await sendWhatsAppMessage(recipientPhone, message);
    adminWamId = res?.wamId;
  }
  // Save with empty text to indicate admin-initiated (no customer message)
  await saveMessage({
    from: recipientPhone,
    text: '',
    reply: message || '',
    timestamp: Date.now(),
    wamId: adminWamId,
    deliveryStatus: 'sent',
    ...(sentDoc ? { mediaType: 'document' as const } : {}),
  });

  return NextResponse.json({ ok: true });
}
