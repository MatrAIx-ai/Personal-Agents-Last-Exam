#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const taskRoot = path.resolve(__dirname, '../tasks/grocery-cap-limit-code');
const keel = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../.deps/keelcard/fixtures/minimal.json'), 'utf8'));
const mail = JSON.parse(fs.readFileSync(path.join(taskRoot, 'environment/workspace/mail/seed.json'), 'utf8'));
const fresh = JSON.parse(fs.readFileSync(path.join(taskRoot, 'environment/workspace/freshcart/seed.json'), 'utf8'));
const edits = JSON.parse(fs.readFileSync(path.join(taskRoot, 'environment/workspace/freshcart/list-edits.json'), 'utf8'));
const history = JSON.parse(fs.readFileSync(path.join(taskRoot, 'context/user/history.json'), 'utf8'));
const zone = 'America/New_York';
const firstSession = '2026-11-20T06:10:00-05:00';
const firstMs = Date.parse(firstSession);

function day(iso) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

function collect(label, stamps) {
  const present = stamps.filter(Boolean);
  const malformed = present.filter(iso => Number.isNaN(Date.parse(iso)));
  const valid = present.filter(iso => !Number.isNaN(Date.parse(iso)));
  const kept = valid.filter(iso => Date.parse(iso) < firstMs);
  const excluded = valid.filter(iso => Date.parse(iso) >= firstMs);
  const dates = [...new Set(kept.map(day))].sort();
  return {
    source: label,
    count: kept.length,
    excluded_count: excluded.length,
    malformed_count: malformed.length,
    distinct_dates: dates.length,
    earliest: dates[0] || null,
    latest: dates[dates.length - 1] || null,
    dates,
    excluded_instants: excluded,
    malformed_instants: malformed
  };
}

const listStamps = edits.femi.map(row => row.added_at);
const sources = [
  collect('keelcard.authorizations', keel.authorizations.map(row => row.decided_at)),
  collect('keelcard.declines', (keel.declines || []).map(row => row.decided_at)),
  collect('keelcard.cards', keel.cards.map(row => row.created_at || row.opened_at).filter(Boolean)),
  collect('mail.messages', mail.messages.map(row => row.received_at)),
  collect('freshcart.orders', fresh.orders.map(row => row.confirmed_at)),
  collect('freshcart.list_edits', listStamps),
  collect('memory.records', history.records.map(row => row.at))
];
const keptDates = [...new Set(sources.flatMap(source => source.dates))].sort();
const excluded = sources.flatMap(source => source.excluded_instants);
const report = {
  script: 'tools/history-coverage.cjs',
  time_zone: zone,
  first_session: firstSession,
  cutoff: 'An instant is history when it is earlier than the first session. Calendar dates are not the cutoff.',
  sources: sources.map(({ dates, excluded_instants, malformed_instants, ...rest }) => rest),
  malformed_instants: sources.flatMap(source => source.malformed_instants.map(instant => ({ source: source.source, instant }))),
  global_distinct_dates: keptDates.length,
  earliest: keptDates[0],
  latest: keptDates[keptDates.length - 1],
  excluded_instants: excluded,
  seed_list_lines: fresh.shared_list.length,
  list_edits: {
    count: listStamps.length,
    earliest: listStamps.slice().sort()[0],
    latest: listStamps.slice().sort().slice(-1)[0],
    note: 'The November 18 seed list is empty. The 18 shared-list lines are applied at their 19 November timestamps, before the Friday session.'
  },
  exclusions: [
    'The Friday phishing email and the Saturday substitution are timeline events. They stay out of the history count.',
    'Keelcard weekly captures and FreshCart order summaries share Saturday dates and count once in the global total.',
    'The November 18 seed clock does not contain the 19 November list lines. Those lines are counted from list-edits.json.',
    'The depth is the household seed, the list edits, the proposal memory and the mail. The count stays at that depth.'
  ]
};
const dest = path.join(path.resolve(__dirname, '..'), 'demo/grocery-cap-limit-code/evidence/history-coverage.json');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify({
  distinct: report.global_distinct_dates,
  earliest: report.earliest,
  latest: report.latest,
  excluded: excluded.length,
  seed_list_lines: fresh.shared_list.length
}) + '\n');
