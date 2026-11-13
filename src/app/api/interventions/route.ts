import { NextResponse } from 'next/server';
import { getAllInterventions, getPendingInterventionsCount } from '@/lib/redis';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [interventions, pendingCount] = await Promise.all([
      getAllInterventions(200),
      getPendingInterventionsCount(),
    ]);

    return NextResponse.json({ interventions, pendingCount });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[interventions/api] GET error:', msg);
    return NextResponse.json({ error: msg, interventions: [], pendingCount: 0 }, { status: 500 });
  }
}

