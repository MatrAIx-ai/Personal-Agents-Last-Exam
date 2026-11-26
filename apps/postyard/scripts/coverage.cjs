'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');

function read(name) {
  return JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
}

function calendarDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit'}).format(parsed);
}

function monthOf(value) {
  const date = calendarDate(value);
  return date ? date.slice(0, 7) : null;
}

function collect(seed, source) {
  const rows = [];
  function push(kind, at) {
    const date = calendarDate(at);
    rows.push({source, kind, at: at || null, month: date ? date.slice(0, 7) : null, date});
  }
  for (const post of seed.posts || []) push('post', post.published_at);
  for (const note of seed.notes || []) push('note', note.published_at);
  for (const edge of seed.follows || []) push('follow', edge.at);
  return rows;
}

function summarize(rows) {
  const months = [];
  for (let year = 2025; year <= 2026; year += 1) {
    for (let month = 1; month <= 12; month += 1) months.push(year + '-' + String(month).padStart(2, '0'));
  }
  const byMonth = Object.fromEntries(months.map(month => [month, {post: 0, note: 0, follow: 0, sources: {}}]));
  const included = [];
  const excluded = [];
  const sources = {};
  for (const row of rows) {
    const date = row.date || calendarDate(row.at);
    const month = date ? date.slice(0, 7) : null;
    const bucket = month && byMonth[month];
    const entry = sources[row.source] || (sources[row.source] = {rows: 0, dates: new Set(), excluded: 0});
    if (!date || !bucket) {
      excluded.push(row);
      entry.excluded += 1;
      continue;
    }
    included.push({...row, date, month});
    entry.rows += 1;
    entry.dates.add(date);
    bucket[row.kind] += 1;
    const source = bucket.sources[row.source] || (bucket.sources[row.source] = {post: 0, note: 0, follow: 0, dates: new Set()});
    source[row.kind] += 1;
    source.dates.add(date);
  }
  const dates = [...new Set(included.map(row => row.date))].sort();
  for (const month of months) {
    for (const source of Object.values(byMonth[month].sources)) source.distinct_dates = source.dates.size;
    for (const source of Object.values(byMonth[month].sources)) delete source.dates;
  }
  const source_totals = Object.fromEntries(Object.entries(sources).map(([name, item]) => [name, {rows: item.rows, distinct_dates: item.dates.size, excluded: item.excluded}]));
  return {
    months: byMonth,
    empty_months: months.filter(month => byMonth[month].post + byMonth[month].note + byMonth[month].follow === 0),
    source_totals,
    row_count: included.length,
    excluded_count: excluded.length,
    earliest: dates[0] || null,
    latest: dates[dates.length - 1] || null,
    distinct_dates: dates.length
  };
}

function sourceHash(file) {
  const bytes = fs.readFileSync(path.join(root, file));
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function reportFor(files) {
  const rows = files.flatMap(item => collect(read(item.file), item.name));
  const summary = summarize(rows);
  return {
    timezone: 'America/Los_Angeles',
    coverage: '2025-01-01 through 2026-12-31',
    provenance: 'synthetic',
    anchor: 'Postyard has no external archive. November 2026 is synthetic, the same as every other month.',
    layout: 'Fixture (a) holds history through 2026-02-09. Fixture (b) is the June embargo sample. examples/dataset/later-2026 holds March through December 2026 and loads at its own December clock. The smoke seed is included in the source hashes.',
    source_hashes: Object.fromEntries(files.map(item => [item.name, sourceHash(item.file)])),
    ...summary
  };
}

const FILES = [
  {name: 'fixture-a', file: 'examples/task-data/rejected-pr/seed.json'},
  {name: 'fixture-b', file: 'examples/task-data/embargo/seed.json'},
  {name: 'later-2026', file: 'examples/dataset/later-2026/seed.json'},
  {name: 'smoke', file: 'fixtures/minimal.json'}
];

function outputPath(argv) {
  const flag = argv.indexOf('--output');
  if (flag >= 0 && argv[flag + 1]) return path.resolve(argv[flag + 1]);
  return path.join(root, 'contribution/coverage.json');
}

if (require.main === module) {
  const report = reportFor(FILES);
  const out = outputPath(process.argv);
  fs.mkdirSync(path.dirname(out), {recursive: true});
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({rows: report.row_count, excluded: report.excluded_count, empty: report.empty_months, output: out}, null, 2));
}

module.exports = {collect, summarize, reportFor, monthOf, calendarDate};
