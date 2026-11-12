import { NextResponse } from 'next/server';
import { getEnrollmentsFromSheet } from '@/lib/google';
import { getAllEnrollments } from '@/lib/redis';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [sheetEnrollments, mongoEnrollments] = await Promise.all([
      getEnrollmentsFromSheet().catch(err => {
        console.error('[enrollments/api] Failed to fetch sheets:', err);
        return [];
      }),
      getAllEnrollments().catch(err => {
        console.error('[enrollments/api] Failed to fetch mongo enrollments:', err);
        return [];
      }),
    ]);

    // Map keyed by clean digits of phone number
    const map = new Map<string, {
      rowIndex?: number;
      name: string;
      email: string;
      phone: string;
      submitted: string;
      driveLink: string;
      status: string;
      normalizedStatus: 'approved' | 'rejected' | 'pending';
      timestamp: number;
    }>();

    // 1. Populate from MongoDB enrollments
    for (const session of mongoEnrollments) {
      if (!session.phone) continue;

      // Only show students who actually paid or submitted payment proof:
      // i.e. approved, rejected, screenshot uploaded, or has drive proof attached
      const hasProof = Boolean(session.driveFileUrl || session.driveFileId);
      const isPaidOrSubmitted =
        session.state === 'approved' ||
        session.state === 'rejected' ||
        session.state === 'screenshot_received' ||
        hasProof;

      if (!isPaidOrSubmitted) continue;

      const clean = session.phone.replace(/\D/g, '');
      const ts = session.createdAt || session.updatedAt || Date.now();
      const submitted = new Date(ts).toLocaleString('en-PK', {
        timeZone: 'Asia/Karachi',
        dateStyle: 'medium',
        timeStyle: 'short',
      });

      let norm: 'approved' | 'rejected' | 'pending' = 'pending';
      let displayStatus = 'Pending Review ⚠️';
      if (session.state === 'approved') {
        norm = 'approved';
        displayStatus = 'Approved ✅';
      } else if (session.state === 'rejected') {
        norm = 'rejected';
        displayStatus = 'Rejected ❌';
      } else if (session.state === 'screenshot_received') {
        norm = 'pending';
        displayStatus = 'Pending Review ⚠️';
      }

      map.set(clean, {
        rowIndex: session.sheetRowIndex ?? undefined,
        name: session.name || 'Student',
        email: session.email || '',
        phone: session.phone.replace(/^\+/, ''),
        submitted,
        driveLink: session.driveFileUrl || '',
        status: displayStatus,
        normalizedStatus: norm,
        timestamp: ts,
      });
    }

    // 2. Overlay / merge Google Sheet entries
    for (const row of sheetEnrollments) {
      if (!row.phone) continue;
      const clean = row.phone.replace(/\D/g, '');
      const rawStatus = (row.status || 'Pending').trim();
      const isAppr = /approved/i.test(rawStatus);
      const isRej = /rejected/i.test(rawStatus);
      const norm: 'approved' | 'rejected' | 'pending' = isAppr ? 'approved' : isRej ? 'rejected' : 'pending';

      const existing = map.get(clean);
      if (existing) {
        map.set(clean, {
          ...existing,
          rowIndex: row.rowIndex || existing.rowIndex,
          name: (row.name && row.name !== 'Student') ? row.name : existing.name,
          email: row.email || existing.email,
          submitted: row.submitted || existing.submitted,
          driveLink: row.driveLink || existing.driveLink,
          status: rawStatus,
          normalizedStatus: norm,
        });
      } else {
        map.set(clean, {
          rowIndex: row.rowIndex,
          name: row.name || 'Student',
          email: row.email || '',
          phone: row.phone,
          submitted: row.submitted || '—',
          driveLink: row.driveLink || '',
          status: rawStatus,
          normalizedStatus: norm,
          timestamp: Date.now(),
        });
      }
    }

    const enrollments = Array.from(map.values()).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    return NextResponse.json({ enrollments, payments: enrollments });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[enrollments/api] GET error:', msg);
    return NextResponse.json({ error: msg, enrollments: [], payments: [] }, { status: 500 });
  }
}
