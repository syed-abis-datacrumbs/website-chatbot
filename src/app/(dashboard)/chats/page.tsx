import { getMessages, ChatMessage } from '@/lib/redis';
import ChatsUI from '@/components/dashboard/ChatsUI';

export const dynamic = 'force-dynamic';

function groupByPhone(messages: ChatMessage[]) {
  const map = new Map<string, ChatMessage[]>();
  for (const msg of messages) {
    if (!map.has(msg.from)) map.set(msg.from, []);
    map.get(msg.from)!.push(msg);
  }
  return Array.from(map.entries())
    .map(([phone, msgs]) => ({
      phone,
      messages: msgs.sort((a, b) => b.timestamp - a.timestamp),
      lastMessage: msgs.reduce((l, m) => m.timestamp > l.timestamp ? m : l),
    }))
    .sort((a, b) => b.lastMessage.timestamp - a.lastMessage.timestamp);
}

export default async function ChatsPage({
  searchParams,
}: {
  searchParams?: Promise<{ phone?: string }>;
}) {
  const resolvedParams = searchParams ? await searchParams : undefined;
  const initialPhone = resolvedParams?.phone ? decodeURIComponent(resolvedParams.phone) : undefined;
  const messages = await getMessages();
  const contacts = groupByPhone(messages);
  return (
    <div style={{ height: '100%' }}>
      <ChatsUI contacts={contacts} total={messages.length} initialPhone={initialPhone} />
    </div>
  );
}
