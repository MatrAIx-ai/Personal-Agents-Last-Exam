'use strict';
// Boundary tests for the timeline condition predicates (node --test world.test.cjs).
const test = require('node:test'), assert = require('node:assert/strict');
const w = require('./world.cjs');

const msg = (to, at, text, app = 'mail') => ({app, id: 'x' + at, at, recipients: [to], text, subject: 's', thread_id: 't', conversation_id: 'c', attachments: []});
const L = 'person-lindqvist', H = 'person-halvorsen';
const ask = 'Could you write my Vireo Fellowship letter?';
const ev = (cond, out, at, delivered = new Set()) => w.evaluate(cond, {out, at, delivered});

test('Lindqvist agrees only when first asked strictly before 17:00 on Nov 24', () => {
  const c = 'lindqvist_asked_for_vireo_before:2026-11-24T17:00:00-05:00';
  assert.equal(ev(c, [msg(L, '2026-11-24T16:59:00-05:00', ask)], '2026-11-26T13:50:00-05:00').holds, true);
  assert.equal(ev(c, [msg(L, '2026-11-24T17:00:00-05:00', ask)], '2026-11-26T13:50:00-05:00').holds, false);
  assert.equal(ev(c, [msg(L, '2026-11-24T09:10:00-05:00', 'Hope the semester is going well!')], '2026-11-26T13:50:00-05:00').holds, false);
  const d = 'lindqvist_first_asked_for_vireo_at_or_after:2026-11-24T17:00:00-05:00';
  assert.equal(ev(d, [msg(L, '2026-11-24T17:00:00-05:00', ask)], '2026-11-25T10:00:00-05:00').holds, true);
  assert.equal(ev(d, [msg(L, '2026-11-24T16:59:00-05:00', ask), msg(L, '2026-11-26T14:30:00-05:00', ask)], '2026-11-27T10:00:00-05:00').holds, false);
});

test('next 10:00 after the ask (America/New_York, EST)', () => {
  assert.equal(w.next1000After('2026-11-24T09:10:00-05:00'), '2026-11-24T10:00:00-05:00');
  assert.equal(w.next1000After('2026-11-24T17:00:00-05:00'), '2026-11-25T10:00:00-05:00');
  assert.equal(w.next1000After('2026-11-26T14:30:00-05:00'), '2026-11-27T10:00:00-05:00');
  assert.equal(w.next1000After('2026-11-30T10:00:00-05:00'), '2026-12-01T10:00:00-05:00');
  assert.equal(w.next1000After('2026-11-30T14:59:00Z'), '2026-11-30T10:00:00-05:00');
});

test('Halvorsen reply fires on a Vireo request or link, not on "Vireo is covered"', () => {
  const c = 'halvorsen_asked_for_vireo', at = '2026-11-24T16:00:00-05:00';
  assert.equal(ev(c, [msg(H, '2026-11-24T09:10:00-05:00', 'Please send the Kestrel, Northfield and Vireo letters by Dec 1.')], at).holds, true);
  assert.equal(ev(c, [msg(H, '2026-11-24T09:10:00-05:00', 'Links: ' + w.VIREO_URL)], at).holds, true);
  assert.equal(ev(c, [msg(H, '2026-11-24T09:10:00-05:00', 'Kestrel and Northfield are due Dec 1. Vireo is covered, so no need to write for it.')], at).holds, false);
  assert.equal(ev(c, [msg(H, '2026-11-24T16:01:00-05:00', 'Please do the Vireo letter.')], at).holds, false, 'only asks made by the event time count');
});

test('Vireo-Lindqvist status needs agreement and the link strictly before Nov 30 17:00', () => {
  const c = 'lindqvist_agreed_and_had_vireo_link_before:2026-11-30T17:00:00-05:00', at = '2026-12-01T15:05:00-05:00';
  const agreed = new Set(['ev-lindqvist-agrees']);
  assert.equal(ev(c, [msg(L, '2026-11-30T16:59:00-05:00', w.VIREO_URL)], at, agreed).holds, true);
  assert.equal(ev(c, [msg(L, '2026-11-30T17:00:00-05:00', w.VIREO_URL)], at, agreed).holds, false);
  assert.equal(ev(c, [msg(L, '2026-11-24T09:10:00-05:00', w.VIREO_URL)], at, new Set()).holds, false);
});

test('recipients resolve by exact address', () => {
  assert.equal(w.personForAddress('Ingrid.Lindqvist@stat.harrow.example.org'), L);
  assert.equal(w.personForAddress('someone@example.org'), null);
});
