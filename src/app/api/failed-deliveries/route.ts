import { NextResponse } from 'next/server';
import { getFailedDeliveries, getFailedDeliveriesCount } from '@/lib/redis';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [items, total] = await Promise.all([
      getFailedDeliveries(250),
      getFailedDeliveriesCount(),
    ]);
    return NextResponse.json({ items, total });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg, items: [], total: 0 }, { status: 500 });
  }
}
