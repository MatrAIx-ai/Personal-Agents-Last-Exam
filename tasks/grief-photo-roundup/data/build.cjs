'use strict';
// Builds the env.load_seed payloads and the App events for Messages, Files, Calendar, Contacts and Notes
// from data/content.cjs. The photos are drawn here, so the build is reproducible and uses no real images.
// Usage: node tasks/grief-photo-roundup/data/build.cjs   (rewrites data/payloads/*.json)
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const C = require('./content.cjs');

const ROOT = path.resolve(__dirname, '../../..');
const { createRuntime } = require(path.join(ROOT, 'runtime/core/runtime.cjs'));
const { pack } = require(path.join(ROOT, 'runtime/core/data-cli.cjs'));
const REGISTRY = path.join(ROOT, 'apps.registry.json');
const OUT = path.join(__dirname, 'payloads');
const SLUG = 'grief-photo-roundup';
const ELENA = C.P.elena;
const APPS = ['messages', 'files', 'calendar', 'contacts', 'notes'];
const ACC = Object.fromEntries(APPS.map((a) => [a, `${a}-elena`]));
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

// ---------- photos ----------
// A baseline JPEG made of flat 8x8 blocks. Each block needs only a DC value, so the two Huffman tables are tiny:
// DC categories 0 to 8 as 4-bit codes, and one AC symbol (end of block) as a 1-bit code.
function jpegBlocks(colors, bw, bh) {
  const out = [];
  const u16 = (n) => [(n >> 8) & 255, n & 255];
  const seg = (marker, payload) => { out.push(0xff, marker, ...u16(payload.length + 2), ...payload); };
  out.push(0xff, 0xd8);
  seg(0xe0, [0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  seg(0xdb, [0x00, ...Array(64).fill(8)]);
  seg(0xc0, [8, ...u16(bh * 8), ...u16(bw * 8), 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0]);
  seg(0xc4, [0x00, 0, 0, 0, 9, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8]);
  seg(0xc4, [0x10, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x00]);
  seg(0xda, [3, 1, 0x00, 2, 0x00, 3, 0x00, 0, 63, 0]);
  let acc = 0;
  let n = 0;
  const put = (v, len) => {
    for (let i = len - 1; i >= 0; i--) {
      acc = (acc << 1) | ((v >> i) & 1);
      if (++n === 8) { out.push(acc); if (acc === 0xff) out.push(0); acc = 0; n = 0; }
    }
  };
  const prev = [0, 0, 0];
  for (const [r, g, b] of colors) {
    const ycc = [0.299 * r + 0.587 * g + 0.114 * b, 128 - 0.168736 * r - 0.331264 * g + 0.5 * b, 128 + 0.5 * r - 0.418688 * g - 0.081312 * b]
      .map((v) => Math.max(0, Math.min(255, Math.round(v))));
    ycc.forEach((v, c) => {
      const dc = v - 128; // DC of a flat block is 8 * (v - 128); the quantizer is 8
      const diff = dc - prev[c];
      prev[c] = dc;
      let cat = 0;
      while ((1 << cat) <= Math.abs(diff)) cat++;
      put(cat, 4);
      if (cat) put(diff > 0 ? diff : diff + (1 << cat) - 1, cat);
      put(0, 1);
    });
  }
  if (n) { const pad = 8 - n; put((1 << pad) - 1, pad); }
  out.push(0xff, 0xd9);
  return Buffer.from(out);
}

const SIZE = 6; // 6 x 6 blocks, 48 x 48 pixels
// Rows from top to bottom, then accent colors. Simple scenes with no people or faces.
const SCENES = {
  orchard: { rows: [[150, 200, 240], [150, 200, 240], [70, 130, 60], [60, 120, 50], [90, 140, 60], [120, 100, 60]], accents: [[200, 40, 40], [220, 60, 50]] },
  room: { rows: [[225, 215, 195], [225, 215, 195], [200, 190, 170], [70, 140, 140], [150, 110, 80], [130, 95, 70]], accents: [[240, 235, 225]] },
  food: { rows: [[120, 80, 50], [130, 90, 55], [235, 225, 205], [235, 225, 205], [130, 90, 55], [120, 80, 50]], accents: [[220, 170, 60], [170, 90, 40], [200, 60, 40]] },
  field: { rows: [[160, 205, 240], [160, 205, 240], [60, 140, 70], [55, 150, 65], [60, 140, 70], [55, 150, 65]], accents: [[245, 245, 245], [30, 30, 30]] },
  pet: { rows: [[200, 190, 175], [200, 190, 175], [110, 120, 150], [110, 120, 150], [150, 110, 70], [90, 130, 70]], accents: [[230, 200, 150], [120, 80, 50]] },
  pumpkin: { rows: [[170, 200, 230], [170, 200, 230], [110, 130, 60], [120, 110, 50], [130, 100, 50], [120, 90, 45]], accents: [[235, 130, 30], [225, 110, 20]] },
  street: { rows: [[175, 195, 215], [140, 140, 150], [140, 140, 150], [95, 95, 100], [80, 80, 85], [80, 80, 85]], accents: [[200, 40, 40], [240, 220, 60]] },
  grill: { rows: [[90, 150, 80], [90, 150, 80], [70, 70, 75], [50, 50, 55], [150, 120, 90], [150, 120, 90]], accents: [[230, 120, 40], [170, 60, 40]] },
  leaves: { rows: [[185, 205, 225], [150, 100, 50], [210, 130, 40], [225, 160, 50], [200, 110, 40], [140, 100, 60]], accents: [[230, 190, 60], [180, 60, 40]] },
  bath: { rows: [[230, 240, 245], [230, 240, 245], [150, 200, 225], [150, 200, 225], [245, 245, 245], [200, 210, 215]], accents: [[150, 110, 70], [250, 250, 250]] },
  garden: { rows: [[160, 205, 235], [70, 130, 70], [80, 140, 75], [70, 130, 70], [110, 85, 60], [110, 85, 60]], accents: [[160, 70, 150], [230, 200, 60], [200, 80, 60]] },
  costume: { rows: [[60, 50, 80], [60, 50, 80], [90, 70, 120], [90, 70, 120], [140, 110, 80], [140, 110, 80]], accents: [[230, 130, 30], [20, 20, 25]] },
  market: { rows: [[200, 220, 240], [240, 240, 235], [200, 60, 50], [240, 240, 235], [150, 120, 90], [120, 120, 125]], accents: [[230, 140, 40], [90, 150, 70], [150, 60, 120]] },
  bridge: { rows: [[170, 200, 230], [170, 200, 230], [120, 120, 130], [100, 100, 110], [80, 130, 170], [70, 120, 160]], accents: [[230, 225, 215]] },
  lake: { rows: [[196, 205, 200], [196, 205, 200], [120, 130, 105], [110, 140, 160], [100, 130, 155], [185, 165, 125]], accents: [[70, 60, 50]] },
};
function rng(seed) {
  let a = [...seed].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0, 7);
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function photoBytes(p) {
  const s = SCENES[p.scene];
  const r = rng(p.key + p.name);
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const grid = [];
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) grid.push(s.rows[y].map((v) => clamp(v + (r() - 0.5) * 24)));
  // A few accent blocks in the lower two thirds.
  const spots = 2 + Math.floor(r() * 3);
  for (let i = 0; i < spots; i++) {
    const x = Math.floor(r() * SIZE);
    const y = 2 + Math.floor(r() * (SIZE - 2));
    grid[y * SIZE + x] = s.accents[Math.floor(r() * s.accents.length)].map((v) => clamp(v + (r() - 0.5) * 16));
  }
  // A scan of a print has a white border.
  if (p.group === 'reprint') for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (!x || !y || x === SIZE - 1 || y === SIZE - 1) grid[y * SIZE + x] = [246, 244, 238];
  return jpegBlocks(grid, SIZE, SIZE);
}

// ---------- shared ----------
const binding = {
  people: Object.entries(C.NAMES).map(([person_id, name]) => ({ person_id, name })),
  accounts: APPS.map((app_id) => ({ app_id, account_id: ACC[app_id], owner_person_id: ELENA })),
  objects: {},
};
const rec = (app, id, at, action = 'seeded') => ({ id, account_id: ACC[app], created_at: at, updated_at: at, history: [{ at, action }] });
const dataset = (app, records, assets) => ({
  schema_version: 'pale.dataset.v1', dataset_id: `${SLUG}-${app}`, version: '1.0.0',
  description: `Invented records for the PALE task ${SLUG}. No real people, messages or photos.`,
  record_source_ids: ['authored'],
  sources: [{ source_id: 'authored', kind: 'synthetic', description: 'Hand-written story records; photos drawn by data/build.cjs.', uri: null, license: 'MIT', usage: 'permitted', collection: null, generation: { method: 'manual', tool: `tasks/${SLUG}/data/build.cjs`, tool_version: '1.0.0', seed: null, parameters: {} } }],
  transformations: ['Timestamps in New York time with UTC offsets.'],
  expected_counts: { records, assets },
  // Core runs this check after every write of a run too, so an agent that repeats a short text in one turn must not be refused.
  // The build checks the authored records for duplicates itself (see main).
  quality_policy: { duplicate_records: 'allow', duplicate_assets: 'allow', missing_assets: 'allow_declared' },
  review: { status: 'pending', reviewer: null, notes: 'Task data; human review at implementation review.' },
});
const descriptor = (app, asset_id, objectType, objectId, mime, file, bytes, media = {}) => ({
  schema_version: 'pale.asset-descriptor.v1', asset_id, scope: { level: 'package', app_id: app }, roles: ['content.attachment'],
  subjects: [{ app_id: app, account_id: ACC[app], object_type: objectType, object_id: objectId }],
  mime_type: mime, availability: { status: 'ready' }, storage: { adapter: 'storage.file', path: `assets/${file}`, packaging: 'bundled' },
  integrity: { bytes: bytes.length, sha256: sha256(bytes) },
  provenance: { dataset_id: `${SLUG}-${app}`, source_ids: ['authored'] }, publication: 'public',
  access: { audience: ['agent'], rule: 'parent_object' }, media, extensions: [],
});
const IMAGE = { image: { width: SIZE * 8, height: SIZE * 8, animated: false } };

// Every forbidden action is callable (proposal Section 6): files.trash, files.move, calendar.cancel, calendar.update, contacts.update.
const allow = {
  messages: ['messages.list', 'messages.get', 'messages.conversations', 'messages.conversation.create', 'messages.send', 'messages.edit', 'messages.retract', 'messages.mark_read', 'messages.attachment.add', 'messages.attachment.read'],
  files: ['files.list', 'files.get', 'files.read', 'files.mkdir', 'files.put', 'files.move', 'files.trash'],
  calendar: ['calendar.list', 'calendar.get', 'calendar.freebusy', 'calendar.create', 'calendar.update', 'calendar.cancel', 'calendar.export_ics'],
  contacts: ['contacts.list', 'contacts.get', 'contacts.create', 'contacts.update', 'contacts.flags'],
  notes: ['notes.list', 'notes.get', 'notes.create', 'notes.update'],
};
const policies = (app) => ({ scenario: { allow: allow[app], constraints: {} }, sandbox: { allow: allow[app], constraints: {} } });

// ---------- records ----------
const seeded = (at) => Date.parse(at) <= Date.parse(C.SEED_NOW);
const fileId = (p) => `file-${p.key}`;
const assetId = (p) => `photo-${p.key}`;
const BYTES = new Map(C.PHOTOS.map((p) => [p.key, photoBytes(p)]));
const photo = (key) => C.PHOTOS.find((p) => p.key === key);

function messageRecord(m, unread = false) {
  return {
    ...rec('messages', m.id, m.at), conversation_id: C.CONV[m.conv].id, author_person_id: m.from, text: m.text,
    sent_at: m.at, received_at: m.at, read_by: unread ? [m.from] : [...new Set([m.from, ELENA])],
    retracted: false, attachments: m.photos.map((k) => `${m.id}-${k}`), edits: [],
  };
}
function folderRecord(f) {
  return { ...rec('files', f.id, f.at, 'created'), name: f.name, parent_id: f.parent, kind: 'folder', trashed: false, versions: [] };
}
function photoRecord(p) {
  return {
    ...rec('files', fileId(p), p.at, 'uploaded'), name: p.name, parent_id: `fld-week-${p.week}`, kind: 'file', trashed: false,
    versions: [{ number: 1, asset_id: assetId(p), at: p.at, source: `Uploaded by ${C.NAMES[C.P[p.by]]}` }],
  };
}
const photoAsset = (p) => ({ file: p.name, bytes: BYTES.get(p.key), d: descriptor('files', assetId(p), 'file', fileId(p), 'image/jpeg', p.name, BYTES.get(p.key), IMAGE) });

function build(app) {
  const assets = [];
  let seed;
  if (app === 'messages') {
    const msgs = [...C.MESSAGES].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    for (const m of msgs) for (const k of m.photos) {
      const p = photo(k);
      assets.push({ file: p.name, bytes: BYTES.get(k), d: descriptor('messages', `${m.id}-${k}`, 'message', m.id, 'image/jpeg', p.name, BYTES.get(k), IMAGE) });
    }
    seed = {
      account_id: ACC.messages, owner_person_id: ELENA, messages: msgs.map((m) => messageRecord(m)),
      conversations: Object.values(C.CONV).map((c) => ({ id: c.id, title: c.title, participant_ids: c.participants, archived: false })),
    };
  } else if (app === 'files') {
    const files = C.FOLDERS.filter((f) => seeded(f.at)).map(folderRecord);
    for (const f of C.TEXT_FILES) {
      const bytes = Buffer.from(f.text);
      assets.push({ file: f.name, bytes, d: descriptor('files', f.asset, 'file', f.id, 'text/plain', f.name, bytes) });
      files.push({ ...rec('files', f.id, f.at, 'uploaded'), name: f.name, parent_id: f.parent, kind: 'file', trashed: false, versions: [{ number: 1, asset_id: f.asset, at: f.at, source: 'Uploaded by Elena Ruiz' }] });
    }
    for (const p of C.PHOTOS.filter((x) => seeded(x.at))) { assets.push(photoAsset(p)); files.push(photoRecord(p)); }
    seed = { account_id: ACC.files, owner_person_id: ELENA, files };
  } else if (app === 'calendar') {
    seed = {
      account_id: ACC.calendar, owner_person_id: ELENA, calendar_id: 'cal-elena', timezone: 'America/New_York',
      events: C.CALENDAR.map((e) => ({
        id: e.id, uid: e.uid || `${e.id}@ruiz.example`, account_id: ACC.calendar, calendar_id: 'cal-elena', title: e.title, start: e.start, end: e.end,
        timezone: 'America/New_York', organizer_person_id: e.organizer, attendees: e.attendees, location: e.location, status: 'confirmed', sequence: 0,
      })),
    };
  } else if (app === 'contacts') {
    seed = {
      account_id: ACC.contacts, owner_person_id: ELENA,
      contacts: C.CONTACTS.map(([id, person_id, display_name, email, phone, organization, groups, notes]) => ({
        ...rec('contacts', id, '2025-01-05T09:00:00-05:00'), display_name, person_id, emails: [email], phones: phone ? [phone] : [], organization, groups, notes, archived: false,
      })),
    };
  } else if (app === 'notes') {
    seed = {
      account_id: ACC.notes, owner_person_id: ELENA,
      notes: C.NOTES.map((n) => ({ ...rec('notes', n.id, n.at, 'created'), title: n.title, body: n.body, tags: n.tags, pinned: !!n.pinned, archived: false, trashed: false, attachments: [], revisions: [] })),
    };
  }
  return { seed, assets };
}

// Uploads and folders that appear after the seed time. A photo event carries its own bytes;
// the scenario harness adds them to the App's asset bundle when it applies the event.
function fileEvents() {
  const folders = C.FOLDERS.filter((f) => !seeded(f.at)).map((f) => ({ event: { event_id: `evt-${f.id}`, at: f.at, operation: 'files.upsert', payload: folderRecord(f) }, asset: null }));
  const photos = C.PHOTOS.filter((p) => !seeded(p.at)).map((p) => {
    const a = photoAsset(p);
    return { event: { event_id: `evt-${fileId(p)}`, at: p.at, operation: 'files.upsert', payload: photoRecord(p) }, asset: { descriptor: a.d, base64: a.bytes.toString('base64') } };
  });
  return [...folders, ...photos].sort((a, b) => Date.parse(a.event.at) - Date.parse(b.event.at));
}
const messageEvents = () => C.EVENTS.map((e) => ({ event_id: e.event_id, at: e.at, operation: 'messages.upsert', payload: messageRecord(e, true) }));

function main() {
  if (!C.RULES_NOTE.includes(C.RULE_2) || !C.RULES_NOTE.includes(C.RULE_3)) throw new Error('rules note does not contain the approved rules 2 and 3');
  const hashes = [...BYTES.values()].map(sha256);
  if (new Set(hashes).size !== hashes.length) throw new Error('two photos have the same bytes');
  fs.mkdirSync(OUT, { recursive: true });
  const runtime = createRuntime({ registryFile: REGISTRY });
  const summary = {};
  for (const app of APPS) {
    const { seed, assets } = build(app);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `grief-${app}-`));
    fs.mkdirSync(path.join(dir, 'assets'));
    for (const a of assets) fs.writeFileSync(path.join(dir, 'assets', a.file), a.bytes);
    const records = (seed.messages || seed.files || seed.events || seed.contacts || seed.notes).length;
    fs.writeFileSync(path.join(dir, 'seed.json'), JSON.stringify(seed));
    fs.writeFileSync(path.join(dir, 'dataset.json'), JSON.stringify(dataset(app, records, assets.length)));
    fs.writeFileSync(path.join(dir, 'catalog.json'), JSON.stringify({ schema_version: 'pale.asset-catalog.v1', catalog_id: `${SLUG}-${app}-assets`, app_id: app, dataset_ref: 'dataset.json', assets: assets.map((a) => a.d), extensions: [] }));
    fs.writeFileSync(path.join(dir, 'binding.json'), JSON.stringify(binding));
    fs.writeFileSync(path.join(dir, 'policies.json'), JSON.stringify(policies(app)));
    const { payload, quality } = pack(app, dir, runtime);
    if (quality.warnings.some((w) => /^Duplicate/.test(w))) throw new Error(`${app}: ${quality.warnings.filter((w) => /^Duplicate/.test(w)).join(' ')}`);
    fs.writeFileSync(path.join(OUT, `${app}.json`), JSON.stringify(payload) + '\n');
    fs.rmSync(dir, { recursive: true, force: true });
    summary[app] = `${records} records, ${quality.counts.assets} assets, ${quality.counts.total_bytes} bytes`;
  }
  const seededMsgs = JSON.parse(fs.readFileSync(path.join(OUT, 'messages.json'), 'utf8')).data.messages;
  if (seededMsgs.some((x) => !x.read_by.includes(ELENA))) throw new Error('a seeded message is unread by Elena');
  fs.writeFileSync(path.join(OUT, 'messages.events.json'), JSON.stringify(messageEvents(), null, 2) + '\n');
  fs.writeFileSync(path.join(OUT, 'files.events.json'), JSON.stringify(fileEvents(), null, 2) + '\n');
  // The grader identifies photos by this list: file ID, name, bytes and group.
  const photos = C.PHOTOS.map((p) => ({ key: p.key, week: p.week, group: p.group, file_id: fileId(p), name: p.name, sha256: sha256(BYTES.get(p.key)), bytes: BYTES.get(p.key).length }));
  fs.writeFileSync(path.join(OUT, 'photos.json'), JSON.stringify(photos, null, 2) + '\n');
  for (const [k, v] of Object.entries(summary)) console.log(`${k}: ${v}`);
  console.log(`events: ${messageEvents().length} messages, ${fileEvents().length} files; photos: ${photos.length}, ${Math.max(...photos.map((p) => p.bytes))} bytes at most`);
}

if (require.main === module) main();
module.exports = { jpegBlocks, photoBytes, ACC };
