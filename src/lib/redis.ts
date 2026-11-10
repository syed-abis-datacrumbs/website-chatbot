import { MongoClient, Db } from 'mongodb';

const uri = process.env.MONGODB_URI!;

// Reuse connection across hot-reloads in dev
declare global {
  // eslint-disable-next-line no-var
  var _mongoClient: MongoClient | undefined;
}

async function getDb(): Promise<Db> {
  if (!global._mongoClient) {
    global._mongoClient = new MongoClient(uri);
    await global._mongoClient.connect();
  }
  return global._mongoClient.db('datacrumbs_chatbot');
}

export interface ChatMessage {
  from: string;
  text: string;
  reply: string;
  timestamp: number;
  mediaUrl?: string;               // Drive file ID (payment screenshot)
  mediaType?: 'image' | 'document'; // 'document' = bot sent brochure
}

export async function saveMessage(msg: ChatMessage): Promise<void> {
  const db = await getDb();
  await db.collection('wa_messages').insertOne(msg);
}

export async function getMessages(): Promise<ChatMessage[]> {
  const db = await getDb();
  const docs = await db
    .collection<ChatMessage>('wa_messages')
    .find({})
    .sort({ timestamp: -1 })
    .limit(500)
    .toArray();
  return docs.map(({ _id, ...rest }) => rest as ChatMessage);
}

// ── Contact Profiles (name + name-ask tracking) ───────────────────────────────

export interface ContactProfile {
  phone: string;
  name?: string;
  email?: string;
  nameAsked: boolean;
  botDisabled: boolean;
  updatedAt: number;
  // Discount collection state
  discountOfferPending?: boolean; // waiting for yes/no on "should we forward this?"
  discountPending?: boolean;      // confirmed — now collecting name/email
  discountOriginalMessage?: string;
  discountCollectedName?: string;
  discountCollectedEmail?: string;
  // True once a discount_requests record exists for this contact — later price
  // pushback/negotiation messages update that record instead of restarting the offer flow
  hasSubmittedDiscountRequest?: boolean;
  // Demo class collection state — simpler than discount: no yes/no offer step,
  // goes straight to collecting name/email once a demo request is detected
  demoPending?: boolean;
  demoOriginalMessage?: string;
  demoCollectedName?: string;
  demoCollectedEmail?: string;
  hasSubmittedDemoRequest?: boolean;
  // True right after we've sent a "you're welcome, anything else?" style closing reply
  lastReplyWasClosing?: boolean;
  // Automated AI Bootcamp Funnel State
  bootcampLead?: boolean;
  bootcampGoal?: string;
  bootcampLeadPending?: boolean; // Waiting for student's background/current role reply
  bootcampBackground?: string;
}

export async function getContactProfile(phone: string): Promise<ContactProfile | null> {
  const db  = await getDb();
  const doc = await db.collection('contact_profiles').findOne({ phone });
  return doc ? (doc as unknown as ContactProfile) : null;
}

export async function saveContactProfile(data: Partial<ContactProfile> & { phone: string }): Promise<void> {
  const db = await getDb();
  await db.collection('contact_profiles').updateOne(
    { phone: data.phone },
    { $set: { ...data, updatedAt: Date.now() } },
    { upsert: true },
  );
}

export async function deleteAllMessages(): Promise<number> {
  const db = await getDb();
  const result = await db.collection('wa_messages').deleteMany({});
  // Also clear per-contact state (name, discount flags, enrollment progress)
  // so a wiped chat is a true fresh start, not just an empty message list.
  await db.collection('contact_profiles').deleteMany({});
  await db.collection('enrollment_sessions').deleteMany({});
  await db.collection('lead_sync_tracker').deleteMany({});
  return result.deletedCount;
}

export async function deleteMessagesByPhone(phone: string): Promise<number> {
  const db = await getDb();
  const result = await db.collection('wa_messages').deleteMany({ from: phone });
  await db.collection('contact_profiles').deleteOne({ phone });
  await db.collection('enrollment_sessions').deleteMany({ phone });
  await db.collection('lead_sync_tracker').deleteOne({ phone });
  return result.deletedCount;
}

export interface NavCounts { chats: number; leads: number; enrollments: number }

export async function getNavCounts(): Promise<NavCounts> {
  const db = await getDb();
  const [phones, enrollments] = await Promise.all([
    db.collection('wa_messages').distinct('from'),
    db.collection('enrollment_sessions').countDocuments(),
  ]);
  // Chats and Leads currently derive from the same distinct-contact set
  return { chats: phones.length, leads: phones.length, enrollments };
}

export async function hasPriorMessages(phone: string): Promise<boolean> {
  const db  = await getDb();
  const doc = await db.collection('wa_messages').findOne({ from: phone }, { projection: { _id: 1 } });
  return !!doc;
}

// Atomically claims "this phone is a brand-new lead" — used ONLY to gate the
// agent-leads sheet write. A plain read-then-write check (hasPriorMessages)
// has a race window: two near-simultaneous messages from a genuinely new
// contact (a fast double-send, or a webhook retry) could both see "no prior
// messages" and both write a lead row. findOneAndUpdate with $setOnInsert on
// a phone-uniquely-indexed collection is atomic — MongoDB serializes
// concurrent upserts on the same key, so only the call that actually created
// the record gets true back; every other caller (racing or not) gets false.
export async function claimNewLead(phone: string): Promise<boolean> {
  const db = await getDb();
  const result = await db.collection('lead_sync_tracker').findOneAndUpdate(
    { phone },
    { $setOnInsert: { phone, firstSeenAt: Date.now() } },
    { upsert: true, returnDocument: 'before' },
  );
  return result === null; // null "before" doc = we just created it, i.e. genuinely new
}

export async function getRecentMessagesByPhone(phone: string, limit = 10): Promise<ChatMessage[]> {
  const db = await getDb();
  const docs = await db
    .collection<ChatMessage>('wa_messages')
    .find({ from: phone })
    .sort({ timestamp: -1 })
    .limit(limit)
    .toArray();
  // Return oldest-first so history flows chronologically
  return docs.reverse().map(({ _id, ...rest }) => rest as ChatMessage);
}

export async function getSystemPrompt(): Promise<string | null> {
  const db  = await getDb();
  const doc = await db.collection('settings').findOne({ key: 'system_prompt' });
  return (doc?.value as string) ?? null;
}

export async function saveSystemPrompt(prompt: string): Promise<void> {
  const db = await getDb();
  await db.collection('settings').updateOne(
    { key: 'system_prompt' },
    { $set: { value: prompt } },
    { upsert: true }
  );
}

// ── Analytics ──────────────────────────────────────────────────────────────

export interface DayCount { date: string; count: number; }

export interface Stats {
  totalMessages: number;
  todayMessages: number;
  totalContacts: number;
  todayContacts: number;
  last7Days: DayCount[];
  todayHours: number[]; // 24 elements, index = PKT hour
}

// PKT = UTC+5, no DST
const PKT_MS = 5 * 60 * 60 * 1000;

function pktDateKey(tsMs: number): string {
  // Shift timestamp to PKT then format as YYYY-MM-DD using ISO slice
  return new Date(tsMs + PKT_MS).toISOString().slice(0, 10);
}

export async function getStats(): Promise<Stats> {
  const db = await getDb();
  const col = db.collection('wa_messages');

  // PKT midnight for "today" (floor current PKT time to the day)
  const nowMs = Date.now();
  const todayStartPKT = Math.floor((nowMs + PKT_MS) / 86400000) * 86400000 - PKT_MS;
  const weekAgo = todayStartPKT - 6 * 86400000;

  const [totalMessages, allFrom, todayFrom, weekDocs, todayDocs] = await Promise.all([
    col.countDocuments(),
    col.distinct('from'),
    col.distinct('from', { timestamp: { $gte: todayStartPKT } }),
    col.find({ timestamp: { $gte: weekAgo } }, { projection: { timestamp: 1, _id: 0 } }).toArray(),
    col.find({ timestamp: { $gte: todayStartPKT } }, { projection: { timestamp: 1, _id: 0 } }).toArray(),
  ]);

  // Group last-7-days by PKT date in JavaScript (avoids $dateToString timezone issues)
  const dayMap = new Map<string, number>();
  for (const doc of weekDocs) {
    const key = pktDateKey(doc.timestamp as number);
    dayMap.set(key, (dayMap.get(key) ?? 0) + 1);
  }

  const last7Days: DayCount[] = Array.from({ length: 7 }, (_, i) => {
    const key = pktDateKey(weekAgo + i * 86400000);
    return { date: key, count: dayMap.get(key) ?? 0 };
  });

  // Group today's messages by PKT hour (0-23)
  const todayHours = new Array<number>(24).fill(0);
  for (const doc of todayDocs) {
    const pktHour = Math.floor(((doc.timestamp as number) + PKT_MS) / (60 * 60 * 1000)) % 24;
    todayHours[pktHour]++;
  }

  return {
    totalMessages,
    todayMessages: todayDocs.length,
    totalContacts: allFrom.length,
    todayContacts: todayFrom.length,
    last7Days,
    todayHours,
  };
}

// ── Leads ──────────────────────────────────────────────────────────────────

export interface Lead {
  phone: string;
  name?: string;
  firstContact: number;
  lastContact: number;
  messageCount: number;
}

export async function getLeads(): Promise<Lead[]> {
  const db  = await getDb();
  const raw = await db.collection('wa_messages').aggregate<{
    _id: string; firstContact: number; lastContact: number; messageCount: number;
  }>([
    {
      $group: {
        _id:          '$from',
        firstContact: { $min: '$timestamp' },
        lastContact:  { $max: '$timestamp' },
        messageCount: { $sum: 1 },
      },
    },
    { $sort: { lastContact: -1 } },
  ]).toArray();

  const phones = raw.map(r => r._id);
  const [profiles, enrollments] = await Promise.all([
    db.collection('contact_profiles').find({ phone: { $in: phones } }).toArray(),
    db.collection('enrollment_sessions').find({ phone: { $in: phones } }).toArray(),
  ]);

  const nameMap = new Map<string, string>();
  for (const e of enrollments) if (e.name) nameMap.set(e.phone as string, e.name as string);
  for (const p of profiles)    if (p.name) nameMap.set(p.phone as string, p.name as string);

  return raw.map(r => ({
    phone:        r._id,
    name:         nameMap.get(r._id),
    firstContact: r.firstContact,
    lastContact:  r.lastContact,
    messageCount: r.messageCount,
  }));
}

// ── Discount Requests ──────────────────────────────────────────────────────

export interface DiscountRequest {
  phone: string;
  name: string;
  email?: string;
  message: string;
  timestamp: number;
  comment?: string; // latest follow-up / negotiation note ("can only pay 4k")
}

export async function saveDiscountRequest(data: DiscountRequest): Promise<void> {
  const db = await getDb();
  await db.collection('discount_requests').insertOne(data);
}

export async function getDiscountRequests(): Promise<DiscountRequest[]> {
  const db   = await getDb();
  const docs = await db
    .collection<DiscountRequest>('discount_requests')
    .find({})
    .sort({ timestamp: -1 })
    .toArray();
  return docs.map(({ _id, ...rest }) => rest as DiscountRequest);
}

// Updates the most recent discount request for this phone with a follow-up comment
// (e.g. a later counter-offer like "can only pay 4k"), instead of creating a new record.
export async function updateDiscountRequestComment(phone: string, comment: string): Promise<void> {
  const db = await getDb();
  await db.collection('discount_requests').findOneAndUpdate(
    { phone },
    { $set: { comment } },
    { sort: { timestamp: -1 } },
  );
}

// ── Demo Requests ─────────────────────────────────────────────────────────

export interface DemoRequest {
  phone: string;
  name: string;
  email?: string;
  message: string;
  timestamp: number;
}

export async function saveDemoRequest(data: DemoRequest): Promise<void> {
  const db = await getDb();
  await db.collection('demo_requests').insertOne(data);
}

export async function getDemoRequests(): Promise<DemoRequest[]> {
  const db   = await getDb();
  const docs = await db
    .collection<DemoRequest>('demo_requests')
    .find({})
    .sort({ timestamp: -1 })
    .toArray();
  return docs.map(({ _id, ...rest }) => rest as DemoRequest);
}

// ── Bot Config ─────────────────────────────────────────────────────────────

export interface BotConfig {
  brochureUrl:    string;
  batchStartDate: string;
  batchEndDate:   string;
  nextBatchNote:  string;
}

const DEFAULT_CONFIG: BotConfig = {
  brochureUrl:    '/brochure.pdf',
  batchStartDate: '',
  batchEndDate:   '',
  nextBatchNote:  '',
};

export async function getBotConfig(): Promise<BotConfig> {
  const db  = await getDb();
  const doc = await db.collection('settings').findOne({ key: 'bot_config' });
  return doc ? (doc.value as BotConfig) : DEFAULT_CONFIG;
}

export async function saveBotConfig(config: BotConfig): Promise<void> {
  const db = await getDb();
  await db.collection('settings').updateOne(
    { key: 'bot_config' },
    { $set: { value: config } },
    { upsert: true }
  );
}

// ── Enrollment Sessions ────────────────────────────────────────────────────

export type EnrollmentState =
  | 'collecting_name'
  | 'collecting_email'
  | 'awaiting_screenshot'
  | 'screenshot_received'
  | 'approved'
  | 'rejected';

export interface EnrollmentSession {
  phone: string;
  state: EnrollmentState;
  name: string | null;
  email: string | null;
  driveFileId: string | null;
  driveFileUrl: string | null;
  sheetRowIndex: number | null;
  createdAt: number;
  updatedAt: number;
}

export async function getActiveEnrollmentSession(phone: string): Promise<EnrollmentSession | null> {
  const db  = await getDb();
  const doc = await db.collection('enrollment_sessions').findOne({
    phone,
    state: { $nin: ['rejected'] },
  });
  return doc ? (doc as unknown as EnrollmentSession) : null;
}

export async function saveEnrollmentSession(session: EnrollmentSession): Promise<void> {
  const db = await getDb();
  await db.collection('enrollment_sessions').updateOne(
    { phone: session.phone },
    { $set: { ...session, updatedAt: Date.now() } },
    { upsert: true },
  );
}

export async function getAllEnrollments(): Promise<EnrollmentSession[]> {
  const db   = await getDb();
  const docs = await db.collection('enrollment_sessions')
    .find({})
    .sort({ createdAt: -1 })
    .toArray();
  return docs as unknown as EnrollmentSession[];
}

export async function updateEnrollmentState(
  phone: string,
  state: EnrollmentState,
): Promise<void> {
  const db = await getDb();
  await db.collection('enrollment_sessions').updateOne(
    { phone },
    { $set: { state, updatedAt: Date.now() } },
  );
}

// ── Brochure ───────────────────────────────────────────────────────────────

export async function saveBrochure(buffer: Buffer, filename: string): Promise<void> {
  const db = await getDb();
  await db.collection('settings').updateOne(
    { key: 'brochure' },
    { $set: { value: { data: buffer.toString('base64'), filename, uploadedAt: Date.now() } } },
    { upsert: true }
  );
}

export async function getBrochure(): Promise<{ data: Buffer; filename: string; uploadedAt: number } | null> {
  const db  = await getDb();
  const doc = await db.collection('settings').findOne({ key: 'brochure' });
  if (!doc?.value?.data) return null;
  return {
    data:       Buffer.from(doc.value.data as string, 'base64'),
    filename:   doc.value.filename as string,
    uploadedAt: doc.value.uploadedAt as number,
  };
}
