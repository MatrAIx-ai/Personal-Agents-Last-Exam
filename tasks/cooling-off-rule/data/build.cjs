'use strict';
// Builds the env.load_seed payloads for Mail and Calendar from data/content.cjs.
// Usage: node tasks/cooling-off-rule/data/build.cjs   (rewrites the JSON files next to this script)
const fs = require('node:fs');
const path = require('node:path');
const C = require('./content.cjs');

const MIRA = 'mira.chen@kestrel.example';
const addr = (s) => (s.match(/<([^>]+)>/) || [null, s])[1];
const name = (s) => (s.match(/^([^<]+)</) || [null, s])[1].trim();

function people() {
  const seen = new Map();
  for (const v of Object.values(C.P)) seen.set(addr(v), name(v));
  return [...seen].map(([person_id, n]) => ({ person_id, name: n }));
}

const binding = {
  people: people(),
  accounts: [
    { app_id: 'mail', account_id: 'mail-mira', owner_person_id: MIRA },
    { app_id: 'calendar', account_id: 'calendar-mira', owner_person_id: MIRA },
  ],
  objects: { calendar: C.CAL.map((e) => e.id) },
};

const threadOf = (subject) => 'thr-' + subject.replace(/^(re|fwd):\s*/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function message(m, folder) {
  const out = {
    id: m.id,
    thread_id: threadOf(m.subject),
    account_id: 'mail-mira',
    from: addr(m.from),
    to: m.to.map(addr),
    subject: m.subject,
    body: m.body,
    received_at: m.at,
    folder,
    read: folder !== 'inbox' || m.at < '2026-10-14T18:00',
    attachments: [],
  };
  if (folder === 'sent') out.sent_at = m.at;
  return out;
}

const mailSeed = {
  account_id: 'mail-mira',
  owner_person_id: MIRA,
  address: MIRA,
  messages: [
    ...C.EMAILS.map((m) => message(m, m.folder === 'reading' ? 'archive' : m.folder)),
    ...C.DRAFTS.map((m) => message(m, 'drafts')),
  ],
};

const mailEvents = C.EVENTS.map((m) => ({
  event_id: 'evt-' + m.id,
  at: m.at,
  operation: 'mail.deliver',
  payload: message(m, m.folder === 'reading' ? 'archive' : m.folder),
}));

const calSeed = {
  account_id: 'calendar-mira',
  owner_person_id: MIRA,
  calendar_id: 'cal-mira',
  timezone: 'America/Chicago',
  events: C.CAL.map((e) => ({
    id: e.id,
    uid: `${e.id}@kestrel.example`,
    account_id: 'calendar-mira',
    calendar_id: 'cal-mira',
    title: e.title,
    start: e.start,
    end: e.end,
    timezone: 'America/Chicago',
    organizer_person_id: addr(e.organizer),
    attendees: e.attendees.map((n) => binding.people.find((p) => p.name === n).person_id),
    location: e.location || (e.kind === 'personal' ? '' : 'Room 4B / video'),
    status: 'confirmed',
    sequence: 0,
  })),
};

// Every forbidden action stays callable: no id or field constraints.
const mailTools = ['mail.search', 'mail.get', 'mail.draft.create', 'mail.draft.update', 'mail.send', 'mail.trash', 'mail.move', 'mail.flags.update'];
const calTools = ['calendar.list', 'calendar.get', 'calendar.freebusy', 'calendar.create', 'calendar.update', 'calendar.cancel'];
const policies = (allow) => ({ scenario: { allow, constraints: {} }, sandbox: { allow, constraints: {} } });

const out = {
  'binding.json': binding,
  'mail.seed.json': mailSeed,
  'mail.events.json': mailEvents,
  'mail.policies.json': policies(mailTools),
  'calendar.seed.json': calSeed,
  'calendar.policies.json': policies(calTools),
};
for (const [file, value] of Object.entries(out)) fs.writeFileSync(path.join(__dirname, file), JSON.stringify(value, null, 2) + '\n');
console.log(`messages ${mailSeed.messages.length}, events ${mailEvents.length}, calendar ${calSeed.events.length}, people ${binding.people.length}`);
