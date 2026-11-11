import { getStats } from '@/lib/redis';
import OverviewUI from '@/components/dashboard/OverviewUI';

export const dynamic = 'force-dynamic';

export default async function OverviewPage() {
  const stats = await getStats();
  return <OverviewUI stats={stats} />;
}
