import { NextResponse } from 'next/server';
import { getMessages, deleteAllMessages, getContactNamesMap } from '@/lib/redis';

export const dynamic = 'force-dynamic';

export async function GET() {
  const messages = await getMessages();
  const phones = Array.from(new Set(messages.map(m => m.from)));
  const nameMap = await getContactNamesMap(phones);
  const names = Object.fromEntries(nameMap.entries());
  return NextResponse.json({ messages, names });
}

export async function DELETE() {
  const deleted = await deleteAllMessages();
  return NextResponse.json({ deleted });
}
