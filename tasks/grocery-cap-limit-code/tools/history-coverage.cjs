#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const taskRoot = path.resolve(__dirname, '../tasks/grocery-cap-limit-code');
const keel = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../.deps/keelcard/fixtures/minimal.json'), 'utf8'));
const mail = JSON.parse(fs.readFileSync(path.join(taskRoot, 'environment/workspace/mail/seed.json'), 'utf8'));
const fresh = JSON.parse(fs.readFileSync(path.join(taskRoot, 'environment/workspace/freshcart/seed.json'), 'utf8'));
const history = JSON.parse(fs.readFileSync(path.join(taskRoot, 'context/user/history.json'), 'utf8'));
const zone = 'America/New_York';
const firstSession = '2026-11-20T06:10:00-05:00';

function day(iso) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

function collect(label, stamps) {
  const dates = stamps.map(day);
  const distinct = [...new Set(dates)].sort();
  return { source: label, count: stamps.length, distinct_dates: distinct.length, earliest: distinct[0], latest: distinct[distinct.length - 1], dates: distinct };
}

const sources = [
  collect('keelcard.authorizations', keel.authorizations.map(row => row.decided_at)),
  collect('keelcard.declines', (keel.declines || []).map(row => row.decided_at)),
  collect('keelcard.cards', keel.cards.map(row => row.created_at || row.opened_at).filter(Boolean)),
  collect('mail.messages', mail.messages.map(row => row.received_at)),
  collect('freshcart.orders', fresh.orders.map(row => row.confirmed_at)),
  collect('memory.records', history.records.map(row => row.at))
];
const all = new Set(sources.flatMap(source => source.dates));
const sorted = [...all].sort();
const late = sorted.filter(date => date >= '2026-11-20');
const report = {
  script: 'tools/history-coverage.cjs',
  time_zone: zone,
  first_session: firstSession,
  sources: sources.map(({ dates, ...rest }) => rest),
  global_distinct_dates: sorted.length,
  earliest: sorted[0],
  latest: sorted[sorted.length - 1],
  dates_on_or_after_first_session: late,
  exclusions: [
    'The Friday phishing email and the Saturday substitution are timeline events. They stay out of the history count.',
    'Keelcard weekly captures and FreshCart order summaries share Saturday dates and count once in the global total.',
    'The depth is the household seed plus the proposal memory and mail. The count was left at that depth.'
  ]
};
const dest = path.join(path.resolve(__dirname, '..'), 'demo/grocery-cap-limit-code/evidence/history-coverage.json');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify({ distinct: report.global_distinct_dates, earliest: report.earliest, latest: report.latest, late: late.length }) + '\n');
