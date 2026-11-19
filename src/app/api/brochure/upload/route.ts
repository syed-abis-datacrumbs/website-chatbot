import { NextRequest, NextResponse } from 'next/server';
import { getDb, saveBrochure } from '@/lib/redis';
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
    const safeUploadId = uploadId.replace(/[^a-zA-Z0-9_-]/g, '');

    const chunkBuffer = Buffer.from(await chunk.arrayBuffer());
    const db = await getDb();

    // Store chunk in MongoDB (shared across all serverless lambda instances)
    await db.collection('upload_chunks').updateOne(
      { uploadId: safeUploadId, chunkIndex },
      {
        $set: {
          uploadId: safeUploadId,
          chunkIndex,
          data: chunkBuffer.toString('base64'),
          createdAt: Date.now(),
        },
      },
      { upsert: true }
    );

    // If this is the last chunk, wait for all chunks and assemble
    if (chunkIndex === totalChunks - 1) {
      let docs = await db
        .collection('upload_chunks')
        .find({ uploadId: safeUploadId })
        .sort({ chunkIndex: 1 })
        .toArray();

      // In case prior chunks are finishing in parallel, retry up to 3 seconds
      let attempts = 0;
      while (docs.length < totalChunks && attempts < 10) {
        await new Promise((r) => setTimeout(r, 300));
        docs = await db
          .collection('upload_chunks')
          .find({ uploadId: safeUploadId })
          .sort({ chunkIndex: 1 })
          .toArray();
        attempts++;
      }

      if (docs.length < totalChunks) {
        return NextResponse.json(
          { error: `Upload incomplete: received ${docs.length} of ${totalChunks} parts. Please try again.` },
          { status: 400 }
        );
      }

      const buffers = docs.map((d) => Buffer.from(d.data as string, 'base64'));
      const fullBuffer = Buffer.concat(buffers);

      // Clean up temporary chunks in background
      db.collection('upload_chunks').deleteMany({ uploadId: safeUploadId }).catch(() => null);

      if (fullBuffer.length === 0) {
        return NextResponse.json({ error: 'Uploaded file is empty' }, { status: 400 });
      }

      console.log(`[brochure/upload] Full file assembled via MongoDB chunks: ${filename} (${fullBuffer.length} bytes)`);

      // 1. Upload to Google Drive (allows web preview of any size)
      let driveUrl: string | undefined;
      let driveFileId: string | undefined;
      try {
        const driveRes = await uploadBrochureToDrive(fullBuffer, filename);
        driveUrl = driveRes.webViewLink;
        driveFileId = driveRes.fileId;
        console.log(`[brochure/upload] Uploaded to Google Drive successfully: ${driveUrl}`);
      } catch (driveErr) {
        console.warn('[brochure/upload] Google Drive upload fallback:', driveErr);
      }

      // 2. Upload directly to Meta WhatsApp Media API (gives official media_id for instant WhatsApp sending)
      let whatsappMediaId: string | undefined;
      try {
        whatsappMediaId = await uploadMediaToWhatsApp(fullBuffer, filename, 'application/pdf');
        console.log(`[brochure/upload] Uploaded to WhatsApp Media API successfully: ${whatsappMediaId}`);
      } catch (waErr) {
        console.warn('[brochure/upload] WhatsApp Media API upload fallback:', waErr);
      }

      // 3. Save brochure in settings collection (immediately active for chats & students)
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
    console.error('[brochure/upload] Error:', err);
    return NextResponse.json({ error: (err as Error)?.message || 'Chunk upload failed' }, { status: 500 });
  }
}
