'use strict';
const { newStep, byId } = require('./util.cjs');
const { ms, toIso, rxExpiry } = require('./time.cjs');
const L = require('./lifecycle.cjs');

const KIND_ORDER = ['expiry', 'review', 'resubmission', 'warning', 'return', 'collector'];

function dueTimers(data, now) {
  const limit = ms(now), due = [];
  for (const f of data.fills) {
    if (L.TERMINAL.has(f.state)) {
      if (f.collector && f.collector.via_grant_id !== null) collectorTimer(data, f, limit, due);
      continue;
    }
    const held = f.hold !== null, rx = L.rxOf(data, f);
    if (L.UNMADE.has(f.state)) {
      const expiry = rxExpiry(rx.written_on);
      if (expiry <= limit) due.push({ kind: 'expiry', fill: f, t: expiry });
    }
    if (!held && f.state === 'requested' && f.review_due_at !== null && ms(f.review_due_at) <= limit) due.push({ kind: 'review', fill: f, t: ms(f.review_due_at) });
    if (!held && f.state === 'claim_rejected' && f.resubmission_due_at !== null && ms(f.resubmission_due_at) <= limit) due.push({ kind: 'resubmission', fill: f, t: ms(f.resubmission_due_at) });
    if (!held && f.state === 'ready' && f.warning_due_at !== null && ms(f.warning_due_at) <= limit) due.push({ kind: 'warning', fill: f, t: ms(f.warning_due_at) });
    if (!held && f.state === 'ready' && f.return_due_at !== null && ms(f.return_due_at) <= limit) due.push({ kind: 'return', fill: f, t: ms(f.return_due_at) });
    if (f.collector && f.collector.via_grant_id !== null) collectorTimer(data, f, limit, due);
  }
  return due.sort((a, b) => a.t - b.t || (a.fill.fill_id < b.fill.fill_id ? -1 : a.fill.fill_id > b.fill.fill_id ? 1 : 0) || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
}

function collectorTimer(data, f, limit, due) {
  const g = byId(data.grants, 'grant_id', f.collector.via_grant_id);
  if (g && g.expires_at !== null && ms(g.expires_at) <= limit) due.push({ kind: 'collector', fill: f, t: ms(g.expires_at) });
}

function apply(data, timer) {
  const f = timer.fill, at = toIso(timer.t);
  if (timer.kind === 'expiry') return L.cancel(data, f, at, 'rx_expired');
  if (timer.kind === 'review') return L.review(data, f, at);
  if (timer.kind === 'resubmission') return L.resubmit(data, f, at);
  if (timer.kind === 'warning') return L.warn(data, f, at);
  if (timer.kind === 'return') return L.returnToStock(data, f, at);
  f.collector = null;
}

function applyDueTimers(data, now) {
  const applied = [];
  for (let guard = 0; ; guard++) {
    const next = dueTimers(data, now)[0];
    if (!next) break;
    if (guard > 100000) throw new Error('Timer catch-up does not terminate.');
    newStep(data);
    apply(data, next);
    applied.push({ kind: next.kind, fill_id: next.fill.fill_id, at: toIso(next.t) });
  }
  newStep(data);
  return applied;
}

module.exports = { dueTimers, applyDueTimers, KIND_ORDER };
