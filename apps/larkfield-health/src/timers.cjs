'use strict';
const { fail, clone, newStep, PROJECTION } = require('./util.cjs');
const { ms, toIso, endOfDay } = require('./time.cjs');
const claims = require('./claims.cjs');
const pa = require('./pa.cjs');
const appeals = require('./appeals.cjs');

const KINDS = ['review', 'request_expiry', 'validity_end', 'pa_due', 'appeal_due', 'window_closing'];
const OPEN_PA = new Set(['pending', 'info_requested']);
const OPEN_APPEAL = new Set(['under_review', 'info_requested']);
const EFFECTS = { review: claims.review, request_expiry: claims.expire, validity_end: pa.validityEnd, pa_due: pa.paDue, appeal_due: appeals.appealDue, window_closing: appeals.windowClosing };

function pending(data) {
  const out = [];
  const add = (kind, id, t, record, type = '') => out.push({ kind, id, t, record, type });
  for (const c of data.claims) if (c.status === 'received') add('review', c.claim_id, ms(c.review_at), c);
  for (const r of data.info_requests) if (r.status === 'open') add('request_expiry', r.info_request_id, ms(r.expires_at), r);
  for (const p of data.pas) {
    if (p.status === 'approved') add('validity_end', p.pa_id, endOfDay(p.approved.valid_until), p);
    if (OPEN_PA.has(p.status) && !p.overdue) add('pa_due', p.pa_id, ms(p.due_at), p);
  }
  for (const a of data.appeals) if (OPEN_APPEAL.has(a.status) && !a.overdue) add('appeal_due', a.appeal_id, ms(a.due_at), a);
  for (const w of data.windows) if (!w.closing.done) add('window_closing', w.target.id, ms(w.closing.due_at), w, w.target.type);
  return out;
}

const text = (a, b) => (a > b) - (a < b);
const order = (a, b) => a.t - b.t || text(a.id, b.id) || KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || text(a.type, b.type);

const dueTimers = (data, now) => pending(data).filter(x => x.t <= ms(now)).sort(order);

function applyDueTimers(data, now, { effects = EFFECTS, code = 'invalid_state' } = {}) {
  const applied = [];
  for (;;) {
    const next = dueTimers(data, now)[0];
    if (!next) break;
    const effect = effects[next.kind];
    if (!effect) fail(code, 'A ' + next.kind + ' timer is due at ' + toIso(next.t) + ', and that timer is not available yet.');
    newStep(data);
    effect(data, next.record, toIso(next.t), next);
    if (pending(data).some(x => x.kind === next.kind && x.record === next.record && x.t === next.t)) fail(code, 'A ' + next.kind + ' timer due at ' + toIso(next.t) + ' did not complete.');
    applied.push({ kind: next.kind, id: next.id, at: toIso(next.t) });
  }
  return applied;
}

function project(data, now, effects = EFFECTS) {
  const copy = clone(data);
  copy[PROJECTION] = true;
  applyDueTimers(copy, now, { effects });
  return copy;
}

module.exports = { KINDS, EFFECTS, pending, dueTimers, applyDueTimers, project };
