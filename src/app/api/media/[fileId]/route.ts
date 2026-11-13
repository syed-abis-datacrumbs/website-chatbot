import { NextRequest, NextResponse } from 'next/server';
import { getDriveFileBuffer } from '@/lib/google';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const { fileId } = await params;
  if (!fileId) return new NextResponse('Missing fileId', { status: 400 });

  try {
    const { buffer, mimeType } = await getDriveFileBuffer(fileId);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': mimeType,
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[api/media] Falling back to Drive thumbnail for ${fileId}:`, message);
    return NextResponse.redirect(`https://drive.google.com/thumbnail?id=${fileId}&sz=w1000`);
  }
}
