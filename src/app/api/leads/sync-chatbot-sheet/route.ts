import { NextRequest, NextResponse } from 'next/server';
import { syncAllChatbotStatusesToPrettySheet } from '@/lib/google';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const result = await syncAllChatbotStatusesToPrettySheet();
    return NextResponse.json({
      ok: true,
      message: `Successfully synced Chatbot status for ${result.updatedCount} leads in ${result.tabName} (Column ${result.colLetter})`,
      ...result,
    });
  } catch (err: unknown) {
    console.error('[sync-chatbot-sheet] Error:', err);
    return NextResponse.json({ error: (err as Error)?.message || 'Sync failed' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
