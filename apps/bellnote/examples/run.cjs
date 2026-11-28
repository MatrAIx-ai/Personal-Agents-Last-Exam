'use strict';
// Walkthrough on fresh synthetic data: a guardian reports one child's absence before the
// cut-off, then the office marks both children. The reported day is explained and quiet;
// the unreported one is unexplained and produces one notification.
const assert = require('node:assert/strict');
const {fixture} = require('../tests/harness.cjs');
const f = fixture({now: '2026-11-17T07:10:00-08:00'});
const reportResult = f.call('bellnote.absences.report', {id: 'child-ines', kind: 'absent', start: '2026-11-17', reason: 'Fever'});
f.event({event_id: 'ev-bn-100', at: '2026-11-17T09:15:00-08:00', operation: 'bellnote.attendance.marked',
  payload: {child_id: 'child-ines', date: '2026-11-17', status: 'absent', marked_by: 'staff-office-alder'}});
f.event(require('./scenario.json'));
const attendance = f.call('bellnote.attendance.list', {start: '2026-11-17', end: '2026-11-17'}).records;
const notifications = f.call('bellnote.notifications.list', {start: '2026-11-17', end: '2026-11-17'}).notifications;
assert.deepEqual(attendance.map(a => [a.child_id, a.explanation]), [['child-ines', 'explained'], ['child-theo', 'unexplained']]);
assert.equal(notifications.length, 1);
console.log(JSON.stringify({app: 'bellnote', report: reportResult,
  attendance: attendance.map(a => ({child_id: a.child_id, date: a.date, status: a.status, explanation: a.explanation, report_id: a.report_id})),
  notifications: notifications.map(n => ({kind: n.kind, title: n.title})), activity: f.data.activity}, null, 2));
