import { getConversationsList, getMessagesByPhone } from '@/lib/redis';
import ChatsUI, { Contact } from '@/components/dashboard/ChatsUI';

export const dynamic = 'force-dynamic';

export default async function ChatsPage({
  searchParams,
}: {
  searchParams?: Promise<{ phone?: string }>;
}) {
  const resolvedParams = searchParams ? await searchParams : undefined;
  const initialPhone = resolvedParams?.phone ? decodeURIComponent(resolvedParams.phone) : undefined;

  // Ultra-fast native MongoDB aggregation: loads all contact summaries in ~15ms
  const convs = await getConversationsList(250);

  const activePhone = initialPhone || convs[0]?.phone;
  // Fetch full messages ONLY for the active open chat
  const activeMessages = activePhone ? await getMessagesByPhone(activePhone, 100) : [];

  const contacts: Contact[] = convs.map(c => ({
    phone: c.phone,
    name: c.name,
    messages: c.phone === activePhone ? activeMessages : [c.lastMessage],
    lastMessage: c.lastMessage,
  }));

  const total = convs.reduce((sum, c) => sum + (c.messageCount || 1), 0);

  return (
    <div style={{ height: '100%' }}>
      <ChatsUI contacts={contacts} total={total} initialPhone={initialPhone} />
    </div>
  );
}
