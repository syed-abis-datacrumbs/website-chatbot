import { NextRequest, NextResponse } from 'next/server';
import { resolveIntervention } from '@/lib/redis';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ phone: string }> },
) {
  try {
    const { phone } = await params;
    const decoded = decodeURIComponent(phone);
    await resolveIntervention(decoded);
    return NextResponse.json({ success: true, phone: decoded });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[interventions/resolve] POST error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

