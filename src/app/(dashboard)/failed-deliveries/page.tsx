import { getFailedDeliveries } from '@/lib/redis';
import FailedDeliveriesUI from '@/components/dashboard/FailedDeliveriesUI';

export const dynamic = 'force-dynamic';

export default async function FailedDeliveriesPage() {
  const items = await getFailedDeliveries(250).catch(() => []);
  return <FailedDeliveriesUI initialItems={items} />;
}
