import { NextResponse } from 'next/server';
import { getNavCounts } from '@/lib/redis';
import { getSheetNavCounts } from '@/lib/google';

export const dynamic = 'force-dynamic';

export async function GET() {
  // Chats reflects MongoDB directly; Leads/Enrollments reflect the Sheet
  // (the reviewed, editable source of truth for those two).
  const [mongoCounts, sheetCounts] = await Promise.all([
    getNavCounts(),
    getSheetNavCounts(),
  ]);
  return NextResponse.json({
    chats: mongoCounts.chats,
    leads: sheetCounts.leads,
    enrollments: sheetCounts.enrollments,
    interventions: mongoCounts.interventions,
  });
}
