import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { saveBrochure } from '@/lib/redis';
import { uploadBrochureToDrive } from '@/lib/google';
import { uploadMediaToWhatsApp } from '@/lib/whatsapp';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const chunk = formData.get('chunk') as File | null;
    const chunkIndexStr = formData.get('chunkIndex') as string | null;
    const totalChunksStr = formData.get('totalChunks') as string | null;
    const uploadId = formData.get('uploadId') as string | null;
    const filename = (formData.get('filename') as string | null) || 'DataCrumbs-Bootcamp-Brochure.pdf';

    if (!chunk || chunkIndexStr === null || totalChunksStr === null || !uploadId) {
      return NextResponse.json({ error: 'Missing required chunk parameters' }, { status: 400 });
    }

    const chunkIndex = parseInt(chunkIndexStr, 10);
    const totalChunks = parseInt(totalChunksStr, 10);

    // Sanitize uploadId
    const safeUploadId = uploadId.replace(/[^a-zA-Z0-9_-]/g, '');
    const tmpDir = '/tmp';
    const partPath = path.join(tmpDir, `brochure_${safeUploadId}.part`);

    const chunkBuffer = Buffer.from(await chunk.arrayBuffer());

    if (chunkIndex === 0) {
      fs.writeFileSync(partPath, chunkBuffer);
    } else {
      fs.appendFileSync(partPath, chunkBuffer);
    }

    // If this is the last chunk, process the complete file
    if (chunkIndex === totalChunks - 1) {
      if (!fs.existsSync(partPath)) {
        return NextResponse.json({ error: 'Uploaded file missing from temporary storage' }, { status: 400 });
      }

      const fullBuffer = fs.readFileSync(partPath);
      try { fs.unlinkSync(partPath); } catch { /* ignore */ }

      if (fullBuffer.length === 0) {
        return NextResponse.json({ error: 'Uploaded file is empty' }, { status: 400 });
      }

      console.log(`[brochure/upload] Full file assembled: ${filename} (${fullBuffer.length} bytes)`);

      // 1. Upload to Google Drive (allows web users to preview/download large PDFs without serverless limits)
      let driveUrl: string | undefined;
      let driveFileId: string | undefined;
      try {
        const driveRes = await uploadBrochureToDrive(fullBuffer, filename);
        driveUrl = driveRes.webViewLink;
        driveFileId = driveRes.fileId;
        console.log(`[brochure/upload] Uploaded to Google Drive successfully: ${driveUrl}`);
      } catch (driveErr) {
        console.warn('[brochure/upload] Google Drive upload failed (will continue):', driveErr);
      }

      // 2. Upload directly to WhatsApp Media API (gives media_id for instant, error-free WhatsApp delivery)
      let whatsappMediaId: string | undefined;
      try {
        whatsappMediaId = await uploadMediaToWhatsApp(fullBuffer, filename, 'application/pdf');
        console.log(`[brochure/upload] Uploaded to WhatsApp Media API successfully: ${whatsappMediaId}`);
      } catch (waErr) {
        console.warn('[brochure/upload] WhatsApp Media upload failed (will retry dynamically):', waErr);
      }

      // 3. Save brochure metadata in MongoDB
      await saveBrochure(fullBuffer, filename, {
        driveUrl,
        driveFileId,
        whatsappMediaId,
        size: fullBuffer.length,
      });

      return NextResponse.json({
        ok: true,
        filename,
        size: fullBuffer.length,
        driveUrl,
        whatsappMediaId,
      });
    }

    return NextResponse.json({ ok: true, chunkReceived: chunkIndex + 1, totalChunks });
  } catch (err: unknown) {
    console.error('[brochure/upload] Chunk upload error:', err);
    return NextResponse.json({ error: (err as Error)?.message || 'Chunk upload failed' }, { status: 500 });
  }
}
