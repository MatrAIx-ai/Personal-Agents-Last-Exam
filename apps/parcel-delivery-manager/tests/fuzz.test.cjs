'use strict';
// Randomized state-machine test. From each catalog seed it applies a few hundred random
// Agent operations and carrier events (valid, stale, out of order and unauthorized) and
// checks invariants after every step. The random numbers come from fixed seeds, so the test
// is deterministic and a failure names the steps that led to it.
const test = require('node:test');
const assert = require('node:assert/strict');
const {fixture} = require('./harness.cjs');

const index = require('../fixtures/seeds/index.json');
const binding = require('../fixtures/binding.json');
const PEOPLE = binding.people.map(p => p.person_id);
const TERMINAL = ['delivered', 'collected', 'returned'];
const account = person => binding.accounts.find(a => a.owner_person_id === person).account_id;
const strip = ({account_id, owner_person_id, ...ledger}) => ledger;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const HOUR = 3600000;

function random(seed) { // mulberry32
  let a = seed >>> 0;
  const next = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const int = (min, max) => min + Math.floor(next() * (max - min + 1));
  return {next, int, pick: list => list[int(0, list.length - 1)], chance: p => next() < p};
}
const iso = ms => new Date(ms).toISOString().replace('.000Z', 'Z');
const day = ms => new Date(ms).toISOString().slice(0, 10);

// What must hold between two consecutive ledgers. `event` is false for Agent operations.
function invariants(prev, next, {event, label}) {
  const where = message => label + ': ' + message;
  for (const key of ['changes', 'grants', 'passes', 'notices']) {
    assert.ok(next[key].length >= prev[key].length, where(key + ' shrank'));
    assert.deepEqual(next[key].slice(0, prev[key].length).map(x => x.id), prev[key].map(x => x.id), where(key + ' were reordered or renamed'));
  }
  assert.ok(same(next.notices.slice(0, prev.notices.length), prev.notices), where('an existing notice changed'));
  for (const before of prev.shipments) {
    const after = next.shipments.find(s => s.id === before.id);
    assert.ok(after, where('parcel disappeared'));
    assert.ok(after.plan.revision >= before.plan.revision && after.pickup_epoch >= before.pickup_epoch, where('plan revision or pickup epoch went backwards'));
    assert.ok(same(after.timeline.slice(0, before.timeline.length), before.timeline) && same(after.history.slice(0, before.history.length), before.history), where('history was rewritten'));
    if (TERMINAL.includes(before.status)) assert.ok(same(after, before), where('a closed parcel changed'));
    if (before.status === 'returning') assert.ok(['returning', 'returned'].includes(after.status) && same(after.plan, before.plan), where('a returning parcel left the return path'));
    if (before.pickup && after.pickup && after.pickup.epoch === before.pickup.epoch) assert.ok(same(after.pickup, before.pickup), where('a pickup deadline moved within one arrival'));
    if (same(after.plan, before.plan) === false) assert.equal(after.plan.revision, before.plan.revision + 1, where('the plan changed without one new revision'));
    // Only trusted events move a parcel, decide a request or change its plan.
    if (!event) {
      for (const field of ['status', 'plan', 'pickup', 'pickup_epoch', 'attempt', 'return_info', 'completed_at', 'estimated_delivery']) {
        assert.ok(same(after[field], before[field]), where('an Agent operation changed ' + field));
      }
    }
    if (after.status === 'collected' && before.status !== 'collected') {
      const used = next.passes.filter(p => p.shipment_id === after.id && p.status === 'consumed' && !prev.passes.some(q => q.id === p.id && q.status === 'consumed'));
      assert.equal(used.length, 1, where('a handoff did not consume exactly one pass'));
    }
  }
  for (const before of prev.changes) {
    const after = next.changes.find(c => c.id === before.id);
    if (before.status !== 'pending') assert.ok(same(after, before), where('a decided request changed'));
    else if (!event) assert.ok(['pending', 'cancelled'].includes(after.status), where('an Agent operation decided a request'));
  }
  for (const before of prev.passes) {
    const after = next.passes.find(p => p.id === before.id);
    assert.equal(after.code, before.code, where('a pass code changed'));
    if (before.status !== 'active') assert.ok(same(after, before), where('an ended pass changed'));
  }
  for (const before of prev.grants) if (before.status !== 'active') assert.ok(same(next.grants.find(g => g.id === before.id), before), where('an ended authorization changed'));
  for (const s of next.shipments) {
    assert.ok(next.passes.filter(p => p.shipment_id === s.id && p.status === 'consumed').length <= s.pickup_epoch, where('more handoffs than arrivals'));
    if (s.status !== 'at_pickup') assert.ok(!next.passes.some(p => p.shipment_id === s.id && p.status === 'active'), where('a pass is active for a parcel that is not ready'));
  }
}

function world(seedId, rng) {
  const entry = index.seeds.find(s => s.id === seedId);
  let data = strip(structuredClone(require('../fixtures/' + entry.seed))), now = Date.parse(entry.virtual_now), eventNumber = 0;
  const log = [];
  // One step as one person. A refusal must leave the ledger untouched; anything else is a defect.
  function step(person, label, fn, event = false) {
    const f = fixture({seed: {...structuredClone(data), account_id: account(person), owner_person_id: person}, virtual_now: iso(now), logging: false});
    const before = f.data;
    let outcome = 'ok';
    try { fn(f); } catch (e) {
      if (!e.code || e.code === 'ERR_ASSERTION' || e instanceof TypeError || e instanceof RangeError) {
        e.message = seedId + ' step ' + (log.length + 1) + ' [' + label + '] failed unexpectedly: ' + e.message + '\n  recent steps:\n  ' + log.slice(-10).join('\n  ');
        throw e;
      }
      assert.deepEqual(f.data, before, label + ' was refused (' + e.code + ') but changed data');
      outcome = e.code;
    }
    const next = strip(f.data);
    invariants(data, next, {event, label: seedId + ' step ' + (log.length + 1) + ' [' + label + ' → ' + outcome + ']'});
    data = next;
    assert.ok(Date.parse(f.ctx.virtual_now) >= now, 'clock went backwards');
    now = Date.parse(f.ctx.virtual_now);
    log.push(label + ' → ' + outcome);
    return outcome;
  }
  const parcel = () => rng.pick(data.shipments);
  // Prefer parcels that are still open, so the walk does not spend itself on closed ones.
  const active = () => { const open = data.shipments.filter(s => !TERMINAL.includes(s.status)); return open.length && rng.chance(0.9) ? rng.pick(open) : parcel(); };
  const person = () => rng.pick(PEOPLE);
  const owner = s => (rng.chance(0.85) ? s.recipient_person_id : person());
  const someId = (list, fallback) => (list.length && rng.chance(0.9) ? rng.pick(list).id : fallback);

  const operations = {
    advance() { now += rng.int(0, rng.chance(0.2) ? 30 * 60 : 4 * 60) * 60000; log.push('clock → ' + iso(now)); },
    // A new parcel enters the ledger the way a Task or Infra would seed it.
    ship() {
      const recipient = rng.pick(['person-maya', 'person-idris', 'person-chloe']), id = 'F' + String(data.shipments.length + 1).padStart(3, '0'), at = iso(now);
      const home = data.addresses.find(a => a.person_id === recipient && a.verified && !a.delivery_restricted), delivery = day(now + rng.int(2, 5) * 24 * HOUR);
      data.shipments.push({id, tracking_number: 'NLFUZZ' + id, recipient_person_id: recipient, sender_label: 'Fuzz Sender', contents_label: 'Fuzz parcel ' + id, policy_id: rng.pick(data.policies).id,
        created_at: at, updated_at: at, estimated_delivery: delivery, status: 'in_transit', plan: {revision: 1, mode: 'home', address_id: home.id, point_id: null, delivery_date: delivery, hold_until: null},
        pending_change_id: null, pickup_epoch: 0, pickup: null, attempt: null, return_info: null, completed_at: null,
        timeline: [{at, kind: 'label_created', summary: 'Shipping label created by the sender.'}], history: [{at, action: 'created'}]});
      log.push('ship ' + id + ' for ' + recipient);
    },
    change() {
      const s = active(), kind = rng.pick(['reschedule', 'address', 'hold', 'redirect', 'home_delivery']);
      const date = () => day(now + rng.int(-2, 10) * 24 * HOUR), address = () => someId(data.addresses, 'addr-none'), point = () => someId(data.pickup_points, 'P99');
      let args = {reschedule: () => ({delivery_date: date()}), address: () => ({address_id: address(), ...(rng.chance(0.3) ? {delivery_date: date()} : {})}), hold: () => ({hold_until: date()}),
        redirect: () => ({point_id: point()}), home_delivery: () => ({address_id: address(), ...(rng.chance(0.3) ? {delivery_date: date()} : {})})}[kind]();
      const who = owner(s);
      // Most of the time ask for something the App itself lists as available, so the walk reaches deep states.
      if (who === s.recipient_person_id && rng.chance(0.75)) {
        const o = fixture({seed: {...structuredClone(data), account_id: account(who), owner_person_id: who}, virtual_now: iso(now), logging: false}).call('options.get', {id: s.id}).options;
        if (kind === 'reschedule' && o.reschedule.allowed) args = {delivery_date: rng.pick([o.reschedule.earliest_date, o.reschedule.latest_date])};
        if (kind === 'hold' && o.hold.allowed) args = {hold_until: o.hold.latest_date};
        if (kind === 'address' && o.address.address_ids.length) args = {address_id: rng.pick(o.address.address_ids)};
        if (kind === 'redirect' && o.redirect.point_ids.length) args = {point_id: rng.pick(o.redirect.point_ids)};
        if (kind === 'home_delivery' && o.home_delivery.address_ids.length) args = {address_id: rng.pick(o.home_delivery.address_ids)};
      }
      step(who, 'change ' + kind + ' ' + s.id, f => {
        const preview = f.call('change.preview', {id: s.id, kind, ...args}).preview;
        assert.equal(preview.allowed, preview.reason === null);
        assert.equal(preview.allowed, preview.confirmation !== null);
        const confirmation = preview.allowed && rng.chance(0.9) ? preview.confirmation : 'cf-wrong';
        const result = f.call('change.submit', {id: s.id, kind, ...args, confirmation});
        assert.ok(preview.allowed && confirmation === preview.confirmation, 'a refused or unconfirmed request was accepted');
        assert.equal(result.change_status, 'pending');
      });
    },
    cancel() { const id = someId(data.changes, 'C999'); step(rng.chance(0.8) ? data.shipments.find(s => s.id === data.changes.find(c => c.id === id)?.shipment_id)?.recipient_person_id || person() : person(), 'cancel ' + id, f => f.call('change.cancel', {id})); },
    grant() {
      const ready = data.shipments.filter(x => x.status === 'at_pickup'), s = ready.length && rng.chance(0.8) ? rng.pick(ready) : active();
      const saved = data.collectors.filter(c => c.recipient_person_id === s.recipient_person_id).map(c => c.person_id);
      const collector = saved.length && rng.chance(0.8) ? rng.pick(saved) : person();
      const limit = s.pickup ? Date.parse(s.pickup.deadline) : now + 48 * HOUR;
      const expires = rng.chance(0.75) && limit > now + 60000 ? iso(now + Math.max(60000, Math.floor(rng.next() * Math.min(limit - now, 20 * HOUR) / 60000) * 60000)) : iso(now + rng.int(-120, 96 * 60) * 60000);
      const current = data.grants.filter(g => g.shipment_id === s.id && g.status === 'active');
      const replaces = current.length && rng.chance(0.5) ? {replaces_grant_id: rng.pick(current).id} : rng.chance(0.1) ? {replaces_grant_id: someId(data.grants, 'G999')} : {};
      step(owner(s), 'authorize ' + collector + ' for ' + s.id, f => {
        const fields = {collector_person_id: collector, expires_at: expires, ...replaces}, preview = f.call('grant.preview', {id: s.id, ...fields}).preview;
        assert.equal(preview.allowed, preview.reason === null);
        const created = f.call('grant.create', {id: s.id, ...fields, confirmation: preview.allowed ? preview.confirmation : 'cf-wrong'});
        assert.ok(preview.allowed && created.grant_id && created.pass_id, 'a refused authorization was created');
      });
    },
    revoke() { const id = someId(data.grants, 'G999'); step(rng.chance(0.8) ? data.shipments.find(s => s.id === data.grants.find(g => g.id === id)?.shipment_id)?.recipient_person_id || person() : person(), 'revoke ' + id, f => f.call('grant.revoke', {id})); },
    // Every read as a random person: nothing may throw unexpectedly, change data or show more than it should.
    read() {
      const who = person(), clock = now;
      const live = (s, g) => g.status === 'active' && s.status === 'at_pickup' && s.pickup && g.pickup_epoch === s.pickup.epoch && g.point_id === s.pickup.point_id && clock < Date.parse(g.expires_at);
      const expected = data.shipments.filter(s => s.recipient_person_id === who || data.grants.some(g => g.shipment_id === s.id && g.collector_person_id === who && live(s, g))).map(s => s.id).sort();
      step(who, 'read as ' + who, f => {
        assert.deepEqual(f.call('shipments.list', {include_closed: true}).items.map(x => x.id).sort(), expected, 'visible parcels differ from ownership and current authorizations');
        f.call('points.list'); f.call('collectors.list'); f.call('changes.list');
        assert.ok(f.call('addresses.list').items.every(a => data.addresses.find(x => x.id === a.id).person_id === who));
        assert.ok(f.call('notices.list').items.every(n => n.audience.includes(who) && (n.shipment_id === null || expected.includes(n.shipment_id))));
        assert.ok(f.call('grants.list').items.every(g => expected.includes(g.shipment_id)));
        for (const s of data.shipments) {
          const visible = expected.includes(s.id), recipient = s.recipient_person_id === who;
          const attempt = (name, args) => { try { return f.call(name, args); } catch (e) { if (!e.code || e.code === 'ERR_ASSERTION') throw e; return e.code; } };
          const got = attempt('shipments.get', {id: s.id});
          assert.equal(got === 'not_found', !visible, 'shipments.get visibility for ' + s.id);
          if (visible && !recipient) assert.deepEqual([got.shipment.plan, got.shipment.tracking_number, got.shipment.timeline], [null, null, []], 'collector saw recipient details');
          const options = attempt('options.get', {id: s.id});
          assert.equal(options === 'not_found', !recipient, 'options.get is for the recipient only');
          const pass = attempt('pass.get', {id: s.id});
          if (!visible) assert.equal(pass, 'not_found');
          else if (typeof pass === 'object') assert.equal(pass.pass.holder_person_id, who);
        }
      });
    },
    event() {
      const s = active(), at = iso(now + rng.int(0, rng.chance(0.3) ? 12 * 60 : 60) * 60000), revision = rng.chance(0.85) ? s.plan.revision : rng.int(1, s.plan.revision + 1);
      const point = () => (s.plan.point_id && rng.chance(0.8) ? s.plan.point_id : someId(data.pickup_points, 'P99'));
      const kinds = {
        change_resolved: () => {
          const pending = data.changes.filter(c => c.status === 'pending'), c = pending.length && rng.chance(0.8) ? rng.pick(pending) : data.changes.length ? rng.pick(data.changes) : null;
          const rejected = rng.chance(0.3);
          return {shipment_id: c && rng.chance(0.95) ? c.shipment_id : s.id, change_id: c ? c.id : 'C999', base_plan_revision: c && rng.chance(0.9) ? c.base_plan_revision : revision,
            decision: rejected ? 'rejected' : 'applied', reason: rejected && rng.chance(0.9) ? 'The carrier could not accept this request.' : null};
        },
        transit_update: () => ({shipment_id: s.id, plan_revision: revision, status: rng.pick(['in_transit', 'out_for_delivery']), estimated_delivery: rng.chance(0.5) ? day(now + 24 * HOUR) : null}),
        delivery_failed: () => ({shipment_id: s.id, plan_revision: revision, reason: 'Nobody was available to receive the parcel.'}),
        delivered: () => ({shipment_id: s.id, plan_revision: revision}),
        pickup_ready: () => ({shipment_id: s.id, plan_revision: revision, point_id: point(), pickup_epoch: rng.chance(0.85) ? s.pickup_epoch + 1 : rng.int(1, s.pickup_epoch + 2)}),
        point_status: () => ({point_id: someId(data.pickup_points, 'P99'), status: rng.pick(['open', 'closed']), note: rng.chance(0.5) ? 'Temporary notice.' : null}),
        relocated: () => ({shipment_id: s.id, plan_revision: revision, to_point_id: someId(data.pickup_points, 'P99'), reason: 'Capacity.'}),
        collected: () => {
          const collector = rng.chance(0.6) ? s.recipient_person_id : person();
          const own = data.passes.find(p => p.shipment_id === s.id && p.holder_person_id === collector && p.status === 'active'), any = data.passes.length ? rng.pick(data.passes) : null;
          return {shipment_id: s.id, point_id: s.pickup && rng.chance(0.9) ? s.pickup.point_id : point(), pickup_epoch: s.pickup && rng.chance(0.9) ? s.pickup.epoch : rng.int(1, s.pickup_epoch + 1),
            collector_person_id: collector, pass_code: own && rng.chance(0.85) ? own.code : any ? any.code : 'AAAA-BBBB'};
        },
        deadline_reached: () => ({shipment_id: s.id, deadline: rng.pick(['pickup', 'failure_action', 'hold_end'])}),
        return_completed: () => ({shipment_id: s.id})
      };
      // Usually the event that fits the parcel's state; otherwise any event at all.
      const fitting = data.changes.some(c => c.shipment_id === s.id && c.status === 'pending') && rng.chance(0.6) ? ['change_resolved']
        : s.status === 'at_pickup' ? ['collected', 'collected', 'point_status', 'relocated', 'deadline_reached']
          : s.status === 'attempt_failed' ? ['deadline_reached', 'change_resolved']
            : s.status === 'returning' ? ['return_completed']
              : s.plan.mode === 'pickup' ? ['pickup_ready', 'pickup_ready', 'relocated', 'point_status']
                : s.plan.mode === 'hold' ? ['deadline_reached', 'transit_update']
                  : ['transit_update', 'delivery_failed', 'delivered', 'transit_update'];
      const operation = rng.chance(0.7) ? rng.pick(fitting) : rng.pick(Object.keys(kinds));
      step(s.recipient_person_id, 'event ' + operation + ' ' + (operation === 'point_status' ? '' : s.id) + ' at ' + at,
        f => f.event({event_id: 'fuzz-' + (++eventNumber), at, operation: 'carrier.' + operation, payload: kinds[operation]()}), true);
    }
  };
  return {
    run(steps) {
      const weighted = ['advance', 'advance', 'ship', 'change', 'change', 'change', 'cancel', 'grant', 'grant', 'revoke', 'read', 'event', 'event', 'event', 'event', 'event'];
      for (let i = 0; i < steps; i++) {
        const open = data.shipments.filter(s => !TERMINAL.includes(s.status)).length;
        operations[open < 2 ? 'ship' : rng.pick(weighted)]();
      }
      return {data, log, outcomes: log.map(line => line.split(' → ').pop())};
    }
  };
}

// Defaults keep the test fast and identical everywhere. For a deeper local search:
//   FUZZ_RUNS=200 FUZZ_STEPS=400 node --test tests/fuzz.test.cjs
const STEPS = Number(process.env.FUZZ_STEPS) || 100, RUNS = Array.from({length: Number(process.env.FUZZ_RUNS) || 1}, (_, i) => 11 + i * 18);
test('random operations and events from every catalog seed keep the ledger consistent', () => {
  const seen = new Set();
  let committedEvents = 0, committedWrites = 0, refused = 0;
  for (const seed of index.seeds) {
    for (const n of RUNS) {
      const result = world(seed.id, random(n * 7919 + Number(seed.id.slice(0, 2)))).run(STEPS);
      for (const line of result.log) {
        if (/^(clock|ship)/.test(line)) continue;
        const outcome = line.split(' → ').pop();
        seen.add(outcome);
        if (outcome === 'ok' && line.startsWith('event')) committedEvents++;
        else if (outcome === 'ok' && /^(change|cancel|authorize|revoke)/.test(line)) committedWrites++;
        else if (!/^(read|clock)/.test(line) && outcome !== 'ok') refused++;
      }
      for (const s of result.data.shipments) seen.add('status:' + s.status);
    }
  }
  // The walk must actually reach the interesting parts of the state space, not only refusals.
  const depth = JSON.stringify({committedEvents, committedWrites, refused});
  if (process.env.FUZZ_RUNS || process.env.FUZZ_REPORT) console.log('fuzz depth ' + depth + '\nfuzz reached ' + [...seen].sort().join(' '));
  assert.ok(committedEvents > STEPS * RUNS.length && committedWrites > STEPS * RUNS.length / 4 && refused > STEPS * RUNS.length, 'walk too shallow: ' + depth);
  for (const expected of ['status:delivered', 'status:collected', 'status:returned', 'status:at_pickup', 'status:attempt_failed',
    'invalid_event', 'not_found', 'stale_confirmation', 'change_pending', 'deadline_passed', 'parcel_closed', 'not_permitted']) {
    assert.ok(seen.has(expected), 'walk never reached ' + expected);
  }
});

test('the same random walk gives the same ledger twice', () => {
  const walk = () => world('05-delegation', random(424242)).run(STEPS);
  const first = walk(), second = walk();
  assert.deepEqual(second.outcomes, first.outcomes);
  assert.deepEqual(second.data, first.data);
});
