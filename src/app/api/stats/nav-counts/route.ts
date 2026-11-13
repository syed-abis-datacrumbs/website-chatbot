import { NextResponse } from 'next/server';
import { getNavCounts } from '@/lib/redis';
import { getSheetNavCounts } from '@/lib/google';
import { getUnifiedEnrollments } from '@/lib/enrollments';

export const dynamic = 'force-dynamic';

export async function GET() {
  const [mongoCounts, sheetCounts, enrollmentsList] = await Promise.all([
    getNavCounts().catch(() => ({ chats: 0, leads: 0, enrollments: 0, interventions: 0 })),
    getSheetNavCounts().catch(() => ({ leads: 0, enrollments: 0 })),
    getUnifiedEnrollments().catch(() => null),
  ]);

  // Use the exact count of verified payment submissions matching the Payments dashboard
  const enrollmentsCount = enrollmentsList !== null ? enrollmentsList.length : sheetCounts.enrollments;

  return NextResponse.json({
    chats: mongoCounts.chats,
    leads: sheetCounts.leads,
    enrollments: enrollmentsCount,
    interventions: mongoCounts.interventions,
  });
}
