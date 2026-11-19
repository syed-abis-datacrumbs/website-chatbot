import { NextResponse } from 'next/server';
import { getNavCounts } from '@/lib/redis';
import { getSheetNavCounts } from '@/lib/google';
import { getUnifiedEnrollments } from '@/lib/enrollments';

export const dynamic = 'force-dynamic';

let cachedNavCounts: { chats: number; leads: number; enrollments: number; interventions: number } | null = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 30 * 1000; // 30 seconds

export async function GET() {
  const now = Date.now();
  if (cachedNavCounts && (now - lastCacheTime) < CACHE_TTL_MS) {
    return NextResponse.json(cachedNavCounts);
  }

  const [mongoCounts, sheetCounts, enrollmentsList] = await Promise.all([
    getNavCounts().catch(() => ({ chats: 0, leads: 0, enrollments: 0, interventions: 0 })),
    getSheetNavCounts().catch(() => ({ leads: 0, enrollments: 0 })),
    getUnifiedEnrollments().catch(() => null),
  ]);

  // Use the exact count of verified payment submissions matching the Payments dashboard
  const enrollmentsCount = enrollmentsList !== null ? enrollmentsList.length : sheetCounts.enrollments;

  cachedNavCounts = {
    chats: mongoCounts.chats,
    leads: sheetCounts.leads,
    enrollments: enrollmentsCount,
    interventions: mongoCounts.interventions,
  };
  lastCacheTime = now;

  return NextResponse.json(cachedNavCounts);
}
