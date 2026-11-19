import { NextResponse } from 'next/server';
import { getMessages, deleteAllMessages, getContactNamesMap } from '@/lib/redis';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sinceParam = searchParams.get('since');
  const since = sinceParam ? parseInt(sinceParam, 10) : undefined;
  const limitParam = searchParams.get('limit');
  const limit = limitParam ? Math.min(parseInt(limitParam, 10), 500) : (since ? 100 : 300);

  const messages = await getMessages(limit, since);
  const phones = Array.from(new Set(messages.map(m => m.from)));
  const nameMap = await getContactNamesMap(phones);
  const names = Object.fromEntries(nameMap.entries());
  return NextResponse.json({ messages, names });
}

export async function DELETE() {
  const deleted = await deleteAllMessages();
  return NextResponse.json({ deleted });
}
