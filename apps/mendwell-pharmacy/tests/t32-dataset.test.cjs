'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const plugin = require('../plugin.cjs');
const { ms, toIso, rxExpiry } = require('../src/time.cjs');
const { dueTimers, applyDueTimers } = require('../src/timers.cjs');
const { project } = require('../src/operations.cjs');
const { fixture } = require('./harness.cjs');
const lib = require('../dataset/lib.cjs');
const generate = require('../dataset/generate.cjs');
const notes = require('../dataset/notes.cjs');
const { asOf, TERMINAL } = require('../dataset/as-of.cjs');
const { compute, render, OUT, instantsOf, visibleTo } = require('../dataset/coverage.cjs');

const files = lib.load();
const steps = files.replay.steps;
const P = lib.P;
const plus = (iso, minutes) => toIso(ms(iso) + minutes * 60000);
const firstAfter = (from, check) => steps.find(s => ms(s.at) > ms(from) && check(s));
const pick = (...args) => { const s = firstAfter(...args); assert.ok(s, 'a replay step for the instant'); return s.at; };
const returned = files.full.fills.find(f => f.state === 'returned_to_stock' && !steps.some(s => ms(s.at) === ms(f.closed_at)));
const review = steps.find((s, i) => s.tool === P + 'fills.request' && steps[i + 1] && ms(steps[i + 1].at) > ms(s.at) + 2 * 3600000 + 60000);
const INSTANTS = [
  lib.START, '2025-07-01', '2026-01-01', lib.REFERENCE, '2026-12-15', lib.END,
  pick('2026-01-01T00:00:00-05:00', s => s.operation === 'fill.hold_placed'),
  pick('2025-06-01T00:00:00-04:00', s => s.tool === P + 'fills.prepay.confirm'),
  toIso(ms(returned.closed_at) + 1),
  plus(review.at, 121),
];
const times = f => [f.requested_at, f.ready_at, f.warned_at, f.closed_at, ...f.timeline.map(e => e.at), ...f.refusals.map(r => r.at), ...f.notes.map(n => n.at), f.collector && f.collector.set_at].filter(Boolean);
const strings = (v, out = []) => { if (typeof v === 'string') out.push(v); else if (Array.isArray(v)) v.forEach(x => strings(x, out)); else if (v && typeof v === 'object') Object.values(v).forEach(x => strings(x, out)); return out; };
const COUNTED = { f: 'fills', cl: 'claims', pr: 'plan_requests', rn: 'renewals', au: 'authorizations', ch: 'charges', n: 'notices' };
const ID = { fills: 'fill_id', claims: 'claim_id', plan_requests: 'plan_request_id', renewals: 'renewal_id', authorizations: 'authorization_id', charges: 'charge_id', notices: 'notice_id' };

test('Dataset every month from 2025-01 to 2026-12 has fills and dated records, from the first day to the last', () => {
  const c = compute(files);
  assert.deepEqual(c.monthly.map(m => m.month), lib.months());
  assert.equal(c.monthly.length, 24);
  for (const m of c.monthly) assert.ok(m.fills >= 2 && m.distinct_dates >= 4 && m.claims >= 2 && m.notices >= 4, 'coverage in ' + m.month);
  assert.deepEqual(c.months_without_fills, []);
  assert.deepEqual([c.earliest, c.latest, c.invalid_dates, c.outside_window], [lib.FIRST, lib.LAST, 0, 0]);
  assert.equal(c.distinct_dates.coverage, new Set(lib.dated(files.full).map(i => lib.dateOf(i.at))).size);
  assert.ok(c.distinct_dates.global >= c.distinct_dates.coverage);
  assert.ok(c.gaps.filter(g => g.kind === 'days_without_records').every(g => lib.dated(files.full).every(i => lib.dateOf(i.at) < g.from || lib.dateOf(i.at) > g.to)));
  assert.deepEqual([c.provenance.real, c.provenance.mixed, c.provenance.synthetic], [0, 0, c.totals.records]);
  const after = lib.dated(files.full).filter(i => ms(i.at) >= ms(lib.REFERENCE)).length;
  assert.equal(c.partitions[1].records, after);
  assert.equal(c.monthly.reduce((s, m) => s + m.records_after_reference_clock, 0), after);
  assert.ok(c.gaps.some(g => g.kind === 'real_data_anchor' && /line 102/.test(g.reason) && /no crawling or copied content/.test(g.reason) && /pending maintainer agreement/.test(g.status)));
  const labels = c.provenance.label_facts.labels;
  assert.equal(labels.length, files.full.drugs.length);
  for (const l of labels) assert.equal(l.used, files.full.prescriptions.some(r => r.drug_id === l.drug_id), l.source_id);
  assert.equal(c.provenance.label_facts.counted_as_real, labels.filter(l => l.used).reduce((s, l) => s + l.facts, 0));
});

test('Dataset an as-of selection holds only what was recorded before its instant, with matching counters, timers and clock', () => {
  const seen = new Set();
  for (const text of INSTANTS) {
    const s = asOf(text, files), t = ms(s.as_of);
    assert.equal(s.virtual_now, toIso(t), text);
    assert.ok(!seen.has(s.data.seed_id), 'its own seed ID');
    seen.add(s.data.seed_id);
    assert.ok(steps.slice(0, s.steps_applied).every(x => ms(x.at) < t) && steps.slice(s.steps_applied).every(x => ms(x.at) >= t), 'cut at ' + text);
    assert.equal(s.steps_applied + s.steps_withheld, steps.length);
    assert.deepEqual(s.data.fills.map(f => f.fill_id), files.full.fills.filter(f => ms(f.requested_at) < t).map(f => f.fill_id), 'fills before ' + text);
    for (const f of s.data.fills) assert.ok(times(f).every(x => ms(x) < t), 'fill ' + f.fill_id + ' shows nothing after ' + text);
    assert.ok(lib.dated(s.data).every(i => ms(i.at) < t), 'every dated record is before ' + text);
    assert.deepEqual(s.data.notices.map(n => n.notice_id), files.full.notices.filter(n => ms(n.at) < t).map(n => n.notice_id), 'exactly the notices dated before ' + text);
    assert.deepEqual(s.data.prescriptions.map(r => r.rx_id), files.full.prescriptions.filter(r => ms(r.received_at) < t).map(r => r.rx_id), 'exactly the prescriptions received before ' + text);
    assert.deepEqual(dueTimers(s.data, toIso(t - 1)), [], 'no timer due before ' + text + ' is left uncommitted');
    assert.equal(s.data.approvals.length, 0);
    for (const f of s.data.fills) {
      const end = files.full.fills.find(x => x.fill_id === f.fill_id);
      if (Math.max(...times(end).map(ms)) < t) assert.deepEqual(f, end, 'a finished fill is identical to the dataset record');
    }
    for (const [prefix, list] of Object.entries(COUNTED)) assert.equal(s.data.issued[prefix] || 0, s.data[list].length, prefix + ' counter at ' + text);
    assert.equal(s.data.issued.rf || 0, s.data.fills.flatMap(f => f.refusals).length, 'rf counter at ' + text);
    assert.ok(Object.entries(COUNTED).every(([prefix, list]) => s.data[list].every((r, i) => r[ID[list]] === prefix + '-' + (i + 1))), 'IDs in issue order at ' + text);
    assert.ok(s.events.every(e => ms(e.at) >= t), 'staged events are later');
    assert.equal(s.bundle.dataset.expected_counts.records, plugin.records(s.data).length);
    assert.equal(s.bundle.dataset.dataset_id, s.data.seed_id);
    const f = fixture({ seed: s.data, now: s.virtual_now });
    assert.equal(f.call(P + 'fills.list', {}).fills.length, visibleTo(s.data, 'p-2', s.as_of).length, 'the account holder lists what the grants allow at ' + text);
    assert.ok(Buffer.byteLength(lib.pretty(s.data)) < 1024 * 1024, 'selection under 1 MiB');
  }
});

test('Dataset selections on either side of a replay step have their own seed IDs, and a preview token from one is stale on the other', () => {
  const step = steps.find(s => s.operation === 'fill.hold_placed' && ms(s.at) > ms('2026-03-01T00:00:00-05:00'));
  const before = asOf(step.at, files), after = asOf(toIso(ms(step.at) + 1), files), same = asOf(toIso(ms(step.at) + 1), files);
  assert.equal(after.steps_applied, before.steps_applied + steps.filter(s => s.at === step.at).length);
  assert.notEqual(before.data.seed_id, after.data.seed_id);
  assert.equal(same.data.seed_id, after.data.seed_id);
  assert.match(after.data.seed_id, /^mendwell-delivery-asof-\d{8}T\d{6}\.\d{3}Z-[0-9a-f]{12}$/);
  const rx = after.data.prescriptions.find(r => r.patient_id === 'p-2' && r.state === 'active' && r.fills_remaining > 0 && !after.data.fills.some(f => f.rx_id === r.rx_id && !TERMINAL.includes(f.state)) && ms(step.at) < rxExpiry(r.written_on));
  assert.ok(rx, 'a prescription free to request');
  const open = s => {
    const f = fixture({ seed: s.data, now: toIso(ms(step.at) + 60000) });
    const fill = f.call(P + 'fills.request', { rx_id: rx.rx_id, store_id: 'st-1', quantity: rx.quantity }).fill;
    return { f, fill: fill.fill_id, token: f.call(P + 'fills.cancel.preview', { fill_id: fill.fill_id }).preview.token };
  };
  const earlier = open(before), later = open(after);
  assert.equal(earlier.fill, later.fill, 'the same new fill ID on both sides');
  assert.notEqual(earlier.token, later.token);
  assert.equal(later.f.call(P + 'fills.cancel.confirm', { fill_id: later.fill, token: earlier.token }).status, 'stale_preview');
  assert.equal(later.f.call(P + 'fills.cancel.confirm', { fill_id: later.fill, token: later.token }).status, 'committed');
  assert.equal(earlier.f.call(P + 'fills.cancel.confirm', { fill_id: earlier.fill, token: earlier.token }).status, 'committed');
});

test('Dataset every note agrees with the records it describes, and a contradicting note is caught', () => {
  assert.deepEqual(notes.problems(files.full), []);
  assert.ok(files.full.plan_requests.some(r => r.note === notes.LOST) && files.full.renewals.length > 0 && files.full.fills.some(f => f.notes.length));
  const broken = (change, pattern) => { const copy = structuredClone(files.full); change(copy); assert.ok(notes.problems(copy).some(p => pattern.test(p)), String(pattern)); };
  const fits = structuredClone(files.full), travel = fits.plan_requests.find(x => x.note === notes.LOST && fits.fills.some(f => f.fill_id === x.fill_id && fits.prescriptions.some(r => r.rx_id === f.rx_id && r.patient_id === 'p-4')));
  travel.note = notes.TRAVEL[0]; travel.created_at = '2025-09-29T10:00:00-04:00';
  assert.ok(!notes.problems(fits).some(p => p.includes(travel.plan_request_id)), 'a travel note before a trip of the patient passes');
  broken(c => { const r = c.plan_requests.find(x => x.note === notes.LOST); r.note = notes.TRAVEL[0]; r.created_at = '2025-03-03T10:00:00-05:00'; }, /no trip of/);
  broken(c => { const r = c.plan_requests.find(x => x.note === notes.LOST); for (const f of c.fills) f.state = f.fill_id === r.fill_id ? f.state : 'cancelled'; }, /no supply of that drug was collected/);
  broken(c => { c.plan_requests.find(x => x.note === notes.PA.denied).note = notes.PA.first; }, /prior-authorization note must be/);
  broken(c => { c.plan_requests.find(x => x.note === notes.PA.first).note = notes.PA.withdrawn; }, /prior-authorization note must be/);
  broken(c => { const r = c.renewals.find(x => x.note === notes.RENEWAL.used); r.note = notes.RENEWAL.expired; }, /the prescription calls for|had fills left/);
  broken(c => { const f = c.fills.find(x => x.notes.length >= 2), pairs = [...notes.REVIEW_HOLDS, ...notes.READY_HOLDS]; f.notes[1].text = pairs.find(h => h[0] !== f.notes[0].text)[1]; }, /does not answer/);
  broken(c => { c.fills.find(x => x.notes.length === 2 && x.state === 'collected').notes.pop(); }, /has no release, yet the fill is not on that hold/);
  assert.deepEqual(notes.problems(files.full, steps), []);
  const dropped = structuredClone(files.full); dropped.fills.find(x => x.notes.length === 2).notes.pop();
  assert.ok(notes.problems(dropped, steps).some(p => /left no note/.test(p)));
  broken(c => { const f = c.fills.find(x => x.notes.some(n => notes.REVIEW_HOLDS.some(h => h[0] === n.text))); const i = f.notes.findIndex(n => notes.REVIEW_HOLDS.some(h => h[0] === n.text)); f.notes[i].text = notes.READY_HOLDS[0][0]; f.notes[i + 1].text = notes.READY_HOLDS[0][1]; }, /placed while requested/);
});

test('Dataset a cut just after a due timer agrees with the App reads Core relays, in the seed, its notices and open_fills', () => {
  for (const t of [ms(returned.closed_at) + 1, ms(returned.closed_at)]) {
    const s = asOf(toIso(t), files);
    const reads = project(s.data, s.virtual_now).fills;
    assert.deepEqual(s.open_fills.map(o => o.fill_id + ' ' + o.status), reads.filter(f => !TERMINAL.includes(f.state)).map(f => f.fill_id + ' ' + f.state), 'open_fills at ' + s.as_of + ' equal the reads');
    const stored = s.data.fills.find(f => f.fill_id === returned.fill_id);
    assert.equal(reads.find(f => f.fill_id === returned.fill_id).state, 'returned_to_stock', 'the App reads the return at ' + s.as_of);
    if (t > ms(returned.closed_at)) {
      assert.ok(s.timers_committed.some(x => x.kind === 'return' && x.fill_id === returned.fill_id && x.at === returned.closed_at));
      assert.deepEqual(stored, returned, 'the committed timer leaves the dataset record');
      assert.ok(s.data.notices.some(n => n.subject.id === returned.fill_id && n.kind === 'notice.returned'));
    } else {
      assert.equal(stored.state, 'ready', 'a timer due exactly at the instant is left to the reads, as Core shows it');
      assert.ok(!s.timers_committed.some(x => x.fill_id === returned.fill_id && x.kind === 'return'));
    }
  }
  const s = asOf(plus(review.at, 121), files), fill = s.data.fills.find(f => f.requested_at === review.at);
  assert.notEqual(fill.state, 'requested', 'a review due before the instant is committed');
  assert.ok(s.timers_committed.some(x => x.kind === 'review' && x.fill_id === fill.fill_id));
});

const outcome = f => f.state + (f.cancellation ? ' (' + f.cancellation.reason + ')' : '');
function replayInApp(selection, entries) {
  const f = fixture({ seed: selection.data, now: selection.virtual_now });
  const statuses = [];
  for (const e of entries) {
    if (e.kind === 'event') { statuses.push(f.event(e.event).status); continue; }
    f.setNow(e.at);
    const name = e.tool.slice(P.length);
    let args = e.args;
    if (lib.PREVIEW[name]) {
      const token = f.call(P + lib.PREVIEW[name], e.args).preview.token;
      if (lib.CONFIRMED.has(name)) statuses.push(f.event({ event_id: 'confirm-' + e.id, at: e.at, operation: 'user.confirmed', payload: { token, confirmed_by: e.by } }).status);
      args = { ...e.args, token };
    }
    statuses.push(f.call(e.tool, args).status);
  }
  const end = project(f.data(), lib.END);
  const extra = [...writtenAfter(f.data(), selection.as_of)].filter(x => !DATASET_ENTRIES.has(x));
  return { statuses, extra, outcome: id => outcome(end.fills.find(x => x.fill_id === id)) };
}
const after = s => toIso(ms(s.at) + 1);
const prOf = id => files.full.plan_requests.find(r => r.plan_request_id === id);
function writtenAfter(data, from) {
  const out = new Set(), late = at => at && ms(at) >= ms(from);
  for (const f of data.fills) {
    for (const r of f.refusals) if (late(r.at)) out.add('refusal ' + f.fill_id + ' ' + r.at + ' ' + r.reason + ' ' + r.collector_id);
    for (const n of f.notes) if (late(n.at)) out.add('note ' + f.fill_id + ' ' + n.at + ' ' + n.text);
    if (f.state === 'collected' && late(f.closed_at)) out.add('collected ' + f.fill_id + ' ' + f.closed_at);
  }
  for (const c of data.charges) if (late(c.at)) out.add('charge ' + c.fill_id + ' ' + c.at + ' ' + c.method + ' ' + c.amount_cents);
  for (const r of data.plan_requests) if (late(r.closed_at) && r.decision) out.add('decision ' + r.fill_id + ' ' + r.closed_at + ' ' + r.decision);
  return out;
}
const DATASET_ENTRIES = writtenAfter(files.full, lib.START);
const REVIEWED = ['2025-07-08T21:37:00-04:00', '2026-01-10T11:00:00-05:00', '2025-03-31T12:00:00-04:00'];
const holderCreates = steps.filter(s => s.by === lib.OWNER && s.tool === P + 'plan_requests.create');
const withdrawals = steps.filter(s => s.tool === P + 'plan_requests.withdraw');
const firstCreate = w => { const fill = files.full.plan_requests.find(r => r.plan_request_id === w.args.plan_request_id).fill_id; return steps.find(s => s.tool === P + 'plan_requests.create' && s.args.fill_id === fill); };
const prepays = steps.filter(s => s.by === lib.OWNER && s.tool === P + 'fills.prepay.confirm');
const grantsByTool = steps.filter(s => s.tool === P + 'grants.change.confirm' && s.args.fill_id);
const CORE_CUTS = [...REVIEWED, ...holderCreates.map(s => s.at), ...withdrawals.map(w => firstCreate(w).at), prepays[0].at, prepays[prepays.length - 1].at, ...grantsByTool.map(s => s.at)];

test('Dataset at every cut the exported events alone and the exported account-holder script, replayed through the App, give the outcomes the selection states', () => {
  const cuts = [...steps.filter((s, i) => i % 12 === 0).map(after), ...REVIEWED, ...CORE_CUTS, ...withdrawals.map(w => after(steps.find(x => x.tool === P + 'fills.request' && files.full.fills.some(f => f.fill_id === prOf(w.args.plan_request_id).fill_id && f.requested_at === x.at))))];
  let open = 0, conditional = 0, actions = 0;
  for (const cut of cuts) {
    const s = asOf(cut, files);
    const events = replayInApp(s, s.events.map(event => ({ kind: 'event', event })));
    const script = replayInApp(s, s.account_holder_script);
    assert.ok([...events.statuses, ...script.statuses].every(x => x === 'committed'), cut + ': every exported step commits');
    assert.deepEqual(events.extra, [], cut + ': the events as given write no refusal, collection, charge, hold note or plan decision the dataset lacks');
    assert.deepEqual(script.extra, [], cut + ': the account-holder script writes nothing the dataset lacks');
    for (const o of s.open_fills) {
      open++;
      assert.equal(events.outcome(o.fill_id), o.after_staged_events, cut + ' ' + o.fill_id + ' after the exported events');
      assert.equal(script.outcome(o.fill_id), o.with_account_holder_actions, cut + ' ' + o.fill_id + ' after the account-holder script');
      assert.equal(o.with_household_actions, o.in_dataset, cut + ' ' + o.fill_id + ' with every household action');
      for (const a of o.actions) assert.equal(a.with_household_actions, 'committed', cut + ' ' + a.id);
    }
    conditional += s.conditional_events.length;
    actions += s.account_holder_script.filter(x => x.kind === 'action').length;
    const ids = s.account_holder_script.filter(x => x.kind === 'event').map(x => x.event.event_id);
    const position = x => s.account_holder_script.findIndex(e => (e.kind === 'event' ? e.event.event_id : e.id) === x);
    for (const c of s.conditional_events) assert.ok(ids.includes(c.event.event_id) && c.after.length > 0 && c.after.every(id => position(id) >= 0 && position(id) < position(c.event.event_id)), cut + ': a conditional event comes after the actions it needs');
  }
  assert.ok(open > 40 && conditional > 0 && actions > 0, open + ' open fills, ' + conditional + ' conditional events, ' + actions + ' account-holder actions');
});

test('Dataset a plan decision that needs an account-holder action is exported as a conditional event, and requests made by withheld actions are traced to their fill', () => {
  assert.ok(withdrawals.length > 0);
  const pickups = steps.filter(x => x.operation === 'fill.collection_attempted' && x.payload.collector_id === 'p-1');
  const prepaid = prepays.filter(p => pickups.some(x => x.payload.fill_id === p.args.fill_id && ms(x.at) > ms(p.at)));
  assert.ok(prepaid.length > 0, 'Sam collects a fill Alex prepays');
  for (const p of prepaid) {
    const s = asOf(p.at, files), pickup = pickups.find(x => x.payload.fill_id === p.args.fill_id && ms(x.at) > ms(p.at));
    const exported = s.conditional_events.find(c => c.event.event_id === lib.eventId(pickup));
    assert.ok(exported && exported.after.includes(p.id) && !s.events.some(e => e.event_id === lib.eventId(pickup)), p.at + ': Sam\'s pickup waits for the prepayment ' + p.id);
  }
  for (const create of holderCreates) {
    const s = asOf(create.at, files), made = files.full.plan_requests.find(r => r.fill_id === create.args.fill_id && r.created_at === create.at);
    const decision = steps.find(x => x.operation === 'plan.decided' && x.payload.plan_request_id === made.plan_request_id);
    const exported = s.conditional_events.find(c => c.event.operation === 'plan.decided' && c.event.event_id === lib.eventId(decision));
    assert.ok(exported && exported.after.includes(create.id), create.at + ': the decision on ' + made.plan_request_id + ' waits for ' + create.id);
    assert.ok(!s.events.some(e => e.event_id === lib.eventId(decision)), 'not an unconditional event');
  }
  for (const w of withdrawals) {
    const target = files.full.fills.find(f => f.fill_id === prOf(w.args.plan_request_id).fill_id);
    const request = asOf(toIso(ms(target.requested_at) + 1), files);
    const listed = request.open_fills.find(o => o.fill_id === target.fill_id);
    assert.ok(listed && listed.actions.some(a => a.id === w.id), w.id + ' is listed at its fill\'s request + 1 ms');
    assert.equal(listed.with_household_actions, listed.in_dataset);
    const create = firstCreate(w), s = asOf(create.at, files);
    const fill = s.open_fills.find(o => o.actions.some(a => a.id === w.id));
    assert.ok(fill, w.id + ' is listed for its fill at ' + create.at);
    assert.ok(fill.actions.some(a => a.id === create.id));
    assert.equal(fill.with_household_actions, fill.in_dataset, w.id);
  }
});

test('Dataset actions that need another household member are labelled, and the account holder sees exactly the fills the export names', () => {
  let others = 0;
  for (const cut of [...REVIEWED, ...steps.filter((s, i) => s.by === 'p-4' && i % 4 === 0).map(s => s.at)]) {
    const s = asOf(cut, files);
    const f = fixture({ seed: s.data, now: s.virtual_now });
    assert.deepEqual(f.call(P + 'fills.list', {}).fills.map(x => x.fill_id).sort(), [...s.account_holder.visible_fills].sort(), cut);
    assert.deepEqual(s.account_holder.visible_open_fills, s.open_fills.filter(o => o.visible_to_account_holder).map(o => o.fill_id));
    for (const o of s.open_fills) for (const a of o.actions) {
      assert.equal(a.account_holder, a.by === lib.OWNER);
      if (a.by !== lib.OWNER) { others++; assert.equal(a.with_account_holder_actions, 'not taken: needs ' + a.by); assert.ok(!s.account_holder_script.some(x => x.id === a.id)); }
    }
    for (const o of s.open_fills.filter(x => !x.visible_to_account_holder)) assert.equal(f.callRaw(P + 'fills.get', { fill_id: o.fill_id }).status, 'not_authorized', o.fill_id);
  }
  assert.ok(others > 0);
});

test('Dataset the account-holder script replays in real Core over MCP with the outcomes and visible fills the selection states', async () => {
  const path = require('node:path');
  const runtimeDir = path.resolve(process.env.PALE_RUNTIME_ROOT || path.join(lib.ROOT, '..', '..', 'runtime'));
  const { prepare } = require(path.join(runtimeDir, 'prepare.cjs'));
  const { Client } = require(path.join(runtimeDir, 'client.cjs'));
  const prepared = prepare(lib.ROOT), clients = [];
  const open = async role => { const c = new Client(prepared.app, role, 'dataset-script', path.join(prepared.root, 'state'), 'mendwell-dataset-script', { registry: prepared.registry }); clients.push(c); await c.initialize(); return c; };
  try {
    const infra = await open('infra'), agent = await open('agent');
    let v = (await infra.call('env.snapshot')).version, clock = null, n = 0;
    const step = async (client, name, args, expected) => { const out = await client.call(name, { ...args, expected_version: v }); if (out.version) v = out.version; assert.equal(out.status, expected, name + ' ' + (out.message || '')); return out; };
    const advance = async t => { if (ms(clock) < ms(t)) { await step(infra, 'env.advance_time', { virtual_now: t, request_id: 'adv-' + (++n) }, 'committed'); clock = t; } };
    for (const cut of CORE_CUTS) {
      const s = asOf(cut, files);
      await step(infra, 'env.load_seed', { request_id: 'load-' + (++n), data: s.data, virtual_now: s.virtual_now, bundle: s.bundle }, 'ready');
      clock = s.virtual_now;
      assert.deepEqual((await agent.call(P + 'fills.list', {})).fills.map(x => x.fill_id).sort(), [...s.account_holder.visible_fills].sort(), cut + ' visible fills');
      for (const e of s.account_holder_script) {
        if (e.kind === 'event') { await step(infra, 'env.apply_event', { event: e.event }, 'committed'); clock = e.event.at; continue; }
        await advance(e.at);
        const name = e.tool.slice(P.length);
        let args = e.args;
        if (lib.PREVIEW[name]) {
          const token = (await agent.call(P + lib.PREVIEW[name], e.args)).preview.token;
          if (lib.CONFIRMED.has(name)) await step(infra, 'env.apply_event', { event: { event_id: 'confirm-' + (++n), at: e.at, operation: 'user.confirmed', payload: { token, confirmed_by: e.by } } }, 'committed');
          args = { ...e.args, token };
        }
        await step(agent, e.tool, { ...args, request_id: 'act-' + (++n) }, 'committed');
      }
      await advance(lib.END);
      const end = project((await infra.call('env.snapshot')).snapshot.data, lib.END);
      for (const o of s.open_fills) assert.equal(outcome(end.fills.find(x => x.fill_id === o.fill_id)), o.with_account_holder_actions, cut + ' ' + o.fill_id + ' in Core');
    }
  } finally {
    await Promise.allSettled(clients.map(c => c.close()));
    prepared.cleanup();
  }
});

test('Dataset each counter visit takes every other ready fill there that the collector may collect and can pay for, and a fill left behind is caught', () => {
  const c = lib.counter(files.base, steps);
  assert.deepEqual([c.left, c.away], [[], []]);
  const { isOpen } = require('../src/time.cjs');
  const next = id => steps[steps.findIndex(x => x.id === id) + 1];
  const pairs = c.visits.filter(v => v.ok).flatMap(v => c.visits.filter(w => w.ok && w !== v && w.who === v.who && w.store === v.store && w.at > v.at && w.at <= v.at + 15 * 60000 && v.eligible.includes(w.fill_id)).map(w => [v, w]));
  const [first, second] = pairs.find(([, w]) => next(w.id) && ms(next(w.id).at) > w.at + 25 * 60000 && isOpen(files.full.stores.find(x => x.store_id === w.store), w.at + 20 * 60000)) || [];
  assert.ok(second, 'a visit that took a second fill');
  const moved = steps.map(x => x.id === second.id ? { ...x, at: toIso(second.at + 20 * 60000) } : x);
  const left = lib.counter(files.base, moved);
  assert.ok(left.left.some(x => x.startsWith(second.fill_id + ' left at ' + first.id)), JSON.stringify(left.left));
});

test('Dataset a missing or unparseable occurrence date is reported by ID and excluded, and the report text follows the numbers', () => {
  const changed = structuredClone(files);
  delete changed.full.prescriptions[0].received_at;
  changed.full.claims[0].at = 'not a time';
  const c = compute(changed), clean = compute(files);
  assert.deepEqual([clean.invalid_dates, clean.invalid, clean.outside], [0, [], []]);
  assert.deepEqual(c.invalid.map(i => i.kind + ' ' + i.id).sort(), ['claim ' + files.full.claims[0].claim_id, 'prescription ' + files.full.prescriptions[0].rx_id].sort());
  assert.deepEqual([c.invalid_dates, c.totals.records, c.totals.counted], [2, clean.totals.records, clean.totals.counted - 2]);
  assert.match(c.counting, /2 invalid or missing and 0 outside the window/);
  assert.doesNotMatch(c.counting, /There are none/);
  assert.match(render({ ...c, loading: null }), /Invalid or missing occurrence dates: 2 \(/);
});

test('Dataset provenance follows the bytes actually selected: mixed seed files, and hashes of the supplied inputs', () => {
  const c = compute(files);
  assert.deepEqual(c.sources.map(x => x.file + ' ' + x.kind), [lib.FILES.base + ' mixed', lib.FILES.replay + ' synthetic', lib.FILES.full + ' mixed']);
  for (const x of c.sources) assert.equal(x.sha256, lib.sha256(x.file));
  const changed = structuredClone(files);
  changed.base.stores[0].name = 'Mendwell Maple Avenue North';
  const s = asOf('2025-02-01', changed), base = lib.digestOf(lib.pretty(changed.base));
  assert.notEqual(base, lib.sha256(lib.FILES.base));
  assert.match(s.bundle.dataset.transformations[0], new RegExp(base));
  assert.doesNotMatch(s.bundle.dataset.transformations[0], new RegExp(lib.sha256(lib.FILES.base)));
  assert.equal(compute(changed).sources[0].sha256, base);
});

test('Dataset an impossible calendar date or time is refused in either input form', () => {
  for (const bad of ['2025-02-30', '2026-02-29', '2025-13-01', '2025-02-30T10:00:00-05:00', '2026-01-01T24:00:00-05:00', '2026-01-01T10:60:00-05:00', '2026-01-01T10:00:00+15:00', '2026-01-01T10:00']) assert.throws(() => asOf(bad, files), /Give the instant/, bad);
  assert.equal(asOf('2025-02-28', files).as_of, '2025-02-28T00:00:00-05:00');
});

test('Dataset the travel card is presented once and then retired, and late arrivals are drawn per visit, not at a fixed time', () => {
  const attempts = steps.filter(s => s.operation === 'fill.collection_attempted');
  const declined = attempts.filter(s => s.payload.card_id === 'card-2');
  assert.equal(declined.length, 1, 'the declined card is presented once');
  const closed = files.full.fills.flatMap(f => f.refusals.filter(r => r.reason === 'store_closed').map(r => r.at.slice(11, 16)));
  assert.ok(closed.length >= 1 && new Set(closed).size === closed.length, 'arrivals after closing at ' + closed.join(', '));
  const next = attempts.find(x => x.payload.fill_id === declined[0].payload.fill_id && ms(x.at) > ms(declined[0].at));
  assert.ok(next && next.payload.card_id !== 'card-2', 'the next attempt uses another card');
});

test('Dataset no replay step leaves the state as it was, and the generator refuses one that would', () => {
  const data = structuredClone(files.base), idle = [];
  for (const step of steps) {
    const pre = structuredClone(data);
    applyDueTimers(pre, step.at);
    const before = JSON.stringify({ ...pre, issued: null });
    lib.apply(data, step);
    if (JSON.stringify({ ...data, issued: null }) === before) idle.push(step.id);
  }
  assert.deepEqual(idle, []);
  const source = fs.readFileSync(lib.file('dataset/generate.cjs'), 'utf8');
  assert.match(source, /would not change the state/);
});

test('Dataset prescriber notes fall in office hours, and one outside them is caught', () => {
  const pa = files.full.plan_requests.filter(r => r.reason === 'prior_auth_required');
  assert.ok(pa.length > 0 && pa.every(r => notes.officeHours(r.created_at)));
  const releases = files.full.fills.flatMap(f => f.notes).filter(n => notes.PRESCRIBER_RELEASES.includes(n.text));
  assert.ok(releases.every(n => notes.officeHours(n.at)));
  const saturday = structuredClone(files.full), r = saturday.plan_requests.find(x => x.reason === 'prior_auth_required');
  const day = lib.dateOf(r.created_at); let sat = day; while (new Date(sat + 'T12:00:00Z').getUTCDay() !== 6) sat = lib.addDays(sat, 1);
  r.created_at = lib.at(sat, '10:30');
  assert.ok(notes.problems(saturday).some(p => /outside office hours/.test(p)));
  const evening = structuredClone(files.full), f = evening.fills.find(x => x.notes.length >= 2);
  f.notes[0].text = notes.REVIEW_HOLDS[0][0]; f.notes[1].text = notes.REVIEW_HOLDS[0][1]; f.notes[1].at = lib.at(lib.dateOf(f.notes[1].at), '19:30');
  assert.ok(notes.problems(evening).some(p => /outside the prescriber's office hours/.test(p)));
  const md = fs.readFileSync(lib.file(OUT.md), 'utf8'), readme = fs.readFileSync(lib.file('README.md'), 'utf8');
  assert.ok(/simplification/.test(md) && /simplification/.test(readme.slice(readme.indexOf('## Delivery dataset'))), 'the prior-authorization simplification is stated');
});

test('Dataset supply runs out only after a documented lost supply, for at most seven days, and no regimen has two pickups returned to stock in a row', () => {
  assert.deepEqual([lib.unexplainedGaps(files.full), lib.repeatedReturns(files.full)], [[], []]);
  const loss = files.full.plan_requests.find(r => r.note === notes.LOST), lostFill = files.full.fills.find(f => f.fill_id === loss.fill_id);
  const gap = lib.supplyGaps(files.full).find(g => g.after_loss === loss.plan_request_id), slow = structuredClone(files.full), replacement = slow.fills.find(f => f.fill_id === gap.fill_id);
  replacement.closed_at = toIso(ms(lostFill.requested_at) + 7 * 86400000 + 60000);
  assert.ok(lib.unexplainedGaps(slow).some(g => g.fill_id === gap.fill_id), 'seven days and one minute after a loss is too long, however the days are rounded');
  replacement.closed_at = toIso(ms(lostFill.requested_at) + 7 * 86400000);
  assert.ok(!lib.unexplainedGaps(slow).some(g => g.fill_id === gap.fill_id), 'exactly seven days is allowed');
  const late = structuredClone(files.full), f = late.fills.filter(x => x.state === 'collected' && late.prescriptions.find(r => r.rx_id === x.rx_id).drug_id === 'd-montelukast-4').at(-3);
  const drug = r => late.prescriptions.find(x => x.rx_id === r.rx_id);
  const same = late.fills.filter(x => x.state === 'collected' && drug(x).patient_id === drug(f).patient_id && drug(x).drug_id === drug(f).drug_id).sort((a, b) => ms(a.closed_at) - ms(b.closed_at));
  same.slice(1, -1).forEach(x => { x.state = 'cancelled'; });
  assert.ok(lib.shortages(late).length > lib.shortages(files.full).length, 'a long gap between collections is caught');
  const twice = structuredClone(files.full), list = twice.fills.filter(x => x.rx_id === f.rx_id && x.state === 'collected').slice(0, 2);
  for (const x of list) x.state = 'returned_to_stock';
  assert.ok(lib.repeatedReturns(twice).length > 0, 'two returns in a row are caught');
  for (const t of notes.TRIPS) for (const g of files.full.fills.filter(x => x.state === 'returned_to_stock')) {
    const rx = files.full.prescriptions.find(r => r.rx_id === g.rx_id);
    assert.ok(!(t.people.includes(rx.patient_id) && lib.dateOf(g.ready_at) <= t.to && lib.dateOf(g.closed_at) >= t.from), g.fill_id + ' was not left to return while ' + rx.patient_id + ' travelled');
  }
});

test('Dataset every early refill for a lost supply comes six to twelve days after that drug was collected', () => {
  const lost = files.full.plan_requests.filter(r => r.note === notes.LOST);
  assert.ok(lost.length >= 2);
  for (const r of lost) {
    const f = files.full.fills.find(x => x.fill_id === r.fill_id), rx = files.full.prescriptions.find(x => x.rx_id === f.rx_id);
    const previous = files.full.fills.filter(g => g.state === 'collected' && ms(g.closed_at) < ms(f.requested_at) && files.full.prescriptions.find(x => x.rx_id === g.rx_id).drug_id === rx.drug_id && files.full.prescriptions.find(x => x.rx_id === g.rx_id).patient_id === rx.patient_id).sort((a, b) => ms(b.closed_at) - ms(a.closed_at))[0];
    const days = (Date.parse(lib.dateOf(f.requested_at)) - Date.parse(lib.dateOf(previous.closed_at))) / 86400000;
    assert.ok(days >= 6 && days <= 12, r.plan_request_id + ': ' + days + ' days');
  }
});

test('Dataset published labels describe the records: collection counts, a genuine refill, the cash price, and the pinned proposal', () => {
  const readme = fs.readFileSync(lib.file('README.md'), 'utf8'), md = fs.readFileSync(lib.file(OUT.md), 'utf8');
  const attempts = steps.filter(s => s.operation === 'fill.collection_attempted');
  const refusals = files.full.fills.flatMap(f => f.refusals).length, collected = files.full.fills.filter(f => f.state === 'collected').length;
  assert.equal(attempts.length, collected + refusals);
  assert.ok(readme.includes(steps.filter(s => s.by !== 'infra').length + ' tool calls') && readme.includes(steps.filter(s => s.by === 'infra').length + ' Infra events'));
  assert.ok(readme.includes(attempts.length + ' counter collection attempts (' + collected + ' collections and ' + refusals + ' refusals)'), 'README collection counts');
  const reps = compute(files).representative, by = label => reps.find(r => r.example === label);
  const refill = files.full.fills.find(f => f.fill_id === by('routine refill paid at the counter').fill_id), rx = files.full.prescriptions.find(r => r.rx_id === refill.rx_id);
  assert.ok(files.full.fills.some(g => g !== refill && g.state === 'collected' && ms(g.closed_at) < ms(refill.requested_at) && files.full.prescriptions.some(r => r.rx_id === g.rx_id && r.patient_id === rx.patient_id && r.drug_id === rx.drug_id)), 'the refill follows an earlier collection');
  const cash = by('drug the plan does not cover, paid at the cash price');
  assert.ok(cash && /\(cash price\)/.test(cash.payment) && !reps.some(r => /in cash/.test(r.example)));
  const pinned = 'https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/c7ddf519b029cebe1c93c5bed50edb889cf34deb/proposals/environment/mendwell-pharmacy.md';
  for (const text of [readme.slice(readme.indexOf('## Delivery dataset')), md]) assert.ok(text.includes(pinned) && text.includes('PR #63'));
  assert.ok(!readme.slice(readme.indexOf('## Delivery dataset')).includes('](../../proposals/'));
});

test('Dataset hashes are taken from the bytes read, so one added newline changes them, the bundle and the report', () => {
  const read = lib.load(), base = read.bytes[lib.FILES.base];
  assert.equal(lib.digestOf(base), lib.sha256(lib.FILES.base));
  const changed = lib.load();
  Object.defineProperty(changed, 'bytes', { value: { ...read.bytes, [lib.FILES.base]: base + '\n' }, enumerable: false });
  const hash = lib.digestOf(base + '\n');
  assert.notEqual(hash, lib.sha256(lib.FILES.base));
  assert.match(asOf('2025-02-01', changed).bundle.dataset.transformations[0], new RegExp(hash));
  const sources = compute(changed).sources;
  assert.deepEqual([sources[0].sha256, sources[0].bytes], [hash, Buffer.byteLength(base) + 1]);
  assert.notDeepEqual(sources, JSON.parse(fs.readFileSync(lib.file(OUT.json), 'utf8')).sources, 'the committed report no longer matches, so coverage --check fails');
  const edited = lib.load();
  edited.base.stores[0].name = 'Mendwell Maple Avenue North';
  assert.notEqual(lib.digestOf(lib.bytesOf(edited)[lib.FILES.base]), lib.sha256(lib.FILES.base), 'an edited store name is not hashed as the bytes read');
  assert.equal(lib.digestOf(lib.bytesOf(edited)[lib.FILES.base]), lib.digestOf(lib.pretty(edited.base)));
  assert.doesNotMatch(asOf('2025-02-01', edited).bundle.dataset.transformations[0], new RegExp(lib.sha256(lib.FILES.base)));
  const trimmed = lib.load();
  trimmed.full.notices.pop();
  const c = compute(trimmed);
  assert.equal(c.totals.records, compute(read).totals.records - 1);
  assert.notEqual(c.sources[2].sha256, lib.sha256(lib.FILES.full), 'a removed notice is not counted under the original hash');
  assert.equal(lib.digestOf(lib.bytesOf(lib.load())[lib.FILES.full]), lib.sha256(lib.FILES.full), 'unchanged content keeps the hash of the bytes read');
});

test('Dataset refills are requested from projected depletion and billed once eligible, so too-soon rejections are occasional and supply on hand stays small', () => {
  const claims = files.full.claims, early = claims.filter(c => c.reason === 'refill_too_soon');
  assert.ok(early.length <= Math.ceil(files.full.fills.length * 0.08), early.length + ' too-soon rejections in ' + files.full.fills.length + ' fills');
  for (const c of early) {
    const f = files.full.fills.find(x => x.fill_id === c.fill_id), noted = files.full.plan_requests.some(r => r.fill_id === f.fill_id && (r.note === notes.LOST || notes.TRAVEL.includes(r.note)));
    const days = (Date.parse(c.eligible_on) - Date.parse(lib.dateOf(f.requested_at))) / 86400000;
    assert.ok(noted || days >= 7, c.claim_id + ': a too-soon rejection comes from a lost supply, a trip or a request at least a week early (' + days + ' days)');
  }
  const hand = lib.onHand(files.full, steps).map(x => x.days).filter(x => x !== null).sort((a, b) => a - b);
  const median = hand[Math.floor(hand.length / 2)];
  assert.ok(hand[0] >= 0 && median <= 10 && hand.at(-1) <= 45, 'on hand at a request: min ' + hand[0] + ', median ' + median + ', max ' + hand.at(-1));
  const md = fs.readFileSync(lib.file(OUT.md), 'utf8');
  assert.ok(md.includes('Supply on hand when a refill is requested: ' + hand[0] + ' to ' + hand.at(-1) + ' days, ' + median + ' at the median'));
});

test('Dataset supply is checked through the window end with documented losses deducted, and a missing late pickup is caught', () => {
  const gaps = lib.supplyGaps(files.full), lostRequests = files.full.plan_requests.filter(r => r.note === notes.LOST);
  assert.equal(gaps.length, lostRequests.length, 'one reported gap per lost supply: ' + JSON.stringify(gaps));
  for (const g of gaps) assert.ok(g.kind === 'between_pickups' && lostRequests.some(r => r.plan_request_id === g.after_loss) && g.days > 0 && g.days <= 7, JSON.stringify(g));
  assert.deepEqual(lib.shortages(files.full).length, gaps.length);
  const report = compute(files).household.supply_gaps, md = fs.readFileSync(lib.file(OUT.md), 'utf8'), readme = fs.readFileSync(lib.file('README.md'), 'utf8');
  assert.deepEqual(report, gaps);
  assert.ok(md.includes(lib.LOSS_METHOD) && /empties all supply on hand/.test(readme), 'the method is stated in COVERAGE and the README');
  assert.ok(!/ignor/i.test(md.slice(md.indexOf('- Supply method'), md.indexOf('- Supply on hand'))) && !/ignores the losses/.test(readme), 'only the stated method is reported');
  assert.ok(md.includes('Supply gaps: ' + gaps.length + ' (') && gaps.every(g => md.includes(g.key + ' ' + g.days + ' days')), 'COVERAGE states every gap');
  assert.ok(gaps.every(g => readme.includes(g.days.toFixed(1) + ' days')), 'the README states every gap');
  assert.deepEqual(lib.supplyGaps(files.full, '2025-07-01T00:00:00-04:00'), [], 'a cutoff before both gaps reports neither');
  const first = [...gaps].sort((a, b) => ms(a.to) - ms(b.to))[0];
  assert.deepEqual(lib.supplyGaps(files.full, toIso(ms(first.to) + 1)).map(g => g.fill_id), [first.fill_id], 'a cutoff just after the first gap reports only that gap');
  const none = structuredClone(files.full);
  for (const f of none.fills) if (none.prescriptions.find(r => r.rx_id === f.rx_id).drug_id === 'd-lisinopril-10' && f.state === 'collected') f.state = 'cancelled';
  assert.ok(lib.shortages(none).includes('p-2 d-lisinopril-10: no pickup at all'), 'a regimen never collected is flagged');
  const cut = structuredClone(files.full), rx = id => cut.prescriptions.find(r => r.rx_id === id);
  const last = cut.fills.filter(f => f.state === 'collected' && rx(f.rx_id).drug_id === 'd-lisinopril-10').sort((a, b) => ms(a.closed_at) - ms(b.closed_at)).slice(-2);
  for (const f of last) f.state = 'cancelled';
  assert.ok(lib.shortages(cut).some(x => /d-lisinopril-10: the supply runs out [0-9.]+ days before/.test(x)), JSON.stringify(lib.shortages(cut)));
  const lost = files.full.plan_requests.filter(r => r.note === notes.LOST);
  for (const r of lost) assert.equal(lib.onHand(files.full, steps).find(x => x.at === files.full.fills.find(f => f.fill_id === r.fill_id).requested_at).days, 0, r.plan_request_id + ': nothing on hand after a lost supply');
});

test('Dataset no fill becomes ready while its patient is away, and one that does is caught', () => {
  assert.deepEqual(lib.readyWhileAway(files.full), []);
  const moved = structuredClone(files.full), trip = notes.TRIPS[0], f = moved.fills.find(x => x.ready_at && trip.people.includes(moved.prescriptions.find(r => r.rx_id === x.rx_id).patient_id));
  f.ready_at = lib.at(trip.from, '12:00');
  assert.equal(lib.readyWhileAway(moved).length, 1);
});

test('Dataset the report lists the prescriptions replaced at the yearly visit without a renewal, and labels the expiry case from its records', () => {
  const c = compute(files), list = c.household.replaced_without_renewal;
  const exhausted = files.full.prescriptions.filter(r => r.fills_remaining === 0 && r.state === 'active' && !['d-albuterol-90', 'd-amoxicillin-250-5'].includes(r.drug_id) && !files.full.renewals.some(n => n.rx_id === r.rx_id));
  assert.deepEqual(list.map(r => r.rx_id), exhausted.map(r => r.rx_id));
  for (const r of list.filter(x => x.replaced_by)) assert.ok(r.days_between >= 0 && r.days_between <= 45, r.rx_id);
  const md = fs.readFileSync(lib.file(OUT.md), 'utf8');
  assert.ok(md.includes(list.filter(r => r.replaced_by).length + ' prescriptions whose last refill was collected in the 45 days before the yearly visit are not renewed'));
  const expired = files.full.fills.find(f => f.cancellation && f.cancellation.reason === 'rx_expired'), rep = c.representative.find(r => r.fill_id === expired.fill_id);
  const held = expired.notes.length % 2 === 1;
  assert.ok(held ? rep.example.includes('while on the pharmacist\'s hold "' + expired.notes.at(-1).text + '"') : rep.example.includes('while ' + expired.cancellation.stage.replace(/_/g, ' ')), rep.example);
  assert.equal(expired.cancellation.at, toIso(rxExpiry(files.full.prescriptions.find(r => r.rx_id === expired.rx_id).written_on)));
});

test('Dataset the prescriber and the plan keep business days without federal holidays, nobody walks into a closed store twice in an evening, and no fill is collected after its prescription expired', () => {
  assert.deepEqual([notes.problems(files.full, steps), lib.lateWalkIns(files.full), lib.afterExpiry(files.full)], [[], [], []]);
  for (const r of files.full.prescriptions) assert.ok(notes.officeHours(r.received_at), r.rx_id);
  for (const r of files.full.plan_requests.filter(x => x.decision)) assert.ok(notes.officeHours(r.closed_at), r.plan_request_id);
  const holiday = structuredClone(files.full), pa = holiday.plan_requests.find(x => x.reason === 'prior_auth_required');
  pa.created_at = '2025-09-01T10:30:00-04:00';
  assert.ok(notes.problems(holiday).some(p => p.includes(pa.plan_request_id) && /outside office hours/.test(p)), 'a form sent on Labor Day is caught');
  const eve = structuredClone(files.full), decided = eve.plan_requests.find(x => x.decision);
  decided.closed_at = '2026-12-24T11:03:00-05:00';
  assert.ok(notes.problems(eve).some(p => p.includes(decided.plan_request_id) && /outside business hours/.test(p)), 'a decision on December 24 is caught');
  const night = structuredClone(files.full), refused = night.fills.find(f => f.refusals.some(r => r.reason === 'store_closed')), first = refused.refusals.find(r => r.reason === 'store_closed');
  const other = night.fills.find(f => f !== refused && f.store_id === refused.store_id);
  other.refusals.push({ refusal_id: 'rf-x', reason: 'store_closed', collector_id: first.collector_id, at: toIso(ms(first.at) + 10 * 60000) });
  assert.equal(lib.lateWalkIns(night).length, 1, 'a second walk-in after closing is caught');
  const late = structuredClone(files.full), f = late.fills.find(x => x.state === 'collected'), rx = late.prescriptions.find(r => r.rx_id === f.rx_id);
  f.closed_at = toIso(rxExpiry(rx.written_on) + 60000);
  assert.equal(lib.afterExpiry(late).length, 1, 'a collection after expiry is caught');
});

test('Dataset a selection at the fixture clock shares the fixture household and catalog, loads, and continues every ID sequence', () => {
  const s = asOf(lib.REFERENCE, files);
  assert.deepEqual(generate.catalog(s.data), generate.catalog(lib.read('fixtures/minimal.json')));
  const f = fixture({ seed: s.data, now: s.virtual_now });
  const rx = s.data.prescriptions.find(r => r.patient_id === 'p-2' && r.state === 'active' && r.fills_remaining > 0 && !s.data.fills.some(x => x.rx_id === r.rx_id && !TERMINAL.includes(x.state)) && ms(s.virtual_now) < rxExpiry(r.written_on));
  assert.equal(f.call(P + 'fills.request', { rx_id: rx.rx_id, store_id: 'st-1', quantity: rx.quantity }).fill.fill_id, 'f-' + (s.data.issued.f + 1));
  const id = 'f-' + (s.data.issued.f + 1);
  f.advance(150);
  const read = f.call(P + 'fills.get', { fill_id: id }).fill;
  assert.ok(read.state !== 'requested' && read.claim !== null, 'the review is read as due');
  assert.equal(f.call(P + 'fills.cancel.confirm', { fill_id: id, token: f.call(P + 'fills.cancel.preview', { fill_id: id }).preview.token }).status, 'committed');
  const data = f.data();
  const fresh = (list, key, prefix) => data[list].slice(s.data[list].length).map(r => r[key]);
  const claims = fresh('claims', 'claim_id'), notices = fresh('notices', 'notice_id');
  assert.deepEqual(claims, claims.map((x, i) => 'cl-' + (s.data.issued.cl + 1 + i)), 'claims continue the series');
  assert.deepEqual(notices, notices.map((x, i) => 'n-' + (s.data.issued.n + 1 + i)), 'notices continue the series');
  assert.ok(data.claims.some(c => c.fill_id === id && claims.includes(c.claim_id)) && data.notices.some(n => n.subject.id === id && notices.includes(n.notice_id)));
});

test('Dataset every replayed state is valid, the replay reproduces the committed files, and the window holds every kind of record and outcome', () => {
  lib.validate(files.base, lib.START);
  lib.validate(files.full, lib.END);
  const { data, applied } = lib.replay(files.base, steps, undefined, { check: true });
  assert.equal(applied, steps.length);
  assert.equal(lib.pretty(generate.selectEnd(data)), fs.readFileSync(lib.file(lib.FILES.full), 'utf8'));
  const end = asOf(lib.END, files);
  end.data.seed_id = lib.SEED_IDS.full;
  assert.equal(lib.pretty(end.data), fs.readFileSync(lib.file(lib.FILES.full), 'utf8'));
  assert.equal(lib.replayText(files.replay), fs.readFileSync(lib.file(lib.FILES.replay), 'utf8'));
  const iso = strings([files.base, files.replay, files.full]).filter(x => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(x));
  assert.ok(iso.every(x => x.slice(-6) === toIso(ms(x)).slice(-6)), 'every time written with the zone offset in force');
  assert.deepEqual(generate.variety(files.full, steps), []);
  const counter = lib.counter(files.base, steps);
  assert.deepEqual([counter.away, counter.left], [[], []]);
  assert.ok(counter.visits.filter(v => v.ok).length > 100);
  assert.ok(steps.every(s => s.by === 'infra' || ['p-1', 'p-2', 'p-4'].includes(s.by)));
  const by = (list, key, id) => files.full[list].find(r => r[key] === id);
  const patientOf = a => {
    const rx = a.rx_id ? by('prescriptions', 'rx_id', a.rx_id) : a.fill_id ? by('prescriptions', 'rx_id', by('fills', 'fill_id', a.fill_id).rx_id) : a.plan_request_id ? by('prescriptions', 'rx_id', by('fills', 'fill_id', by('plan_requests', 'plan_request_id', a.plan_request_id).fill_id).rx_id) : a.renewal_id ? by('prescriptions', 'rx_id', by('renewals', 'renewal_id', a.renewal_id).rx_id) : null;
    return rx ? rx.patient_id : a.patient_id || (a.grant_id && by('grants', 'grant_id', a.grant_id).patient_id);
  };
  assert.ok(steps.filter(s => s.by === 'p-4').every(s => patientOf(s.args) === 'p-4'), 'Elena acts only on her own records');
  assert.ok(steps.filter(s => s.by === 'p-2').every(s => ['p-1', 'p-2', 'p-3'].includes(patientOf(s.args))), 'Alex acts on his own, Sam\'s and Mia\'s records');
  const { BRANDS } = require('../dev/check-fixture.cjs');
  assert.deepEqual(strings([files.base, files.replay, files.full]).filter(x => BRANDS.test(x)), [], 'no brand, chain, insurer or card-network names');
  assert.throws(() => asOf('2024-12-31', files), /dataset window/);
  assert.throws(() => asOf('next week', files), /Give the instant/);
});

test('Dataset the committed coverage report matches a fresh computation, its hashes and its MCP read-back', () => {
  const committed = JSON.parse(fs.readFileSync(lib.file(OUT.json), 'utf8'));
  const { loading, ...counted } = committed;
  assert.deepEqual(counted, compute(files));
  for (const source of committed.sources) assert.equal(source.sha256, lib.sha256(source.file), source.file);
  for (const m of committed.method) assert.equal(m.sha256, lib.sha256(m.file), m.file);
  assert.equal(render(committed), fs.readFileSync(lib.file(OUT.md), 'utf8'));
  assert.deepEqual(loading.instants.map(x => x.as_of), instantsOf(files));
  assert.ok(loading.instants.some(x => x.timers_committed > 0), 'a loaded cut commits a due timer');
  for (const x of loading.instants) {
    const fresh = asOf(x.as_of, files);
    assert.deepEqual([x.seed_id, x.load.loaded_objects, x.fills_in_selection, x.steps_applied, x.timers_committed], [fresh.data.seed_id, plugin.objects(fresh.data).length, fresh.data.fills.length, fresh.steps_applied, fresh.timers_committed.length], x.as_of + ' matches a fresh selection');
    assert.deepEqual([x.load.status, x.load.automated_checks, x.agent_clock, x.listed_ids_match_grants, x.states_match_app_reads, x.monthly_read_back_matches_selection, x.open_fills_match_core], ['ready', 'pass', x.as_of, true, true, true, true], x.as_of);
    assert.deepEqual(x.open_fills, asOf(x.as_of, files).open_fills.map(o => o.fill_id + ' ' + o.status));
    assert.ok(!x.latest_requested_at || ms(x.latest_requested_at) < ms(x.as_of));
    assert.ok(x.drug_facts_shown && x.drug_facts_shown.facts === 2 && x.drug_facts_shown.publisher === 'DailyMed, U.S. National Library of Medicine');
  }
  const whole = loading.instants.at(-1).monthly_read_back;
  for (const m of committed.monthly) for (const key of Object.keys(whole[m.month])) assert.equal(whole[m.month][key], m[key], m.month + ' ' + key);
  const declared = lib.read('contribution/dataset.json').sources.find(s => s.source_id === 'delivery-dataset');
  assert.deepEqual([declared.kind, declared.generation.tool, declared.generation.seed, declared.generation.tool_version], ['synthetic', 'dataset/generate.cjs', String(generate.SEED), generate.VERSION]);
  assert.deepEqual([declared.generation.parameters.from, declared.generation.parameters.to, declared.generation.parameters.time_zone], [lib.FIRST, lib.LAST, lib.ZONE]);
  assert.ok(!lib.read('contribution/dataset.json').record_source_ids.includes('delivery-dataset'), 'the fixture bundle cites only the fixture sources');
});
