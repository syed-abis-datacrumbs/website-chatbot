import { NextRequest, NextResponse } from 'next/server';
import { updateEnrollmentState, getAllEnrollments, saveMessage } from '@/lib/redis';
import { updateSheetStatus, updateEnrollmentSheetStatusByPhone } from '@/lib/google';
import { sendWhatsAppMessage } from '@/lib/whatsapp';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const phone = decodeURIComponent(id);

  let status: 'approved' | 'rejected' | 'pending';
  try {
    const raw = await req.text();
    const body = JSON.parse(raw) as { status?: string };
    if (body.status !== 'approved' && body.status !== 'rejected' && body.status !== 'pending') {
      return NextResponse.json({ error: 'Invalid status. Must be approved, rejected, or pending' }, { status: 400 });
    }
    status = body.status as 'approved' | 'rejected' | 'pending';
  } catch {
    return NextResponse.json({ error: 'Invalid or empty request body' }, { status: 400 });
  }

  // 1. Update MongoDB enrollment state
  const mongoState = status === 'approved'
    ? 'approved'
    : status === 'rejected'
    ? 'rejected'
    : 'screenshot_received';

  try {
    await updateEnrollmentState(phone, mongoState);
  } catch (mongoErr) {
    console.error('[status] Error updating MongoDB:', mongoErr);
  }

  // 2. Update Google Sheet status
  const sheetStatusText = status === 'approved'
    ? 'Approved ✅'
    : status === 'rejected'
    ? 'Rejected ❌'
    : 'Pending';

  try {
    const all = await getAllEnrollments();
    const session = all.find(s => s.phone === phone);
    if (session?.sheetRowIndex && session.sheetRowIndex > 0) {
      await updateSheetStatus(session.sheetRowIndex, sheetStatusText);
    }
    // Also run direct phone matching to ensure sheet row is always found
    await updateEnrollmentSheetStatusByPhone(phone, sheetStatusText);
  } catch (sheetErr) {
    console.error('[status] Error updating Google Sheet:', sheetErr);
  }

  // 3. Notify student on WhatsApp if approved or rejected
  if (status === 'approved') {
    const msg = `🎉 *Payment Verified & Enrollment Confirmed!*

Assalam-o-Alaikum, your payment has been *verified* and your seat in the DataCrumbs AI & Data Science Bootcamp is *officially confirmed*! 🎓

Here are your onboarding links:
1. Create your student account on our LMS:
   🔗 https://lms.datacrumbs.org
2. Join the Official Student Community:
   💬 https://chat.whatsapp.com/Hu6jC1O0LrhBs9WesBlqFT

Welcome to DataCrumbs! Our team will share your orientation schedule right here shortly. 🚀`;

    try {
      await sendWhatsAppMessage(phone, msg);
      await saveMessage({ from: phone, text: '', reply: msg, timestamp: Date.now() });
    } catch (waErr) {
      console.error('[status] Failed to send WhatsApp approval message:', waErr);
    }
  } else if (status === 'rejected') {
    const msg = `Assalam-o-Alaikum, we were unable to verify your payment screenshot.

Please send a clear screenshot showing the transaction ID, date, and fee amount (Rs 7,499 / 7,500) so we can verify and confirm your seat.

If you have already paid or need any assistance, reply here or contact us at +92 329 2020497.`;

    try {
      await sendWhatsAppMessage(phone, msg);
      await saveMessage({ from: phone, text: '', reply: msg, timestamp: Date.now() });
    } catch (waErr) {
      console.error('[status] Failed to send WhatsApp rejection message:', waErr);
    }
  }

  return NextResponse.json({ ok: true, phone, status });
}
