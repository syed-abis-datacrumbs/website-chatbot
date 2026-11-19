import { getAllInterventions } from '@/lib/redis';
import InterventionsUI from '@/components/dashboard/InterventionsUI';

export const dynamic = 'force-dynamic';

export default async function InterventionsPage() {
  const items = await getAllInterventions(200).catch(() => []);
  return <InterventionsUI initialItems={items} />;
}
