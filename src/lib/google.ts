import { google } from 'googleapis';
import { Readable } from 'stream';

const DRIVE_FOLDER_ID   = process.env.GOOGLE_DRIVE_FOLDER_ID!;
const SHEET_ID          = process.env.GOOGLE_SHEET_ID!;
const SHEET_TAB         = process.env.GOOGLE_SHEET_TAB ?? 'Payment info bot';
const DISCOUNT_TAB      = process.env.GOOGLE_SHEET_TAB_DISCOUNT ?? 'Discount';
const LEADS_TAB         = process.env.GOOGLE_SHEET_TAB_LEADS ?? 'agent leads';
const DEMO_TAB          = process.env.GOOGLE_SHEET_TAB_DEMO ?? 'Demo';

function tabRange(tab: string, range: string): string {
  // In Google Sheets A1 notation, single quotes inside sheet titles are escaped by doubling them ('')
  return `'${tab.replace(/'/g, "''")}'!${range}`;
}

function getPrivateKey(): string {
  let key = process.env.GOOGLE_PRIVATE_KEY ?? '';
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1);
  }
  key = key.replace(/\\n/g, '\n').replace(/\\r/g, '');
  return key
    .split('\n')
    .map(line => line.replace(/\\/g, '').trim())
    .filter(Boolean)
    .join('\n');
}

function auth() {
  return new google.auth.JWT({
    email: process.env.GOOGLE_CLIENT_EMAIL,
    key:   getPrivateKey(),
    scopes: [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/spreadsheets',
    ],
  });
}

// ── Drive ──────────────────────────────────────────────────────────────────

async function getOrCreateFolder(folderName: string): Promise<string> {
  const drive = google.drive({ version: 'v3', auth: auth() });

  const res = await drive.files.list({
    q: `name='${folderName}' and '${DRIVE_FOLDER_ID}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id)',
    spaces: 'drive',
  });

  if (res.data.files?.length) return res.data.files[0].id!;

  const folder = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [DRIVE_FOLDER_ID],
    },
    fields: 'id',
  });
  return folder.data.id!;
}

export async function uploadScreenshotToDrive(
  buffer: Buffer,
  mimeType: string,
  phone: string,
  timestamp: number,
): Promise<{ fileId: string; webViewLink: string }> {
  const drive    = google.drive({ version: 'v3', auth: auth() });
  const folderId = await getOrCreateFolder(phone);
  const ext      = mimeType.includes('png') ? 'png' : mimeType.includes('pdf') ? 'pdf' : 'jpg';

  const file = await drive.files.create({
    requestBody: {
      name:    `payment_${timestamp}.${ext}`,
      parents: [folderId],
    },
    media: { mimeType, body: Readable.from(buffer) },
    fields: 'id,webViewLink',
  });

  // Make the file viewable by anyone with the link
  await drive.permissions.create({
    fileId: file.data.id!,
    requestBody: { role: 'reader', type: 'anyone' },
  });

  return { fileId: file.data.id!, webViewLink: file.data.webViewLink! };
}

export async function getDriveFileBuffer(fileId: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const drive = google.drive({ version: 'v3', auth: auth() });
  const meta = await drive.files.get({ fileId, fields: 'mimeType' });
  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' },
  );
  return {
    buffer: Buffer.from(res.data as ArrayBuffer),
    mimeType: meta.data.mimeType || 'image/jpeg',
  };
}

// ── Sheets ─────────────────────────────────────────────────────────────────

export async function ensureSheetHeaders(): Promise<void> {
  const sheets = google.sheets({ version: 'v4', auth: auth() });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: tabRange(SHEET_TAB, 'A1:F1'),
  });

  if (!res.data.values?.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: tabRange(SHEET_TAB, 'A1'),
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [['Name', 'Email', 'Phone', 'Submitted (PKT)', 'Screenshot', 'Status']],
      },
    });
  }
}

export async function appendEnrollmentRow(data: {
  name: string;
  email: string;
  phone: string;
  timestamp: number;
  driveLink: string;
}): Promise<number> {
  await ensureSheetHeaders();
  const sheets = google.sheets({ version: 'v4', auth: auth() });

  const row = [
    data.name,
    data.email,
    // Leading ' forces Sheets to store this as literal text under USER_ENTERED —
    // without it, "+923..." is parsed as a unary-plus numeric expression and the
    // '+' silently gets dropped, breaking every exact-match phone lookup later.
    `'+${data.phone}`,
    new Date(data.timestamp).toLocaleString('en-PK', { timeZone: 'Asia/Karachi' }),
    data.driveLink,
    'Pending',
  ];

  const res = await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: tabRange(SHEET_TAB, 'A:F'),
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] },
  });

  // Extract row number from "Payment info bot!A5:F5"
  const updated = res.data.updates?.updatedRange ?? '';
  const match   = updated.match(/!A(\d+)/);
  return match ? parseInt(match[1]) : -1;
}

export async function appendDiscountRow(data: {
  name: string;
  phone: string;
  email?: string;
  message: string;
  timestamp: number;
}): Promise<void> {
  const sheets = google.sheets({ version: 'v4', auth: auth() });
  const tab    = DISCOUNT_TAB;

  // Ensure headers exist
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: tabRange(tab, 'A1:F1'),
  });
  if (!res.data.values?.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: tabRange(tab, 'A1'),
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [['Name', 'Email', 'Phone', 'Message', 'Submitted (PKT)', 'Comment']] },
    });
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: tabRange(tab, 'A:F'),
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[
        data.name,
        data.email ?? '',
        `'+${data.phone}`, // leading ' forces text — see appendEnrollmentRow for why
        data.message,
        new Date(data.timestamp).toLocaleString('en-PK', { timeZone: 'Asia/Karachi' }),
        '',
      ]],
    },
  });
}

// Updates the Comment column (F) on the most recent Discount row for this phone —
// used when a known discount requester sends a follow-up/counter-offer, so the
// existing row is updated rather than a confusing duplicate row being created.
export async function updateDiscountRowComment(phone: string, comment: string): Promise<void> {
  const sheets = google.sheets({ version: 'v4', auth: auth() });
  const tab    = DISCOUNT_TAB;
  const target = `+${phone}`;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: tabRange(tab, 'A:F'),
  });
  const rows = res.data.values ?? [];

  // Search from the bottom so the MOST RECENT matching row wins if there are several
  for (let i = rows.length - 1; i >= 1; i--) {
    if (rows[i][2] === target) {
      const rowNumber = i + 1;
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: tabRange(tab, `F${rowNumber}`),
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[comment]] },
      });
      return;
    }
  }
}

// ── Demo Requests ────────────────────────────────────────────────────────

export async function appendDemoRow(data: {
  name: string;
  phone: string;
  email?: string;
  message: string;
  timestamp: number;
}): Promise<void> {
  const sheets = google.sheets({ version: 'v4', auth: auth() });
  const tab    = DEMO_TAB;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: tabRange(tab, 'A1:E1'),
  });
  if (!res.data.values?.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: tabRange(tab, 'A1'),
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [['Name', 'Email', 'Phone', 'Message', 'Submitted (PKT)']] },
    });
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: tabRange(tab, 'A:E'),
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[
        data.name,
        data.email ?? '',
        `'+${data.phone}`, // leading ' forces text — see appendEnrollmentRow for why
        data.message,
        new Date(data.timestamp).toLocaleString('en-PK', { timeZone: 'Asia/Karachi' }),
      ]],
    },
  });
}

// ── Leads ──────────────────────────────────────────────────────────────────
// Column layout: Date(A) Time(B) Name(C) Email(D) Phone(E) Status(F) Slot 1-4(G-J)
// Attempts(K) Notes(L) GRP UPDATE(M) Confirmation Date(N) Total Talk(O)
// Last Call Length(P) Last Call At(Q). Columns F onward are a manually-maintained
// CRM workflow owned by the sales team — our code only ever touches A:E.

function formatLeadRow(name: string | null, phone: string, timestamp: number): string[] {
  const dateStr = new Date(timestamp).toLocaleDateString('en-PK', {
    timeZone: 'Asia/Karachi', day: '2-digit', month: 'short', year: 'numeric',
  });
  const timeStr = new Date(timestamp).toLocaleTimeString('en-PK', {
    timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit', hour12: true,
  });
  // Leading ' forces text under USER_ENTERED — see appendEnrollmentRow for why
  return [dateStr, timeStr, name ?? '', '', `'+${phone}`];
}

export async function appendLeadRow(data: {
  name: string | null;
  phone: string;
  timestamp: number;
}): Promise<void> {
  const sheets = google.sheets({ version: 'v4', auth: auth() });
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: tabRange(LEADS_TAB, 'A:E'),
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [formatLeadRow(data.name, data.phone, data.timestamp)] },
  });
}

export async function appendLeadRows(
  rows: { name: string | null; phone: string; timestamp: number }[],
): Promise<void> {
  if (!rows.length) return;
  const sheets = google.sheets({ version: 'v4', auth: auth() });
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: tabRange(LEADS_TAB, 'A:E'),
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: rows.map(r => formatLeadRow(r.name, r.phone, r.timestamp)) },
  });
}

// Backfills the Name column once we learn a contact's name after their lead row
// was already written with a blank name. Only touches a row whose Name is still empty.
export async function updateLeadName(phone: string, name: string): Promise<void> {
  const sheets = google.sheets({ version: 'v4', auth: auth() });
  const target = `+${phone}`;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: tabRange(LEADS_TAB, 'A:E'),
  });
  const rows = res.data.values ?? [];

  for (let i = 1; i < rows.length; i++) {
    const rowPhone = rows[i][4]; // Phone
    const rowName  = rows[i][2]; // Name
    if (rowPhone === target && !rowName) {
      const rowNumber = i + 1;
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: tabRange(LEADS_TAB, `C${rowNumber}`),
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[name]] },
      });
      return;
    }
  }
}

export async function updateSheetStatus(rowIndex: number, status: string): Promise<void> {
  if (rowIndex < 1) return;
  const sheets = google.sheets({ version: 'v4', auth: auth() });

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: tabRange(SHEET_TAB, `F${rowIndex}`),
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[status]] },
  });
}

export async function updateEnrollmentSheetStatusByPhone(phone: string, status: string): Promise<boolean> {
  try {
    const sheets = google.sheets({ version: 'v4', auth: auth() });
    const cleanPhone = phone.replace(/\D/g, '');
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: tabRange(SHEET_TAB, 'A2:F'),
    });
    const rows = res.data.values ?? [];
    for (let i = 0; i < rows.length; i++) {
      const rowPhone = String(rows[i][2] ?? '').replace(/\D/g, '');
      if (rowPhone && (rowPhone === cleanPhone || rowPhone.endsWith(cleanPhone) || cleanPhone.endsWith(rowPhone))) {
        const rowNum = i + 2;
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: tabRange(SHEET_TAB, `F${rowNum}`),
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [[status]] },
        });
        return true;
      }
    }
  } catch (err) {
    console.error('[google] updateEnrollmentSheetStatusByPhone error:', err);
  }
  return false;
}

// ── Sheet reads — dashboard pages read directly from the Sheet (the sheet is
// the reviewed, editable source of truth for Leads/Discounts/Demo/Enrollments;
// only Chats reflects MongoDB directly). ──────────────────────────────────

export interface SheetLead { name: string; email: string; phone: string; date: string; time: string; status: string }

export async function getLeadsFromSheet(): Promise<SheetLead[]> {
  const sheets = google.sheets({ version: 'v4', auth: auth() });
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: tabRange(LEADS_TAB, 'A2:F'),
    });
    const rows = res.data.values ?? [];
    return rows
      .filter(r => r[4])
      .map(r => ({
        date: r[0] ?? '',
        time: r[1] ?? '',
        name: r[2] ?? '',
        email: r[3] ?? '',
        phone: String(r[4] ?? '').replace(/^\+/, ''),
        status: r[5] ?? '',
      }));
  } catch (err: any) {
    if (err.message?.includes('Unable to parse range')) {
      return [];
    }
    throw err;
  }
}

export interface SheetDiscountRequest {
  name: string; email: string; phone: string; message: string; submitted: string; comment: string;
}

export async function getDiscountRequestsFromSheet(): Promise<SheetDiscountRequest[]> {
  const sheets = google.sheets({ version: 'v4', auth: auth() });
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: tabRange(DISCOUNT_TAB, 'A2:F'),
    });
    const rows = res.data.values ?? [];
    return rows
      .filter(r => r[2])
      .map(r => ({
        name: r[0] ?? '',
        email: r[1] ?? '',
        phone: String(r[2] ?? '').replace(/^\+/, ''),
        message: r[3] ?? '',
        submitted: r[4] ?? '',
        comment: r[5] ?? '',
      }));
  } catch (err: any) {
    if (err.message?.includes('Unable to parse range')) {
      return [];
    }
    throw err;
  }
}

export interface SheetDemoRequest {
  name: string; email: string; phone: string; message: string; submitted: string;
}

export async function getDemoRequestsFromSheet(): Promise<SheetDemoRequest[]> {
  const sheets = google.sheets({ version: 'v4', auth: auth() });
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: tabRange(DEMO_TAB, 'A2:E'),
    });
    const rows = res.data.values ?? [];
    return rows
      .filter(r => r[2])
      .map(r => ({
        name: r[0] ?? '',
        email: r[1] ?? '',
        phone: String(r[2] ?? '').replace(/^\+/, ''),
        message: r[3] ?? '',
        submitted: r[4] ?? '',
      }));
  } catch (err: any) {
    if (err.message?.includes('Unable to parse range')) {
      return [];
    }
    throw err;
  }
}

export interface SheetEnrollment {
  rowIndex: number; name: string; email: string; phone: string;
  submitted: string; driveLink: string; status: string;
}

export async function getEnrollmentsFromSheet(): Promise<SheetEnrollment[]> {
  const sheets = google.sheets({ version: 'v4', auth: auth() });
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: tabRange(SHEET_TAB, 'A2:F'),
    });
    const rows = res.data.values ?? [];
    return rows
      .map((r, i) => ({
        rowIndex: i + 2,
        name: r[0] ?? '',
        email: r[1] ?? '',
        phone: String(r[2] ?? '').replace(/^\+/, ''),
        submitted: r[3] ?? '',
        driveLink: r[4] ?? '',
        status: r[5] || 'Pending',
      }))
      .filter(e => e.phone);
  } catch (err: any) {
    if (err.message?.includes('Unable to parse range')) {
      return [];
    }
    throw err;
  }
}

// Counts for the sidebar nav badges — Leads/Enrollments reflect the sheet, not MongoDB
export async function getSheetNavCounts(): Promise<{ leads: number; enrollments: number }> {
  try {
    const sheets = google.sheets({ version: 'v4', auth: auth() });
    const [leadsRes, enrollRes] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: tabRange(LEADS_TAB, 'E2:E') }).catch(() => ({ data: { values: [] } })),
      sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: tabRange(SHEET_TAB, 'C2:C') }).catch(() => ({ data: { values: [] } })),
    ]);
    const leads       = (leadsRes.data.values ?? []).filter(r => r[0]).length;
    const enrollments = (enrollRes.data.values ?? []).filter(r => r[0]).length;
    return { leads, enrollments };
  } catch (err) {
    console.warn('[google/getSheetNavCounts] Failed to fetch nav counts:', err instanceof Error ? err.message : err);
    return { leads: 0, enrollments: 0 };
  }
}
