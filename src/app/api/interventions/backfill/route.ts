import { NextResponse } from 'next/server';
import {
  createHumanIntervention,
  getDiscountRequests,
  getDemoRequests,
  scanMessagesForInterventions,
  getAllInterventions,
} from '@/lib/redis';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    // Clean up any previous non-standard or false-positive records in human_interventions
    await getAllInterventions();

    let discountsCount = 0;
    let demosCount = 0;
    let messagesCount = 0;

    // 1. READ-ONLY: Backfill from discount_requests
    const discounts = await getDiscountRequests();
    for (const d of discounts) {
      const msg = (d.message || 'Discount requested');
      await createHumanIntervention({
        phone: d.phone,
        name: d.name || null,
        email: d.email || null,
        category: 'discount',
        reason: `Discount requested: "${msg.trim().slice(0, 100)}"`,
        lastMessage: msg,
        flaggedAt: d.timestamp,
      });
      discountsCount++;
    }

    // 2. READ-ONLY: Backfill from demo_requests
    const demos = await getDemoRequests();
    for (const dm of demos) {
      const msg = (dm.message || 'Demo class requested');
      await createHumanIntervention({
        phone: dm.phone,
        name: dm.name || null,
        email: dm.email || null,
        category: 'demo',
        reason: `Demo class requested: "${msg.trim().slice(0, 100)}"`,
        lastMessage: msg,
        flaggedAt: dm.timestamp,
      });
      demosCount++;
    }

    // 3. READ-ONLY: Scan past messages for payment claims and human requests
    const msgMatches = await scanMessagesForInterventions(2000);
    for (const match of msgMatches) {
      await createHumanIntervention(match);
      messagesCount++;
    }

    return NextResponse.json({
      success: true,
      summary: {
        discountsCount,
        demosCount,
        messagesCount,
        totalProcessed: discountsCount + demosCount + messagesCount,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[interventions/backfill] error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
