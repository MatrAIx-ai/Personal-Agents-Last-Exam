'use strict';
// Business tests for the approved Hopline workflows (proposal §2 core examples, rules and error paths),
// plus the three implementation items from the plan review.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const plugin = require('../plugin.cjs');
const {fixture} = require('./harness.cjs');
const {ev, T, el12Out, tap, plan, rides} = require('./helpers.cjs');
const {message} = require('../src/publisher.cjs');
const {render} = require('../src/time.cjs');
const net = require('../src/network.cjs');

const fails = (f, fn, code, text) => {
  const before = f.data;
  assert.throws(fn, e => e.code === code && (!text || e.message.includes(text)), code);
  assert.deepEqual(f.data, before, 'no partial effect');
};
const notes = (f, args = {}) => f.call('hopline.notifications.list', args).notifications;
const note = (f, id) => notes(f).find(n => n.notification_id === id);
const card = (f, id) => f.call('hopline.cards.get', {card_id: id}).cards[0];
const withSeed = change => { const seed = structuredClone(require('../fixtures/minimal.json')); change(seed); return fixture({seed}); };
const lastTap = f => f.data.taps.at(-1);

test('generated contracts and fixtures match their generators', () => {
  require('../scripts/build-contracts.cjs').build({check: true});
  require('../scripts/generate-fixtures.cjs').build({check: true});
});

test('Mail wire schema copy is byte-identical to the receiver-owned schema', {skip: !fs.existsSync(path.resolve(__dirname, '../../../examples/apps/mail'))}, () => {
  const ours = fs.readFileSync(path.resolve(__dirname, '../schemas/mail-router-message.schema.json'));
  const mail = fs.readFileSync(path.resolve(__dirname, '../../../examples/apps/mail/schemas/router-message.schema.json'));
  assert.ok(ours.equals(mail));
});

// ---- Workflow 1: network, stops and departures ----
test('W1 places, stops with pathways and facilities, routes with the trip ID rule', () => {
  const f = fixture();
  assert.deepEqual(f.call('hopline.places.search', {query: 'harbor'}).places.map(p => p.place_id), ['pl-harbor-sq']);
  const central = f.call('hopline.stops.get', {stop_id: 'st-central'}).stop;
  assert.deepEqual(central.routes.sort(), ['rt-12', 'rt-blue', 'rt-red']);
  const el = central.facilities.find(x => x.facility_id === 'fac-el12');
  assert.deepEqual([el.code, el.kind, el.status], ['EL-12', 'elevator', 'in_service']);
  assert.ok(central.pathways.some(p => p.mode === 'stairs') && central.pathways.some(p => p.facility_id === 'fac-el12'));
  const r = f.call('hopline.routes.get', {route_id: 'rt-40'}).route;
  assert.equal(r.trip_id_rule, 'trip:40:<direction>:<service date YYYY-MM-DD>:<HHMM leaving the first stop>');
  assert.equal(r.patterns.length, 3);
  fails(f, () => f.call('hopline.stops.get', {stop_id: 'st-x'}), 'stop_not_found');
  fails(f, () => f.call('hopline.routes.get', {route_id: 'rt-x'}), 'route_not_found');
});

test('W1 core example: a 9-minute trip update shows on departures; an unknown trip is rejected', () => {
  const f = fixture();
  f.event(ev(T('12-07', '07:46'), 'service.trip_updated', {trip_id: 'trip:blue:nb:2026-12-07:0752', delay_min: 9, cancelled: false, skipped_stop_ids: []}));
  const deps = f.call('hopline.departures.list', {stop_id: 'st-central', from: T('12-07', '07:45'), to: T('12-07', '08:15')}).departures;
  const d = deps.find(x => x.trip_id === 'trip:blue:nb:2026-12-07:0752');
  assert.deepEqual([d.scheduled, d.estimate, d.status, d.trip_update.seq], [T('12-07', '07:52'), T('12-07', '08:01'), 'delayed', 1]);
  assert.equal(deps.find(x => x.trip_id === 'trip:blue:nb:2026-12-07:0758').status, 'scheduled');
  fails(f, () => f.event(ev(T('12-07', '07:50'), 'service.trip_updated', {trip_id: 'trip:blue:nb:2026-12-07:0753', delay_min: 3})), 'unknown_trip');
  fails(f, () => f.call('hopline.departures.list', {stop_id: 'st-central', from: T('12-07', '09:00'), to: T('12-07', '08:00')}), 'invalid_window');
  fails(f, () => f.call('hopline.departures.list', {stop_id: 'st-central', from: T('12-15', '09:00'), to: T('12-15', '10:00')}), 'outside_planning_horizon');
});

test('W1 trips are computed deterministically, including across the end of DST', () => {
  const data = require('../fixtures/minimal.json');
  const trips = net.tripsOn(data, '2026-11-01');
  const first = trips.find(t => t.trip_id === 'trip:blue:nb:2026-11-01:0700');
  assert.equal(render(first.start, 'America/New_York'), '2026-11-01T07:00:00-05:00');
  assert.deepEqual(net.tripsOn(data, '2026-12-07').map(t => t.trip_id), net.tripsOn(structuredClone(data), '2026-12-07').map(t => t.trip_id));
  assert.ok(net.tripById(data, 'trip:40:nb:2026-12-07:0756'), 'the short-turn trip exists');
});

// ---- Workflow 2: trip planning ----
test('W2 core example: EL-12 out; step-free gives Bus 40 direct at 08:21 for $0.85; Central only with uses_estimates on Tuesday', () => {
  const f = fixture();
  f.event(el12Out());
  f.advance(T('12-07', '07:30'));
  const sf = plan(f, {depart_at: T('12-07', '07:35'), step_free: true, card_id: 'cd-dana'});
  assert.equal(sf.itineraries.length, 1);
  const it = sf.itineraries[0];
  assert.deepEqual([it.arrive, it.step_free, it.fare.total_cents, rides(it)], [T('12-07', '08:21'), true, 85, ['trip:40:nb:2026-12-07:0741']]);
  assert.deepEqual(sf.blockers.map(b => [b.id, b.reason]), [['fac-el12', 'out_of_service']]);
  assert.equal(sf.service_state.facilities[0].facility_id, 'fac-el12');
  const any = plan(f, {depart_at: T('12-07', '07:35')});
  assert.deepEqual([any.itineraries[0].arrive, rides(any.itineraries[0])], [T('12-07', '08:03'), ['trip:12:nb:2026-12-07:0740', 'trip:blue:nb:2026-12-07:0758']]);
  assert.equal(any.itineraries[0].step_free, false);
  const tue = plan(f, {depart_at: T('12-08', '19:00'), step_free: true});
  assert.deepEqual(tue.itineraries[0].uses_estimates.map(e => e.code), ['EL-12']);
  assert.ok(rides(tue.itineraries[0]).some(id => id.startsWith('trip:blue')));
});

test('W2 core example: Bus 40 07:41 cancelled; no_step_free_route names both blockers; one transfer goes via the 07:56 trip', () => {
  const f = fixture();
  f.event(el12Out());
  f.event(ev(T('12-07', '07:20'), 'service.trip_updated', {trip_id: 'trip:40:nb:2026-12-07:0741', cancelled: true}));
  f.advance(T('12-07', '07:30'));
  fails(f, () => plan(f, {depart_at: T('12-07', '07:35'), step_free: true, max_transfers: 0}), 'no_step_free_route', 'fac-el12');
  assert.throws(() => plan(f, {depart_at: T('12-07', '07:35'), step_free: true, max_transfers: 0}), e => e.message.includes('trip:40:nb:2026-12-07:0741'));
  const one = plan(f, {depart_at: T('12-07', '07:35'), step_free: true, max_transfers: 1});
  assert.deepEqual(one.itineraries.map(rides), [['trip:12:nb:2026-12-07:0740', 'trip:40:nb:2026-12-07:0756']]);
});

test('W2 planning rules: arrive_by, avoid_modes, max_walk_m, horizon and unknown places', () => {
  const f = fixture();
  const by = plan(f, {arrive_by: T('12-07', '08:30')});
  assert.ok(by.itineraries.every(i => Date.parse(i.arrive) <= Date.parse(T('12-07', '08:30'))));
  assert.ok(Date.parse(by.itineraries[0].depart) >= Date.parse(T('12-07', '07:50')), 'leaves as late as possible');
  const bus = plan(f, {depart_at: T('12-07', '07:35'), avoid_modes: ['rail']});
  assert.ok(bus.itineraries.every(i => i.legs.every(l => l.kind !== 'ride' || l.mode === 'bus')));
  fails(f, () => plan(f, {depart_at: T('12-07', '07:35'), max_walk_m: 50}), 'no_route');
  fails(f, () => plan(f, {depart_at: T('12-15', '07:35')}), 'outside_planning_horizon');
  fails(f, () => plan(f, {depart_at: T('12-07', '07:35'), to: 'pl-nowhere'}), 'place_not_found');
  fails(f, () => plan(f, {}), 'invalid_window');
  fails(f, () => plan(f, {depart_at: T('12-07', '02:00')}), 'outside_service_hours');
});

// ---- Workflow 3: alerts, trip updates and facilities ----
test('W3 core example: an estimate that passes is not a restoration; a restored event makes Central plain again', () => {
  const f = fixture();
  f.event(el12Out());
  f.advance(T('12-08', '18:30'));
  const el = f.call('hopline.stops.get', {stop_id: 'st-central'}).stop.facilities.find(x => x.facility_id === 'fac-el12');
  assert.deepEqual([el.status, el.expected_return, el.estimate_passed], ['out_of_service', T('12-08', '18:00'), true]);
  const p = plan(f, {depart_at: T('12-08', '18:35'), step_free: true});
  assert.ok(p.itineraries.every(i => !rides(i).some(id => id.startsWith('trip:blue'))));
  assert.deepEqual(p.blockers.filter(b => b.kind === 'facility').map(b => [b.id, b.reason]), [['fac-el12', 'estimate_passed']]);
  f.event(ev(T('12-08', '19:05'), 'facility.status_changed', {facility_id: 'fac-el12', status: 'restored'}));
  const q = plan(f, {depart_at: T('12-08', '19:05'), step_free: true});
  assert.ok(rides(q.itineraries[0]).some(id => id.startsWith('trip:blue')));
  assert.deepEqual(q.itineraries[0].uses_estimates, []);
  fails(f, () => f.event(ev(T('12-08', '19:10'), 'facility.status_changed', {facility_id: 'fac-zz', status: 'restored'})), 'unknown_facility');
});

test('W3 core example: al-40-detour v1 then v2, derived upcoming/active/ended, the plan boards at Elm & 4th', () => {
  const f = fixture();
  const v1 = {alert_id: 'al-40-detour', version: 1, msg_type: 'alert', cause: 'construction', effect: 'stop_moved', informed: {route_ids: ['rt-40'], stop_ids: ['st-elm-3rd']},
    replacement_stop_id: 'st-elm-4th', active_periods: [{start: T('12-07', '09:00'), end: T('12-07', '17:00')}], header: 'Route 40: Elm & 3rd stop moved to Elm & 4th'};
  f.event(ev(T('12-07', '07:00'), 'service.alert_published', v1));
  f.event(ev(T('12-07', '07:30'), 'service.alert_published', {alert_id: 'al-40-detour', version: 2, msg_type: 'update',
    active_periods: [{start: T('12-07', '09:00'), end: T('12-08', '17:00')}], references: [{alert_id: 'al-40-detour', version: 1}]}));
  f.advance(T('12-07', '08:00'));
  const a = f.call('hopline.alerts.get', {alert_id: 'al-40-detour'}).alert;
  assert.deepEqual([a.latest_version, a.status, a.versions.map(v => v.version)], [2, 'upcoming', [1, 2]]);
  f.advance(T('12-07', '09:00'));
  assert.equal(f.call('hopline.alerts.get', {alert_id: 'al-40-detour'}).alert.status, 'active');
  f.advance(T('12-07', '10:00'));
  const bus = plan(f, {depart_at: T('12-07', '10:00')}).itineraries.find(i => i.first_route === 'rt-40');
  assert.deepEqual([bus.legs.find(l => l.kind === 'ride').from_stop_id, bus.legs.find(l => l.kind === 'ride').moved_stop.alert_id], ['st-elm-4th', 'al-40-detour']);
  fails(f, () => f.event(ev(T('12-07', '10:05'), 'service.alert_published', {alert_id: 'al-nope', version: 2, msg_type: 'cancel'})), 'alert_reference_unknown');
  fails(f, () => f.event(ev(T('12-07', '10:05'), 'service.alert_published', {alert_id: 'al-40-detour', version: 2, msg_type: 'update'})), 'stale_alert_version');
  f.advance(T('12-08', '17:00'));
  assert.equal(f.call('hopline.alerts.list', {route_id: 'rt-40'}).alerts[0].status, 'ended');
});

test('W3 stop_closed and no_service alerts take stops and trips out of plans', () => {
  const f = fixture();
  f.event(ev(T('12-07', '06:00'), 'service.alert_published', {alert_id: 'al-c', version: 1, msg_type: 'alert', cause: 'police_activity', effect: 'stop_closed',
    informed: {stop_ids: ['st-central']}, active_periods: [{start: T('12-07', '06:00'), end: null}], header: 'Central closed'}));
  const p = plan(f, {depart_at: T('12-07', '07:35')});
  assert.ok(p.itineraries.every(i => i.legs.every(l => l.kind !== 'ride' || (l.from_stop_id !== 'st-central' && l.to_stop_id !== 'st-central'))));
  f.event(ev(T('12-07', '06:05'), 'service.alert_published', {alert_id: 'al-n', version: 1, msg_type: 'alert', cause: 'technical_problem', effect: 'no_service',
    informed: {route_ids: ['rt-40']}, active_periods: [{start: T('12-07', '06:00'), end: T('12-07', '12:00')}], header: 'No Bus 40 service this morning'}));
  fails(f, () => plan(f, {depart_at: T('12-07', '07:35')}), 'no_route');
});

// ---- Workflow 4: saved commutes, subscriptions and notifications ----
test('W4 core example: the EL-12 outage at 06:40 creates one pending notification with its trigger key', () => {
  const f = fixture();
  f.event(el12Out());
  const n = note(f, 'n-sub3-fac-el12-1-dana');
  assert.deepEqual([n.status, n.trigger_key, n.source.kind], ['pending_delivery', 'sub-3|fac-el12|1|person-dana', 'facility']);
  assert.equal(notes(f).length, 1, 'only the step-free work commute is affected');
  assert.match(n.body, /expected back Tue Dec 8, 18:00 EST \(estimate\)/);
  assert.match(n.body, /Step-free alternative: Bus 40 to Harbor Square/);
  f.event(ev(T('12-07', '06:41'), 'notification.delivery_recorded', {notification_id: n.notification_id, status: 'committed', code: null, router_event_id: 'router-1'}));
  assert.equal(note(f, n.notification_id).status, 'delivered');
});

test('W4 core example: at 05:50 the notice is held until 06:30, released by env.advance_time, or withdrawn if EL-12 is restored first', () => {
  const f = fixture();
  f.event(el12Out(T('12-07', '05:50')));
  const id = 'n-sub3-fac-el12-1-dana';
  assert.deepEqual([note(f, id).status, note(f, id).release_at], ['held_quiet_hours', T('12-07', '06:30')]);
  f.advance(T('12-07', '06:31'));
  assert.equal(note(f, id).status, 'pending_delivery');
  const g = fixture();
  g.event(el12Out(T('12-07', '05:50')));
  g.event(ev(T('12-07', '06:10'), 'facility.status_changed', {facility_id: 'fac-el12', status: 'restored'}));
  g.advance(T('12-07', '06:31'));
  assert.equal(note(g, id).status, 'withdrawn');
  assert.equal(notes(g).filter(n => n.status !== 'withdrawn').length, 0, 'the person was never told, so no "restored" notice either');
});

test('W4 replays create nothing; a newer status version withdraws the held one; urgent alerts override quiet hours', () => {
  const f = fixture();
  f.event(el12Out(T('12-07', '05:50')));
  f.event(el12Out(T('12-07', '06:00'), {expected_return: T('12-09', '12:00')}));
  assert.deepEqual(notes(f).map(n => [n.notification_id, n.status]), [['n-sub3-fac-el12-1-dana', 'withdrawn'], ['n-sub3-fac-el12-2-dana', 'held_quiet_hours']]);
  const g = fixture();
  g.event(ev(T('12-07', '05:50'), 'service.alert_published', {alert_id: 'al-stop', version: 1, msg_type: 'alert', cause: 'police_activity', effect: 'stop_closed',
    informed: {stop_ids: ['st-central']}, active_periods: [{start: T('12-07', '05:50'), end: T('12-07', '12:00')}], header: 'Central station closed'}));
  assert.equal(note(g, 'n-sub3-al-stop-1-dana').status, 'pending_delivery', 'stop_closed is urgent and the subscription allows the override');
});

test('W4 core example: a saved place used by a commute with a subscription cannot be removed until the subscription is deleted', () => {
  const f = fixture();
  const clinic = f.call('hopline.saved.list').saved.find(s => s.label === 'Clinic').saved_id;
  fails(f, () => f.call('hopline.saved.remove', {saved_id: clinic}), 'saved_in_use', 'sub-4');
  f.call('hopline.subscriptions.delete', {subscription_id: 'sub-4'});
  assert.deepEqual(f.call('hopline.saved.remove', {saved_id: clinic}), {saved_id: clinic});
  assert.equal(f.call('hopline.subscriptions.list', {include_deleted: true}).subscriptions.find(s => s.subscription_id === 'sub-4').status, 'deleted');
  fails(f, () => f.call('hopline.saved.remove', {saved_id: 'sv-99'}), 'saved_not_found');
});

test('W4 subscriptions: create, pause (no notices), revisions, limits and targets', () => {
  const f = fixture();
  const {subscription_id} = f.call('hopline.subscriptions.create', {target: {kind: 'facility', id: 'fac-el12'}, delivery: 'in_app'});
  assert.equal(subscription_id, 'sub-5');
  f.call('hopline.subscriptions.update', {subscription_id, status: 'paused'});
  f.call('hopline.subscriptions.update', {subscription_id: 'sub-3', status: 'paused'});
  f.event(el12Out());
  assert.equal(notes(f).length, 0);
  assert.deepEqual(f.call('hopline.subscriptions.list').subscriptions.find(s => s.subscription_id === 'sub-3').history.map(h => h.revision), [1, 2]);
  fails(f, () => f.call('hopline.subscriptions.create', {target: {kind: 'facility', id: 'fac-zz'}}), 'unknown_facility');
  fails(f, () => f.call('hopline.subscriptions.create', {target: {kind: 'commute', id: 'sv-1'}}), 'saved_not_found');
  fails(f, () => f.call('hopline.subscriptions.update', {subscription_id: 'sub-99', status: 'active'}), 'subscription_not_found');
  for (let i = 0; i < 20; i++) f.call('hopline.subscriptions.create', {target: {kind: 'route', id: 'rt-12'}});
  fails(f, () => f.call('hopline.subscriptions.create', {target: {kind: 'route', id: 'rt-12'}}), 'subscription_limit');
  const g = fixture();
  fails(g, () => g.call('hopline.saved.add', {kind: 'commute', label: 'Bad', from_saved_id: 'sv-1', to_saved_id: 'sv-2', days: [1], window: {start: '08:00', end: '08:00'}}), 'invalid_window');
  for (let i = 0; i < 15; i++) g.call('hopline.saved.add', {kind: 'place', label: 'P' + i, place_ref: 'pl-library'});
  fails(g, () => g.call('hopline.saved.add', {kind: 'place', label: 'X', place_ref: 'pl-library'}), 'saved_limit');
});

test('W4 route and card subscriptions: delays over the threshold, low balance after a tap', () => {
  const f = fixture();
  f.event(ev(T('12-07', '06:00'), 'service.trip_updated', {trip_id: 'trip:40:nb:2026-12-07:0711', delay_min: 6}));
  f.event(ev(T('12-07', '06:01'), 'service.trip_updated', {trip_id: 'trip:40:nb:2026-12-07:0741', delay_min: 12}));
  assert.deepEqual(notes(f).filter(n => n.subscription_id === 'sub-1').map(n => n.source.id), ['trip:40:nb:2026-12-07:0741']);
  // Low balance: only a charge that takes the balance from at or above $5.00 to below it.
  f.call('hopline.cards.add_value', {card_id: 'cd-lee', amount_cents: 500, payment_method_id: 'pm-visa'});
  f.event(ev(T('12-07', '07:00'), 'payment.settled', {card_id: 'cd-lee', settle: 'oldest_pending', outcome: 'settled'}));
  f.event(tap(T('12-07', '08:00'), 'cd-lee', 'rail'));
  f.event(tap(T('12-07', '08:30'), 'cd-lee', 'bus'));
  f.event(tap(T('12-07', '11:00'), 'cd-lee', 'rail'));
  const low = notes(f).filter(n => n.subscription_id === 'sub-2');
  assert.deepEqual(low.map(n => n.title), ['Card load settled', 'Low card balance'], 'no notice for the free transfer or the later tap already below the level');
  assert.match(low[1].body, /below your \$5\.00 alert/);
  f.event(tap(T('12-07', '15:00'), 'cd-lee', 'rail'));
  f.event(tap(T('12-07', '17:30'), 'cd-lee', 'rail'));
  assert.equal(lastTap(f).reason, 'insufficient_balance');
  assert.equal(notes(f).filter(n => n.subscription_id === 'sub-2').at(-1).title, 'Tap declined');
});

// ---- Workflow 5: fare card ----
test('W5 core example: reduced-fare weekly cap reached mid-fare at $0.45, then $0.00, and reset next Monday', () => {
  const f = fixture();
  const days = ['12-07', '12-07', '12-08', '12-08', '12-09', '12-09', '12-10', '12-10', '12-11'], hours = ['07:58', '17:20'];
  days.forEach((d, i) => f.event(tap(T(d, hours[i % 2]), 'cd-dana', 'central')));
  assert.equal(f.data.taps.filter(t => t.card_id === 'cd-dana' && Date.parse(t.at) >= Date.parse(T('12-07', '00:00'))).reduce((s, t) => s + t.charged_cents, 0), 1080);
  f.event(tap(T('12-11', '17:40'), 'cd-dana', 'rail'));
  assert.deepEqual([lastTap(f).charged_cents, lastTap(f).basis], [45, 'cap']);
  assert.equal(card(f, 'cd-dana').weekly_cap.remaining_cents, 0);
  f.event(tap(T('12-12', '10:00'), 'cd-dana', 'rail'));
  assert.equal(lastTap(f).charged_cents, 0);
  f.event(tap(T('12-14', '07:58'), 'cd-dana', 'rail'));
  assert.equal(lastTap(f).charged_cents, 120);
});

test('W5 core example: a load is pending until settled; the balance may go to minus one rail fare, then taps are declined', () => {
  const f = fixture();
  const {entry_id, spendable_cents, pending_cents} = f.call('hopline.cards.add_value', {card_id: 'cd-lee', amount_cents: 2000, payment_method_id: 'pm-visa'});
  assert.deepEqual([entry_id, spendable_cents, pending_cents], ['le-cd-lee-6', 100, 2000]);
  f.event(tap(T('12-07', '08:00'), 'cd-lee', 'rail'));
  assert.equal(card(f, 'cd-lee').balance_cents, -140);
  f.event(tap(T('12-07', '10:30'), 'cd-lee', 'rail'));
  assert.deepEqual([lastTap(f).result, lastTap(f).reason], ['declined', 'insufficient_balance']);
  f.event(ev(T('12-07', '12:10'), 'payment.settled', {card_id: 'cd-lee', settle: 'oldest_pending', outcome: 'settled'}));
  assert.equal(card(f, 'cd-lee').balance_cents, 1860);
  fails(f, () => f.event(ev(T('12-07', '12:20'), 'payment.settled', {entry_id, outcome: 'settled'})), 'load_not_pending');
});

test('W5 core example: report_lost moves $13.60 and the pass to cd-lee~r1; the old card is blocked everywhere', () => {
  const f = fixture();
  f.call('hopline.cards.add_value', {card_id: 'cd-lee', amount_cents: 2000, payment_method_id: 'pm-visa'});
  f.event(tap(T('12-07', '08:00'), 'cd-lee', 'rail'));
  f.event(ev(T('12-07', '12:10'), 'payment.settled', {card_id: 'cd-lee', settle: 'oldest_pending', outcome: 'settled'}));
  f.call('hopline.cards.add_value', {card_id: 'cd-lee', amount_cents: 9000, payment_method_id: 'pm-visa'});
  f.event(ev(T('12-07', '12:20'), 'payment.settled', {card_id: 'cd-lee', settle: 'oldest_pending', outcome: 'settled'}));
  const {pass_id} = f.call('hopline.passes.purchase', {card_id: 'cd-lee', product: 'monthly', start_month: '2026-12'});
  assert.equal(card(f, 'cd-lee').balance_cents, 1860);
  const r = f.call('hopline.cards.report_lost', {card_id: 'cd-lee'});
  assert.deepEqual([r.replacement_card_id, r.fee_cents, r.balance_cents], ['cd-lee~r1', 500, 1360]);
  const repl = card(f, 'cd-lee~r1');
  assert.deepEqual([repl.status, repl.passes.map(p => [p.pass_id, p.status])], ['active', [[pass_id, 'active']]]);
  assert.equal(card(f, 'cd-lee').status, 'blocked');
  f.event(tap(T('12-07', '13:00'), 'cd-lee', 'rail'));
  assert.deepEqual([lastTap(f).result, lastTap(f).reason], ['declined', 'card_blocked']);
  fails(f, () => f.call('hopline.cards.report_lost', {card_id: 'cd-lee'}), 'card_blocked');
  fails(f, () => f.call('hopline.cards.add_value', {card_id: 'cd-lee', amount_cents: 500, payment_method_id: 'pm-visa'}), 'card_blocked');
  assert.equal(f.data.ledger.filter(e => e.kind === 'replacement_fee').length, 1);
  fails(f, () => f.call('hopline.passes.cancel', {pass_id}), 'pass_started');
  f.event(tap(T('12-07', '17:00'), 'cd-lee~r1', 'rail'));
  assert.deepEqual([lastTap(f).charged_cents, lastTap(f).basis], [0, 'pass']);
  assert.equal(f.data.subscriptions.find(s => s.subscription_id === 'sub-2').target.id, 'cd-lee~r1', 'the card subscription follows the replacement');
});

test('W5 core example: a senior reduced fare halves fares from its decision; application_pending; expired fares are full again', () => {
  const f = fixture();
  f.call('hopline.cards.add_value', {card_id: 'cd-lee', amount_cents: 3000, payment_method_id: 'pm-visa'});
  f.event(ev(T('12-07', '06:00'), 'payment.settled', {card_id: 'cd-lee', settle: 'oldest_pending', outcome: 'settled'}));
  f.event(tap(T('12-07', '08:00'), 'cd-lee', 'rail'));
  assert.deepEqual(f.call('hopline.reduced_fare.apply', {card_id: 'cd-lee', program: 'senior'}), {application_id: 'ap-cd-lee-1', application_status: 'submitted'});
  fails(f, () => f.call('hopline.reduced_fare.apply', {card_id: 'cd-lee', program: 'senior'}), 'application_pending');
  fails(f, () => f.call('hopline.reduced_fare.apply', {card_id: 'cd-dana', program: 'senior'}), 'not_eligible_program');
  f.event(ev(T('12-14', '10:00'), 'fare.eligibility_decided', {card_id: 'cd-lee', decision: 'approved', program: 'senior', expires_at: '2027-12-31T23:59:00-05:00'}));
  assert.equal(f.data.taps.at(-1).charged_cents, 240, 'earlier taps unchanged');
  f.event(tap(T('12-14', '12:00'), 'cd-lee', 'rail'));
  assert.equal(lastTap(f).charged_cents, 120);
  fails(f, () => f.event(ev(T('12-14', '12:05'), 'fare.eligibility_decided', {card_id: 'cd-lee', decision: 'denied'})), 'application_not_pending');
  f.advance('2028-01-03T08:00:00-05:00');
  const c = card(f, 'cd-lee');
  assert.deepEqual([c.reduced_fare.status, c.application.status, c.fares.rail], ['expired', 'expired', 240]);
});

test('W5 core example: autoreload creates le-cd-lee-7 inside the tap, only once; settlement by card_id settles it', () => {
  const f = withSeed(s => {
    s.ledger.find(e => e.entry_id === 'le-cd-lee-1').amount_cents = 1520;
    s.cards.find(c => c.card_id === 'cd-lee').balance_cents = 560;
  });
  f.call('hopline.cards.set_autoreload', {card_id: 'cd-lee', rule: {threshold_cents: 500, amount_cents: 2000, payment_method_id: 'pm-visa'}});
  f.event(tap(T('12-07', '08:00'), 'cd-lee', 'rail'));
  assert.equal(card(f, 'cd-lee').balance_cents, 320);
  const load = f.data.ledger.find(e => e.entry_id === 'le-cd-lee-7');
  assert.deepEqual([load.kind, load.amount_cents, load.source], ['load_pending', 2000, 'autoreload']);
  f.event(tap(T('12-07', '11:00'), 'cd-lee', 'rail'));
  assert.equal(f.data.ledger.filter(e => e.kind === 'load_pending').length, 1);
  f.event(ev(T('12-07', '12:00'), 'payment.settled', {card_id: 'cd-lee', settle: 'oldest_pending', outcome: 'settled'}));
  assert.equal(f.data.ledger.find(e => e.entry_id === 'le-cd-lee-7').kind, 'load_settled');
});

test('W5 transfers: bus to rail pays the difference, rail to bus is free, one transfer per fare, inside 120 minutes', () => {
  const f = fixture();
  f.event(tap(T('12-07', '08:00'), 'cd-lee', 'bus'));
  f.call('hopline.cards.add_value', {card_id: 'cd-lee', amount_cents: 5000, payment_method_id: 'pm-visa'});
  f.event(ev(T('12-07', '08:01'), 'payment.settled', {card_id: 'cd-lee', settle: 'oldest_pending', outcome: 'settled'}));
  f.event(tap(T('12-07', '08:20'), 'cd-lee', 'rail'));
  assert.deepEqual([lastTap(f).charged_cents, lastTap(f).basis], [70, 'transfer']);
  f.event(tap(T('12-07', '08:40'), 'cd-lee', 'bus'));
  assert.equal(lastTap(f).charged_cents, 170, 'the fare already gave its transfer');
  f.event(tap(T('12-07', '10:40'), 'cd-lee', 'rail'));
  assert.deepEqual([lastTap(f).charged_cents, lastTap(f).basis], [70, 'transfer'], 'exactly 120 minutes is inside the window');
  f.event(tap(T('12-07', '13:00'), 'cd-lee', 'rail'));
  f.event(tap(T('12-07', '13:30'), 'cd-lee', 'bus'));
  assert.equal(lastTap(f).charged_cents, 0, 'rail to bus is free');
  f.event(tap(T('12-07', '17:00'), 'cd-lee', 'rail'));
  f.event(tap(T('12-07', '19:01'), 'cd-lee', 'bus'));
  assert.equal(lastTap(f).charged_cents, 170, '121 minutes is outside');
});

test('W5 passes: month boundaries, pass_overlaps, insufficient_balance, refund before start', () => {
  const f = fixture();
  fails(f, () => f.call('hopline.passes.purchase', {card_id: 'cd-lee', product: 'monthly', start_month: '2027-01'}), 'insufficient_balance');
  f.call('hopline.cards.add_value', {card_id: 'cd-lee', amount_cents: 20000, payment_method_id: 'pm-visa'});
  f.event(ev(T('12-07', '06:00'), 'payment.settled', {card_id: 'cd-lee', settle: 'oldest_pending', outcome: 'settled'}));
  const {pass_id} = f.call('hopline.passes.purchase', {card_id: 'cd-lee', product: 'monthly', start_month: '2027-01'});
  fails(f, () => f.call('hopline.passes.purchase', {card_id: 'cd-lee', product: 'monthly', start_month: '2027-01'}), 'pass_overlaps');
  fails(f, () => f.call('hopline.passes.purchase', {card_id: 'cd-lee', product: 'monthly', start_month: '2026-11'}), 'invalid_window');
  f.event(tap(T('12-31', '23:00'), 'cd-lee', 'rail'));
  assert.equal(lastTap(f).charged_cents, 240);
  f.event(tap('2027-01-01T08:00:00-05:00', 'cd-lee', 'rail'));
  assert.equal(lastTap(f).basis, 'pass');
  const g = fixture();
  g.call('hopline.cards.add_value', {card_id: 'cd-lee', amount_cents: 20000, payment_method_id: 'pm-visa'});
  g.event(ev(T('12-07', '06:00'), 'payment.settled', {card_id: 'cd-lee', settle: 'oldest_pending', outcome: 'settled'}));
  const p = g.call('hopline.passes.purchase', {card_id: 'cd-lee', product: 'monthly', start_month: '2027-01'});
  assert.deepEqual(g.call('hopline.passes.cancel', {pass_id: p.pass_id}).refund_cents, 9000);
  assert.equal(card(g, 'cd-lee').balance_cents, 20100);
  assert.equal(typeof pass_id, 'string');
});

test('W5 errors: mode_mismatch, invalid_amount, payment_method_not_found, card_not_found, a failing payment method', () => {
  const f = fixture();
  fails(f, () => f.event(ev(T('12-07', '08:00'), 'fare.tap_recorded', {tap_id: 'tp-x', card_id: 'cd-lee', stop_id: 'st-central', route_id: 'rt-blue', mode: 'bus'})), 'mode_mismatch');
  fails(f, () => f.call('hopline.cards.add_value', {card_id: 'cd-lee', amount_cents: 50, payment_method_id: 'pm-visa'}), 'invalid_amount');
  fails(f, () => f.call('hopline.cards.add_value', {card_id: 'cd-lee', amount_cents: 500, payment_method_id: 'pm-x'}), 'payment_method_not_found');
  fails(f, () => f.call('hopline.cards.get', {card_id: 'cd-x'}), 'card_not_found');
  const g = withSeed(s => { s.rider.payment_methods[1].fails = true; });
  g.call('hopline.cards.add_value', {card_id: 'cd-lee', amount_cents: 500, payment_method_id: 'pm-debit'});
  g.event(ev(T('12-07', '09:00'), 'payment.settled', {card_id: 'cd-lee', settle: 'oldest_pending', outcome: 'settled'}));
  assert.equal(g.data.ledger.at(-1).kind, 'load_failed');
  assert.equal(card(g, 'cd-lee').balance_cents, 100);
});

// ---- Review items 1-3 ----
test('item 1: without an adapter call a mail notice stays pending_delivery; outcomes follow the Messaging table; messages are byte-stable', () => {
  const f = fixture();
  f.event(el12Out());
  const id = 'n-sub3-fac-el12-1-dana';
  f.advance(T('12-07', '12:00'));
  assert.equal(note(f, id).status, 'pending_delivery', 'a normal outcome, not an error');
  const m = message(f.data, f.data.notifications[0]);
  assert.deepEqual([m.id, m.subject, m.time, m.data.source_object.object_type], ['hopline-' + id, 'fac-el12', T('12-07', '06:40'), 'facility']);
  f.advance(T('12-07', '13:00'));
  assert.equal(JSON.stringify(message(f.data, f.data.notifications[0])), JSON.stringify(m));
  const rec = (status, code, extra = {}) => f.event(ev(f.now, 'notification.delivery_recorded', {notification_id: id, status, code, router_event_id: status === 'committed' ? 'router-1' : null, ...extra}));
  rec('rejected', 'idempotency_conflict');
  assert.equal(note(f, id).status, 'pending_delivery');
  rec('unknown', 'receiver_unconfirmed', {stop_run: true});
  assert.equal(note(f, id).status, 'pending_delivery');
  rec('rejected', 'recipient_not_authorized');
  assert.equal(note(f, id).status, 'delivery_failed');
  fails(f, () => rec('committed', null), 'notification_not_pending');
});

test('item 2: a commute that works only through an estimated return is affected, and the notice says it is an estimate', () => {
  const f = fixture();
  // Out since 05:50, expected back at 06:30, before the 07:20-08:00 window: feasible only if the estimate holds.
  f.event(el12Out(T('12-07', '06:00'), {since: T('12-07', '05:50'), expected_return: T('12-07', '06:30')}));
  const n = note(f, 'n-sub3-fac-el12-1-dana');
  assert.match(n.body, /works only if the estimated return holds/);
  assert.doesNotMatch(n.body, /has no usual/);
  assert.equal(notes(f).length, 1, 'one event affecting several days produces one notice');
  // Once the estimate has passed with no restoration, a plan reports the elevator as estimate_passed.
  f.advance(T('12-07', '07:30'));
  assert.equal(plan(f, {depart_at: T('12-07', '07:35'), step_free: true}).blockers[0].reason, 'estimate_passed');
});

test('item 3: settlements and eligibility decisions naming the replaced card go to its replacement and are recorded', () => {
  const f = fixture();
  f.call('hopline.cards.add_value', {card_id: 'cd-lee', amount_cents: 2000, payment_method_id: 'pm-visa'});
  f.call('hopline.reduced_fare.apply', {card_id: 'cd-lee', program: 'senior'});
  const lost = f.call('hopline.cards.report_lost', {card_id: 'cd-lee'});
  assert.deepEqual([lost.fee_cents, lost.fee_owed_cents], [0, 500], 'a $1.00 balance cannot pay the fee, so it is owed');
  const moved = f.data.ledger.find(e => e.kind === 'load_pending');
  assert.deepEqual([moved.entry_id, moved.card_id, moved.original_card_id], ['le-cd-lee-6', 'cd-lee~r1', 'cd-lee']);
  f.event(ev(T('12-07', '09:00'), 'payment.settled', {card_id: 'cd-lee', settle: 'oldest_pending', outcome: 'settled'}));
  assert.equal(card(f, 'cd-lee~r1').balance_cents, 100 + 2000 - 500, 'the owed fee is taken from the next settled load');
  f.event(ev(T('12-07', '10:00'), 'fare.eligibility_decided', {card_id: 'cd-lee', decision: 'approved', expires_at: '2027-12-31T23:59:00-05:00'}));
  assert.equal(card(f, 'cd-lee~r1').reduced_fare.status, 'active');
  assert.deepEqual(f.data.redirects.map(r => [r.operation, r.from_card_id, r.to_card_id]),
    [['payment.settled', 'cd-lee', 'cd-lee~r1'], ['fare.eligibility_decided', 'cd-lee', 'cd-lee~r1']]);
  // A tap with the physical old card is declined, not redirected.
  f.event(tap(T('12-07', '11:00'), 'cd-lee', 'rail'));
  assert.equal(lastTap(f).reason, 'card_blocked');
});

test('moot events commit as no-ops with the reason recorded; rejections change nothing', () => {
  const f = fixture();
  const before = f.data;
  f.event(ev(T('12-07', '06:00'), 'payment.settled', {card_id: 'cd-lee', settle: 'oldest_pending', outcome: 'settled'}));
  f.event(ev(T('12-07', '06:01'), 'facility.status_changed', {facility_id: 'fac-el12', status: 'restored'}));
  const after = f.data;
  assert.deepEqual(after.ignored_events.map(e => e.operation), ['payment.settled', 'facility.status_changed']);
  assert.deepEqual({...after, ignored_events: []}, before);
  fails(f, () => f.event(ev(T('12-07', '06:02'), 'payment.settled', {entry_id: 'le-zz', outcome: 'settled'})), 'invalid_event');
  fails(f, () => f.event(ev(T('12-07', '06:02'), 'fare.tap_recorded', {tap_id: 'tp-1', card_id: 'cd-zz', stop_id: 'st-central', route_id: 'rt-blue', mode: 'rail'})), 'card_not_found');
});

// ---- Implementation review regressions ----
test('an alert without an end time is stored with end null and is in effect until cancelled', () => {
  const f = fixture();
  f.event(ev(T('12-07', '06:00'), 'service.alert_published', {alert_id: 'al-open', version: 1, msg_type: 'alert', cause: 'police_activity', effect: 'stop_closed',
    informed: {stop_ids: ['st-mill']}, active_periods: [{start: T('12-07', '06:00')}], header: 'Mill Street closed'}));
  assert.equal(f.data.alerts[0].versions[0].active_periods[0].end, null);
  f.advance(T('12-10', '06:00'));
  assert.equal(f.call('hopline.alerts.get', {alert_id: 'al-open'}).alert.status, 'active');
});

test('notification and message IDs never contain the replacement card tilde', () => {
  const f = fixture();
  f.call('hopline.cards.report_lost', {card_id: 'cd-lee'});
  f.call('hopline.cards.add_value', {card_id: 'cd-lee~r1', amount_cents: 2000, payment_method_id: 'pm-visa'});
  f.event(ev(T('12-07', '09:00'), 'payment.settled', {card_id: 'cd-lee~r1', settle: 'oldest_pending', outcome: 'settled'}));
  const n = notes(f).find(x => x.source.id === 'le-cd-lee~r1-1');
  assert.equal(n.notification_id, 'n-sub2-le-cd-lee.r1-1-1-dana');
  const m = message(f.data, n);
  assert.ok(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,149}$/.test(n.notification_id) && !m.data.source_object.object_id.includes('~') && !m.subject.includes('~'));
});

test('a step-free plan between station stop IDs goes through the street entrances and their elevators', () => {
  const f = fixture();
  f.event(el12Out());
  f.advance(T('12-07', '07:30'));
  fails(f, () => plan(f, {from: 'st-central', to: 'st-mill', depart_at: T('12-07', '07:35'), step_free: true}), 'no_step_free_route', 'fac-el12');
  const q = plan(f, {from: 'st-central', to: 'st-mill', depart_at: T('12-07', '07:35')});
  assert.ok(rides(q.itineraries[0])[0].startsWith('trip:blue:nb'));
  fails(f, () => plan(f, {from: 'pl-library', to: 'pl-library', depart_at: T('12-07', '07:35')}), 'no_route', 'same');
  assert.ok(q.itineraries[0].legs.every(l => l.kind !== 'walk' || l.minutes > 0 || l.length_m > 0), 'no empty walk legs');
});

test('commute subscriptions ignore alerts that do not change the commute', () => {
  const f = fixture();
  f.event(el12Out());
  const count = () => notes(f).filter(n => n.subscription_id === 'sub-3').length;
  assert.equal(count(), 1);
  f.event(ev(T('12-07', '07:00'), 'service.alert_published', {alert_id: 'al-sat', version: 1, msg_type: 'alert', cause: 'construction', effect: 'detour',
    informed: {route_ids: ['rt-12']}, active_periods: [{start: T('12-12', '06:00'), end: T('12-12', '20:00')}], header: 'Bus 12 detour on Saturday'}));
  f.event(ev(T('12-07', '07:01'), 'service.alert_published', {alert_id: 'al-sun', version: 1, msg_type: 'alert', cause: 'maintenance', effect: 'reduced_service',
    informed: {route_ids: ['rt-blue']}, active_periods: [{start: T('12-13', '06:00'), end: T('12-13', '20:00')}], header: 'Fewer Blue Line trains on Sunday'}));
  assert.equal(count(), 1);
});

test('a newer version withdraws a held notice even when it creates none itself', () => {
  const f = fixture();
  f.call('hopline.subscriptions.update', {subscription_id: 'sub-1', delivery: 'mail', quiet_hours: {start: '22:00', end: '06:30'}});
  f.event(ev(T('12-07', '05:55'), 'service.trip_updated', {trip_id: 'trip:40:nb:2026-12-07:0741', delay_min: 25}));
  assert.equal(notes(f, {status: 'held_quiet_hours'}).length, 1);
  f.event(ev(T('12-07', '06:05'), 'service.trip_updated', {trip_id: 'trip:40:nb:2026-12-07:0741', delay_min: 0}));
  f.advance(T('12-07', '06:31'));
  assert.deepEqual(notes(f).filter(n => n.subscription_id === 'sub-1').map(n => n.status), ['withdrawn']);
});

test('a $0.00 boarding (capped week or pass) starts no transfer across a week or month boundary', () => {
  const f = fixture();
  f.call('hopline.cards.add_value', {card_id: 'cd-lee', amount_cents: 20000, payment_method_id: 'pm-visa'});
  f.event(ev(T('12-07', '06:00'), 'payment.settled', {card_id: 'cd-lee', settle: 'oldest_pending', outcome: 'settled'}));
  f.call('hopline.passes.purchase', {card_id: 'cd-lee', product: 'monthly', start_month: '2026-12'});
  f.event(tap(T('12-31', '23:30'), 'cd-lee', 'central'));
  assert.equal(lastTap(f).basis, 'pass');
  f.event(tap('2027-01-01T00:30:00-05:00', 'cd-lee', 'rail'));
  assert.deepEqual([lastTap(f).charged_cents, lastTap(f).basis], [240, 'fare']);
});

test('a plan without a card applies the transfer rule', () => {
  const f = fixture();
  const p = plan(f, {depart_at: T('12-07', '07:35')});
  assert.equal(p.itineraries[0].fare.total_cents, 240, 'Bus 12 $1.70 then Blue Line $0.70');
  assert.equal(p.itineraries[0].fare.card_id, null);
});

// ---- Reads, seeds, packs ----
test('reads never change data and every read carries as_of', () => {
  const f = fixture();
  f.event(el12Out(T('12-07', '05:50')));
  f.advance(T('12-07', '07:00'));
  const before = JSON.stringify(f.data);
  for (const [name, args] of [['hopline.places.search', {}], ['hopline.stops.get', {stop_id: 'st-central'}], ['hopline.routes.get', {route_id: 'rt-blue'}],
    ['hopline.departures.list', {stop_id: 'st-central', from: T('12-07', '07:00'), to: T('12-07', '08:00')}], ['hopline.trips.plan', {from: 'pl-elm-3rd', to: 'pl-harbor-sq', depart_at: T('12-07', '07:35'), step_free: true}],
    ['hopline.alerts.list', {}], ['hopline.saved.list', {}], ['hopline.subscriptions.list', {}], ['hopline.notifications.list', {}], ['hopline.cards.get', {}],
    ['hopline.cards.history', {card_id: 'cd-lee', from: T('11-01', '00:00'), to: T('12-07', '07:00')}], ['hopline.fares.products', {}]]) {
    assert.equal(f.call(name, args).as_of, T('12-07', '07:00'), name);
  }
  assert.equal(JSON.stringify(f.data), before);
});

test('seed validation rejects inconsistent records', () => {
  const bad = (change, text) => assert.throws(() => withSeed(change), e => e.code === 'invalid_seed' && (!text || e.message.includes(text)), text);
  bad(s => { s.cards[1].balance_cents += 1; }, 'reconcile');
  bad(s => { s.taps[0].at = '2026-12-08T08:00:00-05:00'; }, 'after the current virtual time');
  bad(s => { s.pathways[0].to = 'nowhere'; }, 'Unknown pathway node');
  bad(s => { s.pathways = s.pathways.filter(p => p.facility_id !== 'fac-el12'); s.facilities = s.facilities.filter(x => x.facility_id !== 'fac-el12'); }, 'step-free');
  bad(s => { s.patterns.push({...s.patterns[0], pattern_id: 'pt-dup'}); }, 'Duplicate trip');
  bad(s => { s.stops[0].external_ref = {app_id: 'switchback', account_id: 'sb-1', object_id: 'x'}; }, 'binding');
});

test('fixture history: reconciled balances, reproducible charges, history from 2026-01-01, seeds under 400 KB', () => {
  for (const p of ['wheelchair-commute', 'stroller-weekend', 'airport-lost-card']) {
    const file = path.resolve(__dirname, `../examples/packs/${p}/seed.json`), seed = require(file);
    assert.ok(fs.statSync(file).size < 400 * 1024, p + ' size');
    assert.ok(seed.taps.every(t => t.at >= '2026-01-01') && seed.ledger.every(e => e.at >= '2026-01-01'));
    assert.equal(seed.notifications.filter(n => n.status === 'pending_delivery').length, 0, 'nothing waits for Mail in a seed');
  }
  const ines = require('../examples/packs/wheelchair-commute/seed.json');
  assert.ok(ines.taps.length > 250 && ines.taps[0].at < '2026-01-10');
  assert.ok(ines.ledger.filter(e => e.source === 'autoreload').length > 5);
  const kenji = require('../examples/packs/airport-lost-card/seed.json');
  assert.deepEqual(kenji.cards.map(c => [c.card_id, c.status]), [['cd-kenji', 'blocked'], ['cd-kenji~r1', 'active']]);
});

for (const name of ['wheelchair-commute', 'stroller-weekend', 'airport-lost-card']) {
  test(`pack ${name} loads and replays its events`, () => {
    const dir = `../examples/packs/${name}/`;
    const f = fixture({seed: require(dir + 'seed.json'), binding: require(dir + 'binding.json'), now: require(dir + 'clock.json').initial_time});
    for (const e of require(dir + 'events.json')) f.event(e);
    const d = f.data;
    if (name === 'wheelchair-commute') {
      const mail = d.notifications.filter(x => x.delivery === 'mail').map(x => [x.notification_id, x.status, x.release_at]);
      assert.deepEqual(mail, [['n-sub1-fac-el12-1-ines', 'pending_delivery', '2026-11-30T06:30:00-05:00'], ['n-sub1-fac-el12-2-ines', 'pending_delivery', null],
        ['n-sub1-fac-el12-3-ines', 'pending_delivery', null]], 'held overnight, a new estimate, then back to normal');
      assert.match(d.notifications[0].body, /No step-free itinerary is available/);
    }
    if (name === 'stroller-weekend') {
      assert.equal(d.taps.find(t => t.tap_id === 'tp-tomas-sat-1').result, 'accepted');
      assert.match(d.notifications.find(n => n.source.id === 'al-40-weekend').body, /Bus 40 stops at Elm & 4th instead of Elm & 3rd/);
      assert.equal(f.call('hopline.alerts.get', {alert_id: 'al-40-weekend'}).alert.status, 'cancelled');
    }
    if (name === 'airport-lost-card') {
      assert.deepEqual(d.redirects.map(r => r.to_card_id), ['cd-kenji~r1']);
      assert.equal(d.taps.find(t => t.tap_id === 'tp-kenji-old-1').reason, 'card_blocked');
    }
  });
}

test('records and objects describe the same business records', () => {
  const seed = require('../fixtures/minimal.json');
  assert.equal(plugin.records(seed).length, plugin.objects(seed).length);
  assert.equal(plugin.records(seed).length, require('../contribution/dataset.json').expected_counts.records);
});
