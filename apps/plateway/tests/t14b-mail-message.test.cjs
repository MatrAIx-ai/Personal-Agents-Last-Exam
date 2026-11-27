'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { compile } = require('./schema-validator.cjs');
const sender = require('../infra/sender.cjs');
const { placed, ev } = require('./flows.cjs');
const { fixture } = require('./harness.cjs');

const wireValid = compile(require('../schemas/router-message.schema.json'), path.join(__dirname, '..', 'schemas'));
const GRANTS = [{ app_id: 'mail', account_id: 'mail-p-1', channel: 'channel.email' }];
const snapshotOf = (f, extra = {}) => ({ epoch: 1, data: f.data(), initial_data: { notices: [] }, binding: require('../fixtures/binding.json'), ...extra });

test('T14 the proposal example notice builds the exact wire message', () => {
  const notice = { id: 'n-6', kind: 'notice.order_delivered', order_id: 'o-21', line_id: null, at: '2026-12-04T12:41:00-05:00', title: 'Order delivered', body: 'Order o-21 from Basil Row was delivered at 12:41. Total charged: $27.84.' };
  const message = sender.message({ epoch: 2, data: { account_id: 'plateway-p-1', owner_person_id: 'p-1' } }, notice);
  assert.deepEqual(message, {
    specversion: '1.0', id: 'e2-n-6', source: 'urn:pale:app:plateway:account:plateway-p-1', type: 'org.pale.mail.notification.v1',
    time: '2026-12-04T12:41:00-05:00', datacontenttype: 'application/json', dataschema: 'urn:pale:email-payload:1',
    data: {
      channel: 'channel.email', recipient: { kind: 'person_ref', id: 'p-1' },
      source_object: { app_id: 'plateway', account_id: 'plateway-p-1', object_type: 'order', object_id: 'o-21' },
      content: { title: 'Order delivered', body: { format: 'text/plain', text: 'Order o-21 from Basil Row was delivered at 12:41. Total charged: $27.84.' }, asset_ids: [] },
      extensions: [],
    },
  });
  assert.ok(wireValid(message));
});

test('T14 every notice kind builds a valid wire message with an epoch-prefixed ID under 100 characters', () => {
  const f = placed({ items: [['mi-1', ['op-1']], ['mi-1', ['op-2']], ['mi-2', []]] });
  f.event(ev('order.accepted', '2026-12-04T11:36:00-05:00', { order_id: 'o-1' }));
  f.event(ev('order.delayed', '2026-12-04T11:40:00-05:00', { order_id: 'o-1', estimated_delivery: '2026-12-04T12:30:00-05:00' }));
  f.event(ev('order.item_unavailable', '2026-12-04T11:41:00-05:00', { order_id: 'o-1', line_id: 'ol-3' }));
  f.event(ev('order.picked_up', '2026-12-04T11:50:00-05:00', { order_id: 'o-1' }));
  f.event(ev('order.delivered', '2026-12-04T12:10:00-05:00', { order_id: 'o-1' }));
  const g = placed();
  g.event(ev('order.rejected', '2026-12-04T11:35:00-05:00', { order_id: 'o-1', reason: 'Too busy' }));
  const notices = [...f.data().notices, ...g.data().notices];
  assert.deepEqual([...new Set(notices.map(n => n.kind))].sort(), ['notice.item_refunded', 'notice.order_accepted', 'notice.order_cancelled', 'notice.order_delayed', 'notice.order_delivered', 'notice.order_placed']);
  for (const notice of notices) {
    const m = sender.message({ epoch: 7, data: f.data() }, notice);
    assert.ok(wireValid(m), notice.kind);
    assert.equal(m.id, 'e7-' + notice.id);
    assert.ok(m.id.length <= 100);
    assert.deepEqual([m.time, m.data.content.title, m.data.content.body.text], [notice.at, notice.title, notice.body]);
  }
});

test('T14 only entries appended after the loaded seed are pending', () => {
  const seed = require('../fixtures/minimal.json');
  const f = fixture();
  f.call('plateway.cart.add_item', { item_id: 'mi-1', option_ids: ['op-2'], quantity: 1 });
  const args = { address_id: 'a-1', card_id: 'c-1', when: { mode: 'asap' }, tip_cents: 300 };
  f.call('plateway.orders.place', { ...args, token: f.call('plateway.checkout.preview', args).token });
  assert.deepEqual(sender.pending({ data: f.data(), initial_data: seed }).map(n => n.id), ['n-4']);
});

test('T14 without a bound Mail account the sender publishes nothing and the entries stay in the log', async () => {
  const f = placed();
  const calls = [];
  const router = { call: async (name, args) => { calls.push(name); return { status: 'ok', channels: [{ channel: 'channel.email' }] }; } };
  const plateway = { call: async () => ({ snapshot: snapshotOf(f) }) };
  const out = await sender.send({ plateway, router });
  assert.deepEqual([out.status, out.reason, out.pending, calls], ['skipped', 'no_mail_account', ['n-1'], []]);
  assert.equal((await sender.send({ plateway, router: null })).status, 'skipped');
});

test('T14 the sender publishes pending entries in order with request_id = message id and stops at the first non-committed receipt', async () => {
  const f = placed();
  f.event(ev('order.accepted', '2026-12-04T11:36:00-05:00', { order_id: 'o-1' }));
  f.event(ev('order.picked_up', '2026-12-04T11:50:00-05:00', { order_id: 'o-1' }));
  const binding = structuredClone(require('../fixtures/binding.json'));
  binding.accounts.push({ app_id: 'mail', account_id: 'mail-p-1', owner_person_id: 'p-1' });
  const published = [];
  const router = { call: async (name, args) => {
    if (name === 'router.capabilities') return { status: 'ok', channels: [{ channel: 'channel.email' }] };
    published.push(args);
    return published.length === 2 ? { status: 'halted', code: 'run_halted' } : { status: 'committed', event_id: 'ev-' + published.length };
  } };
  const out = await sender.send({ plateway: { call: async () => ({ snapshot: snapshotOf(f, { epoch: 3, binding }) }) }, router, grants: GRANTS });
  assert.deepEqual(published.map(p => [p.request_id, p.message.id]), [['e3-n-1', 'e3-n-1'], ['e3-n-2', 'e3-n-2']]);
  assert.deepEqual([out.status, out.stopped_at, out.receipts.length, out.event_id], ['halted', 'n-2', 2, null]);
});

test('T14 without an Infra grant for the bound Mail account and channel nothing is published', async () => {
  const f = placed();
  const binding = structuredClone(require('../fixtures/binding.json'));
  binding.accounts.push({ app_id: 'mail', account_id: 'mail-p-1', owner_person_id: 'p-1' });
  const calls = [];
  const router = { call: async name => { calls.push(name); return { status: 'ok', channels: [{ channel: 'channel.email' }] }; } };
  const plateway = { call: async () => ({ snapshot: snapshotOf(f, { binding }) }) };
  for (const grants of [undefined, [], [{ app_id: 'mail', account_id: 'mail-other', channel: 'channel.email' }], [{ app_id: 'mail', account_id: 'mail-p-1', channel: 'channel.email.attachments' }]]) {
    const out = await sender.send({ plateway, router, grants });
    assert.deepEqual([out.status, out.reason, out.pending], ['skipped', 'no_email_grant', ['n-1']]);
  }
  assert.deepEqual(calls, []);
});

test('T14 reconciliation after an unknown acknowledgement checks the receiver account and epoch first', async () => {
  const mail = (epoch, account, receipt, ids, run = 'run-1') => ({ call: async (name, args) => name === 'env.snapshot'
    ? { snapshot: { run_id: run, epoch, data: { account_id: account, messages: ids.map(id => ({ id })) } } }
    : { status: 'ok', receipt: args.event_id === 'router-1' ? receipt : null } });
  const setup = await sender.receiverSetup(mail(4, 'mail-p-1', null, []));
  assert.deepEqual(setup, { run_id: 'run-1', account_id: 'mail-p-1', epoch: 4 });
  assert.equal((await sender.reconcile({ mail: mail(4, 'mail-p-1', { status: 'committed' }, ['router-1'], 'run-2'), setup, outcome: { status: 'unknown', event_id: 'router-1' } })).status, 'indeterminate');
  const unknown = { status: 'unknown', event_id: 'router-1' };
  assert.deepEqual(await sender.reconcile({ mail: mail(4, 'mail-p-1', { status: 'committed' }, ['router-1']), setup, outcome: unknown }), { status: 'committed', event_id: 'router-1', record_id: 'router-1' });
  assert.deepEqual(await sender.reconcile({ mail: mail(4, 'mail-p-1', null, []), setup, outcome: unknown }), { status: 'indeterminate', reason: 'not_found', event_id: 'router-1' });
  assert.equal((await sender.reconcile({ mail: mail(5, 'mail-p-1', { status: 'committed' }, ['router-1']), setup, outcome: unknown })).status, 'indeterminate');
  assert.equal((await sender.reconcile({ mail: mail(4, 'mail-other', { status: 'committed' }, ['router-1']), setup, outcome: unknown })).status, 'indeterminate');
  assert.equal((await sender.reconcile({ mail: mail(4, 'mail-p-1', { status: 'committed' }, []), setup, outcome: unknown })).status, 'indeterminate');
  assert.equal((await sender.reconcile({ mail: mail(4, 'mail-p-1', null, []), setup, outcome: { status: 'unknown' } })).status, 'indeterminate');
});

test('T14 with several Mail accounts the sender uses the one Infra granted, and a stopped send can be reconciled', async () => {
  const f = placed();
  const binding = structuredClone(require('../fixtures/binding.json'));
  binding.accounts.push({ app_id: 'mail', account_id: 'mail-old', owner_person_id: 'p-1' }, { app_id: 'mail', account_id: 'mail-p-1', owner_person_id: 'p-1' });
  const calls = [];
  const router = { call: async (name, args) => {
    if (name === 'router.capabilities') return { status: 'ok', channels: [{ channel: 'channel.email' }] };
    calls.push(args.request_id);
    return { status: 'unknown', code: 'receiver_unconfirmed', stop_run: true, event_id: 'router-9' };
  } };
  const out = await sender.send({ plateway: { call: async () => ({ snapshot: snapshotOf(f, { binding }) }) }, router, grants: GRANTS });
  assert.deepEqual([calls, out.status, out.event_id], [['e1-n-1'], 'unknown', 'router-9']);
  const mail = { call: async (name, args) => name === 'env.snapshot'
    ? { snapshot: { run_id: 'r', epoch: 2, data: { account_id: 'mail-p-1', messages: [{ id: 'router-9' }] } } }
    : { status: 'ok', receipt: { status: 'committed' } } };
  const setup = await sender.receiverSetup(mail);
  assert.deepEqual(await sender.reconcile({ mail, setup, outcome: out }), { status: 'committed', event_id: 'router-9', record_id: 'router-9' });
});
