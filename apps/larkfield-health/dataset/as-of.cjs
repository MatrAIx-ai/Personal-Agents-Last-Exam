'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const plugin = require('../plugin.cjs');
const { ms, toIso, endOfDay } = require('../src/time.cjs');
const { applyDueTimers, project } = require('../src/timers.cjs');
const { eventTargets } = require('../src/guards.cjs');
const { relation, inForceAt } = require('../src/authority.cjs');
const { appealable } = require('../src/appeals.cjs');
const lib = require('./lib.cjs');

const OPEN_PA = ['pending', 'info_requested'], OPEN_APPEAL = ['under_review', 'info_requested'];
const OWNER = lib.OWNER;
const compact = iso => new Date(ms(iso)).toISOString().replace(/[-:]/g, '');
const digest = (data, at) => crypto.createHash('sha256').update(JSON.stringify({ virtual_now: at, data: { ...data, seed_id: null } })).digest('hex').slice(0, 12);
const selectionId = (data, at) => lib.SEED_IDS.asOf + compact(at) + '-' + digest(data, at);
const idsOf = data => new Set([...data.appeals.map(a => a.appeal_id), ...data.grants.map(g => g.grant_id)]);
const prefix = id => id.replace(/-\d+$/, '');
const ctxFor = at => ({ app_id: lib.APP, virtual_now: at, binding: lib.BINDING });

function stageable(data, step) {
  if (step.by !== 'infra') return false;
  try { eventTargets(data, lib.envelope(step), ctxFor(step.at)); } catch { return false; }
  return true;
}

function effect(data, step) {
  const p = step.payload, t = ms(step.at);
  const pa = () => data.pas.find(x => x.pa_id === p.pa_id), appeal = () => data.appeals.find(x => x.appeal_id === p.appeal_id);
  switch (step.operation) {
    case 'claim.received': return data.claims.some(c => c.claim_id === p.claim_id) ? 'duplicate' : 'received';
    case 'pa.submitted': {
      if (data.pas.some(x => x.pa_id === p.pa_id || x.covered_submissions.some(s => s.pa_id === p.pa_id))) return 'duplicate';
      const cover = data.pas.filter(x => x.status === 'approved' && x.member_id === p.member_id && x.service_id === p.service_id && x.approved.valid_from <= p.valid_from && p.valid_until <= x.approved.valid_until && x.approved.units - x.units_used >= p.units)
        .sort((a, b) => (a.approved.valid_until + '|' + a.pa_id < b.approved.valid_until + '|' + b.pa_id ? -1 : 1))[0];
      return cover ? 'covered by ' + cover.pa_id : 'pending';
    }
    case 'pa.info_requested': return pa().status === 'pending' ? 'info_requested' : 'ignored';
    case 'pa.info_provided': return pa().status === 'info_requested' ? 'pending' : 'ignored';
    case 'pa.withdrawn': return OPEN_PA.includes(pa().status) ? 'withdrawn' : 'ignored';
    case 'pa.decided': return !OPEN_PA.includes(pa().status) ? 'ignored' : p.decision === 'denied' ? 'denied' : endOfDay(p.valid_until) <= t ? 'expired' : 'approved';
    case 'pa.expedite_decided': return OPEN_PA.includes(pa().status) && pa().expedite && pa().expedite.status === 'open' ? 'expedite ' + p.decision : 'ignored';
    case 'appeal.info_requested': return appeal().status === 'under_review' ? 'info_requested' : 'ignored';
    case 'appeal.decided': return OPEN_APPEAL.includes(appeal().status) ? p.outcome : 'ignored';
    case 'grant.changed': {
      const g = data.grants.find(x => x.grant_id === p.grant_id);
      if (p.status === 'revoked') return g && g.status === 'active' && inForceAt(g, t) ? 'revoked' : 'ignored';
      return g ? 'updated' : 'created';
    }
    default: return 'applied';
  }
}

function observed(before, after, step) {
  const p = step.payload;
  switch (step.operation) {
    case 'claim.received': return after.claims.some(c => c.claim_id === p.claim_id) ? 'received' : 'unchanged';
    case 'pa.submitted': { const covered = after.pas.find(x => x.covered_submissions.some(s => s.pa_id === p.pa_id)); return covered ? 'covered by ' + covered.pa_id : after.pas.some(x => x.pa_id === p.pa_id) ? 'pending' : 'unchanged'; }
    case 'pa.expedite_decided': { const x = after.pas.find(y => y.pa_id === p.pa_id); return x.expedite && x.expedite.decided_at === step.at ? 'expedite ' + x.expedite.status : 'unchanged'; }
    case 'pa.info_requested': case 'pa.info_provided': case 'pa.withdrawn': case 'pa.decided': {
      const x = after.pas.find(y => y.pa_id === p.pa_id), y = before.pas.find(z => z.pa_id === p.pa_id);
      return x.pa_version !== y.pa_version ? x.status : 'unchanged';
    }
    case 'appeal.info_requested': case 'appeal.decided': {
      const x = after.appeals.find(y => y.appeal_id === p.appeal_id), y = before.appeals.find(z => z.appeal_id === p.appeal_id);
      return x.appeal_version !== y.appeal_version ? x.status : 'unchanged';
    }
    case 'grant.changed': {
      const x = after.grants.find(y => y.grant_id === p.grant_id), y = before.grants.find(z => z.grant_id === p.grant_id);
      return !y ? (x ? 'created' : 'unchanged') : x.grant_version !== y.grant_version ? (x.status === 'revoked' ? 'revoked' : 'updated') : 'unchanged';
    }
    default: return 'applied';
  }
}

function touched(data, step) {
  const a = step.args, name = step.tool.slice(lib.P.length);
  if (name === 'coverage.cob.confirm') return [...new Set(data.info_requests.filter(r => r.type === 'other_coverage' && r.status === 'open' && r.plan_year === a.plan_year && data.claims.find(c => c.claim_id === r.claim_id).member_id === a.member_id).map(r => 'claim:' + r.claim_id))];
  if (name === 'claims.info.confirm') return ['claim:' + a.claim_id];
  if (name === 'appeals.file.confirm') return [a.target_type + ':' + a.target_id];
  if (name === 'pa.request_expedite') return ['pa:' + a.pa_id];
  if (name === 'appeals.add_statement' || name === 'appeals.withdraw.confirm') { const ap = data.appeals.find(x => x.appeal_id === a.appeal_id); return ['appeal:' + a.appeal_id, ap.target.type + ':' + ap.target.id]; }
  if (name === 'grants.change.confirm') { const t = ms(step.at), live = a.grant_id ? data.grants.find(g => g.grant_id === a.grant_id) : data.grants.find(g => g.member_id === a.member_id && g.grantee_id === a.grantee_id && g.status === 'active' && inForceAt(g, t)); return live ? ['grant:' + live.grant_id] : []; }
  return [];
}

const COUNTERS = new Set(['received_seq', 'posting_seq', 'filed_seq', 'approved_after_post']);
const RUN_ID = /\b(?:ir|eob|ap|n)-\d+\b/g;
const CENTS = /_cents$/;
const ASPECTS = ['~amounts', '~postings', '~ledger', '~closing'];
const bare = k => k.replace(/~(amounts|postings|ledger|closing)$/, '');
function keyedPair(...sets) {
  const ids = sets.map(() => new Map());
  const plain = (x, own) => JSON.stringify(x, (k, v) => (k === own || COUNTERS.has(k) ? undefined : typeof v === 'string' ? v.replace(RUN_ID, '') : v));
  const order = (p, q) => (p[0] < q[0] ? -1 : p[0] > q[0] ? 1 : 0);
  const name = (field, own, baseOf, always) => {
    const groups = new Map();
    sets.forEach((d, s) => { for (const x of d[field]) { const b = baseOf(x, s); if (!groups.has(b)) groups.set(b, sets.map(() => [])); groups.get(b)[s].push([plain(x, own), x]); } });
    for (const [b, per] of groups) {
      const label = k => (always || k ? b + '#' + k : b), anchor = per[per.length - 1].sort(order);
      anchor.forEach(([, x], k) => ids[sets.length - 1].set(x[own], label(k)));
      if (sets.length === 1) continue;
      const taken = new Set(), rest = [];
      for (const [sig, x] of per[0].sort(order)) { const k = anchor.findIndex(([g], i) => g === sig && !taken.has(i)); if (k >= 0) { taken.add(k); ids[0].set(x[own], label(k)); } else rest.push(x); }
      let next = 0, extra = anchor.length;
      for (const x of rest) { while (taken.has(next)) next++; if (next < anchor.length) { taken.add(next); ids[0].set(x[own], label(next)); } else ids[0].set(x[own], label(extra++)); }
    }
  };
  name('info_requests', 'info_request_id', r => 'request:' + r.claim_id + ':' + r.line_id + ':' + r.type, true);
  name('eobs', 'eob_id', e => 'eob:' + e.claim_id + ':v' + e.version, false);
  name('appeals', 'appeal_id', a => 'appeal:' + a.target.type + ':' + a.target.id + '@' + a.filed_at, false);
  name('grants', 'grant_id', g => 'grant:' + g.member_id + '>' + g.grantee_id + '@' + g.created_at, false);
  const subjectOf = (n, s) => (n.subject.type === 'claim' || n.subject.type === 'pa' ? n.subject.type + ':' + n.subject.id : ids[s].get(n.subject.id) || n.subject.type + ':' + n.subject.id);
  name('notices', 'notice_id', (n, s) => 'notice:' + n.kind.replace(/^notice\./, '') + '|' + subjectOf(n, s) + '|' + n.recipient_id + '@' + n.at + '|' + (n.fields.line_id || n.fields.eob_version || ''), true);
  return sets.map((data, s) => {
    const values = new Map(), rows = new Map(), own = ids[s];
    const swap = v => (typeof v === 'string' ? (own.has(v) ? own.get(v) : v.length > 12 ? v.replace(RUN_ID, m => own.get(m) || m) : v) : Array.isArray(v) ? v.map(swap) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => !COUNTERS.has(k)).map(([k, x]) => [k, swap(x)])) : v);
    const put = (key, record, row) => { let k = key; for (let i = 1; values.has(k); i++) k = key + '#' + i; values.set(k, JSON.stringify(swap(record))); if (row) rows.set(k, row); };
    const pick = (o, keep) => Object.fromEntries(Object.entries(o).filter(([k]) => keep(k)));
    for (const c of data.claims) put('claim:' + c.claim_id, c, c);
    for (const r of data.info_requests) put(own.get(r.info_request_id), r, r);
    for (const e of data.eobs) {
      const { ledger_before, postings, lines, ...rest } = e;
      put(own.get(e.eob_id), { ...rest, lines: lines.map(l => pick(l, k => !CENTS.test(k))) }, e);
      put(own.get(e.eob_id) + '~amounts', { lines: lines.map(l => pick(l, k => k === 'line_id' || CENTS.test(k))) });
      put(own.get(e.eob_id) + '~postings', { postings });
      put(own.get(e.eob_id) + '~ledger', { ledger_before });
    }
    for (const c of data.coverage) put('coverage:' + c.member_id + ':' + c.plan_year, c, c);
    for (const a of data.accumulators) put('accumulator:' + a.member_id + ':' + a.plan_year, a, a);
    for (const x of data.pas) put('pa:' + x.pa_id, x, x);
    for (const a of data.appeals) put(own.get(a.appeal_id), a, a);
    for (const w of data.windows) { const { closing, ...opening } = w; put('window:' + w.target.type + ':' + w.target.id, opening, w); put('window:' + w.target.type + ':' + w.target.id + '~closing', { closing }); }
    for (const g of data.grants) put(own.get(g.grant_id), g, g);
    for (const n of data.notices) put(own.get(n.notice_id), n, n);
    return Object.assign(values, { rows });
  });
}
const keyed = data => keyedPair(data)[0];

const finals = new WeakMap();
const recordedOf = full => { if (!finals.has(full)) finals.set(full, project(full, toIso(ms(lib.END) - 1))); return finals.get(full); };
const created = new WeakMap();
function createdBy(files) {
  if (created.has(files.replay)) return created.get(files.replay);
  const data = structuredClone(files.base), made = new Map(), effects = new Map(), targets = new Map(), writes = new Map();
  const diff = (a, b) => new Set([...[...b].filter(([k, v]) => a.get(k) !== v).map(([k]) => k), ...[...a.keys()].filter(k => !b.has(k))]);
  let last = null;
  for (const step of files.replay.steps) {
    const before = idsOf(data);
    const fired = applyDueTimers(data, step.at);
    if (step.by === 'infra') effects.set(step.id, effect(data, step));
    else targets.set(step.id, touched(data, step));
    const pre = last && !fired.length ? last : keyed(data);
    lib.apply(data, step);
    const post = keyed(data);
    last = post;
    writes.set(step.id, diff(pre, post));
    const fresh = [...idsOf(data)].filter(id => !before.has(id));
    if (fresh.length) made.set(step.id, fresh);
  }
  const by = new Map(files.replay.steps.map(x => [x.id, x])), waits = new Map();
  const ancestors = id => {
    if (waits.has(id)) return waits.get(id);
    const set = new Set();
    for (const parent of by.get(id).after || []) { if (by.get(parent).by !== 'infra') set.add(parent); for (const x of ancestors(parent)) set.add(x); }
    waits.set(id, set);
    return set;
  };
  for (const x of files.replay.steps) ancestors(x.id);
  const out = { made, effects, targets, waits, by, writes };
  created.set(files.replay, out);
  return out;
}

function play(data, later, take, { made, effects, waits }) {
  let state = structuredClone(data);
  const pending = new Set(later.filter(x => x.by !== 'infra').map(x => x.id));
  const map = new Map(), mine = new Set(), script = [], results = new Map(), skipped = new Map();
  const remap = value => {
    if (typeof value === 'string') {
      if (map.has(value)) return map.get(value);
      if (mine.has(value)) throw Object.assign(Error('ID ' + value + ' names another record here'), { code: 'id_conflict' });
      return value;
    }
    if (Array.isArray(value)) return value.map(remap);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, remap(v)]));
    return value;
  };
  for (const step of later) {
    if (step.by === 'infra') {
      const missing = [...waits.get(step.id)].filter(id => pending.has(id) && results.get(id) !== 'committed');
      if (missing.length) { skipped.set(step.id, 'waits for ' + missing.join(', ')); continue; }
      let event;
      try { event = { ...step, payload: remap(step.payload) }; } catch { skipped.set(step.id, 'names a record another step created here'); continue; }
      if (!stageable(state, event)) { skipped.set(step.id, 'names a record that does not exist here'); continue; }
      applyDueTimers(state, event.at);
      const expected = effect(state, event);
      if (expected !== effects.get(step.id)) { skipped.set(step.id, 'would be ' + expected + ' here, ' + effects.get(step.id) + ' in the dataset'); continue; }
      const before = structuredClone(state);
      try { lib.apply(state, event); } catch (e) { state = before; skipped.set(step.id, 'refused: ' + (e.code || 'error')); continue; }
      const seen = observed(before, state, event);
      if (seen !== expected) throw Error('Event ' + step.id + ' did ' + seen + ' where ' + expected + ' was expected.');
      script.push({ kind: 'event', step: event });
    } else if (take.has(step.id)) {
      let action;
      try { action = { ...step, args: remap(step.args) }; } catch (e) { results.set(step.id, e.code); continue; }
      const trial = structuredClone(state), before = idsOf(state);
      try { lib.apply(trial, action); } catch (e) { results.set(step.id, e.code || 'error'); continue; }
      state = trial;
      results.set(step.id, 'committed');
      const fresh = [...idsOf(state)].filter(id => !before.has(id));
      const kept = [...fresh];
      for (const id of made.get(step.id) || []) {
        const m = fresh.find(x => prefix(x) === prefix(id));
        if (!m) continue;
        fresh.splice(fresh.indexOf(m), 1);
        map.set(id, m);
        mine.add(m);
      }
      for (const m of fresh) mine.add(m);
      script.push({ kind: 'action', step: action, made: kept });
    }
  }
  return { state, script, results, skipped };
}

function claimOutcome(data, id) {
  const c = data.claims.find(x => x.claim_id === id);
  if (!c) return 'not received';
  const eobs = data.eobs.filter(e => e.claim_id === id).sort((a, b) => a.version - b.version);
  if (!eobs.length) return c.status;
  return c.status + ': ' + eobs.map(e => 'v' + e.version + ' ' + e.lines.map(l => l.line_id + ' ' + (l.status === 'paid' ? 'paid' : 'denied ' + l.reason)).join(', ')).join('; ');
}
const paOutcome = (data, id) => { const p = data.pas.find(x => x.pa_id === id); return p ? p.status + (p.approved ? ' (' + p.approved.units + ' units ' + p.approved.valid_from + ' to ' + p.approved.valid_until + ')' : '') + (p.overdue ? ', decision overdue' : '') : 'not submitted'; };
const appealsOn = (data, type, id) => data.appeals.filter(a => a.target.type === type && a.target.id === id).map(a => a.status + (a.overdue ? ' (decision overdue)' : ''));
function outcome(data, item) {
  const [type, id] = [item.slice(0, item.indexOf(':')), item.slice(item.indexOf(':') + 1)];
  if (type === 'claim') { const appeals = appealsOn(data, 'claim', id); return claimOutcome(data, id) + (appeals.length ? '; appeals: ' + appeals.join(', ') : ''); }
  if (type === 'pa') { const appeals = appealsOn(data, 'pa', id); return paOutcome(data, id) + (appeals.length ? '; appeals: ' + appeals.join(', ') : ''); }
  if (type === 'appeal') { const a = data.appeals.find(x => x.appeal_id === id); return a ? a.status + (a.overdue ? ' (decision overdue)' : '') : 'not filed'; }
  if (type === 'grant') {
    const g = data.grants.find(x => x.grant_id === id), t = ms(lib.END) - 1;
    return g ? g.scope + ' ' + (g.status === 'revoked' ? 'revoked ' + g.revoked_at : inForceAt(g, t) ? 'in force' : 'expired') + (g.expires_at ? ' (expires ' + g.expires_at + ')' : '') : 'none';
  }
  return 'unknown';
}

function openItems(seen, at) {
  const t = ms(at), items = [];
  for (const c of seen.claims) if (c.status !== 'processed') items.push({ item: 'claim:' + c.claim_id, member_id: c.member_id, status: c.status, open_requests: seen.info_requests.filter(r => r.claim_id === c.claim_id && r.status === 'open').map(r => r.info_request_id + ' ' + r.type + ' ' + r.line_id + ' until ' + r.expires_at) });
  for (const p of seen.pas) if (OPEN_PA.includes(p.status)) items.push({ item: 'pa:' + p.pa_id, member_id: p.member_id, status: p.status + (p.overdue ? ' (overdue)' : '') + (p.expedite ? ', expedite ' + p.expedite.status : ''), due_at: p.due_at });
  for (const a of seen.appeals) if (OPEN_APPEAL.includes(a.status)) items.push({ item: 'appeal:' + a.appeal_id, member_id: a.member_id, status: a.status + (a.overdue ? ' (overdue)' : ''), target: a.target.type + ':' + a.target.id, due_at: a.due_at });
  for (const w of seen.windows) {
    const rec = w.target.type === 'pa' ? seen.pas.find(p => p.pa_id === w.target.id) : seen.claims.find(c => c.claim_id === w.target.id);
    if (t < ms(w.ends_at) && appealable(seen, w.target.type, rec) && !seen.appeals.some(a => a.target.type === w.target.type && a.target.id === w.target.id && OPEN_APPEAL.includes(a.status))) items.push({ item: w.target.type + ':' + w.target.id, member_id: rec.member_id, status: 'appealable until ' + w.ends_at, window_ends_at: w.ends_at });
  }
  for (const g of seen.grants) if (g.status === 'active' && inForceAt(g, t)) items.push({ item: 'grant:' + g.grant_id, member_id: g.member_id, status: g.scope + ' grant to ' + g.grantee_id + ' in force' + (g.expires_at ? ' until ' + g.expires_at : '') });
  return items;
}

function netPosting(data, claimId, year, t) {
  const e = data.eobs.filter(x => x.claim_id === claimId && ms(x.issued_at) <= t).sort((a, b) => b.version - a.version)[0];
  const p = e && e.postings.find(x => x.plan_year === year);
  return p ? [p.deductible_cents, p.oop_cents] : [0, 0];
}
function differencesOf(end, recorded, run, later, info, withheld) {
  const [A, F] = keyedPair(end, recorded), delta = new Set([...A.keys(), ...F.keys()].filter(k => A.get(k) !== F.get(k)));
  const rowOf = key => F.rows.get(bare(key)) || A.rows.get(bare(key)), named = prefix => [...new Set([...F.rows.keys(), ...A.rows.keys()])].filter(k => k.startsWith(prefix));
  const taken = new Set([...run.results].filter(([, r]) => r === 'committed').map(([id]) => id));
  const applied = new Set(run.script.filter(x => x.kind === 'event').map(x => x.step.id));
  const missed = later.filter(x => (x.by === 'infra' ? !applied.has(x.id) : !taken.has(x.id)));
  const roots = x => { if (x.by !== 'infra') return [x.id]; const w = [...info.waits.get(x.id)].filter(y => withheld.has(y) && !taken.has(y)); return w.length ? w : [x.id]; };
  const writers = new Map();
  const sibling = k => k.replace(/#\d+$/, ''), kin = new Map();
  for (const k of delta) { const b = sibling(k); if (!kin.has(b)) kin.set(b, []); kin.get(b).push(k); }
  for (const x of missed) for (const w of info.writes.get(x.id)) for (const k of kin.get(sibling(w)) || []) { if (!writers.has(k)) writers.set(k, new Set()); for (const r of roots(x)) writers.get(k).add(r); }
  const both = [end, recorded];
  const group = pairs => { const m = new Map(); for (const [k, v] of pairs) { if (!m.has(k)) m.set(k, new Set()); m.get(k).add(v); } return m; };
  const of = (m, k) => [...(m.get(k) || [])];
  const eobs = new Map(named('eob:').map(k => [k, rowOf(k)]));
  const eobsByClaim = group([...eobs].map(([k, e]) => [e.claim_id, k]));
  const counted = (d, e) => { const prev = d.eobs.find(x => x.claim_id === e.claim_id && x.version === e.version - 1); return e.lines.filter(l => l.pa_id && l.pa_units && !(prev && prev.lines.some(m => m.line_id === l.line_id && m.pa_id === l.pa_id && m.pa_units === l.pa_units))); };
  const eobsByPa = group(both.flatMap(d => d.eobs.flatMap(e => counted(d, e).map(l => [l.pa_id, 'eob:' + e.claim_id + ':v' + e.version]))));
  const posting = group(both.flatMap(d => d.eobs.flatMap(e => e.postings.filter(x => x.deductible_cents || x.oop_cents).map(x => [x.member_id + ':' + x.plan_year, 'eob:' + e.claim_id + ':v' + e.version + '~postings']))));
  const requestsByClaim = group([...new Set([...A.keys(), ...F.keys()])].filter(k => k.startsWith('request:')).map(k => [k.split(':')[1], k]));
  const appeals = new Map(named('appeal:').map(k => [k, rowOf(k)]));
  const appealsByTarget = group([...appeals].map(([k, a]) => [a.target.type + ':' + a.target.id, k]));
  const overturned = new Set(named('appeal:').filter(k => [A.rows.get(k), F.rows.get(k)].some(a => a && a.status === 'overturned')));
  const decisive = target => of(appealsByTarget, target).filter(k => overturned.has(k));
  const claims = new Map([...recorded.claims, ...end.claims].map(c => [c.claim_id, c]));
  const pas = new Map([...recorded.pas, ...end.pas].map(x => [x.pa_id, x]));
  const grants = group(named('grant:').flatMap(k => [A.rows.get(k), F.rows.get(k)].filter(Boolean).map(g => [k, g])));
  const inForce = (g, at) => ms(g.created_at) <= at && (g.expires_at === null || at < ms(g.expires_at)) && (!g.revoked_at || at < ms(g.revoked_at));
  const asked = new Set(both.flatMap(d => d.info_requests.filter(r => r.type === 'other_coverage').map(r => r.claim_id)));
  const unpaid = new Set(both.flatMap(d => d.eobs.filter(e => e.lines.some(l => l.reason === 'missing_information' || l.reason === 'other_party_liable')).map(e => e.claim_id)));
  const authorized = new Set(both.flatMap(d => d.eobs.filter(e => e.lines.some(l => l.pa_id || l.reason === 'prior_auth_missing')).map(e => e.claim_id)));
  const exists = k => A.has(k) !== F.has(k);
  const years = c => [...new Set(c.lines.map(l => l.service_date.slice(0, 4)))];
  const covers = (p, c) => p.member_id === c.member_id && c.lines.some(l => l.service_id === p.service_id && [p.approved, p.requested].some(r => r && r.valid_from <= l.service_date && l.service_date <= r.valid_until));
  const coverage = c => (asked.has(c.claim_id) || unpaid.has(c.claim_id) ? years(c).map(y => 'coverage:' + c.member_id + ':' + y) : []);
  const authorizations = c => (authorized.has(c.claim_id) ? [...pas.values()].filter(x => covers(x, c)).map(x => 'pa:' + x.pa_id) : []);
  const appealsBefore = (target, at) => of(appealsByTarget, target).filter(k => ms(appeals.get(k).filed_at) < ms(at));
  const eobsBefore = (claimId, at) => of(eobsByClaim, claimId).filter(k => at === null || ms(eobs.get(k).issued_at) <= ms(at));
  const moved = (c, e) => {
    const out = [];
    for (const o of claims.values()) {
      if (o === c || (o.member_id !== c.member_id && !years(o).some(y => years(c).includes(y)))) continue;
      const shift = years(c).some(y => both.map(d => netPosting(d, o.claim_id, Number(y), ms(e.issued_at) - 1).join()).reduce((a, b) => a !== b));
      if (shift) out.push(...eobsBefore(o.claim_id, e.issued_at).map(k => k + '~postings'));
    }
    return out;
  };
  const inputs = key => {
    const kind = key.slice(0, key.indexOf(':')), id = key.slice(key.indexOf(':') + 1);
    if (kind === 'claim') { const c = claims.get(id); return [...of(requestsByClaim, id), ...coverage(c), ...authorizations(c), ...decisive(key)]; }
    if (kind === 'request') { const [claimId, , type] = id.split(':'), c = claims.get(claimId); return [...(exists('claim:' + claimId) ? ['claim:' + claimId] : []), ...(type.startsWith('other_coverage') ? years(c).map(y => 'coverage:' + c.member_id + ':' + y) : [])]; }
    if (kind === 'eob') {
      const base = bare(key), e = eobs.get(base), c = claims.get(e.claim_id);
      if (key.endsWith('~ledger')) return moved(c, e);
      if (key.endsWith('~amounts')) return [base, base + '~ledger'];
      if (key.endsWith('~postings')) return [base + '~amounts', base + '~ledger'];
      return ['claim:' + c.claim_id, ...of(requestsByClaim, c.claim_id), ...coverage(c), ...authorizations(c), ...appealsBefore('claim:' + c.claim_id, e.issued_at)];
    }
    if (kind === 'pa') return [...decisive(key), ...of(eobsByPa, id)];
    if (kind === 'appeal') { const a = appeals.get(key), target = a.target.type + ':' + a.target.id; return [target, ...(a.target.type === 'claim' ? eobsBefore(a.target.id, a.filed_at) : [])]; }
    if (kind === 'window') { const base = bare(key), [type, tid] = base.slice(7).split(':'); return key.endsWith('~closing') ? [base, ...of(appealsByTarget, type + ':' + tid)] : type === 'claim' ? eobsBefore(tid, rowOf(base).notice_at) : [type + ':' + tid]; }
    if (kind === 'accumulator') return of(posting, id);
    if (kind === 'notice') {
      const n = JSON.parse(A.get(key) || F.get(key)), subject = key.split('|')[1], member = n.member_id, at = ms(n.at);
      const access = [...grants].filter(([, list]) => [...list].some(g => g.member_id === member && g.grantee_id === n.recipient_id && inForce(g, at))).map(([k]) => k);
      const claimId = subject.startsWith('claim:') ? subject.slice(6) : null;
      const own = n.kind === 'notice.appeal_window_closing' ? ['window:' + subject, 'window:' + subject + '~closing'] : !claimId ? [subject, ...(subject.startsWith('pa:') ? ['window:' + subject] : [])] : n.fields.eob_version ? ['eob:' + claimId + ':v' + n.fields.eob_version, 'eob:' + claimId + ':v' + n.fields.eob_version + '~amounts'] : ['window:' + subject, ...eobsBefore(claimId, n.at)];
      return [...own, ...access];
    }
    return [];
  };
  const stepAt = id => ms(info.by.get(id).at);
  const limit = key => {
    const b = bare(key);
    if (!/^(eob|notice):/.test(b) && !(b.startsWith('window:') && key === b)) return Infinity;
    const r = rowOf(b);
    return ms(b.startsWith('eob:') ? r.issued_at : b.startsWith('notice:') ? r.at : r.notice_at);
  };
  const bound = new Map([...delta].map(k => [k, limit(k)]));
  const edges = new Map([...delta].map(k => [k, inputs(k).filter(i => i !== k && delta.has(i))]));
  const expl = new Map([...delta].map(k => [k, new Set([...(writers.get(k) || [])].filter(r => stepAt(r) <= bound.get(k)))]));
  for (let changed = true; changed;) {
    changed = false;
    for (const [k, ins] of edges) { const set = expl.get(k), t = bound.get(k); for (const i of ins) for (const r of expl.get(i)) if (!set.has(r) && stepAt(r) <= t) { set.add(r); changed = true; } }
  }
  const entryOf = k => (k.startsWith('window:') ? k : bare(k)), order = id => Number(id.slice(2)), bases = [...new Set([...delta].map(entryOf))].sort();
  return bases.map(record => {
    const parts = record.startsWith('window:') ? [record] : [record, ...ASPECTS.map(x => record + x)].filter(k => delta.has(k)), at = Math.max(...parts.map(k => bound.get(k)));
    const fields = new Set(), because = new Set(), via = new Set();
    for (const k of parts) {
      const a = A.has(k) ? JSON.parse(A.get(k)) : null, b = F.has(k) ? JSON.parse(F.get(k)) : null;
      if (a && b) for (const f of Object.keys({ ...a, ...b })) if (JSON.stringify(a[f]) !== JSON.stringify(b[f])) fields.add(f);
      for (const r of expl.get(k)) because.add(r);
      for (const i of edges.get(k)) if (entryOf(i) !== record && [...expl.get(i)].some(r => stepAt(r) <= bound.get(k))) via.add(entryOf(i));
    }
    const change = !A.has(parts[0]) ? 'missing' : !F.has(parts[0]) ? 'extra' : 'changed';
    return { record, change, ...(at < Infinity ? { issued_at: toIso(at) } : {}), fields: [...fields].sort(), because: [...because].sort((x, y) => order(x) - order(y)), via: [...via].sort(), reason: because.size ? 'these withheld steps, or the records listed in via that depend on them, change it' : 'unexplained' };
  });
}

function dependsOn(event, actions) {
  const values = new Set((JSON.stringify(event.payload).match(/"[^"]*"/g) || []).map(x => JSON.parse(x)));
  const direct = actions.filter(a => a.made.some(id => values.has(id)) || Object.values(a.step.args).some(v => typeof v === 'string' && values.has(v)));
  return (direct.length ? direct : actions).map(a => a.step.id);
}

function scenario(data, at, later, files) {
  const info = createdBy(files);
  const seen = project(data, at);
  const items = openItems(seen, at), keys = new Set(items.map(i => i.item));
  const actions = later.filter(s => s.by !== 'infra' && (info.targets.get(s.id) || []).some(k => keys.has(k)));
  const withheld = new Set(later.filter(x => x.by !== 'infra').map(x => x.id));
  const waitsFor = id => [...info.waits.get(id)].filter(x => withheld.has(x));
  const none = play(data, later, new Set(), info);
  const all = later.filter(s => s.by !== 'infra');
  const owner = play(data, later, new Set(all.filter(s => s.by === OWNER).map(s => s.id)), info);
  const household = play(data, later, new Set(all.map(s => s.id)), info);
  const ends = [none, owner, household].map(r => project(r.state, toIso(ms(lib.END) - 1)));
  const recorded = recordedOf(files.full);
  const unconditional = new Set(none.script.map(x => x.step.id)), scripted = new Set(owner.script.map(x => x.step.id));
  const t = ms(at), visible = new Set(data.members.filter(m => relation(data, OWNER, m.member_id, t).view).map(m => m.member_id));
  const taken = [];
  const script = owner.script.map(x => {
    if (x.kind === 'action') {
      taken.push({ step: x.step, made: x.made });
      return { kind: 'action', id: x.step.id, at: x.step.at, by: x.step.by, tool: x.step.tool, args: x.step.args };
    }
    const entry = { kind: 'event', event: lib.envelope(x.step) };
    if (!unconditional.has(x.step.id)) entry.after = waitsFor(x.step.id).length ? waitsFor(x.step.id) : dependsOn(x.step, taken);
    return entry;
  });
  const envelopeIn = (run, x) => { const e = run.script.find(y => y.kind === 'event' && y.step.id === x.id); return e ? lib.envelope(e.step) : null; };
  const conditional = later.filter(x => x.by === 'infra' && !unconditional.has(x.id) && (waitsFor(x.id).length || scripted.has(x.id))).map(x => {
    const after = waitsFor(x.id).length ? waitsFor(x.id) : script.find(e => e.kind === 'event' && e.event.event_id === lib.eventId(x)).after;
    return { after, needs: [...new Set(after.map(id => info.by.get(id).by))].sort(), in_account_holder_script: scripted.has(x.id), event: envelopeIn(household, x) || lib.envelope(x), account_holder_event: envelopeIn(owner, x) };
  });
  const listed = new Set([...unconditional, ...conditional.map(c => c.event.event_id.slice(lib.RUN.length + 1))]);
  const unstaged = later.filter(x => x.by === 'infra' && !listed.has(x.id)).map(x => ({ reason: none.skipped.get(x.id) || 'not staged', event: lib.envelope(x) }));
  const differences = run => differencesOf(project(run.state, toIso(ms(lib.END) - 1)), recorded, run, later, info, withheld);
  return {
    account_holder: { person_id: OWNER, visible_members: [...visible].sort(), visible_open_items: items.filter(i => visible.has(i.member_id)).map(i => i.item) },
    events: none.script.map(x => lib.envelope(x.step)),
    account_holder_script: script,
    conditional_events: conditional,
    unstaged_events: unstaged,
    differences_from_dataset: { after_staged_events: differences(none), with_account_holder_actions: differences(owner) },
    withheld_actions: all.map(s => ({ id: s.id, at: s.at, by: s.by, tool: s.tool, args: s.args, account_holder_args: (owner.script.find(x => x.kind === 'action' && x.step.id === s.id) || { step: { args: null } }).step.args, account_holder: s.by === OWNER, open_items: info.targets.get(s.id).filter(k => keys.has(k)), with_account_holder_actions: s.by === OWNER ? owner.results.get(s.id) : 'not taken: needs ' + s.by })),
    open_items: items.map(i => {
      const [a, b, c] = ends.map(end => outcome(end, i.item)), d = outcome(recorded, i.item);
      return {
        ...i, visible_to_account_holder: visible.has(i.member_id),
        after_staged_events: a, with_account_holder_actions: b, with_household_actions: c, in_dataset: d,
        completed_by_staged_events: a === d, completed_with_account_holder_actions: b === d, completed_with_household_actions: c === d,
        actions: actions.filter(s => info.targets.get(s.id).includes(i.item)).map(s => ({
          id: s.id, at: s.at, by: s.by, tool: s.tool, account_holder: s.by === OWNER,
          with_account_holder_actions: s.by === OWNER ? owner.results.get(s.id) : 'not taken: needs ' + s.by,
          with_household_actions: household.results.get(s.id),
        })),
      };
    }),
  };
}

function bundle(data, at, applied, withheld, timers, files) {
  const declared = lib.read('contribution/dataset.json'), bytes = lib.bytesOf(files);
  const sources = ['delivery-dataset'];
  return {
    dataset: {
      schema_version: declared.schema_version,
      dataset_id: data.seed_id,
      version: declared.version,
      description: 'As-of selection of the Larkfield delivery dataset ' + lib.SEED_IDS.full + ' at ' + at + ': the household, the plan, the providers and services, and every record dated before that instant. All records are synthetic. Claims, prior authorizations and appeals still open at that instant have only the history they had then (see open_items in the selection).',
      record_source_ids: sources,
      sources: declared.sources.filter(s => sources.includes(s.source_id)),
      transformations: ['Replayed the ' + applied + ' steps of ' + lib.FILES.replay + ' (sha256 ' + lib.digestOf(bytes[lib.FILES.replay]) + ') dated before ' + at + ' over ' + lib.FILES.base + ' (sha256 ' + lib.digestOf(bytes[lib.FILES.base]) + ') through the App handlers, then committed the ' + timers + ' timers due before that instant as the App\'s next write would; the ' + withheld + ' later steps are withheld.'],
      expected_counts: { records: plugin.records(data).length, assets: 0 },
      quality_policy: declared.quality_policy,
      review: declared.review,
    },
    catalog: lib.read('contribution/assets.catalog.json'),
    blobs: {},
  };
}

function asOf(text, files = lib.load()) {
  const at = lib.instant(text);
  if (ms(at) < ms(lib.START) || ms(at) > ms(lib.END)) throw Error('The instant must be from ' + lib.START + ' to ' + lib.END + ', the dataset window.');
  const { data, applied } = lib.replay(files.base, files.replay.steps, at);
  const timers = applyDueTimers(data, toIso(ms(at) - 1));
  data.seed_id = selectionId(data, at);
  lib.validate(data, at);
  const later = files.replay.steps.slice(applied);
  const { open_items, events, account_holder, account_holder_script, conditional_events, unstaged_events, withheld_actions, differences_from_dataset } = scenario(data, at, later, files);
  return {
    schema: 'larkfield-health.as-of.v1',
    dataset_id: files.replay.dataset_id,
    as_of: at,
    virtual_now: at,
    steps_applied: applied,
    steps_withheld: later.length,
    timers_committed: timers.map(x => ({ kind: x.kind, id: x.id, at: x.at })),
    summary: lib.summarize(data),
    data,
    account_holder,
    open_items,
    events,
    account_holder_script,
    conditional_events,
    unstaged_events,
    withheld_actions,
    differences_from_dataset,
    bundle: bundle(data, at, applied, later.length, timers.length, files),
  };
}

const countKinds = list => list.reduce((m, x) => { const k = x.record.split(':')[0]; m[k] = (m[k] || 0) + 1; return m; }, {});
function main() {
  const argv = process.argv.slice(2);
  const option = name => { const i = argv.lastIndexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const at = option('--at');
  if (!at) {
    console.error('Usage: node dataset/as-of.cjs --at <instant> [--out FILE] [--summary]\n  <instant> is a date (local midnight in ' + lib.ZONE + ') or a date-time with an offset, from ' + lib.START + ' to ' + lib.END + '.');
    process.exit(2);
  }
  let selection;
  try { selection = asOf(at); } catch (e) { console.error(e.message); process.exit(1); }
  const { data, events, account_holder_script: script, conditional_events: conditional, unstaged_events: unstaged, withheld_actions: withheld, differences_from_dataset: differences, bundle: b, ...head } = selection;
  const brief = { ...head, seed_id: data.seed_id, counters: data.issued || {}, staged_events: events.length, account_holder_script_steps: script.length, conditional_events: conditional.length, unstaged_events: unstaged.length, differing_after_staged_events: countKinds(differences.after_staged_events), differing_with_account_holder_actions: countKinds(differences.with_account_holder_actions), withheld_actions: withheld.length, withheld_account_holder_actions: withheld.filter(x => x.account_holder).length };
  const out = option('--out');
  if (out) {
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, lib.pretty(selection));
    console.log(JSON.stringify({ ...brief, out }));
  } else if (argv.includes('--summary')) console.log(lib.pretty(brief).trimEnd());
  else process.stdout.write(lib.pretty(selection));
}

if (require.main === module) main();
module.exports = { keyed, keyedPair, differencesOf, netPosting, asOf, compact, selectionId, stageable, effect, observed, createdBy, play, openItems, outcome, OWNER, OPEN_PA, OPEN_APPEAL };
