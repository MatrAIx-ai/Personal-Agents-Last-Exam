'use strict';
// App-only business tests. Run with `node --test tests/business.test.cjs` from this folder.
const test = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('../plugin.cjs');
const {fixture, rejects, actAs} = require('./harness.cjs');
const build = require('../scripts/build-schemas.cjs');

test('generated contracts match their source definitions', () => {
  assert.deepEqual(build.build({check: true}), []);
});

test('Web App declaration, registry and controller are consistent with the package', () => {
  const fs = require('node:fs'), path = require('node:path'), root = path.resolve(__dirname, '..');
  const manifest = require('../app.json'), tools = require('../tools.json'), registry = require('../web.registry.json');
  const web = require('../contribution/gui.json').extensions.find(e => e.namespace === 'pale.web').data;
  assert.equal(require('../contribution/contribution.json').gui_ref, 'gui.json');
  assert.deepEqual([web.page, web.controller, web.host, web.status], ['gui/index.html', 'gui/src/app.js', 'runtime/web/server.cjs', 'implemented']);
  for (const file of [web.page, web.controller]) assert.ok(fs.existsSync(path.join(root, file)), file);
  // The package-local registry starts the shared Web Host on this package at the fixture clock.
  assert.deepEqual(registry.apps, [{app_id: manifest.app_id, version: manifest.version, path: '.'}]);
  assert.equal(registry.initial_time, require('../fixtures/clock.json').initial_time);
  const controller = fs.readFileSync(path.join(root, web.controller), 'utf8');
  for (const tool of tools) assert.ok(controller.includes("'" + tool.name + "'"), 'Controller uses ' + tool.name);
  // The Host allows no inline script or style; the controller builds text nodes only.
  assert.doesNotMatch(controller, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|style\s*[:=]/);
  assert.doesNotMatch(controller, /Date\.now|new Date\(\)/, 'The page never uses the browser clock for business state');
  const policies = require('../fixtures/policies.json');
  assert.deepEqual(policies.sandbox.allow.slice().sort(), tools.map(t => t.name).sort());
  assert.deepEqual(policies.scenario.allow.slice().sort(), tools.filter(t => t.read_only).map(t => t.name).sort());
});

test('fixture loads and reads are side-effect free', () => {
  const f = fixture(), before = f.data;
  const list = f.call('shipments.list').items;
  assert.deepEqual(list.map(x => x.id).sort(), ['S001', 'S002', 'S003']);
  assert.equal(f.call('shipments.get', {id: 'S002'}).shipment.pickup.point_id, 'P01');
  assert.equal(f.call('points.list', {accessible_only: true}).items.length, 2);
  assert.equal(f.call('changes.list', {shipment_id: 'S002'}).items[0].status, 'applied');
  assert.equal(f.call('collectors.list').items[0].name, 'Alex Rivera');
  assert.deepEqual(f.call('addresses.list').items.map(a => [a.id, a.label, a.verified, a.delivery_restricted]),
    [['addr-maya-home', 'Home', true, false], ['addr-maya-work', 'Studio', true, false], ['addr-maya-pobox', 'Mail box', true, true], ['addr-maya-cottage', 'Cottage', false, false]]);
  assert.equal(f.call('pass.get', {id: 'S002'}).pass.code, 'K7QM-4R2X');
  assert.equal(f.call('notices.list').items.length, 1);
  assert.deepEqual(f.data, before);
});

test('unknown and foreign parcels are indistinguishable', () => {
  const f = actAs(fixture(), 'person-sam');
  assert.equal(f.call('shipments.list').items.length, 0);
  for (const id of ['S001', 'missing']) rejects(f, () => f.call('shipments.get', {id}), 'not_found');
  rejects(f, () => f.call('pass.get', {id: 'S002'}), 'not_found');
  rejects(f, () => f.call('options.get', {id: 'S001'}), 'not_found');
  rejects(f, () => f.call('change.preview', {id: 'S001', kind: 'reschedule', delivery_date: '2026-03-06'}), 'not_found');
  rejects(f, () => f.call('change.submit', {id: 'S001', kind: 'reschedule', delivery_date: '2026-03-06', confirmation: 'cf-guess'}), 'not_found');
  rejects(f, () => f.call('change.cancel', {id: 'C001'}), 'not_found');
  assert.equal(f.call('notices.list').items.length, 0);
  assert.equal(f.call('changes.list').items.length, 0);
  assert.equal(f.call('addresses.list').items.length, 0, 'Another person\'s addresses are never listed');
});

test('pickup deadline is evaluated at the committed clock without writing state', () => {
  const f = fixture();
  assert.equal(f.call('pass.get', {id: 'S002'}).pass.valid_now, true);
  f.advance('2026-03-04T15:00:00Z');
  const before = f.data;
  const view = f.call('shipments.get', {id: 'S002'}).shipment;
  assert.equal(view.status, 'at_pickup');
  assert.deepEqual(view.deadlines, [{kind: 'pickup', at: '2026-03-04T15:00:00Z', passed: true}]);
  assert.equal(f.call('pass.get', {id: 'S002'}).pass.valid_now, false, 'Validity uses now < expires_at');
  assert.equal(f.call('change.preview', {id: 'S002', kind: 'redirect', point_id: 'P03'}).preview.reason, 'deadline_passed');
  assert.deepEqual(f.data, before);
});

test('pickup opening hours use the point time zone', () => {
  const f = fixture({virtual_now: '2026-03-03T01:30:00Z'}); // 20:30 in Toronto
  assert.equal(f.call('points.list', {query: 'P01'}).items[0].open_now, true);
  f.advance('2026-03-03T02:30:00Z'); // 21:30 in Toronto, after closing
  assert.equal(f.call('points.list', {query: 'P01'}).items[0].open_now, false);
});

test('seed validation rejects inconsistent history', () => {
  const f = fixture(), good = f.data;
  const cases = [
    [d => { d.shipments[0].account_id = 'other'; }, /another account/],
    [d => { d.shipments[1].pickup.epoch = 2; }, /readiness/],
    [d => { d.shipments[1].status = 'in_transit'; }, /readiness/],
    [d => { d.passes[0].expires_at = '2026-03-05T15:00:00Z'; }, /outlasts/],
    [d => { d.shipments[0].plan.address_id = 'addr-missing'; }, /missing record/],
    [d => { d.shipments[0].pending_change_id = 'C001'; }, /pending change/],
    [d => { d.changes.push({...structuredClone(d.changes[0]), id: 'C001'}); }, /Duplicate/],
    [d => { d.notices[0].audience = ['person-unknown']; }, /binding/],
    [d => { d.carrier.time_zone = 'Mars/Olympus'; }, /time zone/],
    [d => { d.shipments[0].plan.delivery_date = '2026-02-30'; }, /calendar date/],
    [d => { d.shipments[0].status = 'out_for_delivery'; d.shipments[0].plan = {...d.shipments[1].plan}; }, /home delivery plan/]
  ];
  for (const [mutate, pattern] of cases) {
    const bad = structuredClone(good); mutate(bad);
    assert.throws(() => plugin.validateSeed(f.ctx, bad), pattern);
  }
});

test('transit update follows the current plan and rejects superseded or terminal parcels', () => {
  const f = fixture(), event = structuredClone(require('../examples/scenario.json'));
  f.event(event);
  const s = f.call('shipments.get', {id: 'S001'}).shipment;
  assert.equal(s.timeline.at(-1).at, event.at);
  rejects(f, () => f.event({...event, event_id: 'old-plan', payload: {...event.payload, plan_revision: 2}}), 'invalid_event');
  rejects(f, () => f.event({...event, event_id: 'pickup-not-moving', payload: {...event.payload, shipment_id: 'S002', plan_revision: 2}}), 'invalid_event');
  rejects(f, () => f.event({...event, event_id: 'bad', payload: {...event.payload, status: 'delivered'}}), /Event schema/);
  rejects(f, () => f.event({...event, event_id: 'unknown', payload: {...event.payload, shipment_id: 'S999'}}), 'invalid_event');
});

// Workflow suites; the public verifier runs this file, which registers them too.
require('./w1-home-delivery.test.cjs');
require('./w2-pickup.test.cjs');
require('./w3-delegation.test.cjs');
require('./w4-recovery.test.cjs');

test('optional diagnostics cannot change business results', () => {
  const scenario = require('../examples/scenario.json');
  const on = fixture(), off = fixture({logging: false});
  on.event(scenario); off.event(scenario);
  assert.deepEqual(on.data, off.data);
  assert.ok(on.logs.length);
  const broken = fixture(); broken.ctx.log = () => { throw Error('logger offline'); };
  broken.event(scenario);
  assert.deepEqual(broken.data, off.data);
});
