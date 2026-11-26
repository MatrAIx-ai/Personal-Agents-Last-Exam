'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.join(__dirname, '..');
const DATE = /^(\d{4})-(\d{2})-(\d{2})T/;
const PARTS = [
  ['a-family-care', 'fixtures/a-family-care'],
  ['a-family-care-later', 'fixtures/a-family-care/later'],
  ['family-care-task', 'examples/task-data/family-care'],
  ['family-care-after', 'examples/task-data/family-care/after'],
  ['b-school-parents', 'fixtures/b-school-parents'],
  ['b-school-parents-later', 'fixtures/b-school-parents/later'],
  ['c-friends', 'fixtures/c-friends'],
  ['c-friends-later', 'fixtures/c-friends/later']
];

function read(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function months() {
  const rows = [];
  for (let year = 2025; year <= 2026; year += 1) {
    for (let month = 1; month <= 12; month += 1) rows.push(year + '-' + String(month).padStart(2, '0'));
  }
  return rows;
}
function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function add(bucket, dates, unrecognized, source, field, instant) {
  if (instant === null || instant === undefined) return 0;
  const match = typeof instant === 'string' ? instant.match(DATE) : null;
  if (!match) {
    unrecognized.push(source + '.' + field);
    return 0;
  }
  const key = match[1] + '-' + match[2];
  if (!bucket[source]) bucket[source] = {};
  bucket[source][key] = (bucket[source][key] || 0) + 1;
  const day = match[1] + '-' + match[2] + '-' + match[3];
  if (!dates[source]) dates[source] = new Set();
  dates[source].add(day);
  dates.all.add(day);
  return 1;
}
function collectSeed(bucket, dates, unrecognized, data, source) {
  let total = 0;
  for (const row of data.label_history || []) total += add(bucket, dates, unrecognized, source, 'label_history.at', row.at);
  for (const notice of data.notices || []) {
    total += add(bucket, dates, unrecognized, source, 'notice.created_at', notice.created_at);
    if (notice.delivery) total += add(bucket, dates, unrecognized, source, 'delivery.recorded_at', notice.delivery.recorded_at);
  }
  for (const group of data.groups || []) {
    total += add(bucket, dates, unrecognized, source, 'group.created_at', group.created_at);
    for (const member of group.members) {
      total += add(bucket, dates, unrecognized, source, 'member.joined_at', member.joined_at);
      if (member.left_at) total += add(bucket, dates, unrecognized, source, 'member.left_at', member.left_at);
      for (const row of member.profile_history || []) total += add(bucket, dates, unrecognized, source, 'profile_history.at', row.at);
      for (const row of member.role_history || []) total += add(bucket, dates, unrecognized, source, 'role_history.at', row.at);
      for (const row of member.membership_intervals || []) {
        total += add(bucket, dates, unrecognized, source, 'membership_intervals.joined_at', row.joined_at);
        if (row.left_at) total += add(bucket, dates, unrecognized, source, 'membership_intervals.left_at', row.left_at);
      }
    }
    for (const item of group.vault_items || []) {
      for (const field of item.fields || []) {
        for (const row of field.history || []) total += add(bucket, dates, unrecognized, source, 'vault_field.history.at', row.at);
      }
    }
    for (const row of (group.note && group.note.history) || []) total += add(bucket, dates, unrecognized, source, 'note.history.at', row.at);
    for (const item of group.checklist || []) {
      for (const row of item.history || []) total += add(bucket, dates, unrecognized, source, 'checklist.history.at', row.at);
    }
    for (const grant of group.grants || []) {
      total += add(bucket, dates, unrecognized, source, 'grant.granted_at', grant.granted_at);
      if (grant.revoked_at) total += add(bucket, dates, unrecognized, source, 'grant.revoked_at', grant.revoked_at);
    }
    for (const reveal of group.reveals || []) total += add(bucket, dates, unrecognized, source, 'reveal.at', reveal.at);
    for (const row of group.activity || []) total += add(bucket, dates, unrecognized, source, 'activity.at', row.at);
    for (const row of group.changes || []) total += add(bucket, dates, unrecognized, source, 'changes.at', row.at);
  }
  return total;
}
function collectMessages(bucket, dates, unrecognized, data, source) {
  let total = 0;
  for (const message of data.messages || []) {
    total += add(bucket, dates, unrecognized, source, 'message.sent_at', message.sent_at);
    for (const edit of message.edits || []) total += add(bucket, dates, unrecognized, source, 'message.edits.at', edit.at);
  }
  return total;
}
function futureProblems(value, clock, trail, problems) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => futureProblems(item, clock, trail + '/' + index, problems));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if ((key === 'expires_at' || key === 'due_at') && (child === null || typeof child === 'string')) continue;
      futureProblems(child, clock, trail + '/' + key, problems);
    }
    return;
  }
  if (typeof value === 'string' && DATE.test(value) && Date.parse(value) > Date.parse(clock)) problems.push(trail);
}
function partition(dir) {
  const clock = read(path.join(dir, 'clock.json')).initial_time;
  const seed = read(path.join(dir, 'seed.json'));
  const messages = read(path.join(dir, 'messages-seed.json'));
  const problems = [];
  futureProblems(seed, clock, 'seed', problems);
  futureProblems(messages, clock, 'messages', problems);
  return {clock, seed, messages, problems, seedFile: path.join(dir, 'seed.json'), messageFile: path.join(dir, 'messages-seed.json')};
}
function report() {
  const parts = {};
  for (const [name, rel] of PARTS) parts[name] = partition(path.join(root, rel));
  const counts = {};
  const dates = {all: new Set()};
  const unrecognized = [];
  let total = 0;
  const sources = [];
  for (const [name, part] of Object.entries(parts)) {
    if (!name.endsWith('-later')) continue;
    total += collectSeed(counts, dates, unrecognized, part.seed, name);
    total += collectMessages(counts, dates, unrecognized, part.messages, name);
    sources.push({
      partition: name,
      seed: path.relative(root, part.seedFile),
      messages: path.relative(root, part.messageFile),
      seed_sha256: sha256(part.seedFile),
      messages_sha256: sha256(part.messageFile)
    });
  }
  const byMonth = {};
  for (const month of months()) byMonth[month] = {};
  for (const [source, rows] of Object.entries(counts)) {
    for (const [month, count] of Object.entries(rows)) {
      if (!byMonth[month]) byMonth[month] = {};
      byMonth[month][source] = count;
    }
  }
  const gaps = months().filter(month => Object.keys(byMonth[month] || {}).length === 0);
  const bodies = {};
  for (const [name, part] of Object.entries(parts)) {
    if (!name.endsWith('-later')) continue;
    const set = new Set((part.messages.messages || []).map(message => message.text));
    bodies[name] = {messages: part.messages.messages.length, distinct_bodies: set.size};
  }
  return {
    zone: 'America/Los_Angeles',
    provenance: 'synthetic',
    window: {start: '2025-01-01', end: '2026-12-31'},
    method: 'The civil date is the year, month, and day written in each timestamp. The generator stores the Pacific offset for that date, so the calendar day is the date in the string.',
    date_fields: [
      'label_history.at', 'group.created_at', 'member.joined_at', 'member.left_at',
      'profile_history.at', 'role_history.at', 'membership_intervals.joined_at', 'membership_intervals.left_at',
      'vault_field.history.at', 'note.history.at', 'checklist.history.at', 'grant.granted_at', 'grant.revoked_at',
      'reveal.at', 'activity.at', 'changes.at', 'notice.created_at', 'delivery.recorded_at', 'message.sent_at', 'message.edits.at'
    ],
    exclusions: [
      'seq counters and ids are not dated records.',
      'expires_at and due_at are deadlines and are omitted from the month counts. The date test still allows them to sit after a fixture clock.',
      'Policies, bindings, clocks, and image bytes are not dated records.',
      'Base fixtures and the task baseline are checked for future timestamps and are omitted from the 24-month totals. The later partitions are the coverage set.'
    ],
    smoke_fixtures: ['fixtures/minimal.json'],
    sources,
    message_bodies: bodies,
    partitions: Object.fromEntries(Object.entries(parts).map(([name, part]) => [name, {
      clock: part.clock,
      future_timestamps: part.problems.length,
      messages: part.messages.messages.length,
      members: part.seed.groups[0].members.length
    }])),
    by_month: byMonth,
    gaps,
    distinct_dates: Object.fromEntries(Object.entries(dates).filter(([name]) => name !== 'all').map(([name, set]) => [name, set.size])),
    global_distinct_dates: dates.all.size,
    total_dated_records: total,
    unrecognized_dates: unrecognized,
    earliest: [...dates.all].sort()[0] || null,
    latest: [...dates.all].sort().slice(-1)[0] || null,
    load_example: 'node examples/read-january.cjs',
    note: 'Later partitions are complete seeds loaded at their own clock. A task that starts on the 13:40 baseline loads examples/task-data/family-care, so December records stay out of that session.'
  };
}
function main() {
  const value = report();
  const file = path.join(root, 'contribution/coverage-report.json');
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
  console.log(JSON.stringify({gaps: value.gaps, months: Object.keys(value.by_month).length, total: value.total_dated_records, bodies: value.message_bodies, unrecognized: value.unrecognized_dates.length}, null, 2));
}
module.exports = {report, futureProblems, partition};
if (require.main === module) main();
