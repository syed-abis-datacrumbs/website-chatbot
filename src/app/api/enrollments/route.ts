import { NextResponse } from 'next/server';
import { getUnifiedEnrollments } from '@/lib/enrollments';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const enrollments = await getUnifiedEnrollments();
    return NextResponse.json({ enrollments, payments: enrollments });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[enrollments/api] GET error:', msg);
    return NextResponse.json({ error: msg, enrollments: [], payments: [] }, { status: 500 });
  }
}
