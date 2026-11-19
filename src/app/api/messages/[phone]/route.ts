import { NextRequest, NextResponse } from 'next/server';
import { deleteMessagesByPhone, getDb, ChatMessage } from '@/lib/redis';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ phone: string }> },
) {
  const { phone } = await params;
  if (!phone) return NextResponse.json({ messages: [] });

  const clean = phone.replace(/\D/g, '');
  const variants = [phone, clean];
  if (clean.startsWith('0')) variants.push('92' + clean.slice(1));
  else if (clean.startsWith('92')) variants.push('0' + clean.slice(2));
  else if (clean.startsWith('3')) {
    variants.push('92' + clean);
    variants.push('0' + clean);
  }

  const db = await getDb();
  const msgs = await db
    .collection<ChatMessage>('wa_messages')
    .find({ from: { $in: variants } }, {
      projection: {
        _id: 0,
        from: 1,
        text: 1,
        reply: 1,
        timestamp: 1,
        mediaType: 1,
        mediaUrl: 1,
        wamId: 1,
        deliveryStatus: 1,
        deliveryError: 1,
        isPayment: 1,
        isDeleted: 1,
      },
    })
    .sort({ timestamp: -1 })
    .limit(300)
    .toArray();

  return NextResponse.json({ messages: msgs });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ phone: string }> },
) {
  const { phone } = await params;
  const deleted = await deleteMessagesByPhone(phone);
  return NextResponse.json({ deleted });
}
