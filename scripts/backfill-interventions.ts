import fs from 'fs';
import path from 'path';

function loadEnv() {
  const envPath = path.resolve(__dirname, '../.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

async function main() {
  loadEnv();
  const { getDb, createHumanIntervention } = await import('../src/lib/redis');
  const db = await getDb();

  console.log('--- Starting Safe Interventions Backfill (Read-Only on existing data) ---');

  // 1. Discount requests
  const discounts = await db.collection('discount_requests').find({}).toArray();
  console.log(`Found ${discounts.length} discount requests.`);
  for (const d of discounts) {
    if (!d.phone) continue;
    const msg = (d.comment || d.message || 'Discount requested').toString();
    await createHumanIntervention({
      phone: d.phone,
      name: d.name || null,
      email: d.email || null,
      category: 'discount',
      reason: `Discount requested: "${msg.trim().slice(0, 100)}"`,
      lastMessage: msg,
      flaggedAt: d.timestamp || Date.now(),
    });
  }

  // 2. Demo requests
  const demos = await db.collection('demo_requests').find({}).toArray();
  console.log(`Found ${demos.length} demo requests.`);
  for (const dm of demos) {
    if (!dm.phone) continue;
    const msg = (dm.message || 'Demo class requested').toString();
    await createHumanIntervention({
      phone: dm.phone,
      name: dm.name || null,
      email: dm.email || null,
      category: 'demo',
      reason: `Demo class requested: "${msg.trim().slice(0, 100)}"`,
      lastMessage: msg,
      flaggedAt: dm.timestamp || Date.now(),
    });
  }

  // 3. Scan messages
  const recentMsgs = await db.collection('wa_messages').find({}).sort({ timestamp: -1 }).limit(2000).toArray();
  console.log(`Scanning recent ${recentMsgs.length} messages for payment and support triggers...`);

  const phones = Array.from(new Set(recentMsgs.map(m => m.from as string)));
  const profiles = await db.collection('contact_profiles').find({ phone: { $in: phones } }).toArray();
  const profileMap = new Map(profiles.map(p => [p.phone as string, p]));

  let msgFlaggedCount = 0;
  for (const m of recentMsgs) {
    const text = (m.text || '').toString();
    const reply = (m.reply || '').toString();
    const t = text.toLowerCase();
    const r = reply.toLowerCase();

    const hasPaymentWord = /\b(paid|payed|payment|pese|paise|transfer|transferred|sent|send|bheje|bhej|bheja|deposit|deposited)\b/i.test(t);
    const hasPastOrTimeClaim = /\b(yesterday|kal|parson|monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|aaj|pehle|already|subah|morning|evening|hours?|days?|hafta|week|date|kar\s*diya|kar\s*diye|ho\s*gayi|ho\s*gaye|deducted|kat\s*gaye)\b/i.test(t);
    const asksHuman = /\b(human|agent|representative|call\s*me|call\s*karo|talk\s*to\s*someone|speak\s*to|complaint|admin|manager)\b/i.test(t);
    const aiFlagged = /\b(flag(ged)?|expedite|admissions?\s*team|forward(ed)?\s*to\s*(our\s*)?management)\b/i.test(r) &&
                      /\b(payment|verification|review|request)\b/i.test(r);

    let shouldFlag = false;
    let category: 'payment' | 'support' | 'other' = 'other';
    let reason = '';

    if (hasPaymentWord && hasPastOrTimeClaim) {
      shouldFlag = true;
      category = 'payment';
      reason = `Claimed past payment: "${text.trim().slice(0, 100)}"`;
    } else if (asksHuman) {
      shouldFlag = true;
      category = 'support';
      reason = `Requested human assistance: "${text.trim().slice(0, 100)}"`;
    } else if (aiFlagged) {
      shouldFlag = true;
      category = 'payment';
      reason = `AI flagged for team review: "${text.trim().slice(0, 100)}"`;
    }

    if (shouldFlag) {
      const profile = profileMap.get(m.from as string);
      await createHumanIntervention({
        phone: m.from as string,
        name: profile?.name || null,
        email: profile?.email || null,
        category,
        reason,
        lastMessage: text,
        flaggedAt: (m.timestamp as number) || Date.now(),
      });
      msgFlaggedCount++;
    }
  }

  console.log(`Scan complete! Flagged ${msgFlaggedCount} message events.`);
  console.log('Done without modifying any original messages or records.');
  process.exit(0);
}

main().catch(err => {
  console.error('Backfill error:', err);
  process.exit(1);
});

