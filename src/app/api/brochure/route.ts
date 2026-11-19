import { NextRequest, NextResponse } from 'next/server';
import { getBrochure, saveBrochure } from '@/lib/redis';
import { uploadBrochureToDrive } from '@/lib/google';
import { uploadMediaToWhatsApp } from '@/lib/whatsapp';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function HEAD() {
  const brochure = await getBrochure();
  if (brochure?.driveUrl) {
    return new NextResponse(null, {
      status: 302,
      headers: { Location: brochure.driveUrl },
    });
  }
  const size = brochure?.data?.length || brochure?.size || 0;
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': size ? String(size) : '0',
      'Accept-Ranges': 'bytes',
    },
  });
}

// Serve the uploaded brochure PDF dynamically
export async function GET() {
  const brochure = await getBrochure();

  // If brochure has a Google Drive link, redirect to it (renders in Google Drive PDF viewer, zero payload limit)
  if (brochure?.driveUrl) {
    return NextResponse.redirect(brochure.driveUrl, 302);
  }

  // If small enough (< 4.5 MB) and stored in MongoDB, stream it directly
  if (brochure?.data && brochure.data.length > 0) {
    return new NextResponse(new Uint8Array(brochure.data), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(brochure.data.length),
        'Accept-Ranges': 'bytes',
        'Content-Disposition': `inline; filename="${brochure.filename || 'DataCrumbs-Bootcamp-Brochure.pdf'}"`,
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });
  }

  // Fallback: redirect to public/brochure.pdf so Vercel CDN serves it without serverless size limits
  try {
    const filePath = path.join(process.cwd(), 'public', 'brochure.pdf');
    if (fs.existsSync(filePath)) {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://agent.datacrumbs.org';
      return NextResponse.redirect(new URL('/brochure.pdf', baseUrl), 302);
    }
  } catch (err) {
    console.warn('[brochure] Error reading static fallback:', err);
  }

  return NextResponse.json({ error: 'Brochure not found' }, { status: 404 });
}

// Upload a new brochure PDF (single-shot for files <= 4 MB)
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    if (file.type !== 'application/pdf') {
      return NextResponse.json({ error: 'Only PDF files are allowed' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    let driveUrl: string | undefined;
    let driveFileId: string | undefined;
    try {
      const driveRes = await uploadBrochureToDrive(buffer, file.name);
      driveUrl = driveRes.webViewLink;
      driveFileId = driveRes.fileId;
    } catch (e) {
      console.warn('[brochure] Google Drive upload fallback:', e);
    }

    let whatsappMediaId: string | undefined;
    try {
      whatsappMediaId = await uploadMediaToWhatsApp(buffer, file.name, 'application/pdf');
    } catch (e) {
      console.warn('[brochure] WhatsApp media upload fallback:', e);
    }

    await saveBrochure(buffer, file.name, {
      driveUrl,
      driveFileId,
      whatsappMediaId,
      size: buffer.length,
    });

    return NextResponse.json({
      ok: true,
      filename: file.name,
      size: file.size,
      driveUrl,
      whatsappMediaId,
    });
  } catch (err: unknown) {
    console.error('[brochure] Upload error:', err);
    return NextResponse.json({ error: (err as Error)?.message || 'Upload failed' }, { status: 500 });
  }
}
