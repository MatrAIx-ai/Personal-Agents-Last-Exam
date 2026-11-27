'use strict';
// W3 — Authorize another collector. Fixture clock: 2026-03-02T14:00Z.
// S002 is ready at P01 (epoch 1, deadline 2026-03-04T15:00Z); Maya's own pass is K7QM-4R2X.
// Alex is Maya's trusted collector; Sam is nobody's collector. Standard policy allows
// delegation for at most 72 h and never beyond the pickup deadline.
const test = require('node:test');
const assert = require('node:assert/strict');
const {fixture, rejects, ev, submit, decide, authorize, actAs} = require('./harness.cjs');

const get = (f, id) => f.call('shipments.get', {id}).shipment;
const preview = (f, id, fields) => f.call('grant.preview', {id, ...fields}).preview;
const alex = until => ({collector_person_id: 'person-alex', expires_at: until});
const grants = f => f.call('grants.list', {shipment_id: 'S002'}).items;
const collect = (at, fields = {}) => ev('collected', at, {shipment_id: 'S002', point_id: 'P01', pickup_epoch: 1, collector_person_id: 'person-maya', pass_code: 'K7QM-4R2X', ...fields});
const passOf = (f, person) => f.data.passes.find(p => p.shipment_id === 'S002' && p.holder_person_id === person && p.status === 'active');
const byAlex = (f, at, fields = {}) => collect(at, {collector_person_id: 'person-alex', pass_code: passOf(f, 'person-alex').code, ...fields});
// Fixture with one extra trusted collector, for replacement between two people.
const withSam = () => { const seed = fixture().data; seed.collectors.push({recipient_person_id: 'person-maya', person_id: 'person-sam', relationship: 'Colleague'}); return fixture({seed}); };

test('W3 preview shows who may be authorized and until when, without changing state', () => {
  const f = fixture(), before = f.data;
  assert.deepEqual(f.call('options.get', {id: 'S002'}).options.delegation, {allowed: true, reason: null, latest_expires_at: '2026-03-04T15:00:00.000Z'});
  const ok = preview(f, 'S002', alex('2026-03-04T12:00:00Z'));
  assert.equal(ok.allowed, true);
  assert.equal(ok.point_id, 'P01');
  assert.equal(ok.expires_at, '2026-03-04T12:00:00Z');
  assert.match(ok.summary, /Alex Rivera will be able to collect Two paperback books at Larchmere Pharmacy counter until 2026-03-04T12:00:00.000Z/);
  const reason = fields => preview(f, 'S002', fields).reason;
  assert.equal(reason({collector_person_id: 'person-sam', expires_at: '2026-03-04T12:00:00Z'}), 'unknown_collector', 'Only saved collectors');
  assert.equal(reason({collector_person_id: 'person-nobody', expires_at: '2026-03-04T12:00:00Z'}), 'unknown_collector');
  assert.equal(reason({collector_person_id: 'person-maya', expires_at: '2026-03-04T12:00:00Z'}), 'unknown_collector', 'No self-delegation');
  assert.equal(reason(alex('2026-03-02T14:00:00Z')), 'expiry_in_past');
  assert.equal(reason(alex('2026-03-04T15:00:00Z')), null, 'May last exactly until the pickup deadline');
  assert.equal(reason(alex('2026-03-04T15:00:01Z')), 'expiry_out_of_range', 'Never beyond the pickup deadline');
  assert.equal(reason({...alex('2026-03-04T12:00:00Z'), replaces_grant_id: 'G999'}), 'unknown_grant');
  assert.equal(preview(f, 'S001', alex('2026-03-04T12:00:00Z')).reason, 'not_ready', 'In-transit parcels cannot be delegated');
  rejects(f, () => f.call('grant.create', {id: 'S002', ...alex('2026-03-04T12:00:00Z'), confirmation: 'cf-000000000000000000000000'}), 'stale_confirmation');
  rejects(f, () => f.call('grant.create', {id: 'S002', ...alex('2026-03-04T15:00:01Z'), confirmation: ok.confirmation}), 'expiry_out_of_range');
  assert.deepEqual(f.data, before);
});

test('W3 policy limits: maximum duration and parcels that cannot be delegated', () => {
  const seed = fixture().data;
  seed.policies.find(p => p.id === 'pol-standard').max_grant_hours = 24;
  const short = fixture({seed});
  assert.equal(short.call('options.get', {id: 'S002'}).options.delegation.latest_expires_at, '2026-03-03T14:00:00.000Z');
  assert.equal(preview(short, 'S002', alex('2026-03-03T14:00:01Z')).reason, 'expiry_out_of_range');
  assert.equal(preview(short, 'S002', alex('2026-03-03T14:00:00Z')).allowed, true);

  // S003 follows the signature policy: it can be redirected and collected, but only by the recipient.
  const f = fixture();
  decide(f, '2026-03-02T15:00:00Z', 'S003', submit(f, 'S003', {kind: 'redirect', point_id: 'P03'}), 1);
  f.event(ev('pickup_ready', '2026-03-03T15:00:00Z', {shipment_id: 'S003', plan_revision: 2, point_id: 'P03', pickup_epoch: 1}));
  assert.equal(f.call('options.get', {id: 'S003'}).options.delegation.reason, 'not_permitted');
  assert.equal(preview(f, 'S003', alex('2026-03-04T12:00:00Z')).reason, 'not_permitted');
  assert.equal(f.call('pass.get', {id: 'S003'}).pass.role, 'recipient');
});

test('W3 a grant gives the collector one parcel\'s pickup details and their own pass, nothing more', () => {
  const f = fixture();
  const created = authorize(f, 'S002', alex('2026-03-04T12:00:00Z'));
  assert.deepEqual(created, {grant_id: 'G001', pass_id: 'PASS002'});
  const [grant] = grants(f);
  assert.deepEqual({id: grant.id, status: grant.status, valid_now: grant.valid_now, collector_name: grant.collector_name, point_id: grant.point_id, pickup_epoch: grant.pickup_epoch},
    {id: 'G001', status: 'active', valid_now: true, collector_name: 'Alex Rivera', point_id: 'P01', pickup_epoch: 1});
  assert.equal(get(f, 'S002').timeline.at(-1).kind, 'collector_authorized');
  assert.equal(f.call('pass.get', {id: 'S002'}).pass.code, 'K7QM-4R2X', 'The recipient keeps their own pass');
  assert.equal(preview(f, 'S002', alex('2026-03-04T13:00:00Z')).reason, 'already_authorized');

  // Separate seeded run for the collector over the same ledger.
  const d = actAs(f, 'person-alex'), before = d.data;
  assert.deepEqual(d.call('shipments.list').items.map(x => [x.id, x.access, x.tracking_number, x.sender_label, x.plan_mode, x.has_pending_change]),
    [['S002', 'delegate', null, null, null, false]]);
  assert.equal(d.call('shipments.list', {query: 'NL4471200027'}).items.length, 0, 'A tracking number finds nothing');
  const s = get(d, 'S002');
  assert.deepEqual([s.access, s.plan, s.recipient_person_id, s.tracking_number, s.sender_label, s.policy_id, s.pending_change, s.timeline],
    ['delegate', null, null, null, null, null, null, []]);
  assert.deepEqual(s.pickup, {point_id: 'P01', epoch: 1, ready_at: '2026-03-01T15:00:00Z', deadline: '2026-03-04T15:00:00Z'});
  assert.equal(s.point.name, 'Larchmere Pharmacy counter');
  const pass = d.call('pass.get', {id: 'S002'}).pass;
  assert.deepEqual([pass.role, pass.holder_person_id, pass.point_id, pass.expires_at, pass.valid_now], ['delegate', 'person-alex', 'P01', '2026-03-04T12:00:00Z', true]);
  assert.notEqual(pass.code, 'K7QM-4R2X');
  assert.deepEqual(d.call('grants.list').items.map(g => [g.id, g.valid_now, g.replaces_grant_id]), [['G001', true, null]]);
  const notices = d.call('notices.list').items;
  assert.deepEqual(notices.map(n => n.type), ['collection_authorized']);
  assert.doesNotMatch(JSON.stringify(notices) + JSON.stringify(s), /418 Larchmere Row|Foundry Lane|Brightleaf|NL4471200027|addr-maya/, 'No address, sender or tracking number reaches the collector');
  // The collector cannot change the parcel, see other parcels or pass the right on.
  for (const call of [
    () => d.call('options.get', {id: 'S002'}),
    () => d.call('change.preview', {id: 'S002', kind: 'redirect', point_id: 'P03'}),
    () => d.call('change.submit', {id: 'S002', kind: 'redirect', point_id: 'P03', confirmation: 'cf-any'}),
    () => d.call('grant.preview', {id: 'S002', collector_person_id: 'person-sam', expires_at: '2026-03-04T12:00:00Z'}),
    () => d.call('grant.create', {id: 'S002', collector_person_id: 'person-sam', expires_at: '2026-03-04T12:00:00Z', confirmation: 'cf-any'}),
    () => d.call('grant.revoke', {id: 'G001'}),
    () => d.call('changes.list', {shipment_id: 'S002'}),
    () => d.call('shipments.get', {id: 'S001'}),
    () => d.call('pass.get', {id: 'S001'})
  ]) rejects(d, call, 'not_found');
  assert.equal(d.call('changes.list').items.length, 0);
  assert.equal(d.call('collectors.list').items.length, 0, 'The recipient\'s collectors are not shared');
  assert.deepEqual(d.call('addresses.list').items.map(a => a.id), ['addr-alex-home'], 'Only the collector\'s own addresses');
  assert.deepEqual(d.data, before);
});

test('W3 knowing a tracking number or being a saved collector grants no access', () => {
  for (const person of ['person-alex', 'person-sam']) {
    const f = actAs(fixture(), person);
    assert.equal(f.call('shipments.list', {include_closed: true}).items.length, 0);
    assert.equal(f.call('shipments.list', {query: 'NL4471200027'}).items.length, 0);
    assert.equal(f.call('grants.list').items.length, 0);
    assert.equal(f.call('notices.list').items.length, 0);
    for (const id of ['S002', 'NL4471200027', 'S999']) {
      rejects(f, () => f.call('shipments.get', {id}), 'not_found');
      rejects(f, () => f.call('pass.get', {id}), 'not_found');
    }
  }
});

test('W3 only the named collector with the current pass can collect; the recipient sees the result', () => {
  const f = fixture();
  authorize(f, 'S002', alex('2026-03-04T12:00:00Z'));
  const code = passOf(f, 'person-alex').code;
  // Passes are bound to their holder.
  rejects(f, () => f.event(collect('2026-03-03T15:00:00Z', {pass_code: code})), 'invalid_event', /No valid collection pass/);
  rejects(f, () => f.event(collect('2026-03-03T15:00:00Z', {collector_person_id: 'person-alex'})), 'invalid_event', /No valid collection pass/);
  rejects(f, () => f.event(collect('2026-03-03T15:00:00Z', {collector_person_id: 'person-sam', pass_code: code})), 'invalid_event', /No valid collection pass/);
  assert.equal(f.data.passes.filter(p => p.status === 'active').length, 2, 'Failed checks consume nothing');

  f.event(byAlex(f, '2026-03-03T15:00:00Z'));
  const s = get(f, 'S002');
  assert.equal(s.status, 'collected');
  assert.equal(s.timeline.at(-1).summary, 'Collected at Larchmere Pharmacy counter by Alex Rivera.');
  assert.deepEqual(grants(f).map(g => [g.status, g.valid_now, g.end_reason]), [['consumed', false, 'collected']]);
  const passes = Object.fromEntries(f.data.passes.map(p => [p.holder_person_id, [p.status, p.end_reason]]));
  assert.deepEqual(passes, {'person-maya': ['invalidated', 'collected_with_another_pass'], 'person-alex': ['consumed', 'collected']});
  assert.equal(f.call('notices.list', {shipment_id: 'S002'}).items.at(-1).type, 'collected');
  // No second handoff, by anyone.
  rejects(f, () => f.event(collect('2026-03-03T16:00:00Z')), 'invalid_event', /terminal/);
  // The collector's access ended with the handoff.
  const d = actAs(f, 'person-alex');
  assert.equal(d.call('shipments.list', {include_closed: true}).items.length, 0);
  rejects(d, () => d.call('pass.get', {id: 'S002'}), 'not_found');
});

test('W3 revocation ends the collector\'s pass and access at once', () => {
  const f = fixture();
  authorize(f, 'S002', alex('2026-03-04T12:00:00Z'));
  const code = passOf(f, 'person-alex').code;
  assert.deepEqual(f.call('grant.revoke', {id: 'G001'}), {grant_id: 'G001', grant_status: 'revoked'});
  assert.deepEqual(grants(f).map(g => [g.status, g.valid_now, g.end_reason]), [['revoked', false, 'revoked']]);
  assert.equal(get(f, 'S002').timeline.at(-1).kind, 'collector_revoked');
  rejects(f, () => f.event(collect('2026-03-03T15:00:00Z', {collector_person_id: 'person-alex', pass_code: code})), 'invalid_event', /No valid collection pass/);
  rejects(f, () => f.call('grant.revoke', {id: 'G001'}), 'grant_not_active');
  rejects(f, () => f.call('grant.revoke', {id: 'G999'}), 'not_found');
  const d = actAs(f, 'person-alex');
  assert.equal(d.call('shipments.list').items.length, 0);
  assert.equal(d.call('notices.list').items.length, 0, 'Notice access follows the current grant');
  rejects(d, () => d.call('pass.get', {id: 'S002'}), 'not_found');
  // The recipient is unaffected and can authorize again.
  assert.equal(f.call('pass.get', {id: 'S002'}).pass.valid_now, true);
  assert.equal(authorize(f, 'S002', alex('2026-03-03T20:00:00Z')).grant_id, 'G002');
  f.event(collect('2026-03-03T15:00:00Z'));
  assert.equal(get(f, 'S002').status, 'collected');
  assert.deepEqual(grants(f).map(g => [g.id, g.status, g.end_reason]), [['G001', 'revoked', 'revoked'], ['G002', 'invalidated', 'collected_with_another_pass']]);
});

test('W3 replacement swaps the authorization atomically', () => {
  const f = withSam();
  authorize(f, 'S002', alex('2026-03-04T12:00:00Z'));
  const oldCode = passOf(f, 'person-alex').code;
  const swap = {collector_person_id: 'person-sam', expires_at: '2026-03-03T20:00:00Z', replaces_grant_id: 'G001'};
  assert.match(preview(f, 'S002', swap).summary, /replaces authorization G001/);
  assert.equal(authorize(f, 'S002', swap).grant_id, 'G002');
  assert.deepEqual(grants(f).map(g => [g.id, g.collector_person_id, g.status, g.replaces_grant_id]),
    [['G001', 'person-alex', 'replaced', null], ['G002', 'person-sam', 'active', 'G001']]);
  assert.equal(passOf(f, 'person-alex'), undefined);
  rejects(f, () => f.event(collect('2026-03-03T15:00:00Z', {collector_person_id: 'person-alex', pass_code: oldCode})), 'invalid_event', /No valid collection pass/);
  assert.equal(actAs(f, 'person-alex').call('shipments.list').items.length, 0);
  assert.equal(actAs(f, 'person-sam').call('pass.get', {id: 'S002'}).pass.expires_at, '2026-03-03T20:00:00Z');
  assert.equal(preview(f, 'S002', {...alex('2026-03-04T12:00:00Z'), replaces_grant_id: 'G001'}).reason, 'grant_not_active');
  // Replacing a person's own grant changes its expiry and issues a fresh pass.
  const samCode = passOf(f, 'person-sam').code;
  authorize(f, 'S002', {collector_person_id: 'person-sam', expires_at: '2026-03-04T10:00:00Z', replaces_grant_id: 'G002'});
  assert.notEqual(passOf(f, 'person-sam').code, samCode);
  f.event(collect('2026-03-03T21:00:00Z', {collector_person_id: 'person-sam', pass_code: passOf(f, 'person-sam').code}));
  assert.equal(get(f, 'S002').status, 'collected');
});

test('W3 a grant that expires before the pickup deadline stops working by the clock alone', () => {
  const f = fixture();
  authorize(f, 'S002', alex('2026-03-03T18:00:00Z'));
  const code = passOf(f, 'person-alex').code;
  const onTime = actAs(f, 'person-alex');
  onTime.advance('2026-03-03T17:59:59Z');
  assert.equal(onTime.call('pass.get', {id: 'S002'}).pass.valid_now, true);

  f.advance('2026-03-03T18:00:00Z');
  const before = f.data;
  assert.deepEqual(grants(f).map(g => [g.status, g.valid_now]), [['active', false]], 'Expiry is reported, not written, by reads');
  const d = actAs(f, 'person-alex');
  assert.equal(d.call('shipments.list').items.length, 0);
  rejects(d, () => d.call('pass.get', {id: 'S002'}), 'not_found');
  assert.deepEqual(f.data, before);
  rejects(f, () => f.event(collect('2026-03-03T18:00:00Z', {collector_person_id: 'person-alex', pass_code: code})), 'invalid_event', /pass has expired/);
  // The recipient can still collect, or authorize the same person again without replacing.
  assert.equal(preview(f, 'S002', alex('2026-03-04T12:00:00Z')).allowed, true);
  authorize(f, 'S002', alex('2026-03-04T12:00:00Z'));
  assert.deepEqual(grants(f).map(g => [g.id, g.status, g.end_reason]), [['G001', 'expired', 'expired'], ['G002', 'active', null]]);
  f.event(byAlex(f, '2026-03-03T19:00:00Z'));
  assert.equal(get(f, 'S002').status, 'collected');

  const early = fixture();
  authorize(early, 'S002', alex('2026-03-03T18:00:00Z'));
  early.event(byAlex(early, '2026-03-03T17:59:59Z'));
  assert.equal(get(early, 'S002').status, 'collected');
});

test('W3 leaving the pickup point invalidates the authorization; a new arrival needs a new one', () => {
  const moved = fixture();
  authorize(moved, 'S002', alex('2026-03-04T12:00:00Z'));
  const oldCode = passOf(moved, 'person-alex').code;
  moved.event(ev('relocated', '2026-03-02T15:00:00Z', {shipment_id: 'S002', plan_revision: 2, to_point_id: 'P03', reason: 'The pharmacy counter is over capacity.'}));
  assert.deepEqual(grants(moved).map(g => [g.status, g.end_reason]), [['invalidated', 'relocated']]);
  assert.equal(actAs(moved, 'person-alex').call('shipments.list').items.length, 0);
  assert.equal(preview(moved, 'S002', alex('2026-03-04T12:00:00Z')).reason, 'not_ready');
  moved.event(ev('pickup_ready', '2026-03-03T14:00:00Z', {shipment_id: 'S002', plan_revision: 3, point_id: 'P03', pickup_epoch: 2}));
  assert.equal(passOf(moved, 'person-alex'), undefined, 'Arrival re-issues only the recipient\'s pass');
  rejects(moved, () => moved.event(collect('2026-03-03T15:00:00Z', {point_id: 'P03', pickup_epoch: 2, collector_person_id: 'person-alex', pass_code: oldCode})), 'invalid_event', /No valid collection pass/);
  authorize(moved, 'S002', alex('2026-03-05T12:00:00Z'));
  assert.deepEqual(grants(moved).map(g => [g.id, g.status, g.point_id, g.pickup_epoch]), [['G001', 'invalidated', 'P01', 1], ['G002', 'active', 'P03', 2]]);
  moved.event(collect('2026-03-03T15:00:00Z', {point_id: 'P03', pickup_epoch: 2, collector_person_id: 'person-alex', pass_code: passOf(moved, 'person-alex').code}));
  assert.equal(get(moved, 'S002').status, 'collected');

  const home = fixture();
  authorize(home, 'S002', alex('2026-03-04T12:00:00Z'));
  decide(home, '2026-03-02T16:00:00Z', 'S002', submit(home, 'S002', {kind: 'home_delivery', address_id: 'addr-maya-home'}), 2);
  assert.deepEqual(grants(home).map(g => [g.status, g.end_reason]), [['invalidated', 'plan_changed']]);
  const d = actAs(home, 'person-alex');
  assert.equal(d.call('shipments.list').items.length, 0);
  assert.equal(d.call('notices.list').items.length, 0, 'The new home address never reaches the former collector');
});

test('W3 after the pickup deadline passes, no new or replacement authorization is possible', () => {
  const f = fixture();
  authorize(f, 'S002', alex('2026-03-04T15:00:00Z'));
  const ok = preview(f, 'S002', {...alex('2026-03-04T14:00:00Z'), replaces_grant_id: 'G001'});
  f.advance('2026-03-04T15:00:00Z');
  assert.equal(f.call('options.get', {id: 'S002'}).options.delegation.reason, 'deadline_passed');
  assert.equal(preview(f, 'S002', {...alex('2026-03-04T16:00:00Z'), replaces_grant_id: 'G001'}).reason, 'deadline_passed');
  rejects(f, () => f.call('grant.create', {id: 'S002', ...alex('2026-03-04T14:00:00Z'), replaces_grant_id: 'G001', confirmation: ok.confirmation}), 'deadline_passed');
  assert.deepEqual(grants(f).map(g => [g.status, g.valid_now]), [['active', false]]);
  assert.equal(actAs(f, 'person-alex').call('shipments.list').items.length, 0);
});

test('W3 a confirmation is bound to the previewed parcel state and request', () => {
  const f = fixture();
  const first = preview(f, 'S002', alex('2026-03-04T12:00:00Z'));
  rejects(f, () => f.call('grant.create', {id: 'S002', ...alex('2026-03-04T11:00:00Z'), confirmation: first.confirmation}), 'stale_confirmation');
  submit(f, 'S002', {kind: 'redirect', point_id: 'P03'}); // the parcel changes after the preview
  rejects(f, () => f.call('grant.create', {id: 'S002', ...alex('2026-03-04T12:00:00Z'), confirmation: first.confirmation}), 'stale_confirmation');
  assert.equal(authorize(f, 'S002', alex('2026-03-04T12:00:00Z')).grant_id, 'G001');
});

test('W3 a point closure reaches the authorized collector without exposing the recipient', () => {
  const f = fixture();
  authorize(f, 'S002', alex('2026-03-04T12:00:00Z'));
  f.event(ev('point_status', '2026-03-02T15:00:00Z', {point_id: 'P01', status: 'closed', note: 'Water damage; closed until further notice.'}));
  const d = actAs(f, 'person-alex');
  const notice = d.call('notices.list', {shipment_id: 'S002'}).items.at(-1);
  assert.equal(notice.type, 'point_closed');
  assert.match(notice.message, /Larchmere Pharmacy counter is closed: Water damage/);
  const s = get(d, 'S002');
  assert.deepEqual([s.point.status, s.point.status_note, s.point.open_now], ['closed', 'Water damage; closed until further notice.', false]);
  assert.equal(d.call('pass.get', {id: 'S002'}).pass.valid_now, true, 'The pass itself is still valid; the point cannot hand over');
  rejects(f, () => f.event(byAlex(f, '2026-03-02T16:00:00Z')), 'invalid_event', /closed at this time/);
});
