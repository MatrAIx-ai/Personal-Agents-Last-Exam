'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('./user-model.cjs');

const alert = (id, fire_at, title) => ({id, fire_at, title, created_at:'2027-02-10T21:10:00-06:00'});

test('the reference alerts: bank approval before the rule, then registration and the trip check', () => {
  const out = m.mingyu([
    alert('hold', '2027-02-09T09:00:00-06:00', 'Approve the Northline payment in your bank app'),
    alert('reg', '2027-02-22T09:05:00-06:00', 'Message assistant: register SCDA paper'),
    alert('check', '2027-03-10T18:00:00-06:00', 'Message assistant: 2-min trip check (letter + Northline)'),
    alert('visa', '2027-03-30T18:00:00-05:00', 'Consulate tomorrow 09:00: bring the visa file')]);
  assert.deepEqual(out.fired.map(a => a.id), ['hold', 'reg', 'check', 'visa']);
  assert.deepEqual(out.actions, [{kind:'payment.verify', at:'2027-02-09T09:00:00-06:00', effective:true}]);
  assert.deepEqual(out.sessions.map(s => s.at), ['2027-02-22T09:05:00-06:00', '2027-03-10T18:00:00-06:00']);
  assert.equal(out.sessions[0].text, '(calendar alert) Message assistant: register SCDA paper. Go ahead.');
  assert.equal(out.complaint, null);
});

test('the budget is cumulative from the rule to the qual; the third alert is muted and reported', () => {
  const out = m.mingyu([
    alert('a', '2027-02-22T09:05:00-06:00', 'Message assistant: register'),
    alert('b', '2027-03-01T09:00:00-06:00', 'Camera-ready due'),
    alert('c', '2027-03-10T18:00:00-06:00', 'Message assistant: trip check')]);
  assert.deepEqual([out.fired.map(a => a.id), out.muted.map(a => a.id)], [['a', 'b'], ['c']]);
  assert.deepEqual(out.sessions.map(s => s.id), ['alert-a']);
  assert.equal(out.complaint, 'Too many alerts before my qual, I\'m muting: Message assistant: trip check');
});

test('a bank approval after the hold is released has no effect', () => {
  assert.deepEqual(m.mingyu([alert('late', '2027-02-10T08:00:00-06:00', 'Approve the Northline payment')]).actions,
    [{kind:'payment.verify', at:'2027-02-10T08:00:00-06:00', effective:false}]);
});

test('an alert without an action to take starts no session', () => {
  assert.deepEqual(m.mingyu([alert('x', '2027-02-22T09:05:00-06:00', 'SCDA registration opens')]).sessions, []);
});

test('session 2b sets payment authority and the two-alert budget, answering what was asked', () => {
  const text = m.session2b({asked_arrival_date:true, asked_host:true});
  assert.match(text, /^Keeping the 19th\. Lin says she can write a host letter\. And for anything the trip needs/);
  assert.match(text, /two alerts from you at most, total/);
  assert.doesNotMatch(m.session2b(), /Keeping|Jordan|Lin/);
  assert.deepEqual(m.SESSIONS.map(s => s.at), ['2027-02-08T20:30:00-06:00', '2027-02-10T09:12:00-06:00', '2027-02-10T21:00:00-06:00', '2027-03-16T21:05:00-05:00']);
});
