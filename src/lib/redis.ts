import { MongoClient, Db } from 'mongodb';

const uri = process.env.MONGODB_URI!;

// Reuse connection across hot-reloads in dev
declare global {
  // eslint-disable-next-line no-var
  var _mongoClient: MongoClient | undefined;
  // eslint-disable-next-line no-var
  var _indexesEnsured: boolean | undefined;
}

function isTopologyClosed(client?: MongoClient): boolean {
  if (!client) return true;
  try {
    const topology = (client as unknown as { topology?: { isDestroyed?: () => boolean; isClosed?: () => boolean; s?: { state?: string } } }).topology;
    if (!topology) return true;
    if (typeof topology.isDestroyed === 'function' && topology.isDestroyed()) return true;
    if (typeof topology.isClosed === 'function' && topology.isClosed()) return true;
    const state = topology.s?.state;
    if (state === 'closed' || state === 'destroying' || state === 'destroyed') return true;
    return false;
  } catch {
    return true;
  }
}

export async function getDb(): Promise<Db> {
  if (!global._mongoClient || isTopologyClosed(global._mongoClient)) {
    if (global._mongoClient) {
      try {
        await global._mongoClient.close(true);
      } catch {
        // ignore close error
      }
      global._mongoClient = undefined;
    }

    const client = new MongoClient(uri, {
      maxPoolSize: 10,
      minPoolSize: 0,
      maxIdleTimeMS: 30000,
      serverSelectionTimeoutMS: 8000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 10000,
    });

    client.on('close', () => {
      console.warn('[MongoDB] Connection closed by remote/Atlas. Clearing cached client.');
      if (global._mongoClient === client) {
        global._mongoClient = undefined;
      }
    });

    client.on('error', (err) => {
      console.warn('[MongoDB] Client error event:', err?.message);
      if (global._mongoClient === client) {
        global._mongoClient = undefined;
      }
    });

    await client.connect();
    global._mongoClient = client;
  }

  const db = global._mongoClient.db('datacrumbs_chatbot');

  // Ensure high-performance indexes in the background once
  if (!global._indexesEnsured) {
    global._indexesEnsured = true;
    Promise.allSettled([
      db.collection('wa_messages').createIndex({ timestamp: -1 }, { background: true }),
      db.collection('wa_messages').createIndex({ from: 1, timestamp: -1 }, { background: true }),
      db.collection('wa_messages').createIndex({ deliveryStatus: 1, timestamp: -1 }, { background: true }),
      db.collection('contact_profiles').createIndex({ phone: 1 }, { background: true }),
      db.collection('enrollment_sessions').createIndex({ phone: 1 }, { background: true }),
    ]).catch(() => {});
  }

  return db;
}

export async function withMongoRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err: unknown) {
    const isClosed = err instanceof Error && (
      err.name === 'MongoTopologyClosedError' ||
      err.message.includes('Topology is closed') ||
      err.message.includes('Client must be connected')
    );
    if (isClosed) {
      console.warn('[MongoDB] Topology closed detected during operation. Reconnecting and retrying...');
      if (global._mongoClient) {
        try { await global._mongoClient.close(true); } catch {}
        global._mongoClient = undefined;
      }
      return await fn();
    }
    throw err;
  }
}

export interface ChatMessage {
  from: string;
  text: string;
  reply: string;
  timestamp: number;
  mediaUrl?: string;               // Drive file ID (payment screenshot)
  mediaType?: 'image' | 'document' | 'audio'; // 'document' = bot sent brochure, 'audio' = voice message
  wamId?: string;                  // Meta WhatsApp message ID
  deliveryStatus?: 'sent' | 'delivered' | 'read' | 'failed';
  deliveryError?: string;
  isPayment?: boolean;
  isDeleted?: boolean;             // Customer deleted message for everyone
}

export async function saveMessage(msg: ChatMessage): Promise<void> {
  const db = await getDb();
  await db.collection('wa_messages').insertOne(msg);
}

export async function markMessageDeleted(wamId?: string, phone?: string): Promise<boolean> {
  const db = await getDb();
  if (wamId) {
    const res = await db.collection('wa_messages').updateOne(
      { wamId },
      { $set: { isDeleted: true, text: '🚫 This message was deleted' } }
    );
    if (res.matchedCount > 0) return true;
  }

  // Fallback: match most recent message from this phone if wamId was not found
  if (phone) {
    const clean = phone.replace(/\D/g, '');
    const doc = await db.collection('wa_messages').findOne(
      { from: { $in: [clean, `+${clean}`, phone] }, isDeleted: { $ne: true } },
      { sort: { timestamp: -1 } }
    );
    if (doc) {
      await db.collection('wa_messages').updateOne(
        { _id: doc._id },
        { $set: { isDeleted: true, text: '🚫 This message was deleted' } }
      );
      return true;
    }
  }
  return false;
}

export async function updateMessageDeliveryStatus(
  recipientPhone: string,
  status: 'sent' | 'delivered' | 'read' | 'failed',
  wamId?: string,
  errorMsg?: string
): Promise<void> {
  const db = await getDb();
  const update: Record<string, unknown> = { deliveryStatus: status };
  if (status === 'failed') {
    update.deliveryError = errorMsg || 'Message delivery failed';
  } else {
    update.deliveryError = null;
  }

  if (wamId) {
    const res = await db.collection('wa_messages').updateOne({ wamId }, { $set: update });
    if (res.matchedCount > 0) return;
  }

  // Fallback: match by recipient phone on most recent outgoing message (text === '')
  const clean = recipientPhone.replace(/\D/g, '');
  const doc = await db.collection('wa_messages').findOne(
    { from: { $in: [clean, `+${clean}`, recipientPhone] }, text: '' },
    { sort: { timestamp: -1 } }
  );
  if (doc) {
    await db.collection('wa_messages').updateOne({ _id: doc._id }, { $set: update });
  }
}

export async function getMessages(limit = 300, since?: number): Promise<ChatMessage[]> {
  const db = await getDb();
  const filter: Record<string, unknown> = {};
  if (since && !isNaN(since) && since > 0) {
    filter.timestamp = { $gt: since };
  }
  const docs = await db
    .collection<ChatMessage>('wa_messages')
    .find(filter, {
      projection: {
        _id: 0,
        from: 1,
        text: 1,
        reply: 1,
        timestamp: 1,
        mediaType: 1,
        mediaUrl: 1,
        wamId: 1,
        deliveryStatus: 1,
        deliveryError: 1,
        isPayment: 1,
        isDeleted: 1,
      },
    })
    .sort({ timestamp: -1 })
    .limit(limit)
    .toArray();
  return docs as ChatMessage[];
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
  // Follow-up group trigger
  followUpGroupSent?: boolean;
  followUpGroupSentAt?: number;
  // Chat summarization cache for sales CRM
  chatSummary?: string;
  chatSummaryMsgCount?: number;
  chatSummaryUpdatedAt?: number;
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

export interface NavCounts { chats: number; leads: number; enrollments: number; interventions: number; }

export async function getNavCounts(): Promise<NavCounts> {
  const db = await getDb();
  const [phones, enrollments, interventions] = await Promise.all([
    db.collection('wa_messages').distinct('from'),
    db.collection('enrollment_sessions').countDocuments(),
    db.collection('human_interventions').countDocuments({ status: 'pending' }),
  ]);
  // Chats and Leads currently derive from the same distinct-contact set
  return { chats: phones.length, leads: phones.length, enrollments, interventions };
}

export async function hasPriorMessages(phone: string): Promise<boolean> {
  const db  = await getDb();
  const doc = await db.collection('wa_messages').findOne({ from: phone }, { projection: { _id: 1 } });
  return !!doc;
}

export async function getInactiveUnpaidContacts(
  minInactivityMs = 12 * 60 * 60 * 1000, // 12 hours
  maxAgeMs = 23 * 60 * 60 * 1000,        // 23 hours (safely inside Meta's 24-hr window)
): Promise<ContactProfile[]> {
  const db = await getDb();
  const now = Date.now();
  const minTime = now - maxAgeMs;
  const maxTime = now - minInactivityMs;

  const contacts = await db
    .collection<ContactProfile>('contact_profiles')
    .find({
      updatedAt: { $gte: minTime, $lte: maxTime },
      botDisabled: { $ne: true },
      followUpGroupSent: { $ne: true },
    })
    .toArray();

  return contacts.map(({ _id, ...rest }) => rest as ContactProfile);
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

export async function getMessagesByPhone(phone: string, limit = 250): Promise<ChatMessage[]> {
  const db = await getDb();
  const clean = phone.replace(/\D/g, '');
  const variants = [phone, clean];
  if (clean.startsWith('0')) variants.push('92' + clean.slice(1));
  else if (clean.startsWith('92')) variants.push('0' + clean.slice(2));
  else if (clean.startsWith('3')) {
    variants.push('92' + clean);
    variants.push('0' + clean);
  }

  const msgs = await db
    .collection<ChatMessage>('wa_messages')
    .find({ from: { $in: variants } }, {
      projection: {
        _id: 0,
        from: 1,
        text: 1,
        reply: 1,
        timestamp: 1,
        mediaType: 1,
        mediaUrl: 1,
        wamId: 1,
        deliveryStatus: 1,
        deliveryError: 1,
        isPayment: 1,
        isDeleted: 1,
      },
    })
    .sort({ timestamp: -1 })
    .limit(limit)
    .toArray();

  return msgs as ChatMessage[];
}

export async function getConversationsList(limit = 200): Promise<{ phone: string; name?: string | null; lastMessage: ChatMessage; messageCount: number }[]> {
  const db = await getDb();
  const raw = await db.collection('wa_messages').aggregate<{
    _id: string;
    lastMessage: ChatMessage;
    messageCount: number;
  }>([
    { $sort: { timestamp: -1 } },
    {
      $group: {
        _id: '$from',
        lastMessage: { $first: '$$ROOT' },
        messageCount: { $sum: 1 },
      },
    },
    { $sort: { 'lastMessage.timestamp': -1 } },
    { $limit: limit },
  ]).toArray();

  const phones = raw.map(r => r._id);
  const nameMap = await getContactNamesMap(phones);

  return raw.map(r => ({
    phone: r._id,
    name: nameMap.get(r._id) || null,
    lastMessage: {
      from: r.lastMessage.from,
      text: r.lastMessage.text,
      reply: r.lastMessage.reply,
      timestamp: r.lastMessage.timestamp,
      mediaType: r.lastMessage.mediaType,
      mediaUrl: r.lastMessage.mediaUrl,
      deliveryStatus: r.lastMessage.deliveryStatus,
      deliveryError: r.lastMessage.deliveryError,
      isPayment: r.lastMessage.isPayment,
      isDeleted: r.lastMessage.isDeleted,
    },
    messageCount: r.messageCount,
  }));
}

export interface FailedDelivery {
  phone: string;
  name?: string | null;
  text: string;
  reply: string;
  timestamp: number;
  deliveryError: string;
  wamId?: string;
  errorCategory: '24h_window' | 'invalid_phone' | 'policy_block' | 'rate_limit' | 'other';
}

export async function getFailedDeliveries(limit = 250): Promise<FailedDelivery[]> {
  const db = await getDb();
  const docs = await db.collection<ChatMessage>('wa_messages')
    .find({ deliveryStatus: 'failed' }, {
      projection: {
        _id: 0,
        from: 1,
        text: 1,
        reply: 1,
        timestamp: 1,
        deliveryStatus: 1,
        deliveryError: 1,
        wamId: 1,
      },
    })
    .sort({ timestamp: -1 })
    .limit(limit)
    .toArray();

  const phones = Array.from(new Set(docs.map(d => d.from)));
  const nameMap = await getContactNamesMap(phones);

  return docs.map(d => {
    const err = d.deliveryError || 'Message delivery failed (Meta error)';
    let errorCategory: FailedDelivery['errorCategory'] = 'other';
    const lower = err.toLowerCase();
    if (lower.includes('24 hour') || lower.includes('131047') || lower.includes('re-engagement') || lower.includes('outside')) {
      errorCategory = '24h_window';
    } else if (lower.includes('not a valid') || lower.includes('not registered') || lower.includes('131026') || lower.includes('invalid number') || lower.includes('undeliverable')) {
      errorCategory = 'invalid_phone';
    } else if (lower.includes('policy') || lower.includes('spam') || lower.includes('131048') || lower.includes('blocked') || lower.includes('opt')) {
      errorCategory = 'policy_block';
    } else if (lower.includes('rate limit') || lower.includes('130429') || lower.includes('throughput')) {
      errorCategory = 'rate_limit';
    }

    return {
      phone: d.from,
      name: nameMap.get(d.from) || null,
      text: d.text,
      reply: d.reply,
      timestamp: d.timestamp,
      deliveryError: err,
      wamId: d.wamId,
      errorCategory,
    };
  });
}

export async function getFailedDeliveriesCount(): Promise<number> {
  const db = await getDb();
  return db.collection('wa_messages').countDocuments({ deliveryStatus: 'failed' });
}

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

const nameCache = new Map<string, { name: string; cachedAt: number }>();
const NAME_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export async function getContactNamesMap(phones: string[]): Promise<Map<string, string>> {
  if (phones.length === 0) return new Map();

  const map = new Map<string, string>();
  const uncachedPhones: string[] = [];
  const now = Date.now();

  for (const phone of phones) {
    const cached = nameCache.get(phone);
    if (cached && (now - cached.cachedAt) < NAME_CACHE_TTL_MS) {
      if (cached.name) map.set(phone, cached.name);
    } else {
      uncachedPhones.push(phone);
    }
  }

  // If all requested phones are in cache, return immediately (0ms, 0 DB queries!)
  if (uncachedPhones.length === 0) {
    return map;
  }

  const db = await getDb();
  const proj = { projection: { phone: 1, name: 1, collectedName: 1 } };

  const [profiles, enrollments, interventions, demos, discounts] = await Promise.all([
    db.collection('contact_profiles').find({ phone: { $in: uncachedPhones } }, proj).toArray(),
    db.collection('enrollment_sessions').find({ phone: { $in: uncachedPhones } }, proj).toArray(),
    db.collection('human_interventions').find({ phone: { $in: uncachedPhones } }, proj).toArray(),
    db.collection('demo_requests').find({ phone: { $in: uncachedPhones } }, proj).toArray(),
    db.collection('discount_requests').find({ phone: { $in: uncachedPhones } }, proj).toArray(),
  ]);

  for (const doc of enrollments) {
    if (doc.name && typeof doc.name === 'string' && doc.name.trim()) map.set(doc.phone as string, doc.name.trim());
  }
  for (const doc of demos) {
    const n = (doc.name || doc.collectedName) as string | undefined;
    if (n && typeof n === 'string' && n.trim()) map.set(doc.phone as string, n.trim());
  }
  for (const doc of discounts) {
    const n = (doc.name || doc.collectedName) as string | undefined;
    if (n && typeof n === 'string' && n.trim()) map.set(doc.phone as string, n.trim());
  }
  for (const doc of interventions) {
    if (doc.name && typeof doc.name === 'string' && doc.name.trim()) map.set(doc.phone as string, doc.name.trim());
  }
  for (const doc of profiles) {
    if (doc.name && typeof doc.name === 'string' && doc.name.trim()) map.set(doc.phone as string, doc.name.trim());
  }

  // Populate cache for newly fetched phones
  for (const phone of uncachedPhones) {
    const foundName = map.get(phone) || '';
    nameCache.set(phone, { name: foundName, cachedAt: now });
  }

  return map;
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
  const doc = await db.collection('enrollment_sessions').findOne({ phone });
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

export interface StoredBrochure {
  data?: Buffer;
  filename: string;
  uploadedAt: number;
  size?: number;
  whatsappMediaId?: string;
  whatsappMediaUploadedAt?: number;
  driveUrl?: string;
  driveFileId?: string;
}

export async function saveBrochure(
  buffer: Buffer,
  filename: string,
  extra?: { driveUrl?: string; driveFileId?: string; whatsappMediaId?: string; size?: number }
): Promise<void> {
  const db = await getDb();
  const value: Record<string, unknown> = {
    filename,
    uploadedAt: Date.now(),
    size: extra?.size ?? buffer.length,
    whatsappMediaId: extra?.whatsappMediaId,
    whatsappMediaUploadedAt: extra?.whatsappMediaId ? Date.now() : undefined,
    driveUrl: extra?.driveUrl,
    driveFileId: extra?.driveFileId,
  };
  // Only store buffer in MongoDB if <= 4MB
  if (buffer.length <= 4 * 1024 * 1024) {
    value.data = buffer.toString('base64');
  }
  await db.collection('settings').updateOne(
    { key: 'brochure' },
    { $set: { value } },
    { upsert: true }
  );
}

export async function updateBrochureMediaId(mediaId: string): Promise<void> {
  const db = await getDb();
  await db.collection('settings').updateOne(
    { key: 'brochure' },
    { $set: { 'value.whatsappMediaId': mediaId, 'value.whatsappMediaUploadedAt': Date.now() } },
    { upsert: true }
  );
}

export async function getBrochure(): Promise<StoredBrochure | null> {
  const db  = await getDb();
  const doc = await db.collection('settings').findOne({ key: 'brochure' });
  if (!doc?.value) return null;
  const val = doc.value;
  return {
    data: val.data ? Buffer.from(val.data as string, 'base64') : undefined,
    filename: (val.filename as string) || 'DataCrumbs-Bootcamp-Brochure.pdf',
    uploadedAt: (val.uploadedAt as number) || Date.now(),
    size: val.size as number | undefined,
    whatsappMediaId: val.whatsappMediaId as string | undefined,
    whatsappMediaUploadedAt: val.whatsappMediaUploadedAt as number | undefined,
    driveUrl: val.driveUrl as string | undefined,
    driveFileId: val.driveFileId as string | undefined,
  };
}

// ── Human Interventions ───────────────────────────────────────────────────

export interface HumanIntervention {
  phone: string;
  name?: string | null;
  email?: string | null;
  category: 'payment' | 'discount' | 'demo';
  reason: string;
  lastMessage: string;
  flaggedAt: number;
  status: 'pending' | 'resolved';
  resolvedAt?: number;
}

export async function createHumanIntervention(data: {
  phone: string;
  name?: string | null;
  email?: string | null;
  category: 'payment' | 'discount' | 'demo';
  reason: string;
  lastMessage: string;
  flaggedAt?: number;
}): Promise<void> {
  const db = await getDb();
  await db.collection('human_interventions').updateOne(
    { phone: data.phone, status: 'pending' },
    {
      $set: {
        phone: data.phone,
        name: data.name || null,
        email: data.email || null,
        category: data.category,
        reason: data.reason,
        lastMessage: data.lastMessage,
        flaggedAt: data.flaggedAt || Date.now(),
        status: 'pending',
      },
    },
    { upsert: true }
  );
}

export async function getPendingInterventions(): Promise<HumanIntervention[]> {
  const db = await getDb();
  const docs = await db.collection('human_interventions')
    .find({
      status: 'pending',
      category: { $in: ['payment', 'discount', 'demo'] },
    })
    .sort({ flaggedAt: -1 })
    .toArray();
  return docs.map(({ _id, ...rest }) => rest as unknown as HumanIntervention);
}

export async function getAllInterventions(limit = 100): Promise<HumanIntervention[]> {
  const db = await getDb();
  // Automatically clean up non-standard or previous false-positive entries from human_interventions
  try {
    await db.collection('human_interventions').deleteMany({
      $or: [
        { category: { $nin: ['payment', 'discount', 'demo'] } },
        { lastMessage: /^[\w.+-]+@[\w-]+\.[\w.-]+$/i },
        { lastMessage: /how\s*(can|do)\s*i\s*pay/i },
        { lastMessage: /will\s*make\s*payment\s*by\s*evening/i },
      ],
    });
  } catch {
    // ignore
  }

  const docs = await db.collection('human_interventions')
    .find({
      category: { $in: ['payment', 'discount', 'demo'] },
    })
    .sort({ flaggedAt: -1 })
    .limit(limit)
    .toArray();
  return docs.map(({ _id, ...rest }) => rest as unknown as HumanIntervention);
}

export async function resolveIntervention(phone: string): Promise<void> {
  const db = await getDb();
  await db.collection('human_interventions').updateMany(
    { phone, status: 'pending' },
    { $set: { status: 'resolved', resolvedAt: Date.now() } }
  );
}

export async function getPendingInterventionsCount(): Promise<number> {
  const db = await getDb();
  return await db.collection('human_interventions').countDocuments({
    status: 'pending',
    category: { $in: ['payment', 'discount', 'demo'] },
  });
}

// ── Intervention Backfill Helper ───────────────────────────────────────────
// Scans wa_messages for payment claims and returns matched items.
// READ-ONLY on wa_messages and contact_profiles. Never modifies them.
export interface BackfillMessageMatch {
  phone: string;
  name?: string | null;
  email?: string | null;
  category: 'payment';
  reason: string;
  lastMessage: string;
  flaggedAt: number;
}

export async function scanMessagesForInterventions(limit = 2000): Promise<BackfillMessageMatch[]> {
  const db = await getDb();

  // Newest first — so for any given phone, the first match we encounter is their LATEST message!
  const msgs = await db.collection('wa_messages')
    .find({})
    .sort({ timestamp: -1 })
    .limit(limit)
    .toArray();

  const phones = Array.from(new Set(msgs.map((m: Record<string, unknown>) => m.from as string)));
  const profiles = await db.collection('contact_profiles').find({ phone: { $in: phones } }).toArray();
  const profileMap = new Map<string, { name?: string; email?: string }>(
    profiles.map((p: Record<string, unknown>) => [
      p.phone as string,
      { name: (p.name as string | undefined), email: (p.email as string | undefined) },
    ])
  );

  const seenPhones = new Set<string>();
  const matches: BackfillMessageMatch[] = [];

  for (const m of msgs) {
    const phone = m.from as string;
    if (!phone || seenPhones.has(phone)) continue;

    const text = ((m.text || '') as string).trim();
    const reply = ((m.reply || '') as string);
    if (!text || text === '[image]') continue;
    const t = text.toLowerCase();
    const r = reply.toLowerCase();

    // 1. Ignore pure emails
    if (/^[\w.+-]+@[\w-]+\.[\w.-]+$/i.test(t)) continue;
    // 2. Ignore asking how to pay
    if (/\b(how\s*(can|do)\s*i\s*pay|how\s*to\s*pay|where\s*to\s*pay|tarika|payment\s*method|payment\s*details)\b/i.test(t)) continue;
    // 3. Ignore future payment intentions ("will pay evening", "kal karunga")
    if (/\b(will\s*(pay|send|transfer)|karunga|karungi|kal\s*(karunga|bhejunga)|evening\s*today|sham\s*ko)\b/i.test(t)) continue;

    // Check past payment claim:
    const hasPastPaymentClaim = /\b(already\s*paid|made\s*payment|payment\s*done|paid\s*on|pese\s*(bhej|kar)\s*diye|transfer\s*kar\s*diya|kar\s*diye\s*the|deducted|kat\s*gaye)\b/i.test(t) ||
      (/\b(paid|transferred|sent|bheje|bhej|deposit)\b/i.test(t) && /\b(yesterday|kal|parson|monday|tuesday|wednesday|thursday|friday|saturday|sunday|today\s*morning|aaj\s*subah|hours?\s*ago|already)\b/i.test(t));

    // Check if bot explicitly escalated or redirected to support:
    const botRedirectedToSupport = /\b(reach\s*out\s*to\s*our\s*support\s*team\s*directly|contact\s*our\s*support\s*team|let\s*me\s*flag\s*your\s*.*payment|expedite\s*your\s*verification)\b/i.test(r) &&
      /\b(payment|verification)\b/i.test(r);

    let reason = '';
    if (hasPastPaymentClaim) {
      reason = `Claimed past payment: "${text.slice(0, 100)}"`;
    } else if (botRedirectedToSupport) {
      reason = `Bot redirected to support / escalated: "${text.slice(0, 100)}"`;
    } else {
      continue;
    }

    seenPhones.add(phone);
    const profile = profileMap.get(phone);
    matches.push({
      phone,
      name: profile?.name || null,
      email: profile?.email || null,
      category: 'payment',
      reason,
      lastMessage: text,
      flaggedAt: (m.timestamp as number) || Date.now(),
    });
  }

  return matches;
}
