import { getUnifiedEnrollments } from '@/lib/enrollments';
import PaymentsUI from '@/components/dashboard/PaymentsUI';

export const dynamic = 'force-dynamic';

export default async function PaymentsPage() {
  const initialPayments = await getUnifiedEnrollments().catch(() => []);
  return <PaymentsUI initialPayments={initialPayments} />;
}
