'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');

function read(name) {
  return JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
}

function monthOf(value) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit'}).format(parsed);
  return parts.slice(0, 7);
}

function collect(seed, source) {
  const rows = [];
  for (const post of seed.posts) {
    if (post.published_at) rows.push({source, kind: 'post', at: post.published_at, month: monthOf(post.published_at)});
  }
  for (const note of seed.notes) {
    if (note.published_at) rows.push({source, kind: 'note', at: note.published_at, month: monthOf(note.published_at)});
  }
  for (const edge of seed.follows) rows.push({source, kind: 'follow', at: edge.at, month: monthOf(edge.at)});
  return rows;
}

const sources = [
  ['fixture-a', 'examples/task-data/rejected-pr/seed.json'],
  ['later-2026', 'examples/dataset/later-2026/seed.json']
];
const rows = sources.flatMap(([name, file]) => collect(read(file), name));
const months = [];
for (let year = 2025; year <= 2026; year++) {
  for (let month = 1; month <= 12; month++) months.push(year + '-' + String(month).padStart(2, '0'));
}
const byMonth = Object.fromEntries(months.map(month => [month, {post: 0, note: 0, follow: 0, sources: []}]));
for (const row of rows) {
  const bucket = byMonth[row.month];
  if (!bucket) continue;
  bucket[row.kind] += 1;
  if (!bucket.sources.includes(row.source)) bucket.sources.push(row.source);
}
const empty = months.filter(month => byMonth[month].post + byMonth[month].note + byMonth[month].follow === 0);
const report = {
  timezone: 'America/Los_Angeles',
  coverage: '2025-01-01 through 2026-12-31',
  provenance: 'synthetic',
  anchor: 'Postyard has no external archive. November 2026 is synthetic, the same as every other month.',
  layout: 'Fixture (a) holds history through 2026-02-09T20:40:00-08:00. examples/dataset/later-2026 holds March through December 2026 and is loaded only at its own December clock.',
  months: byMonth,
  empty_months: empty,
  row_count: rows.length
};
const out = path.join(root, 'contribution/coverage.json');
fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({rows: rows.length, empty}, null, 2));
