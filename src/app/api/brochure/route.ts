import { NextRequest, NextResponse } from 'next/server';
import { getBrochure, saveBrochure } from '@/lib/redis';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

// Serve the uploaded brochure PDF dynamically (always 200 OK, no 302 redirect)
export async function GET() {
  const brochure = await getBrochure();
  if (brochure?.data) {
    return new NextResponse(new Uint8Array(brochure.data), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${brochure.filename || 'DataCrumbs-Bootcamp-Brochure.pdf'}"`,
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });
  }

  // Fallback: serve the static brochure from /public directly with 200 OK so Meta never fails
  try {
    const filePath = path.join(process.cwd(), 'public', 'brochure.pdf');
    if (fs.existsSync(filePath)) {
      const fileBuffer = fs.readFileSync(filePath);
      return new NextResponse(fileBuffer, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'inline; filename="DataCrumbs-Bootcamp-Brochure.pdf"',
          'Cache-Control': 'public, max-age=86400',
        },
      });
    }
  } catch (err) {
    console.warn('[brochure] Error reading static fallback:', err);
  }

  return NextResponse.json({ error: 'Brochure not found' }, { status: 404 });
}

// Upload a new brochure PDF (max ~10 MB)
export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get('file') as File | null;

  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  if (file.type !== 'application/pdf') {
    return NextResponse.json({ error: 'Only PDF files are allowed' }, { status: 400 });
  }
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: 'File too large (max 10 MB)' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  await saveBrochure(buffer, file.name);

  return NextResponse.json({ ok: true, filename: file.name, size: file.size });
}
