'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const DATE = /^(\d{4})-(\d{2})-\d{2}T/;

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
function add(bucket, dates, source, instant) {
  const match = typeof instant === 'string' ? instant.match(DATE) : null;
  if (!match) return;
  const key = match[1] + '-' + match[2];
  if (!bucket[source]) bucket[source] = {};
  bucket[source][key] = (bucket[source][key] || 0) + 1;
  const day = instant.slice(0, 10);
  if (!dates[source]) dates[source] = new Set();
  dates[source].add(day);
  dates.all.add(day);
}
function collectSeed(bucket, dates, data, source) {
  add(bucket, dates, source + '.label', data.label_history && data.label_history[0] && data.label_history[0].at);
  for (const group of data.groups || []) {
    add(bucket, dates, source + '.group', group.created_at);
    for (const member of group.members) add(bucket, dates, source + '.member', member.joined_at);
    for (const row of group.note.history) add(bucket, dates, source + '.note', row.at);
    for (const item of group.checklist) add(bucket, dates, source + '.checklist', item.history[0] && item.history[0].at);
    for (const grant of group.grants) add(bucket, dates, source + '.grant', grant.granted_at);
    for (const reveal of group.reveals) add(bucket, dates, source + '.reveal', reveal.at);
    for (const row of group.activity) add(bucket, dates, source + '.activity', row.at);
  }
}
function collectMessages(bucket, dates, data, source) {
  for (const message of data.messages || []) add(bucket, dates, source + '.message', message.sent_at);
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
  return {clock, seed, messages, problems};
}
function report() {
  const parts = {
    'a-family-care': partition(path.join(root, 'fixtures/a-family-care')),
    'a-family-care-later': partition(path.join(root, 'fixtures/a-family-care/later')),
    'family-care-task': partition(path.join(root, 'examples/task-data/family-care')),
    'b-school-parents': partition(path.join(root, 'fixtures/b-school-parents')),
    'b-school-parents-later': partition(path.join(root, 'fixtures/b-school-parents/later')),
    'c-friends': partition(path.join(root, 'fixtures/c-friends')),
    'c-friends-later': partition(path.join(root, 'fixtures/c-friends/later'))
  };
  const counts = {};
  const dates = {all: new Set()};
  for (const [name, part] of Object.entries(parts)) {
    if (!name.endsWith('-later')) continue;
    collectSeed(counts, dates, part.seed, name);
    collectMessages(counts, dates, part.messages, name);
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
  return {
    zone: 'America/Los_Angeles',
    provenance: 'synthetic',
    window: {start: '2025-01-01', end: '2026-12-31'},
    method: 'Civil month is the year and month embedded in each timestamp. The generator writes the Pacific offset for that date.',
    smoke_fixtures: ['fixtures/minimal.json'],
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
    earliest: [...dates.all].sort()[0] || null,
    latest: [...dates.all].sort().slice(-1)[0] || null,
    note: 'Later partitions are complete seeds loaded at their own clock. A task that starts on the base clock loads the base seed, so December records stay out of that session.'
  };
}
function main() {
  const value = report();
  const file = path.join(root, 'contribution/coverage-report.json');
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
  console.log(JSON.stringify({gaps: value.gaps, months: Object.keys(value.by_month).length, partitions: value.partitions}, null, 2));
}
module.exports = {report, futureProblems, partition};
if (require.main === module) main();
