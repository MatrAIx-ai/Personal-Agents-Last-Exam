#!/usr/bin/env node
'use strict';
// Single source for the synthetic data catalog: six identities, ten addresses (nine
// verified), six pickup points, six policy profiles and 24 parcels in eight resettable seed
// scenarios. Each seed's history is produced by replaying this App's own operations and
// trusted events in time order, so every stored change, pass, authorization and notice is a
// state the App can really reach. Nothing here is a task or an answer: seeds describe a
// starting situation, and the example schedules only show well-formed events for it.
// Run `node scripts/build-fixtures.cjs` after editing; `--check` detects drift.
// All names, addresses and tracking numbers are fictional and not deliverable.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {fixture} = require('../tests/harness.cjs');
const APP = require('../app.json').app_id;

// ---------- directory ----------
const PEOPLE = [
  {person_id: 'person-maya', name: 'Maya Chen', role: 'recipient'},
  {person_id: 'person-idris', name: 'Idris Bello', role: 'recipient'},
  {person_id: 'person-chloe', name: 'Chloé Tremblay', role: 'recipient'},
  {person_id: 'person-alex', name: 'Alex Rivera', role: 'delegate'},
  {person_id: 'person-noor', name: 'Noor Haddad', role: 'delegate'},
  {person_id: 'person-sam', name: 'Sam Okafor', role: 'unauthorized'}
];
const accountOf = person => 'pdm-' + person.split('-')[1];
const binding = {
  people: PEOPLE.map(({person_id, name}) => ({person_id, name})),
  accounts: PEOPLE.map(p => ({app_id: APP, account_id: accountOf(p.person_id), owner_person_id: p.person_id})),
  // Parcels of the package's default seed (fixtures/minimal.json).
  objects: {shipments: ['S001', 'S002', 'S003']}
};
const address = (id, person, label, recipient, line1, line2, city, postal, flags = {}) => ({id, person_id: person, label, recipient_name: recipient, line1, line2, city,
  region: 'QC', postal_code: postal, country: 'CA', verified: true, delivery_restricted: false, ...flags});
const ADDRESSES = [
  address('addr-maya-home', 'person-maya', 'Home', 'Maya Chen', '418 Larchmere Row', 'Apt 3', 'Harlow Bay', 'H0H 0A1'),
  address('addr-maya-work', 'person-maya', 'Studio', 'Maya Chen', '77 Foundry Lane', null, 'Harlow Bay', 'H0H 0B2'),
  address('addr-maya-pobox', 'person-maya', 'Mail box', 'Maya Chen', 'Box 219, 12 Quay Street', null, 'Harlow Bay', 'H0H 0C3', {delivery_restricted: true}),
  address('addr-maya-cottage', 'person-maya', 'Cottage', 'Maya Chen', '3 Tamarack Trail', null, 'Lac Brume', 'J0J 0D4', {verified: false}),
  address('addr-idris-home', 'person-idris', 'Home', 'Idris Bello', '9 Wexcombe Terrace', null, 'Harlow Bay', 'H0H 0E5'),
  address('addr-idris-office', 'person-idris', 'Office', 'Idris Bello', '240 Tide Street', 'Suite 5', 'Harlow Bay', 'H0H 0F6'),
  address('addr-chloe-home', 'person-chloe', 'Home', 'Chloé Tremblay', '61 Old Mill Road', null, 'Harlow Bay', 'H0H 0G7'),
  address('addr-chloe-parents', 'person-chloe', 'Parents', 'Chloé Tremblay', '15 Chemin des Bouleaux', null, 'Lac Brume', 'J0J 0H8'),
  address('addr-alex-home', 'person-alex', 'Home', 'Alex Rivera', '420 Larchmere Row', null, 'Harlow Bay', 'H0H 0A1'),
  address('addr-noor-home', 'person-noor', 'Home', 'Noor Haddad', '33 Quay Street', 'Apt 8', 'Harlow Bay', 'H0H 0C3')
];
const hours = (opens, closes, days = [0, 1, 2, 3, 4, 5, 6]) => days.map(weekday => ({weekday, opens, closes}));
const point = (id, name, kind, address_text, opening, flags = {}) => ({id, name, kind, address_text, time_zone: 'America/Toronto', hours: opening, status: 'open',
  accessible: true, accepts_redirects: true, status_note: null, updated_at: '2026-01-05T14:00:00Z', ...flags});
const POINTS = [
  point('P01', 'Larchmere Pharmacy counter', 'counter', '402 Larchmere Row, Harlow Bay', hours('09:00', '21:00')),
  point('P02', 'Foundry Lane parcel locker', 'locker', '80 Foundry Lane, Harlow Bay', hours('00:00', '24:00'), {accessible: false, status_note: 'Upper lockers only; no step-free access.'}),
  point('P03', 'Quay Street depot counter', 'counter', '30 Quay Street, Harlow Bay', hours('08:00', '18:00', [1, 2, 3, 4, 5, 6])),
  point('P04', 'Wexcombe Market service desk', 'counter', '2 Wexcombe Market, Harlow Bay', [...hours('10:00', '19:00', [1, 2, 3, 4, 5]), ...hours('10:00', '16:00', [6])]),
  point('P05', 'Tide Street step-free lockers', 'locker', '200 Tide Street, Harlow Bay', hours('06:00', '23:00')),
  point('P06', 'Old Mill returns desk', 'counter', '70 Old Mill Road, Harlow Bay', hours('09:00', '17:00', [1, 2, 3, 4, 5]), {accepts_redirects: false, status_note: 'Returns and sender drop-off only.'})
];
// Profiles differ in which changes they allow, their cutoffs, destination types, delegation and windows.
const policy = (id, name, f) => ({id, name, ...f});
const POLICIES = [
  policy('pol-standard', 'Standard residential', {allow_reschedule: true, max_reschedule_days: 5, allow_address_change: true, allow_hold: true, max_hold_days: 7,
    allow_pickup_redirect: true, allow_delegation: true, change_cutoff_hours: 12, pickup_window_hours: 72, failure_action_hours: 48, max_grant_hours: 72, allowed_point_kinds: ['counter', 'locker']}),
  policy('pol-signature', 'Signature required', {allow_reschedule: true, max_reschedule_days: 3, allow_address_change: false, allow_hold: false, max_hold_days: 0,
    allow_pickup_redirect: true, allow_delegation: false, change_cutoff_hours: 24, pickup_window_hours: 48, failure_action_hours: 24, max_grant_hours: 24, allowed_point_kinds: ['counter']}),
  policy('pol-express', 'Express', {allow_reschedule: true, max_reschedule_days: 2, allow_address_change: false, allow_hold: false, max_hold_days: 0,
    allow_pickup_redirect: true, allow_delegation: true, change_cutoff_hours: 4, pickup_window_hours: 24, failure_action_hours: 24, max_grant_hours: 24, allowed_point_kinds: ['counter', 'locker']}),
  policy('pol-bulky', 'Bulky item, home delivery only', {allow_reschedule: true, max_reschedule_days: 7, allow_address_change: true, allow_hold: true, max_hold_days: 5,
    allow_pickup_redirect: false, allow_delegation: false, change_cutoff_hours: 24, pickup_window_hours: 72, failure_action_hours: 72, max_grant_hours: 24, allowed_point_kinds: []}),
  policy('pol-compact', 'Compact parcel, locker eligible', {allow_reschedule: true, max_reschedule_days: 5, allow_address_change: true, allow_hold: true, max_hold_days: 7,
    allow_pickup_redirect: true, allow_delegation: true, change_cutoff_hours: 12, pickup_window_hours: 120, failure_action_hours: 48, max_grant_hours: 120, allowed_point_kinds: ['locker']}),
  policy('pol-recipient-only', 'Recipient only, fixed delivery', {allow_reschedule: true, max_reschedule_days: 2, allow_address_change: false, allow_hold: false, max_hold_days: 0,
    allow_pickup_redirect: false, allow_delegation: false, change_cutoff_hours: 48, pickup_window_hours: 48, failure_action_hours: 24, max_grant_hours: 24, allowed_point_kinds: []})
];
const COLLECTORS = [
  {recipient_person_id: 'person-maya', person_id: 'person-alex', relationship: 'Neighbour'},
  {recipient_person_id: 'person-maya', person_id: 'person-noor', relationship: 'Friend'},
  {recipient_person_id: 'person-idris', person_id: 'person-noor', relationship: 'Partner'},
  {recipient_person_id: 'person-chloe', person_id: 'person-alex', relationship: 'Colleague'}
];
const directory = () => structuredClone({carrier: {name: 'Northline Parcel (synthetic)', service_area: 'Fictional domestic service area; addresses are not deliverable.', time_zone: 'America/Toronto'},
  addresses: ADDRESSES, pickup_points: POINTS, policies: POLICIES, collectors: COLLECTORS});
const tracking = id => 'NL' + (5500000000 + Number(id.slice(1)) * 1009);

// ---------- seed builder: replays App operations and events in time order ----------
function builder(seedId, primary) {
  let data = {...directory(), shipments: [], changes: [], grants: [], passes: [], notices: []}, clock = null, recording = null, sequence = 0;
  const parcels = [];
  const open = (person, at) => {
    assert.ok(!clock || Date.parse(at) >= Date.parse(clock), seedId + ': step at ' + at + ' precedes ' + clock);
    return fixture({seed: {...data, account_id: accountOf(person), owner_person_id: person}, binding, virtual_now: at, logging: false});
  };
  const commit = f => { const {account_id, owner_person_id, ...ledger} = f.data; data = ledger; clock = f.ctx.virtual_now; };
  const parcel = id => data.shipments.find(s => s.id === id);
  const api = {
    // A new parcel enters the ledger as a Task or Infra would seed it; everything after is replayed.
    ship(at, {id, recipient, sender, contents, policy: policyId, address: addressId = null, delivery = null, point: pointId = null}) {
      const plan = pointId ? {revision: 1, mode: 'pickup', address_id: null, point_id: pointId, delivery_date: null, hold_until: null}
        : {revision: 1, mode: 'home', address_id: addressId, point_id: null, delivery_date: delivery, hold_until: null};
      data.shipments.push({id, tracking_number: tracking(id), recipient_person_id: recipient, sender_label: sender, contents_label: contents, policy_id: policyId,
        created_at: at, updated_at: at, estimated_delivery: delivery, status: 'in_transit', plan, pending_change_id: null, pickup_epoch: 0, pickup: null,
        attempt: null, return_info: null, completed_at: null, timeline: [{at, kind: 'label_created', summary: 'Shipping label created by the sender.'}], history: [{at, action: 'created'}]});
      parcels.push(id);
      commit(open(primary, at));
    },
    event(at, operation, payload) {
      const event = {event_id: seedId + '-' + (recording ? 'event' : 'history') + '-' + (++sequence), at, operation: 'carrier.' + operation, payload};
      const f = open(primary, clock);
      f.event(event);
      commit(f);
      if (recording) recording.push(event);
    },
    transit(at, id, status = 'in_transit') { api.event(at, 'transit_update', {shipment_id: id, plan_revision: parcel(id).plan.revision, status, estimated_delivery: parcel(id).plan.delivery_date}); },
    ready(at, id) { const s = parcel(id); api.event(at, 'pickup_ready', {shipment_id: id, plan_revision: s.plan.revision, point_id: s.plan.point_id, pickup_epoch: s.pickup_epoch + 1}); },
    collect(at, id, person) {
      const s = parcel(id), pass = data.passes.find(p => p.shipment_id === id && p.holder_person_id === person && p.status === 'active');
      api.event(at, 'collected', {shipment_id: id, point_id: s.pickup.point_id, pickup_epoch: s.pickup.epoch, collector_person_id: person, pass_code: pass.code});
    },
    change(person, at, id, change) {
      const f = open(person, at), preview = f.call('change.preview', {id, ...change}).preview;
      assert.equal(preview.allowed, true, seedId + ': change on ' + id + ' refused: ' + preview.reason);
      const changeId = f.call('change.submit', {id, ...change, confirmation: preview.confirmation}).change_id;
      commit(f);
      return changeId;
    },
    cancel(person, at, changeId) { const f = open(person, at); f.call('change.cancel', {id: changeId}); commit(f); },
    decide(at, changeId, decision = 'applied', reason = null) {
      const change = data.changes.find(c => c.id === changeId);
      api.event(at, 'change_resolved', {shipment_id: change.shipment_id, change_id: changeId, base_plan_revision: change.base_plan_revision, decision, reason});
    },
    redirect(person, at, id, pointId, decidedAt) { const changeId = api.change(person, at, id, {kind: 'redirect', point_id: pointId}); api.decide(decidedAt, changeId); return changeId; },
    grant(person, at, id, collector, expires) {
      const f = open(person, at), fields = {collector_person_id: collector, expires_at: expires}, preview = f.call('grant.preview', {id, ...fields}).preview;
      assert.equal(preview.allowed, true, seedId + ': grant on ' + id + ' refused: ' + preview.reason);
      const created = f.call('grant.create', {id, ...fields, confirmation: preview.confirmation});
      commit(f);
      return created.grant_id;
    },
    revoke(person, at, grantId) { const f = open(person, at); f.call('grant.revoke', {id: grantId}); commit(f); },
    // Example events that are valid, in this order, for the untouched seed. Applied to a copy only.
    schedule(at, fn) {
      const saved = {data: structuredClone(data), clock, sequence};
      clock = at; recording = []; sequence = 0;
      fn(api);
      const events = recording;
      ({data, clock, sequence} = saved); recording = null;
      return events;
    },
    finish(at) {
      assert.ok(Date.parse(at) >= Date.parse(clock), seedId + ': clock precedes history');
      clock = at;
      commit(open(primary, at));
      return {data: {account_id: accountOf(primary), owner_person_id: primary, ...structuredClone(data)}, virtual_now: at, parcels};
    }
  };
  return api;
}

// ---------- the eight seed scenarios ----------
const SEEDS = [
  {id: '01-normal-delivery', title: 'Normal delivery', workflows: ['W1'], primary: 'person-maya', clock: '2026-03-02T14:00:00Z',
    summary: 'One parcel on its way home with every change still open, one delivered in January after an applied date change, and another recipient\'s parcel in the same ledger.',
    build(s) {
      s.ship('2026-01-08T15:00:00Z', {id: 'S102', recipient: 'person-maya', sender: 'Brightleaf Books', contents: 'Two paperback books', policy: 'pol-standard', address: 'addr-maya-home', delivery: '2026-01-12'});
      s.transit('2026-01-09T12:00:00Z', 'S102');
      s.decide('2026-01-09T18:00:00Z', s.change('person-maya', '2026-01-09T14:00:00Z', 'S102', {kind: 'reschedule', delivery_date: '2026-01-14'}));
      s.transit('2026-01-14T13:30:00Z', 'S102', 'out_for_delivery');
      s.event('2026-01-14T17:10:00Z', 'delivered', {shipment_id: 'S102', plan_revision: 2});
      s.ship('2026-02-27T16:00:00Z', {id: 'S101', recipient: 'person-maya', sender: 'Cedar & Loom', contents: 'Wool blanket', policy: 'pol-standard', address: 'addr-maya-home', delivery: '2026-03-04'});
      s.ship('2026-02-28T14:00:00Z', {id: 'S103', recipient: 'person-idris', sender: 'Fennel & Fig', contents: 'Tea sampler', policy: 'pol-compact', address: 'addr-idris-home', delivery: '2026-03-05'});
      s.transit('2026-03-01T12:00:00Z', 'S101');
      s.transit('2026-03-01T15:00:00Z', 'S103');
    },
    example(s) {
      s.transit('2026-03-04T13:00:00Z', 'S101', 'out_for_delivery');
      s.event('2026-03-04T17:30:00Z', 'delivered', {shipment_id: 'S101', plan_revision: 1});
    }},
  {id: '02-pending-changes', title: 'Pending changes', workflows: ['W1', 'W2'], primary: 'person-idris', clock: '2026-03-03T15:00:00Z',
    summary: 'Two parcels each with a request the carrier has not decided, and a collected parcel whose history holds a rejected, a withdrawn and an applied request.',
    build(s) {
      s.ship('2026-02-20T15:00:00Z', {id: 'S106', recipient: 'person-idris', sender: 'Quillfeather Stationery', contents: 'Notebook set', policy: 'pol-compact', address: 'addr-idris-home', delivery: '2026-02-25'});
      s.decide('2026-02-21T19:00:00Z', s.change('person-idris', '2026-02-21T14:00:00Z', 'S106', {kind: 'address', address_id: 'addr-idris-office'}), 'rejected', 'The office address is outside the delivery zone for this service.');
      s.cancel('person-idris', '2026-02-22T15:30:00Z', s.change('person-idris', '2026-02-22T15:00:00Z', 'S106', {kind: 'hold', hold_until: '2026-02-27'}));
      s.redirect('person-idris', '2026-02-22T16:00:00Z', 'S106', 'P05', '2026-02-22T20:00:00Z');
      s.ready('2026-02-24T14:00:00Z', 'S106');
      s.collect('2026-02-25T23:00:00Z', 'S106', 'person-idris');
      s.ship('2026-02-26T15:00:00Z', {id: 'S104', recipient: 'person-idris', sender: 'Marlow Cycle Parts', contents: 'Bicycle pedals', policy: 'pol-standard', address: 'addr-idris-home', delivery: '2026-03-05'});
      s.ship('2026-02-27T14:00:00Z', {id: 'S105', recipient: 'person-idris', sender: 'Petal & Stem', contents: 'Ceramic planter', policy: 'pol-standard', address: 'addr-idris-home', delivery: '2026-03-06'});
      s.transit('2026-02-28T13:00:00Z', 'S104');
      s.transit('2026-03-01T14:00:00Z', 'S105');
      s.change('person-idris', '2026-03-02T16:00:00Z', 'S104', {kind: 'reschedule', delivery_date: '2026-03-07'});
      s.change('person-idris', '2026-03-03T14:00:00Z', 'S105', {kind: 'redirect', point_id: 'P04'});
    },
    example(s, data) {
      const pending = id => data.shipments.find(x => x.id === id).pending_change_id;
      s.decide('2026-03-03T18:00:00Z', pending('S104'));
      s.decide('2026-03-03T19:00:00Z', pending('S105'), 'rejected', 'The market service desk has no parcel capacity this week.');
    }},
  {id: '03-restricted-changes', title: 'Restricted changes', workflows: ['W1', 'W2'], primary: 'person-chloe', clock: '2026-03-03T16:00:00Z',
    summary: 'Three parcels under restrictive profiles: signature (no address change or hold, counters only; one date change already applied), bulky (home delivery only; an address change the carrier declined) and recipient-only with its change cutoff already passed.',
    build(s) {
      s.ship('2026-02-26T14:00:00Z', {id: 'S108', recipient: 'person-chloe', sender: 'Atelier Boisclair', contents: 'Flat-pack bookshelf', policy: 'pol-bulky', address: 'addr-chloe-home', delivery: '2026-03-06'});
      s.ship('2026-02-27T15:00:00Z', {id: 'S107', recipient: 'person-chloe', sender: 'Verre & Fils', contents: 'Crystal decanter', policy: 'pol-signature', address: 'addr-chloe-home', delivery: '2026-03-05'});
      s.decide('2026-02-27T20:00:00Z', s.change('person-chloe', '2026-02-27T16:00:00Z', 'S108', {kind: 'address', address_id: 'addr-chloe-parents'}), 'rejected', 'Bulky items are not delivered to Lac Brume.');
      s.ship('2026-02-28T15:00:00Z', {id: 'S109', recipient: 'person-chloe', sender: 'Northgate Apothecary', contents: 'Vitamin order', policy: 'pol-recipient-only', address: 'addr-chloe-home', delivery: '2026-03-04'});
      s.decide('2026-02-28T18:30:00Z', s.change('person-chloe', '2026-02-28T15:30:00Z', 'S107', {kind: 'reschedule', delivery_date: '2026-03-06'}));
      s.transit('2026-03-01T13:00:00Z', 'S107');
      s.transit('2026-03-02T14:00:00Z', 'S108');
      s.transit('2026-03-02T15:00:00Z', 'S109');
    },
    example(s) {
      s.transit('2026-03-04T13:00:00Z', 'S109', 'out_for_delivery');
      s.event('2026-03-04T16:00:00Z', 'delivered', {shipment_id: 'S109', plan_revision: 1});
    }},
  {id: '04-redirect-readiness', title: 'Redirect and readiness', workflows: ['W2'], primary: 'person-maya', clock: '2026-03-03T15:00:00Z',
    summary: 'One parcel with an applied redirect that has not arrived yet, one ready at a counter and one sent straight to a step-free locker; each ready parcel has the recipient\'s pass.',
    build(s) {
      s.ship('2026-02-24T15:00:00Z', {id: 'S111', recipient: 'person-maya', sender: 'Saltmarsh Outfitters', contents: 'Rain jacket', policy: 'pol-standard', address: 'addr-maya-home', delivery: '2026-03-02'});
      s.redirect('person-maya', '2026-02-25T14:00:00Z', 'S111', 'P01', '2026-02-25T18:00:00Z');
      s.ship('2026-02-26T16:00:00Z', {id: 'S110', recipient: 'person-maya', sender: 'Lumen & Lathe', contents: 'Desk lamp', policy: 'pol-standard', address: 'addr-maya-home', delivery: '2026-03-04'});
      s.ship('2026-02-27T13:00:00Z', {id: 'S112', recipient: 'person-maya', sender: 'Pocket Circuit', contents: 'Phone charger', policy: 'pol-compact', point: 'P05'});
      s.transit('2026-02-28T12:00:00Z', 'S110');
      s.redirect('person-maya', '2026-03-01T15:00:00Z', 'S110', 'P03', '2026-03-01T19:00:00Z');
      s.ready('2026-03-02T16:00:00Z', 'S111');
      s.ready('2026-03-03T13:00:00Z', 'S112');
    },
    example(s) {
      s.ready('2026-03-04T14:00:00Z', 'S110');
      s.collect('2026-03-04T15:00:00Z', 'S111', 'person-maya');
    }},
  {id: '05-delegation', title: 'Delegation', workflows: ['W3'], primary: 'person-maya', clock: '2026-03-03T15:00:00Z',
    others: [{person: 'person-alex', role: 'delegate', sees: ['S113']}, {person: 'person-noor', role: 'delegate', sees: []}],
    summary: 'A ready parcel with a current authorization for one collector after an earlier one was revoked, a signature parcel that cannot be delegated, and a February parcel collected by an authorized collector.',
    build(s) {
      s.ship('2026-02-05T15:00:00Z', {id: 'S114', recipient: 'person-maya', sender: 'Tinderbox Games', contents: 'Board game', policy: 'pol-standard', address: 'addr-maya-home', delivery: '2026-02-10'});
      s.redirect('person-maya', '2026-02-06T15:00:00Z', 'S114', 'P03', '2026-02-06T19:00:00Z');
      s.ready('2026-02-09T14:00:00Z', 'S114');
      s.grant('person-maya', '2026-02-09T16:00:00Z', 'S114', 'person-noor', '2026-02-11T22:00:00Z');
      s.collect('2026-02-10T15:00:00Z', 'S114', 'person-noor');
      s.ship('2026-02-25T15:00:00Z', {id: 'S113', recipient: 'person-maya', sender: 'Harbour Wool Co.', contents: 'Knitting yarn', policy: 'pol-standard', address: 'addr-maya-home', delivery: '2026-03-03'});
      s.redirect('person-maya', '2026-02-26T14:00:00Z', 'S113', 'P01', '2026-02-26T18:00:00Z');
      s.ship('2026-02-27T16:00:00Z', {id: 'S115', recipient: 'person-maya', sender: 'Halden Optics', contents: 'Reading glasses', policy: 'pol-signature', address: 'addr-maya-home', delivery: '2026-03-04'});
      s.redirect('person-maya', '2026-02-28T15:00:00Z', 'S115', 'P03', '2026-02-28T19:00:00Z');
      s.ready('2026-03-02T15:00:00Z', 'S113');
      s.revoke('person-maya', '2026-03-02T20:00:00Z', s.grant('person-maya', '2026-03-02T16:00:00Z', 'S113', 'person-noor', '2026-03-03T23:00:00Z'));
      s.ready('2026-03-03T14:00:00Z', 'S115');
      s.grant('person-maya', '2026-03-03T14:30:00Z', 'S113', 'person-alex', '2026-03-05T12:00:00Z');
    },
    example(s) { s.collect('2026-03-04T15:00:00Z', 'S113', 'person-alex'); }},
  {id: '06-failed-delivery', title: 'Failed delivery', workflows: ['W4'], primary: 'person-idris', clock: '2026-03-03T15:00:00Z',
    summary: 'Two failed deliveries waiting for the recipient, one with a day and a half left and a signature parcel with six hours left, plus a February failure that was recovered by redelivery.',
    build(s) {
      s.ship('2026-02-10T15:00:00Z', {id: 'S117', recipient: 'person-idris', sender: 'Greyfriar Audio', contents: 'Headphones', policy: 'pol-standard', address: 'addr-idris-home', delivery: '2026-02-13'});
      s.transit('2026-02-13T13:00:00Z', 'S117', 'out_for_delivery');
      s.event('2026-02-13T20:00:00Z', 'delivery_failed', {shipment_id: 'S117', plan_revision: 1, reason: 'The building entrance was locked.'});
      s.decide('2026-02-14T17:00:00Z', s.change('person-idris', '2026-02-14T14:00:00Z', 'S117', {kind: 'reschedule', delivery_date: '2026-02-16'}));
      s.transit('2026-02-16T13:00:00Z', 'S117', 'out_for_delivery');
      s.event('2026-02-16T18:00:00Z', 'delivered', {shipment_id: 'S117', plan_revision: 2});
      s.ship('2026-02-26T15:00:00Z', {id: 'S116', recipient: 'person-idris', sender: 'Copperpot Kitchen', contents: 'Cast-iron pan', policy: 'pol-standard', address: 'addr-idris-home', delivery: '2026-03-02'});
      s.ship('2026-02-27T15:00:00Z', {id: 'S118', recipient: 'person-idris', sender: 'Ironbridge Tools', contents: 'Cordless drill', policy: 'pol-signature', address: 'addr-idris-home', delivery: '2026-03-02'});
      s.transit('2026-02-28T14:00:00Z', 'S116');
      s.transit('2026-03-02T13:00:00Z', 'S116', 'out_for_delivery');
      s.transit('2026-03-02T13:30:00Z', 'S118', 'out_for_delivery');
      s.event('2026-03-02T19:30:00Z', 'delivery_failed', {shipment_id: 'S116', plan_revision: 1, reason: 'Nobody was available to receive the parcel.'});
      s.event('2026-03-02T21:00:00Z', 'delivery_failed', {shipment_id: 'S118', plan_revision: 1, reason: 'An adult signature was required and nobody could sign.'});
    },
    example(s) {
      s.event('2026-03-03T21:00:00Z', 'deadline_reached', {shipment_id: 'S118', deadline: 'failure_action'});
      s.event('2026-03-06T15:00:00Z', 'return_completed', {shipment_id: 'S118'});
    }},
  {id: '07-closure-relocation', title: 'Closure and relocation', workflows: ['W2', 'W3', 'W4'], primary: 'person-chloe', clock: '2026-03-03T16:00:00Z',
    others: [{person: 'person-alex', role: 'delegate', sees: ['S119']}],
    summary: 'A ready parcel, with an authorized collector, at a point that has closed with its deadline unchanged, and a parcel the carrier is moving to another point after its first pass was invalidated.',
    build(s) {
      s.ship('2026-02-24T15:00:00Z', {id: 'S120', recipient: 'person-chloe', sender: 'Papeterie Nord', contents: 'Art prints', policy: 'pol-standard', address: 'addr-chloe-home', delivery: '2026-03-01'});
      s.redirect('person-chloe', '2026-02-25T15:00:00Z', 'S120', 'P02', '2026-02-25T19:00:00Z');
      s.ship('2026-02-25T20:00:00Z', {id: 'S119', recipient: 'person-chloe', sender: 'Maison Lierre', contents: 'Linen bedding', policy: 'pol-standard', address: 'addr-chloe-home', delivery: '2026-03-02'});
      s.redirect('person-chloe', '2026-02-26T15:00:00Z', 'S119', 'P04', '2026-02-26T19:00:00Z');
      s.ready('2026-03-01T14:00:00Z', 'S120');
      s.ready('2026-03-02T15:00:00Z', 'S119');
      s.grant('person-chloe', '2026-03-02T17:00:00Z', 'S119', 'person-alex', '2026-03-04T22:00:00Z');
      s.event('2026-03-03T13:00:00Z', 'point_status', {point_id: 'P04', status: 'closed', note: 'Flooding in the market hall; closed until further notice.'});
      s.event('2026-03-03T14:00:00Z', 'relocated', {shipment_id: 'S120', plan_revision: 2, to_point_id: 'P05', reason: 'The Foundry Lane locker bank is out of service.'});
    },
    example(s) {
      s.event('2026-03-04T14:00:00Z', 'point_status', {point_id: 'P04', status: 'open', note: null});
      s.ready('2026-03-04T15:00:00Z', 'S120');
    }},
  {id: '08-expiry-return', title: 'Expiry and return', workflows: ['W2', 'W4'], primary: 'person-maya', clock: '2026-03-04T12:00:00Z',
    summary: 'A ready parcel with three hours left, one whose pickup deadline has passed by the clock with no deadline event applied yet, one being returned after expiry, and a January parcel returned after an unanswered failed delivery.',
    build(s) {
      s.ship('2026-01-12T15:00:00Z', {id: 'S124', recipient: 'person-maya', sender: 'Bramble Print Shop', contents: 'Photo calendar', policy: 'pol-standard', address: 'addr-maya-home', delivery: '2026-01-16'});
      s.transit('2026-01-16T13:00:00Z', 'S124', 'out_for_delivery');
      s.event('2026-01-16T19:00:00Z', 'delivery_failed', {shipment_id: 'S124', plan_revision: 1, reason: 'The address could not be reached because of a road closure.'});
      s.event('2026-01-18T19:00:00Z', 'deadline_reached', {shipment_id: 'S124', deadline: 'failure_action'});
      s.event('2026-01-22T16:00:00Z', 'return_completed', {shipment_id: 'S124'});
      s.ship('2026-02-22T15:00:00Z', {id: 'S123', recipient: 'person-maya', sender: 'Oak & Ember', contents: 'Scented candles', policy: 'pol-standard', address: 'addr-maya-home', delivery: '2026-02-27'});
      s.redirect('person-maya', '2026-02-23T15:00:00Z', 'S123', 'P03', '2026-02-23T19:00:00Z');
      s.ship('2026-02-25T15:00:00Z', {id: 'S122', recipient: 'person-maya', sender: 'Fernhill Seeds', contents: 'Seed packets', policy: 'pol-standard', address: 'addr-maya-home', delivery: '2026-03-02'});
      const toCounter = s.change('person-maya', '2026-02-26T15:00:00Z', 'S122', {kind: 'redirect', point_id: 'P01'});
      s.ready('2026-02-26T15:30:00Z', 'S123');
      s.decide('2026-02-26T19:00:00Z', toCounter);
      s.ready('2026-02-28T16:00:00Z', 'S122');
      s.ship('2026-03-01T14:00:00Z', {id: 'S121', recipient: 'person-maya', sender: 'Driftwood Home', contents: 'Table runner', policy: 'pol-express', address: 'addr-maya-home', delivery: '2026-03-03'});
      s.event('2026-03-01T15:30:00Z', 'deadline_reached', {shipment_id: 'S123', deadline: 'pickup'});
      s.redirect('person-maya', '2026-03-01T16:00:00Z', 'S121', 'P05', '2026-03-01T20:00:00Z');
      s.ready('2026-03-03T15:00:00Z', 'S121');
    },
    example(s) {
      s.event('2026-03-04T12:00:00Z', 'deadline_reached', {shipment_id: 'S122', deadline: 'pickup'});
      s.event('2026-03-04T15:00:00Z', 'deadline_reached', {shipment_id: 'S121', deadline: 'pickup'});
      s.event('2026-03-05T15:00:00Z', 'return_completed', {shipment_id: 'S123'});
    }}
];

function generate() {
  const files = {'fixtures/binding.json': binding}, index = [], catalogParcels = [];
  for (const spec of SEEDS) {
    const s = builder(spec.id, spec.primary);
    spec.build(s);
    const seed = s.finish(spec.clock), events = s.schedule(spec.clock, api => spec.example(api, seed.data));
    files['fixtures/seeds/' + spec.id + '.json'] = seed.data;
    files['fixtures/seeds/schedules/' + spec.id + '.json'] = events;
    const actor = (person, role, sees) => ({account_id: accountOf(person), owner_person_id: person, role, sees});
    const own = seed.data.shipments.filter(x => x.recipient_person_id === spec.primary).map(x => x.id).sort();
    index.push({id: spec.id, title: spec.title, workflows: spec.workflows, summary: spec.summary, seed: 'seeds/' + spec.id + '.json', example_schedule: 'seeds/schedules/' + spec.id + '.json',
      virtual_now: seed.virtual_now,
      // The same ledger loads for any of these people by setting account_id and owner_person_id.
      actors: [actor(spec.primary, 'recipient', own), ...(spec.others || []).map(o => actor(o.person, o.role, o.sees)), actor('person-sam', 'unauthorized', [])],
      shipments: seed.data.shipments.map(x => ({id: x.id, recipient_person_id: x.recipient_person_id, policy_id: x.policy_id, status: x.status, plan_mode: x.plan.mode})).sort((a, b) => a.id.localeCompare(b.id))});
    for (const x of seed.data.shipments) catalogParcels.push({id: x.id, tracking_number: x.tracking_number, recipient_person_id: x.recipient_person_id, sender_label: x.sender_label,
      contents_label: x.contents_label, policy_id: x.policy_id, seed: spec.id});
  }
  files['fixtures/seeds/index.json'] = {schema: 'parcel-delivery-manager.seed-index.v1', binding: 'binding.json',
    note: 'Each seed is a full ledger for env.load_seed, to be loaded with its virtual_now and the binding. Example schedules are valid only for the untouched seed; a Task supplies its own events.',
    seeds: index};
  files['fixtures/catalog.json'] = {schema: 'parcel-delivery-manager.catalog.v1',
    people: PEOPLE.map(p => ({...p, account_id: accountOf(p.person_id)})), ...directory(),
    shipments: catalogParcels.sort((a, b) => a.id.localeCompare(b.id))};
  return files;
}

const root = path.resolve(__dirname, '..');
const render = value => JSON.stringify(value, null, 2) + '\n';
function build({check = false} = {}) {
  const drift = [];
  for (const [file, value] of Object.entries(generate())) {
    const target = path.join(root, file), expected = render(value);
    if (check) { if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== expected) drift.push(file); }
    else { fs.mkdirSync(path.dirname(target), {recursive: true}); fs.writeFileSync(target, expected); }
  }
  return drift;
}
module.exports = {build, generate, SEEDS, PEOPLE};
if (require.main === module) {
  const check = process.argv.includes('--check'), drift = build({check});
  if (drift.length) { console.error('Fixture drift: ' + drift.join(', ') + '. Run node scripts/build-fixtures.cjs'); process.exitCode = 1; }
  else console.log(check ? 'Generated fixtures match.' : 'Generated binding, catalog, seed index, 8 seeds and 8 example schedules.');
}
