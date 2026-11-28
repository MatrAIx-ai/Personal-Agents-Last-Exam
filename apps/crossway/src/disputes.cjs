'use strict';
// Dispute outcomes. A dispute freezes its notice's fees and due date; a decision
// or a withdrawal releases it.
const R = require('./rules.cjs');
const C = require('./clock.cjs');
const {notify, money} = require('./notices.cjs');
const {history} = require('./settle.cjs');

function reopen(n, d, dueDate, at, action) {
  n.state = d.prior_state;
  n.due_date = dueDate;
  history(n, at, action, {dispute_id: d.id, state: n.state, due_date: n.due_date});
}

function closeDispute(data, d, n, outcome, at, now) {
  d.state = outcome;
  d.decided_at = at;
  if (outcome === 'granted') {
    n.state = 'dismissed';
    history(n, at, 'dismissed', {dispute_id: d.id});
    notify(data, {at, kind: 'dispute_decided', object_type: 'dispute', object_id: d.id,
      title: `Dispute ${d.id} granted: toll notice ${n.id} is dismissed`,
      fields: [['Dispute', d.id], ['Notice', n.id], ['Plate', n.plate], ['Reason', R.REASONS[d.reason].label],
        ['Decision', 'granted'], ['Amount owed', money(0)]]});
    return;
  }
  const due = C.addDays(C.localDate(now), R.policy(data).denial_due_days);
  reopen(n, d, due, at, 'dispute_denied');
  notify(data, {at, kind: 'dispute_decided', object_type: 'dispute', object_id: d.id,
    title: `Dispute ${d.id} denied: ${money(R.noticeAmount(n))} for notice ${n.id} is due by ${due}`,
    fields: [['Dispute', d.id], ['Notice', n.id], ['Plate', n.plate], ['Reason', R.REASONS[d.reason].label],
      ['Decision', 'denied'], ['Notice status', n.state], ['Amount due', money(R.noticeAmount(n))], ['Due date', due]]});
}

function withdraw(data, d, n, at, now) {
  d.state = 'withdrawn';
  d.withdrawn_at = at;
  // The notice gets back the days that remained when the dispute was filed.
  const due = C.addDays(C.localDate(now), d.remaining_days);
  reopen(n, d, due, at, 'dispute_withdrawn');
  notify(data, {at, kind: 'dispute_withdrawn', object_type: 'dispute', object_id: d.id,
    title: `Dispute ${d.id} withdrawn: notice ${n.id} is due by ${due}`,
    fields: [['Dispute', d.id], ['Notice', n.id], ['Notice status', n.state], ['Amount due', money(R.noticeAmount(n))],
      ['Due date', due], ['Note', 'A notice can be disputed once; this notice cannot be disputed again.']]});
}

module.exports = {closeDispute, withdraw};
