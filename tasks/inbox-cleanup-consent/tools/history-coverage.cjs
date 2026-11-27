#!/usr/bin/env node
'use strict';
// Counts distinct history dates in America/Los_Angeles.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PACKAGE = path.resolve(__dirname, '..');
const TASK = path.join(PACKAGE, 'tasks/inbox-cleanup-consent');
const ZONE = 'America/Los_Angeles';
const CUTOFF = Date.parse('2026-11-16T09:02:00-08:00');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function day(iso) {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(new Date(iso));
  const get = (type) => parts.find((part) => part.type === type).value;
  return get('year') + '-' + get('month') + '-' + get('day');
}

function datesOf(rows) {
  const set = new Set();
  for (const row of rows) set.add(row.day);
  return [...set].sort();
}

function main() {
  const seedPath = path.join(TASK, 'environment/workspace/mail/seed.json');
  const historyPath = path.join(TASK, 'context/user/history.json');
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  const history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
  const mail = [];
  const excluded = [];
  for (const message of seed.messages) {
    const at = Date.parse(message.received_at);
    const row = {id: message.id, day: day(message.received_at), received_at: message.received_at};
    if (at >= CUTOFF) excluded.push(row);
    else mail.push(row);
  }
  const text = history.records.map((row) => ({id: row.id, day: day(row.at), at: row.at, visibility: row.visibility}));
  const futureText = text.filter((row) => Date.parse(row.at) >= CUTOFF);
  const pastText = text.filter((row) => Date.parse(row.at) < CUTOFF);
  const mailDays = datesOf(mail);
  const textDays = datesOf(pastText);
  const global = [...new Set([...mailDays, ...textDays])].sort();
  const report = {
    schema: 'pale.inbox-cleanup.history.v1',
    task_id: 'inbox-cleanup-consent',
    zone: ZONE,
    cutoff: '2026-11-16T09:02:00-08:00',
    cutoff_rule: 'Records at or after the first session are excluded. Date-only records are not used.',
    sources: [
      {
        id: 'mail',
        file: 'tasks/inbox-cleanup-consent/environment/workspace/mail/seed.json',
        sha256: sha256(seedPath),
        date_field: 'received_at',
        records: mail.length,
        distinct_dates: mailDays.length,
        earliest: mailDays[0],
        latest: mailDays[mailDays.length - 1]
      },
      {
        id: 'history',
        file: 'tasks/inbox-cleanup-consent/context/user/history.json',
        sha256: sha256(historyPath),
        date_field: 'at',
        records: pastText.length,
        distinct_dates: textDays.length,
        earliest: textDays[0],
        latest: textDays[textDays.length - 1]
      }
    ],
    excluded: {
      mail_at_or_after_cutoff: excluded.length,
      history_at_or_after_cutoff: futureText.length
    },
    global_distinct_dates: global.length,
    earliest: global[0],
    latest: global[global.length - 1],
    depth: 'The mailbox is the uncleaned inbox. Receipt dates cover the weekdays from 2025-01-02 through 2026-11-13, plus the November 14 and 15 story mail: 489 dates. The April 18 standing instruction falls on a Saturday, which the weekday mailbox does not use, so the global count is 490. The 300-date recommendation is met by the mailbox itself.'
  };
  const out = path.join(PACKAGE, 'demo/inbox-cleanup-consent/evidence/history-coverage.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({
    mail_records: mail.length,
    mail_dates: mailDays.length,
    text_dates: textDays.length,
    global: global.length,
    earliest: report.earliest,
    latest: report.latest,
    excluded: report.excluded
  }));
}

main();
