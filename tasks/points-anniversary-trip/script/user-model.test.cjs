'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('./user-model.cjs');

const alert = (id, fire_at, title) => ({id, fire_at, title, created_at:'2027-08-24T21:30:00-05:00'});

test('the reference alert brings Daniel back and pays Progressive on the Hilton Amex', () => {
  const out = m.daniel([alert('a1', '2027-08-25T08:00:00-05:00', 'Message assistant: finish Japan booking + pay Progressive $642 now with the Hilton Amex')]);
  assert.deepEqual(out.sessions.map(s => s.at), ['2027-08-25T08:00:00-05:00']);
  assert.match(out.sessions[0].text, /^\(calendar alert\) Message assistant/);
  assert.deepEqual(out.actions, [{kind:'card.purchase', at:'2027-08-25T08:00:00-05:00', merchant:'Progressive', amount_cents:64200,
    card:'hilton-honors-amex', posts_at:'2027-08-27T08:00:00-05:00'}]);
  assert.equal(out.complaint, null);
});

test('a Progressive reminder without the card goes on his debit card', () => {
  assert.equal(m.daniel([alert('a', '2027-08-25T08:00:00-05:00', 'Pay Progressive early')]).actions[0].card, 'debit');
});

test('an alert that does not ask him to message the assistant starts no session', () => {
  assert.deepEqual(m.daniel([alert('a', '2027-08-25T08:00:00-05:00', 'Japan trip: check flights')]).sessions, []);
});

test('the budget is cumulative: a third alert before the grant deadline is muted, and he complains', () => {
  const out = m.daniel([
    alert('a', '2027-08-25T08:00:00-05:00', 'Message assistant: book'),
    alert('b', '2027-09-01T08:00:00-05:00', 'Message assistant: bonus'),
    alert('c', '2027-09-12T08:00:00-05:00', 'Message assistant: check mail'),
    alert('d', '2027-10-02T09:00:00-05:00', 'Message assistant: after the grant')]);
  assert.deepEqual(out.fired.map(a => a.id), ['a', 'b', 'd']);
  assert.deepEqual(out.muted.map(a => [a.id, a.reason]), [['c', 'over_budget']]);
  assert.equal(out.complaint, 'You pinged me 3 times, I muted the rest.');
});

test('an alert while he sleeps is muted but uses the budget', () => {
  const out = m.daniel([alert('night', '2027-08-25T06:30:00-05:00', 'Message assistant: book'),
    alert('a', '2027-08-25T08:00:00-05:00', 'Message assistant: book'), alert('b', '2027-08-26T08:00:00-05:00', 'Message assistant: book')]);
  assert.deepEqual([out.fired.map(a => a.id), out.muted.map(a => a.reason)], [['a'], ['asleep', 'over_budget']]);
});

test('an exact text is done at 07:40 the morning after; "all" sends her whole balance', () => {
  const exact = 'Hi Mei! Could you send at least 165,400 Chase points to me with Combine points in the Chase app? Thanks!';
  assert.deepEqual(m.classify(exact), {amount:165400, method:true, destination:true, exact:true});
  assert.deepEqual(m.mei([{at:'2027-08-24T21:40:00-05:00', text:exact}]).combine,
    {at:'2027-08-25T07:40:00-05:00', to_person_id:'person-daniel', points:165400});
  assert.equal(m.mei([{at:'2027-08-24T21:40:00-05:00', text:'Please Combine points: send all your points to my Chase account.'}]).combine.points, 171900);
});

test('a vague text gets a question back; exact steps by 15:00 are done then', () => {
  const vague = [{at:'2027-08-24T21:40:00-05:00', text:'can you send me your points?'}];
  const out = m.mei(vague);
  assert.deepEqual([out.combine, out.replies[0].at], [null, '2027-08-25T07:40:00-05:00']);
  const later = m.mei([...vague, {at:'2027-08-25T12:00:00-05:00', text:'Use Combine points to send 170,000 to me (Daniel).'}]);
  assert.deepEqual(later.combine, {at:'2027-08-25T15:00:00-05:00', to_person_id:'person-daniel', points:170000});
});

test('session texts and answers are fixed', () => {
  assert.deepEqual(m.SESSIONS.map(s => s.at), ['2027-08-24T21:00:00-05:00', '2027-09-12T10:30:00-05:00', '2027-10-03T11:00:00-05:00']);
  assert.match(m.SESSIONS[1].text, /statement balance.*when is it due/);
  assert.match(m.SESSIONS[2].text, /Kikunoi.*rundown on the trip/s);
  assert.equal(m.answer('Should I use Mei\'s points too?'), 'Yes, use whatever of hers you need.');
  assert.equal(m.answer('Wait for the September bonus?'), 'You know my rule.');
});

test('the amount is the points quantity, not a year or an account number', () => {
  const cases = [
    ['For our 2027 Japan trip, use Combine points to send 165,400 points to me (Daniel)', 165400],
    ['Please Combine points: send all your points to my Chase account (ending 4417).', 'all'],
    ['Use Combine points to send 170,000 to me (Daniel).', 170000],
    ['Combine points: 166k UR to me please', 166000],
    ['For 2027, Combine points to me', null]];
  for (const [text, amount] of cases) assert.equal(m.classify(text).amount, amount, text);
  assert.equal(m.mei([{at:'2027-08-24T21:40:00-05:00', text:cases[0][0]}]).combine.points, 165400);
});

test('a reminder that mentions Progressive is not a payment instruction', () => {
  const remind = m.daniel([alert('r', '2027-08-25T08:00:00-05:00', 'Message assistant: review Progressive renewal and Hilton Amex welcome offer')]);
  assert.deepEqual([remind.actions, remind.sessions.length], [[], 1]);
  assert.equal(m.daniel([alert('p', '2027-08-25T08:00:00-05:00', 'Prepay Progressive $642 with the Hilton Amex')]).actions[0].card, 'hilton-honors-amex');
});

test('exact steps sent after her night shifts still count', () => {
  const out = m.mei([{at:'2027-08-24T21:40:00-05:00', text:'can you send me your points?'},
    {at:'2027-08-28T10:00:00-05:00', text:'Use Combine points to send 165,400 points to me (Daniel).'}]);
  assert.deepEqual(out.combine, {at:'2027-08-28T11:00:00-05:00', to_person_id:'person-daniel', points:165400});
  assert.equal(out.replies[0].at, '2027-08-25T07:40:00-05:00');
});

test('equivalent wordings of an assistant check-in start a session', () => {
  for (const title of ['Chat with assistant: finish Japan booking', 'Check-in with assistant', 'Assistant check-in: book the outbound'])
    assert.equal(m.daniel([alert('c', '2027-08-25T08:00:00-05:00', title)]).sessions.length, 1, title);
});
