'use strict';
// Data catalog checks: counts promised by the approved proposal, coherent history, role
// boundaries per seed, the situation each seed is named for, and replayable example schedules.
const test = require('node:test');
const assert = require('node:assert/strict');
const {fixture, rejects} = require('./harness.cjs');
const generator = require('../scripts/build-fixtures.cjs');

const catalog = require('../fixtures/catalog.json');
const index = require('../fixtures/seeds/index.json');
const binding = require('../fixtures/binding.json');
const load = id => require('../fixtures/' + index.seeds.find(s => s.id === id).seed);
const entry = id => index.seeds.find(s => s.id === id);
// A run for one of the seed's actors: the same ledger with another acting account.
const run = (id, person = entry(id).actors[0].owner_person_id) => {
  const actor = binding.accounts.find(a => a.owner_person_id === person);
  return fixture({seed: {...structuredClone(load(id)), account_id: actor.account_id, owner_person_id: person}, virtual_now: entry(id).virtual_now, logging: false});
};
const get = (f, id) => f.call('shipments.get', {id}).shipment;
const options = (f, id) => f.call('options.get', {id}).options;
const stamps = value => (Array.isArray(value) ? value.flatMap(stamps) : value && typeof value === 'object' ? Object.values(value).flatMap(stamps)
  : typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) ? [value] : []);

test('catalog files are exactly what the generator produces', () => {
  assert.deepEqual(generator.build({check: true}), []);
});

test('catalog has the promised identities, addresses, points, profiles, parcels and seeds', () => {
  const roles = role => catalog.people.filter(p => p.role === role).length;
  assert.deepEqual([catalog.people.length, roles('recipient'), roles('delegate'), roles('unauthorized')], [6, 3, 2, 1]);
  assert.equal(catalog.addresses.filter(a => a.verified).length, 9);
  assert.equal(catalog.pickup_points.length, 6);
  assert.equal(catalog.policies.length, 6);
  assert.equal(index.seeds.length, 8);
  assert.equal(catalog.shipments.length, 24);
  assert.equal(new Set(catalog.shipments.map(s => s.id)).size, 24);
  assert.equal(new Set(catalog.shipments.map(s => s.tracking_number)).size, 24);
  // Every parcel is in exactly one seed, and each seed holds exactly the parcels listed for it.
  for (const seed of index.seeds) {
    assert.deepEqual(load(seed.id).shipments.map(s => s.id).sort(), catalog.shipments.filter(s => s.seed === seed.id).map(s => s.id).sort(), seed.id);
  }
  assert.deepEqual(binding.people.map(p => p.person_id).sort(), catalog.people.map(p => p.person_id).sort());
  const bytes = require('node:fs').readdirSync(require('node:path').join(__dirname, '../fixtures'), {recursive: true, withFileTypes: true})
    .filter(e => e.isFile()).reduce((sum, e) => sum + require('node:fs').statSync(require('node:path').join(e.parentPath || e.path, e.name)).size, 0);
  assert.ok(bytes < 1024 * 1024, 'Fixture payload stays below 1 MiB: ' + bytes);
});

test('policy profiles differ and every one is used', () => {
  const rules = catalog.policies.map(({id, name, ...rest}) => JSON.stringify(rest));
  assert.equal(new Set(rules).size, 6, 'No two profiles have the same rules');
  assert.deepEqual([...new Set(catalog.shipments.map(s => s.policy_id))].sort(), catalog.policies.map(p => p.id).sort());
  const vary = key => new Set(catalog.policies.map(p => JSON.stringify(p[key]))).size;
  for (const key of ['change_cutoff_hours', 'pickup_window_hours', 'allowed_point_kinds', 'allow_delegation', 'allow_address_change', 'allow_pickup_redirect']) assert.ok(vary(key) > 1, key);
  assert.ok(catalog.addresses.some(a => a.delivery_restricted) && catalog.addresses.some(a => !a.verified), 'Restricted and unverified destinations exist');
  assert.ok(catalog.pickup_points.some(p => !p.accessible) && catalog.pickup_points.some(p => !p.accepts_redirects) && new Set(catalog.pickup_points.map(p => p.kind)).size === 2);
});

test('every seed loads for each of its actors with coherent, non-future timestamps', () => {
  for (const seed of index.seeds) {
    for (const actor of seed.actors) run(seed.id, actor.owner_person_id); // schema and validateSeed
    const times = stamps(load(seed.id)).map(Date.parse), clock = Date.parse(seed.virtual_now);
    assert.ok(times.every(Number.isFinite), seed.id);
    assert.ok(Math.min(...times) >= Date.parse('2026-01-01T00:00:00Z'), seed.id + ' has no record before 2026');
    // Deadlines and expiries may lie ahead; nothing may be recorded as having happened after the seed clock.
    const happened = load(seed.id);
    const past = stamps([happened.shipments.map(s => [s.created_at, s.updated_at, s.timeline, s.history, s.completed_at]), happened.changes.map(c => [c.created_at, c.updated_at, c.decided_at]),
      happened.grants.map(g => [g.created_at, g.ended_at, g.history]), happened.passes.map(p => [p.issued_at, p.ended_at]), happened.notices.map(n => n.at), happened.pickup_points.map(p => p.updated_at)]);
    assert.ok(past.every(t => Date.parse(t) <= clock), seed.id + ' records nothing after its clock');
  }
  assert.ok(index.seeds.some(s => stamps(load(s.id)).some(t => t.startsWith('2026-01'))), 'History reaches back to January 2026');
});

test('no seed or index entry carries a task, answer or rubric', () => {
  const keys = value => (Array.isArray(value) ? value.flatMap(keys) : value && typeof value === 'object' ? Object.entries(value).flatMap(([k, v]) => [k, ...keys(v)]) : []);
  for (const key of [...keys(index), ...keys(catalog)]) assert.doesNotMatch(key, /answer|rubric|expected|solution|hint|grade|score|task/i);
});

test('role boundaries hold in every seed', () => {
  for (const seed of index.seeds) {
    const ledger = load(seed.id);
    for (const actor of seed.actors) {
      const f = run(seed.id, actor.owner_person_id), before = f.data;
      const listed = f.call('shipments.list', {include_closed: true}).items;
      assert.deepEqual(listed.map(s => s.id).sort(), actor.sees, seed.id + ' as ' + actor.owner_person_id);
      for (const s of ledger.shipments) {
        if (actor.sees.includes(s.id)) continue;
        rejects(f, () => f.call('shipments.get', {id: s.id}), 'not_found');
        rejects(f, () => f.call('pass.get', {id: s.id}), 'not_found');
        assert.equal(f.call('shipments.list', {query: s.tracking_number, include_closed: true}).items.length, 0, 'Tracking number reveals nothing');
      }
      if (actor.role === 'delegate') {
        assert.ok(listed.every(s => s.access === 'delegate' && s.tracking_number === null && s.sender_label === null));
        for (const id of actor.sees) assert.equal(f.call('pass.get', {id}).pass.role, 'delegate');
        for (const id of actor.sees) rejects(f, () => f.call('options.get', {id}), 'not_found');
      }
      if (actor.role === 'unauthorized') {
        assert.deepEqual([f.call('grants.list').items.length, f.call('notices.list').items.length, f.call('changes.list').items.length, f.call('addresses.list').items.length], [0, 0, 0, 0]);
      }
      assert.ok(f.call('notices.list').items.every(n => actor.sees.includes(n.shipment_id)), 'Notices only for visible parcels');
      assert.deepEqual(f.data, before);
    }
  }
});

test('each seed presents the situation it is named for', () => {
  let f = run('01-normal-delivery');
  let o = options(f, 'S101');
  assert.deepEqual([o.reschedule.allowed, o.address.allowed, o.hold.allowed, o.redirect.allowed], [true, true, true, true]);
  assert.deepEqual([get(f, 'S102').status, f.call('changes.list', {shipment_id: 'S102'}).items[0].status], ['delivered', 'applied']);

  f = run('02-pending-changes');
  assert.deepEqual(['S104', 'S105'].map(id => get(f, id).pending_change.status), ['pending', 'pending']);
  const history = f.call('changes.list', {shipment_id: 'S106'}).items;
  assert.deepEqual(history.map(c => c.status), ['rejected', 'cancelled', 'applied']);
  assert.match(history[0].reason, /outside the delivery zone/);
  assert.equal(f.call('change.cancel', {id: get(f, 'S104').pending_change.id}).change_status, 'cancelled');

  f = run('03-restricted-changes');
  o = options(f, 'S107');
  assert.deepEqual([o.address.reason, o.hold.reason, o.redirect.point_ids], ['not_permitted', 'not_permitted', ['P01', 'P03', 'P04']]);
  o = options(f, 'S108');
  assert.deepEqual([o.redirect.reason, o.address.allowed, o.hold.allowed], ['not_permitted', true, true]);
  assert.match(f.call('changes.list', {shipment_id: 'S108'}).items[0].reason, /Bulky items/);
  o = options(f, 'S109');
  assert.ok(['reschedule', 'address', 'hold', 'redirect'].every(kind => o[kind].reason === 'cutoff_passed'));

  f = run('04-redirect-readiness');
  assert.deepEqual([get(f, 'S110').plan.mode, get(f, 'S110').status, get(f, 'S110').pickup], ['pickup', 'in_transit', null]);
  rejects(f, () => f.call('pass.get', {id: 'S110'}), 'not_available');
  assert.deepEqual(['S111', 'S112'].map(id => f.call('pass.get', {id}).pass.valid_now), [true, true]);
  assert.equal(get(f, 'S112').point.accessible, true);

  f = run('05-delegation');
  assert.deepEqual(f.call('grants.list', {shipment_id: 'S113'}).items.map(g => [g.collector_person_id, g.status, g.valid_now]),
    [['person-noor', 'revoked', false], ['person-alex', 'active', true]]);
  assert.equal(options(f, 'S115').delegation.reason, 'not_permitted');
  assert.deepEqual(f.call('grants.list', {shipment_id: 'S114'}).items.map(g => g.status), ['consumed']);
  assert.match(get(f, 'S114').timeline.at(-1).summary, /Collected at Quay Street depot counter by Noor Haddad/);

  f = run('06-failed-delivery');
  assert.deepEqual(['S116', 'S118'].map(id => [get(f, id).status, get(f, id).deadlines[0].kind, get(f, id).deadlines[0].passed]),
    [['attempt_failed', 'failure_action', false], ['attempt_failed', 'failure_action', false]]);
  assert.ok(Date.parse(get(f, 'S118').attempt.action_deadline) < Date.parse(get(f, 'S116').attempt.action_deadline), 'The signature parcel has less time');
  assert.deepEqual([options(f, 'S118').reschedule.allowed, options(f, 'S118').hold.reason], [true, 'not_permitted']);
  assert.ok(get(f, 'S117').timeline.some(e => e.kind === 'delivery_failed') && get(f, 'S117').status === 'delivered');

  f = run('07-closure-relocation');
  let s = get(f, 'S119');
  assert.deepEqual([s.point.status, s.deadlines[0].passed, f.call('pass.get', {id: 'S119'}).pass.valid_now], ['closed', false, true]);
  assert.ok(!options(f, 'S119').redirect.point_ids.includes('P04'));
  s = get(f, 'S120');
  assert.deepEqual([s.status, s.plan.point_id, s.pickup], ['in_transit', 'P05', null]);
  rejects(f, () => f.call('pass.get', {id: 'S120'}), 'not_available');
  assert.equal(f.data.passes.find(p => p.shipment_id === 'S120').end_reason, 'relocated');

  f = run('08-expiry-return');
  assert.deepEqual(get(f, 'S121').deadlines, [{kind: 'pickup', at: '2026-03-04T15:00:00.000Z', passed: false}]);
  // Deadline passed by the clock, deadline event not applied: status unchanged, nothing can be requested.
  s = get(f, 'S122');
  assert.deepEqual([s.status, s.deadlines[0].passed, f.call('pass.get', {id: 'S122'}).pass.valid_now, options(f, 'S122').redirect.reason, options(f, 'S122').delegation.reason],
    ['at_pickup', true, false, 'deadline_passed', 'deadline_passed']);
  assert.deepEqual([get(f, 'S123').status, options(f, 'S123').redirect.reason], ['returning', 'return_started']);
  assert.deepEqual([get(f, 'S124').status, get(f, 'S124').completed_at], ['returned', '2026-01-22T16:00:00Z']);
});

test('example schedules apply in order and replay to the same outcome', () => {
  for (const seed of index.seeds) {
    const events = require('../fixtures/' + seed.example_schedule);
    assert.ok(events.length > 0, seed.id);
    const replay = () => { const f = run(seed.id); for (const event of events) f.event(event); return f.data; };
    const first = replay();
    assert.notDeepEqual(first, run(seed.id).data, seed.id + ' schedule changes the ledger');
    assert.deepEqual(replay(), first, seed.id + ' replays deterministically');
    // The seed itself is untouched: a new run starts from the same baseline.
    assert.deepEqual({...run(seed.id).data}, {...structuredClone(load(seed.id))});
  }
});
