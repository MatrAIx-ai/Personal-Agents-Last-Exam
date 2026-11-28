'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { compile } = require('./schema-validator.cjs');
const sender = require('../infra/sender.cjs');
const { fixture } = require('./harness.cjs');
const { granted, received, paPending, base } = require('./seeds.cjs');
const { TITLES } = require('../src/notices.cjs');
const { toIso, dayDeadline } = require('../src/time.cjs');
const example = require('../infra/router.config.example.json');

const wireValid = compile(require('../schemas/router-message.schema.json'), path.join(__dirname, '..', 'schemas'));
const MAIL = [{ app_id: 'mail', account_id: 'mail-m-1', owner_person_id: 'm-1' }, { app_id: 'mail', account_id: 'mail-m-2', owner_person_id: 'm-2' }];
const SOURCE = 'urn:pale:app:larkfield-health:account:larkfield-m-1';
const GRANT = account => ({ app_id: 'mail', account_id: account, channel: 'channel.email' });
const bound = (accounts = MAIL) => { const b = structuredClone(require('../fixtures/binding.json')); b.accounts.push(...accounts); return b; };
let n = 0;
const ev = (f, at, operation, payload) => assert.equal(f.event({ event_id: 't11b-' + (++n), at, operation, payload }).status, 'committed');
const snap = (f, seed, extra = {}) => ({ run_id: 'unit', epoch: 1, virtual_now: f.ctx.virtual_now, data: f.data(), initial_data: structuredClone(seed), binding: f.ctx.binding, ...extra });
const DECIDE = ['2026-11-18T12:10:00-05:00', 'pa.decided', { pa_id: 'pa-2', decision: 'approved', units: 1, valid_from: '2026-12-01', valid_until: '2026-12-31' }];
const POKE = ['2026-11-21T09:00:00-05:00', 'pa.withdrawn', { pa_id: 'pa-2' }];

function dailySeed(viewExpires = null) {
  const s = granted(received(undefined, paPending()), 'm-2', 'view', viewExpires, 'm-1');
  s.seed_id = 'larkfield-mail-1';
  const eob = s.eobs.find(e => e.claim_id === 'cl-1');
  s.notices.push({ notice_id: 'n-1', kind: 'notice.eob_available', recipient_id: 'm-1', subject: { type: 'claim', id: 'cl-1' }, member_id: 'm-1', at: eob.issued_at, title: TITLES['notice.eob_available'], body: 'Explanation of benefits version 1 for claim cl-1 is available.', fields: { claim_id: 'cl-1', eob_version: 1, member_cost_cents: 2500, plan_paid_cents: 15500 } });
  s.issued.n = '1';
  return s;
}

function daily(viewExpires = null, accounts = MAIL, poke = true) {
  const seed = dailySeed(viewExpires);
  const f = fixture({ seed, binding: bound(accounts) });
  ev(f, ...DECIDE);
  if (poke) ev(f, ...POKE);
  return { f, seed };
}

const wire = require('../schemas/router-message.schema.json');
const CHANNEL_ENTRY = { channel: 'channel.email', schema_id: 'urn:pale:email-message:2', event_type: 'org.pale.mail.notification.v1', payload_schema_id: 'urn:pale:email-payload:1' };
let runs = 0;
const RUN = () => 'unit-' + (++runs);

function fakeApp(state, extra) {
  state.version = state.version || { epoch: state.epoch || 1, revision: 0 };
  state.advances = [];
  return {
    state,
    call: async (name, args) => {
      if (state.before) state.before(name, args);
      const version = { ...state.version };
      if (name === 'env.snapshot') return { status: 'ok', version, snapshot: { run_id: state.run_id, epoch: state.version.epoch, virtual_now: state.now, ...extra() } };
      if (name === 'env.advance_time') { state.advances.push(args); state.now = args.virtual_now; state.version.revision++; return { status: 'committed', advanced: true }; }
      if (name === 'env.event_status') return { status: 'ok', receipt: (state.receipts || {})[args.event_id] || null, version };
      throw new Error('unexpected call ' + name);
    },
  };
}

const appFake = (f, seed, run, over = {}) => fakeApp({ now: f.ctx.virtual_now, epoch: 3, run_id: run, ...(over.state || {}) }, () => ({ data: f.data(), ...(over.noSeed ? {} : { initial_data: structuredClone(seed) }), binding: over.binding ? over.binding() : f.ctx.binding }));
const mailFake = (account, run, now = '2026-11-15T09:00:00-08:00', state = {}) => {
  const app = fakeApp({ now, epoch: 1, run_id: run, ...state }, () => ({ data: { account_id: app.state.data_account || account.account_id, owner_person_id: app.state.data_owner || account.owner_person_id, messages: app.state.messages || [] }, binding: app.state.binding || { accounts: [account] } }));
  return app;
};

function routers(run, respond = () => ({ status: 'committed' }), options = {}) {
  const log = { published: [], inFlight: 0, max: 0, halted: false, capabilities: 0, stops: [] };
  const identity = options.identity || {}, down = options.down || {};
  const make = account => ({
    definitions: [{ name: 'router.capabilities' }, { name: 'router.publish', inputSchema: { type: 'object', properties: { message: { anyOf: [(options.schemas || {})[account] || wire] } } } }],
    call: async (name, args) => {
      if (name === 'router.capabilities') { log.capabilities++; if (down[account]) throw new Error('disconnected'); return { status: 'ok', run_id: identity[account] || run, publisher: (options.publisher || {})[account] || 'larkfield-health', halted: log.halted, channels: (options.channels || {})[account] || [CHANNEL_ENTRY] }; }
      log.inFlight++; log.max = Math.max(log.max, log.inFlight);
      await new Promise(resolve => setImmediate(resolve));
      log.inFlight--;
      log.published.push([account, args.request_id, args.message.id, args.message.data.recipient.id]);
      const i = log.published.length;
      const reply = respond(args, i, account);
      if (reply === undefined || reply instanceof Error) { if (reply) throw reply; return undefined; }
      const event_id = sender.eventId({ run_id: run, source: args.message.source, message_id: args.message.id, account_id: account, epoch: (options.epochs || {})[account] || 1 });
      const out = reply.status === 'committed' ? { event_id, run_id: run, target: { app_id: 'mail', account_id: account }, cloud_event: { id: args.message.id, source: args.message.source }, ...reply } : { event_id, ...reply };
      if (out.stop_run === true && reply.status !== 'committed') log.halted = true;
      if (options.after) await options.after(args, i, account);
      return out;
    },
  });
  return { log, make, stop: cause => { log.stops.push(cause.code); log.halted = true; } };
}

const configFor = accounts => ({ ...example, publishers: [{ ...example.publishers[0], allowed_recipients: accounts.map(a => GRANT(a.account_id)) }] });

async function sessionsFor(rs, mails, run, accounts = MAIL) {
  const out = [];
  for (const [i, account] of accounts.entries()) {
    const r = Array.isArray(rs) ? rs[i] : rs;
    out.push(await sender.openSession({ run, stateDir: 'state', account, config: configFor(accounts), openMail: async () => mails[i], openRouter: async () => r.make(account.account_id) }));
  }
  return out;
}

async function world({ f, seed, respond, options, mailNow, mailStates = [], accounts = MAIL, over, onHalt } = {}) {
  const run = RUN();
  const app = appFake(f, seed, run, over);
  const mails = accounts.map((a, i) => mailFake(a, run, mailNow, mailStates[i] || {}));
  const r = routers(run, respond, options);
  const sessions = await sessionsFor(r, mails, run, accounts);
  const adapter = sender.create({ app, sessions, onHalt: onHalt || r.stop });
  return { run, app, mails, r, sessions, adapter };
}

test('T11b the proposal example notice, written by the App for a guardian of a minor member, builds the exact wire message', () => {
  const s = paPending();
  s.seed_id = 'larkfield-example-1';
  Object.assign(s.pas.find(x => x.pa_id === 'pa-2'), { pa_id: 'pa-4', submitted_at: '2026-11-25T09:00:00-05:00', due_at: toIso(dayDeadline('2026-11-25T09:00:00-05:00', 15)) });
  s.issued.n = '16';
  const f = fixture({ seed: s, now: '2026-12-04T09:00:00-05:00' });
  ev(f, '2026-12-04T10:00:00-05:00', 'pa.decided', { pa_id: 'pa-4', decision: 'approved', units: 12, valid_from: '2026-12-01', valid_until: '2027-02-28' });
  assert.deepEqual(f.data().notices.map(x => [x.notice_id, x.recipient_id]), [['n-17', 'm-1'], ['n-18', 'm-2'], ['n-19', 'm-3']]);
  const message = sender.message({ epoch: 2, data: f.data() }, f.data().notices[0]);
  assert.deepEqual(message, {
    specversion: '1.0', id: 'e2-n-17', source: 'urn:pale:app:larkfield-health:account:larkfield-m-1', type: 'org.pale.mail.notification.v1',
    time: '2026-12-04T10:00:00-05:00', datacontenttype: 'application/json', dataschema: 'urn:pale:email-payload:1',
    data: {
      channel: 'channel.email', recipient: { kind: 'person_ref', id: 'm-1' },
      source_object: { app_id: 'larkfield-health', account_id: 'larkfield-m-1', object_type: 'pa', object_id: 'pa-4' },
      content: { title: 'Prior authorization decision', body: { format: 'text/plain', text: 'Prior authorization pa-4 for member m-3 was approved: 12 units, valid 2026-12-01 to 2027-02-28.' }, asset_ids: [] },
      extensions: [],
    },
  });
  assert.ok(wireValid(message));
});

test('T11b every notice kind builds a valid wire message whose source object follows the entry subject', () => {
  const data = { account_id: 'larkfield-m-1' };
  const subjects = { 'notice.eob_available': 'claim', 'notice.claim_denied': 'claim', 'notice.info_requested': 'info_request', 'notice.pa_decision': 'pa', 'notice.appeal_received': 'appeal', 'notice.appeal_info_requested': 'appeal', 'notice.appeal_decision': 'appeal', 'notice.appeal_window_closing': 'pa', 'notice.decision_overdue': 'appeal' };
  assert.deepEqual(Object.keys(subjects).sort(), Object.keys(TITLES).sort());
  for (const kind of Object.keys(TITLES)) {
    const subject = { type: subjects[kind], id: 'x-1' };
    const entry = { notice_id: 'n-999999999', kind, recipient_id: 'm-3', subject, member_id: 'm-3', at: '2026-11-30T09:00:00-05:00', title: TITLES[kind], body: 'x'.repeat(20000), fields: {} };
    const m = sender.message({ epoch: 123456, data }, entry);
    assert.ok(wireValid(m), kind);
    assert.equal(m.id, 'e123456-n-999999999');
    assert.ok(m.id.length <= 100);
    assert.deepEqual([m.time, m.data.recipient, m.data.source_object, m.data.content.title, m.data.content.body.text.length], [entry.at, { kind: 'person_ref', id: 'm-3' }, { app_id: 'larkfield-health', account_id: 'larkfield-m-1', object_type: subject.type, object_id: 'x-1' }, TITLES[kind], 20000]);
  }
});

test('T11b only entries appended after the loaded seed are pending', () => {
  const { f, seed } = daily();
  assert.deepEqual(f.data().notices.map(x => x.notice_id), ['n-1', 'n-2', 'n-3', 'n-4', 'n-5', 'n-6']);
  assert.deepEqual(sender.pending(snap(f, seed)).map(x => x.notice_id), ['n-2', 'n-3', 'n-4', 'n-5', 'n-6']);
  assert.deepEqual(sender.pending({ data: f.data(), initial_data: f.data() }), []);
});

test('T11b dispatch-time recheck follows the notice relation: member, guardians and grant holders in force, a minor included without read authority', () => {
  const { f } = daily();
  const entries = f.data().notices.slice(1);
  const ok = () => entries.map(x => sender.eligible(f.data(), x, f.ctx.virtual_now));
  assert.deepEqual(entries.map(x => [x.notice_id, x.kind, x.recipient_id, x.member_id]), [
    ['n-2', 'notice.pa_decision', 'm-1', 'm-3'], ['n-3', 'notice.pa_decision', 'm-2', 'm-3'], ['n-4', 'notice.pa_decision', 'm-3', 'm-3'],
    ['n-5', 'notice.info_requested', 'm-1', 'm-2'], ['n-6', 'notice.info_requested', 'm-2', 'm-2']]);
  assert.deepEqual(ok(), [true, true, true, true, true]);
  ev(f, '2026-11-21T09:00:00-05:00', 'grant.changed', { grant_id: 'gr-h1', status: 'revoked' });
  assert.deepEqual(ok(), [true, true, true, false, true]);
  assert.equal(sender.eligible(f.data(), { ...entries[4], recipient_id: 'm-3' }, f.ctx.virtual_now), false);
  assert.equal(sender.eligible(f.data(), { ...entries[0], member_id: 'm-9' }, f.ctx.virtual_now), false);
  ev(f, '2026-11-21T09:05:00-05:00', 'grant.changed', { grant_id: 'gr-7', member_id: 'm-2', grantor_id: 'm-2', grantee_id: 'm-1', scope: 'act', expires_at: null, status: 'active' });
  assert.deepEqual(ok(), [true, true, true, true, true]);
});

test('T11b dispatch-time recheck uses the grants in force at dispatch: an expiry after the notice drops the entry; member and guardians always pass', () => {
  const { f } = daily('2026-11-21T09:30:00-05:00');
  const viewer = f.data().notices.find(x => x.notice_id === 'n-5');
  assert.deepEqual([viewer.at, viewer.recipient_id], ['2026-11-20T23:59:00-05:00', 'm-1']);
  assert.equal(sender.eligible(f.data(), viewer, '2026-11-21T09:29:59-05:00'), true);
  assert.equal(sender.eligible(f.data(), viewer, '2026-11-21T09:30:00-05:00'), false);
  const data = f.data();
  const minor = f.data().notices.find(x => x.notice_id === 'n-4');
  assert.deepEqual(['m-1', 'm-2', 'm-3', 'm-9'].map(p => sender.eligible(data, { ...minor, recipient_id: p }, '2027-06-01T09:00:00-04:00')), [true, true, true, false]);
  assert.deepEqual(['m-1', 'm-2', 'm-3'].map(p => sender.eligible(data, { ...viewer, recipient_id: p }, '2026-11-21T09:30:00-05:00')), [false, true, false]);
  const other = structuredClone(data);
  other.grants.push({ grant_id: 'gr-8', grant_version: 0, member_id: 'm-2', grantor_id: 'm-2', grantee_id: 'm-3', scope: 'view', created_at: '2026-11-01T09:00:00-04:00', expires_at: null, status: 'active', revoked_at: null });
  const own = f.data().notices.find(x => x.notice_id === 'n-1');
  assert.deepEqual([sender.eligible(other, { ...own, recipient_id: 'm-3' }, '2026-11-21T09:00:00-05:00'), sender.eligible(other, { ...viewer, recipient_id: 'm-3' }, '2026-11-21T09:00:00-05:00')], [false, true]);
});

test('T11b an entry is routed through exactly one usable, granted session; ambiguity counts usable routes only', () => {
  const { f, seed } = daily();
  const sessions = MAIL.map(a => ({ account_id: a.account_id, grants: [GRANT(a.account_id)] }));
  const s = snap(f, seed);
  const routeOf = (snapshot, list, entry, usable) => { const r = sender.route(snapshot, list, entry, usable); return r.session ? r.session.account_id : r.reason; };
  assert.deepEqual(sender.pending(s).map(x => [x.notice_id, routeOf(s, sessions, x)]), [['n-2', 'mail-m-1'], ['n-3', 'mail-m-2'], ['n-4', 'no_mail_account'], ['n-5', 'mail-m-1'], ['n-6', 'mail-m-2']]);
  const n2 = sender.pending(s)[0];
  assert.equal(routeOf(s, [sessions[1]], n2), 'no_email_grant');
  assert.equal(routeOf(s, [{ ...sessions[0], grants: [] }, sessions[1]], n2), 'no_email_grant');
  assert.equal(routeOf(s, [{ ...sessions[0], grants: [{ ...GRANT('mail-m-1'), channel: 'channel.email.attachments' }] }], n2), 'no_email_grant');
  const two = snap(f, seed, { binding: bound([...MAIL, { app_id: 'mail', account_id: 'mail-m-1-old', owner_person_id: 'm-1' }]) });
  const both = [...sessions, { account_id: 'mail-m-1-old', grants: [GRANT('mail-m-1-old')] }];
  assert.equal(routeOf(two, sessions, n2), 'mail-m-1');
  assert.equal(routeOf(two, both, n2), 'ambiguous_route');
  assert.equal(routeOf(two, both, n2, x => (x.account_id === 'mail-m-1' ? 'receiver_not_in_run' : true)), 'mail-m-1-old');
  assert.equal(routeOf(two, both, n2, x => (x.account_id === 'mail-m-1-old' ? 'router_not_in_run' : true)), 'mail-m-1');
  assert.equal(routeOf(two, both, n2, () => 'receiver_unavailable'), 'receiver_unavailable');
  assert.equal(routeOf(two, both, n2, x => (x.account_id === 'mail-m-1' ? 'router_unavailable' : true)), 'ambiguous_route');
  assert.equal(routeOf({ ...s, binding: bound([]) }, sessions, n2), 'no_mail_account');
});

test('T11b the example Router config gives one session per recipient Mail account, each with its own grant and a stable, filesystem-safe namespace', () => {
  const configs = sender.sessionConfigs(example);
  assert.deepEqual(configs.map(c => [c.account_id, c.namespace, c.config.receiver_state_namespace, c.config.publishers.map(p => [p.app_id, p.allowed_recipients])]), MAIL.map(a => [a.account_id, sender.namespace(a.account_id), sender.namespace(a.account_id), [['larkfield-health', [GRANT(a.account_id)]]]]));
  for (const c of configs) assert.deepEqual({ ...c.config, receiver_state_namespace: undefined, publishers: undefined }, { ...example, receiver_state_namespace: undefined, publishers: undefined });
  assert.notDeepEqual(configs[0].config.publishers[0], configs[1].config.publishers[0]);
  assert.deepEqual(example.publishers[0].allowed_recipients.map(g => g.account_id), MAIL.map(a => a.account_id));
  assert.ok([example.registry, ...Object.values(example.publishers[0]).filter(v => typeof v === 'string')].every(v => !v.startsWith('/')));
  assert.throws(() => sender.sessionConfigs({ ...example, publishers: [...example.publishers, example.publishers[0]] }), /exactly one Larkfield publisher/);
  const odd = ['mail:p-1', 'mail.p-1', 'Mail-P-1', 'm'.repeat(150), 'mail-m-1'];
  const spaces = odd.map(sender.namespace);
  assert.ok(spaces.every(x => /^[-a-zA-Z0-9_]{1,80}$/.test(x)));
  assert.equal(new Set(spaces).size, odd.length);
  assert.deepEqual(odd.map(sender.namespace), spaces);
  const colon = sender.sessionConfigs({ ...example, publishers: [{ ...example.publishers[0], allowed_recipients: [GRANT('mail:p-1')] }] });
  assert.deepEqual(colon.map(c => [c.account_id, c.config.receiver_state_namespace]), [['mail:p-1', sender.namespace('mail:p-1')]]);
});


test('T11b the sender validates endpoints, aligns clocks, then dispatches sequentially through each recipient\'s own session with request_id equal to the message id', async () => {
  const { f, seed } = daily();
  const w = await world({ f, seed });
  const out = await w.adapter.send();
  assert.equal(out.status, 'published');
  assert.deepEqual(w.r.log.published, [['mail-m-1', 'e3-n-2', 'e3-n-2', 'm-1'], ['mail-m-2', 'e3-n-3', 'e3-n-3', 'm-2'], ['mail-m-1', 'e3-n-5', 'e3-n-5', 'm-1'], ['mail-m-2', 'e3-n-6', 'e3-n-6', 'm-2']]);
  assert.equal(w.r.log.max, 1);
  assert.deepEqual(out.held, [{ notice_id: 'n-4', recipient_id: 'm-3', reason: 'no_mail_account' }]);
  assert.deepEqual(w.mails.map(m => m.state.advances.map(a => [a.virtual_now, a.expected_version, a.request_id])), MAIL.map(() => [[f.ctx.virtual_now, { epoch: 1, revision: 0 }, 'align-e1-r0-' + Date.parse(f.ctx.virtual_now)]]));
  assert.deepEqual([w.app.state.advances, out.clock.advanced], [[], [1, 2]]);
  const retry = await w.adapter.send();
  assert.deepEqual([retry.status, w.mails.map(m => m.state.advances.length)], ['published', [1, 1]]);
  assert.deepEqual(w.r.log.published.slice(4).map(p => p[1]), ['e3-n-2', 'e3-n-3', 'e3-n-5', 'e3-n-6']);
  const [a, b] = await Promise.all([w.adapter.send(), sender.create({ app: w.app, sessions: w.sessions, onHalt: w.r.stop }).send()]);
  assert.deepEqual([a.status, b.status, w.r.log.max, w.r.log.published.slice(8).map(p => p[1])], ['published', 'published', 1, ['e3-n-2', 'e3-n-3', 'e3-n-5', 'e3-n-6', 'e3-n-2', 'e3-n-3', 'e3-n-5', 'e3-n-6']]);
});

test('T11b a Larkfield clock behind the Mail clocks is advanced before delivery and the recheck runs at the aligned time', async () => {
  const { f, seed } = daily('2026-11-21T09:10:00-05:00');
  const w = await world({ f, seed, mailNow: '2026-11-21T09:30:00-05:00' });
  const out = await w.adapter.send();
  assert.deepEqual([out.clock.advanced, w.app.state.now, w.mails.map(m => m.state.advances.length)], [[0], '2026-11-21T09:30:00-05:00', [0, 0]]);
  assert.deepEqual(out.held.map(h => [h.notice_id, h.reason]), [['n-4', 'no_mail_account'], ['n-5', 'access_changed']]);
  assert.deepEqual(w.r.log.published.map(p => p.slice(0, 2)), [['mail-m-1', 'e3-n-2'], ['mail-m-2', 'e3-n-3'], ['mail-m-2', 'e3-n-6']]);
  const ok = daily();
  const v = await world({ ...ok });
  v.mails[0].state.now = '2026-11-21T08:00:00-05:00';
  v.mails[1].state.now = '2026-11-21T10:00:00-05:00';
  v.mails[0].call = (call => async (name, args) => (name === 'env.advance_time' ? { status: 'stale_version' } : call(name, args)))(v.mails[0].call);
  const partial = await v.adapter.send();
  assert.deepEqual([partial.status, partial.clock.failed, partial.clock.reply.status, partial.held.filter(h => h.recipient_id === 'm-1').map(h => h.reason), v.r.log.published.map(p => p[0]), v.app.state.now], ['published', [1], 'stale_version', ['clock_unaligned', 'clock_unaligned'], ['mail-m-2', 'mail-m-2'], '2026-11-21T10:00:00-05:00']);
  const src = await world({ ...ok, mailNow: '2026-11-21T10:00:00-05:00' });
  src.app.call = (call => async (name, args) => (name === 'env.advance_time' ? { status: 'stale_version' } : call(name, args)))(src.app.call);
  const stuck = await src.adapter.send();
  assert.deepEqual([stuck.status, stuck.clock.failed, src.r.log.published.length], ['unaligned', [0], 0]);
});

test('T11b every participating clock is re-read and realigned before each delivery, so a Mail clock moved past a grant expiry between publishes stops the viewer\'s entry', async () => {
  const { f, seed } = daily('2026-11-21T09:25:00-05:00');
  let w;
  w = await world({ f, seed, options: { after: (args, i) => { if (i === 1) w.adapter.exclusive(async () => { w.mails[0].state.now = '2026-11-21T09:30:00-05:00'; }); } } });
  const out = await w.adapter.send();
  assert.deepEqual([out.status, w.r.log.published.map(p => p[1]), out.held.map(h => [h.notice_id, h.reason]), w.app.state.now, w.mails[1].state.now], ['published', ['e3-n-2', 'e3-n-3', 'e3-n-6'], [['n-4', 'no_mail_account'], ['n-5', 'access_changed']], '2026-11-21T09:30:00-05:00', '2026-11-21T09:30:00-05:00']);
});

test('T11b each publish is preceded by a fresh check: a revocation, a reset or a binding change between two publishes is seen', async () => {
  const revoked = daily();
  let w1;
  w1 = await world({ ...revoked, options: { after: (args, i) => { if (i === 1) w1.adapter.exclusive(async () => { await new Promise(resolve => setTimeout(resolve, 5)); ev(revoked.f, '2026-11-21T09:00:00-05:00', 'grant.changed', { grant_id: 'gr-h1', status: 'revoked' }); }); } } });
  const out = await w1.adapter.send();
  assert.deepEqual([out.status, w1.r.log.published.map(p => p[1]), out.held.map(h => [h.notice_id, h.reason])], ['published', ['e3-n-2', 'e3-n-3', 'e3-n-6'], [['n-4', 'no_mail_account'], ['n-5', 'access_changed']]]);
  const reset = daily();
  let w2;
  w2 = await world({ ...reset, options: { after: (args, i) => { if (i === 1) w2.app.state.version.epoch = 4; } } });
  const stopped = await w2.adapter.send();
  assert.deepEqual([stopped.status, stopped.epoch, w2.r.log.published.map(p => p[1]), stopped.halted], ['source_changed', 4, ['e3-n-2'], undefined]);
  const rebind = daily();
  let binding = rebind.f.ctx.binding, w3;
  w3 = await world({ ...rebind, over: { binding: () => binding }, options: { after: (args, i) => { if (i === 1) binding = bound([MAIL[0]]); } } });
  const moved = await w3.adapter.send();
  assert.deepEqual([moved.status, w3.r.log.published.map(p => p[1])], ['source_changed', ['e3-n-2']]);
});

test('T11b a recognised pre-dispatch refusal skips that entry and the pass continues; an incompatible contract marks its session unusable', async () => {
  const { f, seed } = daily();
  const w = await world({ f, seed, respond: (args, i, account) => (account === 'mail-m-1' ? { status: 'rejected', code: 'incompatible_contract' } : { status: 'committed' }) });
  const out = await w.adapter.send();
  assert.deepEqual([out.status, out.refused, out.held.map(h => [h.notice_id, h.reason]), out.receipts.filter(x => x.receipt.status === 'committed').map(x => x.notice_id), w.adapter.status().status], ['partial', [{ notice_id: 'n-2', account_id: 'mail-m-1', code: 'incompatible_contract' }], [['n-4', 'no_mail_account'], ['n-5', 'incompatible_contract']], ['n-3', 'n-6'], 'ready']);
  const again = await w.adapter.send();
  assert.deepEqual([again.status, again.held.filter(h => h.recipient_id === 'm-1').map(h => h.reason), w.r.log.published.filter(p => p[0] === 'mail-m-1').length], ['published', ['incompatible_contract', 'incompatible_contract'], 1]);
  const d = await world({ f, seed, respond: (args, i, account) => (account === 'mail-m-1' ? { status: 'permission_denied', code: 'operation_unavailable' } : { status: 'rejected', code: 'recipient_not_authorized' }) });
  const denied = await d.adapter.send();
  assert.deepEqual([denied.status, denied.refused.map(x => x.code), d.r.log.published.length], ['partial', ['operation_unavailable', 'recipient_not_authorized', 'operation_unavailable', 'recipient_not_authorized'], 4]);
});

test('T11b a repeated pre-dispatch refusal on one session never starves the other across passes', async () => {
  const { f, seed } = daily();
  const w = await world({ f, seed, respond: (args, i, account) => (account === 'mail-m-1' ? { status: 'rejected', code: 'recipient_unavailable' } : { status: 'committed' }) });
  const one = await w.adapter.send(), two = await w.adapter.send();
  assert.deepEqual([one.status, two.status, w.r.log.published.map(p => [p[0], p[1]])], ['partial', 'partial', [
    ['mail-m-1', 'e3-n-2'], ['mail-m-2', 'e3-n-3'], ['mail-m-1', 'e3-n-5'], ['mail-m-2', 'e3-n-6'],
    ['mail-m-1', 'e3-n-2'], ['mail-m-2', 'e3-n-3'], ['mail-m-1', 'e3-n-5'], ['mail-m-2', 'e3-n-6']]]);
  assert.deepEqual(two.refused.map(x => [x.notice_id, x.code]), [['n-2', 'recipient_unavailable'], ['n-5', 'recipient_unavailable']]);
});

test('T11b stop_run is honoured before anything else; committed receipts are validated; anything but a recognised refusal halts the adapter', async () => {
  const { f, seed } = daily();
  for (const [reply, code, hooked] of [
    [{ status: 'rejected', code: 'receiver_lifecycle_changed', stop_run: true }, 'receiver_lifecycle_changed', false],
    [{ status: 'rejected', code: 'receiver_rejected', stop_run: true }, 'receiver_rejected', false],
    [{ status: 'unknown', code: 'receiver_unconfirmed', stop_run: true }, 'receiver_unconfirmed', true],
    [{ status: 'halted', code: 'run_halted', stop_run: true }, 'run_halted', false],
    [{ status: 'committed', stop_run: true }, 'stop_run', true],
    [{ status: 'rejected', code: 'receiver_rejected' }, 'publish_unconfirmed', true],
    [{ status: 'rejected', code: 'something_else' }, 'publish_unconfirmed', true],
    [{ status: 'rejected' }, 'publish_unconfirmed', true],
    [new Error('reply lost'), 'publish_unconfirmed', true],
    [undefined, 'publish_unconfirmed', true],
    [{ status: 'accepted' }, 'publish_unconfirmed', true],
    [{ status: 'committed', event_id: 'router-other' }, 'receipt_mismatch', true],
    [{ status: 'committed', target: { app_id: 'mail', account_id: 'mail-m-2' } }, 'receipt_mismatch', true],
    [{ status: 'committed', run_id: 'other' }, 'receipt_mismatch', true],
    [{ status: 'committed', cloud_event: { id: 'e3-n-9', source: 'urn:pale:app:larkfield-health:account:larkfield-m-1' } }, 'receipt_mismatch', true],
    [{ status: 'committed', cloud_event: { id: 'e3-n-2', source: 'urn:pale:app:other:account:x' } }, 'receipt_mismatch', true],
    [{ status: 'committed', duplicate: 'yes' }, 'receipt_mismatch', true],
  ]) {
    const w = await world({ f, seed, respond: () => reply });
    const first = await w.adapter.send();
    assert.deepEqual([first.halted, first.code, w.adapter.status().cause.code, (await w.adapter.send()).code, w.r.log.published.length, w.r.log.stops, first.stop_verified], [true, code, code, 'run_halted', 1, hooked ? [code] : [], true], code + ' ' + JSON.stringify(reply));
  }
  const ok = await world({ f, seed, respond: () => ({ status: 'committed' }) });
  assert.equal((await ok.adapter.send()).status, 'published');
});

test('T11b the adapter needs a shared stop mechanism and reports a halt as verified only when every session refuses', async () => {
  const { f, seed } = daily();
  const run = RUN(), mails = MAIL.map(a => mailFake(a, run)), r = routers(run, () => undefined);
  const sessions = await sessionsFor(r, mails, run);
  const app = appFake(f, seed, run);
  assert.throws(() => sender.create({ app, sessions }), /shared stop mechanism/);
  const silent = sender.create({ app, sessions, onHalt: () => {} });
  const lost = await silent.send();
  assert.deepEqual([lost.code, lost.stop_verified, silent.status().status, silent.status().cause.unhalted], ['publish_unconfirmed', false, 'halted', ['mail-m-1', 'mail-m-2']]);
  const fresh = sender.create({ app, sessions, onHalt: r.stop });
  const seen = r.log.published.length;
  assert.deepEqual([(await fresh.send()).code, fresh.status().status, r.log.published.length], ['run_halted', 'halted', seen]);
  const run2 = RUN(), m2 = MAIL.map(a => mailFake(a, run2)), r2 = routers(run2, () => undefined);
  const s2 = await sessionsFor(r2, m2, run2);
  const broken = sender.create({ app: appFake(f, seed, run2), sessions: s2, onHalt: () => { throw new Error('stop file not writable'); } });
  const out = await broken.send();
  assert.deepEqual([out.stop_verified, broken.status().cause.on_halt_error, broken.status().status], [false, 'stop file not writable', 'halted']);
  const w = await world({ f, seed, respond: () => undefined });
  const verified = await w.adapter.send();
  assert.deepEqual([verified.stop_verified, w.r.log.stops, w.adapter.status().cause.unhalted], [true, ['publish_unconfirmed'], []]);
});

test('T11b sessions are built together from one grant, account and namespace, and every endpoint is checked against the source run before alignment or publish', async () => {
  const { f, seed } = daily();
  const run = RUN();
  await assert.rejects(sender.openSession({ run, stateDir: 's', account: MAIL[0], config: configFor([MAIL[1]]), openMail: async () => mailFake(MAIL[0], run), openRouter: async () => assert.fail('no Router before the grant') }), /exactly one grant/);
  await assert.rejects(sender.openSession({ run, stateDir: 's', account: MAIL[0], config: configFor(MAIL), openMail: async () => mailFake({ ...MAIL[0], account_id: 'mail-maya' }, run), openRouter: async () => assert.fail('no Router before the Mail check') }), /loaded and bound/);
  await assert.rejects(sender.openSession({ run, stateDir: 's', account: MAIL[0], config: configFor(MAIL), openMail: async () => mailFake(MAIL[0], 'other-run'), openRouter: async () => assert.fail('no Router for another run') }), /loaded and bound/);
  await assert.rejects(sender.openSession({ run, stateDir: 's', account: MAIL[0], config: configFor(MAIL), openMail: async () => mailFake(MAIL[0], run), openRouter: async () => routers('other-run').make('mail-m-1') }), /does not serve this publisher/);
  const opened = [];
  const s = await sender.openSession({ run, stateDir: 's', account: MAIL[0], config: configFor(MAIL), openMail: async args => { opened.push(['mail', args.namespace]); return mailFake(MAIL[0], run); }, openRouter: async args => { opened.push(['router', args.namespace, args.config.receiver_state_namespace, args.config.publishers[0].allowed_recipients]); return routers(run).make('mail-m-1'); } });
  const space = sender.namespace('mail-m-1');
  assert.deepEqual([opened, s.namespace, s.receiver_state_namespace, s.contract === sender.CONTRACT, Object.isFrozen(s)], [[['mail', space], ['router', space, space, [GRANT('mail-m-1')]]], space, space, true, true]);
  const other = await world({ f, seed });
  const app = appFake(f, seed, RUN());
  const crossed = sender.create({ app, sessions: other.sessions, onHalt: other.r.stop });
  const c1 = await crossed.send();
  assert.deepEqual([c1.held.map(h => h.reason), other.r.log.published.length], [['session_not_in_run', 'session_not_in_run', 'no_mail_account', 'session_not_in_run', 'session_not_in_run'], 0]);
  const w = await world({ f, seed });
  const hand = sender.create({ app: w.app, sessions: [{ ...w.sessions[0] }, w.sessions[1]], onHalt: w.r.stop });
  const c2 = await hand.send();
  assert.deepEqual([c2.held.filter(h => h.recipient_id === 'm-1').map(h => h.reason), w.r.log.published.map(p => p[0])], [['session_unverified', 'session_unverified'], ['mail-m-2', 'mail-m-2']]);
});

test('T11b a foreign or halted-elsewhere Router is checked for identity before its halt is mirrored, and a failing discovery is isolated to its session', async () => {
  const { f, seed } = daily();
  const run = RUN();
  const identity = {};
  const r1 = routers(run, undefined, { identity }), r2 = routers(run);
  const sessions = await sessionsFor([r1, r2], MAIL.map(a => mailFake(a, run)), run);
  identity['mail-m-1'] = 'other-run';
  r1.log.halted = true;
  const adapter = sender.create({ app: appFake(f, seed, run), sessions, onHalt: r2.stop });
  const out = await adapter.send();
  assert.deepEqual([out.status, out.held.filter(h => h.recipient_id === 'm-1').map(h => h.reason), adapter.status().status, r2.log.published.map(p => p[0]), r2.log.stops], ['published', ['router_not_in_run', 'router_not_in_run'], 'ready', ['mail-m-2', 'mail-m-2'], []]);
  const down = {};
  const d = await world({ f, seed, options: { down } });
  down['mail-m-1'] = true;
  const isolated = await d.adapter.send();
  assert.deepEqual([isolated.status, isolated.held.filter(h => h.recipient_id === 'm-1').map(h => h.reason), d.r.log.published.map(p => p[0]), d.adapter.status().status], ['published', ['router_unavailable', 'router_unavailable'], ['mail-m-2', 'mail-m-2'], 'ready']);
  const e = await world({ f, seed });
  e.mails[0].call = async () => { throw new Error('Mail process gone'); };
  const gone = await e.adapter.send();
  assert.deepEqual([gone.status, gone.held.filter(h => h.recipient_id === 'm-1').map(h => h.reason), e.r.log.published.map(p => p[0])], ['published', ['receiver_unavailable', 'receiver_unavailable'], ['mail-m-2', 'mail-m-2']]);
  const g = await world({ f, seed });
  let snaps = 0;
  const inner = g.mails[0].call;
  g.mails[0].call = async (name, args) => { if (name === 'env.snapshot' && ++snaps === 2) throw new Error('Mail stalled during alignment'); return inner(name, args); };
  const stalled = await g.adapter.send();
  assert.deepEqual([stalled.status, stalled.clock.failed, stalled.held.filter(h => h.recipient_id === 'm-1').map(h => h.reason), g.r.log.published.map(p => p[0])], ['published', [1], ['clock_unaligned', 'clock_unaligned'], ['mail-m-2', 'mail-m-2']]);
});

test('T11b a Mail run or epoch change after the session opened is caught before any clock change or publish', async () => {
  const { f, seed } = daily();
  const a = await world({ f, seed });
  a.mails[0].state.run_id = 'other-run';
  const moved = await a.adapter.send();
  assert.deepEqual([moved.held.filter(h => h.recipient_id === 'm-1').map(h => h.reason), a.mails[0].state.advances, a.app.state.advances, a.r.log.published.map(p => p[0])], [['receiver_not_in_run', 'receiver_not_in_run'], [], [], ['mail-m-2', 'mail-m-2']]);
  const b = await world({ f, seed });
  b.mails[0].state.version.epoch = 2;
  const out = await b.adapter.send();
  assert.deepEqual([out.status, b.adapter.status().cause.code, b.adapter.status().cause.observed, b.adapter.status().cause.expected_epoch, b.r.log.stops, b.r.log.published.length, b.mails.map(m => m.state.advances.length)], ['halted', 'receiver_lifecycle_changed', 'adapter', 1, ['receiver_lifecycle_changed'], 0, [0, 0]]);
  const c = await world({ f, seed });
  await c.adapter.send();
  c.mails[1].state.version.epoch = 5;
  assert.deepEqual([(await c.adapter.send()).status, c.adapter.status().cause.account_id, c.r.log.published.length], ['halted', 'mail-m-2', 4]);
});

test('T11b contract compatibility is checked before counting routes: the sole compatible route of a person with two granted accounts is used', async () => {
  const accounts = [MAIL[0], { app_id: 'mail', account_id: 'mail-m-1-b', owner_person_id: 'm-1' }, MAIL[1]];
  const { f, seed } = daily(null, accounts, false);
  const changed = { ...wire, description: 'A changed copy whose content no longer matches the receiver.' };
  const w = await world({ f, seed, accounts, options: { schemas: { 'mail-m-1': changed } } });
  assert.deepEqual(w.sessions.map(s => s.contract === sender.CONTRACT), [false, true, true]);
  const out = await w.adapter.send();
  assert.deepEqual([out.status, w.r.log.published.map(p => [p[0], p[1]])], ['published', [['mail-m-1-b', 'e3-n-2'], ['mail-m-2', 'e3-n-3']]]);
  const both = await world({ f, seed, accounts });
  const amb = await both.adapter.send();
  assert.deepEqual([amb.held.map(h => [h.notice_id, h.reason]), both.r.log.published.map(p => p[0])], [[['n-2', 'ambiguous_route'], ['n-4', 'no_mail_account']], ['mail-m-2']]);
  const missing = await world({ f, seed, options: { schemas: { 'mail-m-1': { $id: 'urn:pale:other:1' } } } });
  assert.equal(missing.sessions[0].contract, null);
});

test('T11b a halted Router session reported by router.capabilities is mirrored before any clock change or publish', async () => {
  const { f, seed } = daily();
  const w = await world({ f, seed });
  w.r.log.halted = true;
  const out = await w.adapter.send();
  assert.deepEqual([out.status, out.code, w.adapter.status().status, w.adapter.status().cause.account_id, w.r.log.published.length, w.mails.map(m => m.state.advances.length), w.r.log.stops, w.adapter.status().cause.stop_verified], ['halted', 'run_halted', 'halted', 'mail-m-1', 0, [0, 0], [], true]);
  assert.equal((await w.adapter.align()).status, 'halted');
});

test('T11b without a bound Mail account nothing is published; a receiver whose owner changes or a session without the channel is never routed', async () => {
  const { f, seed } = daily();
  const none = await world({ f, seed, over: { binding: () => bound([]) } });
  const calls = none.r.log.capabilities;
  const out = await none.adapter.send();
  assert.deepEqual([out.status, out.reason, out.pending, none.r.log.published.length, none.r.log.capabilities - calls], ['skipped', 'no_mail_account', ['n-2', 'n-3', 'n-4', 'n-5', 'n-6'], 0, 0]);
  for (const [change, reason] of [[m => { m.state.data_owner = 'm-9'; }, 'receiver_not_loaded'], [m => { m.state.binding = { accounts: [{ ...MAIL[0], owner_person_id: 'm-9' }] }; }, 'receiver_not_loaded'], [m => { m.state.binding = { accounts: [MAIL[0], MAIL[0]] }; }, 'receiver_not_loaded'], [m => { m.state.data_account = 'mail-maya'; }, 'receiver_not_loaded']]) {
    const w = await world({ f, seed });
    change(w.mails[0]);
    const r = await w.adapter.send();
    assert.deepEqual([r.status, r.held.filter(h => h.recipient_id === 'm-1').map(h => h.reason), w.r.log.published.map(p => p[0])], ['published', [reason, reason], ['mail-m-2', 'mail-m-2']], reason);
  }
});

test('T11b the owner in the Larkfield binding must match the session; the receiver check pins data owner, binding owner and account', async () => {
  const run = RUN();
  for (const [data, accounts] of [[{ account_id: 'mail-m-1', owner_person_id: 'm-9' }, [{ ...MAIL[0], owner_person_id: 'm-9' }]], [{ account_id: 'mail-m-1', owner_person_id: 'm-1' }, [{ ...MAIL[0], owner_person_id: 'm-9' }]], [{ account_id: 'mail-m-1', owner_person_id: 'm-9' }, [MAIL[0]]], [{ account_id: 'mail-m-1', owner_person_id: 'm-1' }, [MAIL[0], MAIL[0]]]]) {
    const m = fakeApp({ now: '2026-11-15T09:00:00-08:00', run_id: run }, () => ({ data: { ...data, messages: [] }, binding: { accounts } }));
    assert.equal((await sender.receiver(m, MAIL[0])).reason, 'receiver_not_loaded');
  }
  assert.equal((await sender.receiver(mailFake(MAIL[0], run), MAIL[0])).status, 'ok');
  const { f, seed } = daily();
  const w = await world({ f, seed, over: { binding: () => bound([{ ...MAIL[0], owner_person_id: 'm-2' }, MAIL[1]]) } });
  const out = await w.adapter.send();
  assert.deepEqual([out.held.map(h => [h.notice_id, h.reason]), w.r.log.published.map(p => [p[0], p[1]])], [[['n-2', 'no_mail_account'], ['n-4', 'no_mail_account'], ['n-5', 'no_mail_account']], [['mail-m-2', 'e3-n-3'], ['mail-m-2', 'e3-n-6']]]);
});

test('T11b reconciliation is committed only when the receipt, its trace and the record agree with the derived event ID in the dispatch run, account and epoch', async () => {
  const run = RUN();
  const setup = { status: 'ok', run_id: run, account_id: 'mail-m-1', owner_person_id: 'm-1', epoch: 4 };
  const src = 'urn:pale:app:larkfield-health:account:larkfield-m-1';
  const id = sender.eventId({ run_id: run, source: src, message_id: 'e3-n-2', account_id: 'mail-m-1', epoch: 4 });
  const outcome = { status: 'unknown', account_id: 'mail-m-1', source: src, message_id: 'e3-n-2', event_id: id, receiver: setup };
  const record = { id, thread_id: 'e3-n-2', account_id: 'mail-m-1' };
  const good = { status: 'committed', event_id: id, version: { epoch: 4, revision: 3 }, trace: { run_id: run, event_id: id, cloud_event: { id: 'e3-n-2', source: src } } };
  const mail = (state = {}) => mailFake(MAIL[0], run, '2026-11-30T09:00:00-05:00', { epoch: 4, receipts: { [id]: good }, messages: [record], ...state });
  const committed = { status: 'committed', event_id: id, record_id: id, account_id: 'mail-m-1', epoch: 4 };
  assert.deepEqual(await sender.reconcile({ mail: mail(), setup, outcome }), committed);
  assert.deepEqual(await sender.reconcile({ mail: mail(), setup, outcome: { ...outcome, event_id: null } }), committed);
  const reason = async (state, o = outcome, s = setup) => (await sender.reconcile({ mail: mail(state), setup: s, outcome: o })).reason;
  assert.equal(await reason({}, { ...outcome, event_id: 'router-' + '0'.repeat(32) }), 'event_id_mismatch');
  assert.equal(await reason({}, { ...outcome, source: 'urn:pale:app:larkfield-health:account:larkfield-m-9', event_id: null }), 'not_found');
  const other = 'urn:pale:app:larkfield-health:account:larkfield-m-9';
  const twin = sender.eventId({ run_id: run, source: other, message_id: 'e3-n-2', account_id: 'mail-m-1', epoch: 4 });
  assert.equal(await reason({ receipts: { [twin]: { ...good, event_id: twin, trace: { ...good.trace, cloud_event: { id: 'e3-n-2', source: other } } } }, messages: [{ ...record, id: twin }] }), 'not_found');
  assert.equal(await reason({ receipts: { [id]: { ...good, trace: { ...good.trace, cloud_event: { id: 'e3-n-2', source: other } } } } }), 'receipt_and_record_disagree');
  assert.equal(await reason({ epoch: 5 }), 'receiver_changed');
  assert.equal(await reason({ run_id: 'other' }), 'receiver_changed');
  assert.equal(await reason({}, outcome, { ...setup, account_id: 'mail-m-2' }), 'event_id_mismatch');
  const racing = mail();
  racing.state.before = name => { if (name === 'env.event_status') racing.state.version.epoch = 5; };
  assert.equal((await sender.reconcile({ mail: racing, setup, outcome })).reason, 'receiver_changed');
  const answered = mail();
  answered.call = (call => async (name, args) => { const out = await call(name, args); return name === 'env.event_status' ? { ...out, version: { epoch: 5, revision: 0 } } : out; })(answered.call);
  assert.equal((await sender.reconcile({ mail: answered, setup, outcome })).reason, 'receiver_changed');
  const flip = mail();
  let reads = 0;
  flip.state.before = name => { if (name === 'env.snapshot' && ++reads === 2) flip.state.version.epoch = 5; };
  assert.equal((await sender.reconcile({ mail: flip, setup, outcome })).reason, 'receiver_changed');
  assert.equal(await reason({ receipts: {}, messages: [] }), 'not_found');
  assert.equal(await reason({ messages: [] }), 'receipt_and_record_disagree');
  assert.equal(await reason({ receipts: {} }), 'receipt_and_record_disagree');
  assert.equal(await reason({ receipts: { [id]: { ...good, status: 'rejected' } } }), 'receipt_and_record_disagree');
  assert.equal(await reason({ receipts: { [id]: { ...good, version: { epoch: 3, revision: 3 } } } }), 'receipt_and_record_disagree');
  assert.equal(await reason({ receipts: { [id]: { ...good, trace: { ...good.trace, cloud_event: { id: 'e3-n-9', source: src } } } } }), 'receipt_and_record_disagree');
  assert.equal(await reason({ receipts: { [id]: { ...good, trace: { ...good.trace, run_id: 'other' } } } }), 'receipt_and_record_disagree');
  assert.equal(await reason({ messages: [{ ...record, thread_id: 'e3-n-9' }] }), 'receipt_and_record_disagree');
  assert.equal(await reason({}, { ...outcome, message_id: undefined }), 'no_message');
  assert.equal(await reason({}, { ...outcome, source: undefined }), 'no_message');
  assert.equal(await reason({}, outcome, null), 'no_receiver');
  const { f, seed } = daily();
  const w = await world({ f, seed, respond: () => ({ status: 'unknown', code: 'receiver_unconfirmed', stop_run: true }) });
  const lost = await w.adapter.send();
  const derived = sender.eventId({ run_id: w.run, source: src, message_id: 'e3-n-2', account_id: 'mail-m-1', epoch: 1 });
  w.mails[0].state.receipts = { [derived]: { ...good, event_id: derived, version: { epoch: 1, revision: 1 }, trace: { run_id: w.run, event_id: derived, cloud_event: { id: 'e3-n-2', source: src } } } };
  w.mails[0].state.messages = [{ id: derived, thread_id: 'e3-n-2', account_id: 'mail-m-1' }];
  assert.deepEqual([lost.event_id, lost.expected_event_id, lost.source], [derived, derived, src]);
  assert.deepEqual(await w.adapter.reconcile(lost), { status: 'committed', event_id: derived, record_id: derived, account_id: 'mail-m-1', epoch: 1 });
  assert.deepEqual([w.adapter.status().status, w.adapter.status().reconciliation.status, (await w.adapter.send()).code], ['halted', 'committed', 'run_halted']);
  assert.equal((await w.adapter.reconcile({ ...lost, account_id: 'mail-p-9' })).reason, 'no_receiver');
});

test('T11b a snapshot without the loaded seed fails closed: nothing is pending and nothing is published', async () => {
  const { f, seed } = daily();
  assert.throws(() => sender.pending({ data: f.data() }), /no loaded seed/);
  assert.throws(() => sender.pending({ data: f.data(), initial_data: {} }), /no loaded seed/);
  const w = await world({ f, seed, over: { noSeed: true } });
  const before = w.r.log.capabilities;
  const out = await w.adapter.send();
  assert.deepEqual([out.status, out.reason, w.r.log.published.length, w.r.log.capabilities - before], ['invalid_snapshot', 'no_initial_data', 0, 0]);
});

test('T11b account IDs outside the Router namespace grammar get their own session next to the others', () => {
  const accounts = ['mail-m-1', 'mail.p-2', 'mail:p-3'];
  const configs = sender.sessionConfigs({ ...example, publishers: [{ ...example.publishers[0], allowed_recipients: accounts.map(GRANT) }] });
  assert.deepEqual(configs.map(c => c.account_id), accounts);
  assert.ok(configs.every(c => /^[-a-zA-Z0-9_]{1,80}$/.test(c.config.receiver_state_namespace) && c.config.receiver_state_namespace === sender.namespace(c.account_id)));
  assert.equal(new Set(configs.map(c => c.config.receiver_state_namespace)).size, 3);
});

test('T11b a Router that serves another publisher is refused like one from another run', async () => {
  const { f, seed } = daily();
  const publisher = {};
  const w = await world({ f, seed, options: { publisher } });
  publisher['mail-m-1'] = 'mail';
  const out = await w.adapter.send();
  assert.deepEqual([out.held.filter(h => h.recipient_id === 'm-1').map(h => h.reason), w.r.log.published.map(p => p[0])], [['router_not_in_run', 'router_not_in_run'], ['mail-m-2', 'mail-m-2']]);
  const run = RUN();
  const other = routers(run, undefined, { publisher: { 'mail-m-1': 'mail' } });
  await assert.rejects(sender.openSession({ run, stateDir: 's', account: MAIL[0], config: configFor(MAIL), openMail: async () => mailFake(MAIL[0], run), openRouter: async () => other.make('mail-m-1') }), /does not serve this publisher/);
});

test('T11b when the source clock moves during a pass every Mail clock follows it before the next publish', async () => {
  const { f, seed } = daily();
  let w;
  w = await world({ f, seed, options: { after: (args, i) => { if (i === 1) w.adapter.exclusive(async () => { w.app.state.now = '2026-11-21T09:40:00-05:00'; }); } } });
  const out = await w.adapter.send();
  assert.deepEqual([out.status, w.mails.map(m => m.state.now), w.mails.map(m => m.state.advances.map(a => a.virtual_now))], ['published', ['2026-11-21T09:40:00-05:00', '2026-11-21T09:40:00-05:00'], [['2026-11-21T09:00:00-05:00', '2026-11-21T09:40:00-05:00'], ['2026-11-21T09:00:00-05:00', '2026-11-21T09:40:00-05:00']]]);
});

test('T11b the exported align() validates every endpoint before it advances any clock', async () => {
  const { f, seed } = daily();
  const w = await world({ f, seed });
  w.mails[0].state.run_id = 'other-run';
  w.mails[0].state.now = '2026-12-31T09:00:00-05:00';
  const out = await w.adapter.align();
  assert.deepEqual([out.status, out.sessions, w.app.state.advances, w.mails[0].state.advances, w.mails[1].state.advances.map(a => a.virtual_now)], ['aligned', [{ account_id: 'mail-m-2', status: 'aligned' }], [], [], [f.ctx.virtual_now]]);
  const h = await world({ f, seed });
  h.r.log.halted = true;
  assert.deepEqual([(await h.adapter.align()).status, h.app.state.advances, h.mails.map(m => m.state.advances.length)], ['halted', [], [0, 0]]);
});

test('T11b reconciliation needs the same record on both reads', async () => {
  const run = RUN();
  const setup = { status: 'ok', run_id: run, account_id: 'mail-m-1', owner_person_id: 'm-1', epoch: 4 };
  const src = 'urn:pale:app:larkfield-health:account:larkfield-m-1';
  const id = sender.eventId({ run_id: run, source: src, message_id: 'e3-n-2', account_id: 'mail-m-1', epoch: 4 });
  const good = { status: 'committed', event_id: id, version: { epoch: 4, revision: 3 }, trace: { run_id: run, event_id: id, cloud_event: { id: 'e3-n-2', source: src } } };
  const mail = mailFake(MAIL[0], run, '2026-11-30T09:00:00-05:00', { epoch: 4, receipts: { [id]: good }, messages: [{ id, thread_id: 'e3-n-2', account_id: 'mail-m-1', folder: 'inbox' }] });
  let reads = 0;
  mail.state.before = name => { if (name === 'env.snapshot' && ++reads === 2) mail.state.messages = [{ id, thread_id: 'e3-n-2', account_id: 'mail-m-1', folder: 'trash' }]; };
  const outcome = { account_id: 'mail-m-1', source: src, message_id: 'e3-n-2', event_id: id, receiver: setup };
  assert.deepEqual(await sender.reconcile({ mail, setup, outcome }), { status: 'indeterminate', reason: 'receipt_and_record_disagree', event_id: id, account_id: 'mail-m-1' });
});

test('T11b a source change during the first alignment stops the pass before any publish', async () => {
  const { f, seed } = daily();
  const w = await world({ f, seed });
  w.mails[0].state.before = name => { if (name === 'env.advance_time') w.app.state.version.epoch = 4; };
  const out = await w.adapter.send();
  assert.deepEqual([out.status, w.r.log.published.length, w.adapter.status().status], ['source_changed', 0, 'ready']);
});

test('T11b adapter.exclusive refuses to wrap a pass, an alignment, a reconciliation or another exclusive section instead of deadlocking', { timeout: 5000 }, async () => {
  const { f, seed } = daily();
  const w = await world({ f, seed });
  for (const [name, inner] of [['send', () => w.adapter.send()], ['align', () => w.adapter.align()], ['reconcile', () => w.adapter.reconcile({})], ['exclusive', () => w.adapter.exclusive(() => 1)]]) {
    await assert.rejects(w.adapter.exclusive(inner), new RegExp('adapter\\.' + name + ' cannot run inside adapter\\.exclusive'));
  }
  await assert.rejects(w.adapter.exclusive(() => sender.create({ app: w.app, sessions: w.sessions, onHalt: w.r.stop }).send()), /cannot run inside adapter\.exclusive/);
  assert.equal(await w.adapter.exclusive(async () => 'grant applied'), 'grant applied');
  assert.equal((await w.adapter.send()).status, 'published');
});

test('T11b a Router that does not offer the Email channel and wire contract is never routed', async () => {
  const { f, seed } = daily();
  for (const offered of [[], [{ ...CHANNEL_ENTRY, channel: 'channel.email.attachments' }], [{ ...CHANNEL_ENTRY, schema_id: 'urn:pale:email-message:1' }], [{ ...CHANNEL_ENTRY, payload_schema_id: 'urn:pale:email-payload:0' }]]) {
    const channels = {};
    const w = await world({ f, seed, options: { channels } });
    channels['mail-m-1'] = offered;
    const out = await w.adapter.send();
    assert.deepEqual([out.held.filter(h => h.recipient_id === 'm-1').map(h => h.reason), w.r.log.published.map(p => p[0])], [['no_email_channel', 'no_email_channel'], ['mail-m-2', 'mail-m-2']], JSON.stringify(offered));
  }
});

test('T11b with two granted inboxes for one person a merely unreachable route keeps the entry ambiguous; once sent, retries go only to that inbox', async () => {
  const accounts = [MAIL[0], { app_id: 'mail', account_id: 'mail-m-1-b', owner_person_id: 'm-1' }, MAIL[1]];
  const { f, seed } = daily(null, accounts, false);
  const down = {};
  const w = await world({ f, seed, accounts, options: { down } });
  const reasons = [];
  for (const failing of [null, 'mail-m-1', null, 'mail-m-1-b']) {
    for (const k of Object.keys(down)) delete down[k];
    if (failing) down[failing] = true;
    reasons.push((await w.adapter.send()).held.find(h => h.notice_id === 'n-2').reason);
  }
  assert.deepEqual([reasons, w.r.log.published.filter(p => p[1] === 'e3-n-2').length], [['ambiguous_route', 'ambiguous_route', 'ambiguous_route', 'ambiguous_route'], 0]);
  for (const k of Object.keys(down)) delete down[k];
  const inner = w.mails[1].call;
  w.mails[1].call = async () => { throw new Error('Mail client closed'); };
  const closed = await w.adapter.send();
  w.mails[1].call = inner;
  assert.deepEqual([closed.held.find(h => h.notice_id === 'n-2').reason, w.r.log.published.filter(p => p[1] === 'e3-n-2').length], ['destination_unknown', 0]);
  const first = await sender.create({ app: w.app, sessions: [w.sessions[0], w.sessions[2]], onHalt: w.r.stop }).send();
  assert.deepEqual(first.receipts.filter(x => x.notice_id === 'n-2').map(x => x.account_id), ['mail-m-1']);
  const again = await w.adapter.send();
  down['mail-m-1'] = true;
  const waiting = await w.adapter.send();
  assert.deepEqual([again.receipts.filter(x => x.notice_id === 'n-2').map(x => x.account_id), waiting.held.find(h => h.notice_id === 'n-2').reason], [['mail-m-1'], 'destination_unavailable']);
  assert.deepEqual(w.r.log.published.filter(p => p[1] === 'e3-n-2').map(p => p[0]), ['mail-m-1', 'mail-m-1']);
});

test('T11b a delivery already present in another granted inbox of the recipient pins the entry there, and an unreadable inbox makes it wait', async () => {
  const accounts = [MAIL[0], { app_id: 'mail', account_id: 'mail-m-1-b', owner_person_id: 'm-1' }, MAIL[1]];
  const { f, seed } = daily(null, accounts, false);
  for (const [prepare, reason] of [[w => { const id = sender.eventId({ run_id: w.run, source: 'urn:pale:app:larkfield-health:account:larkfield-m-1', message_id: 'e3-n-2', account_id: 'mail-m-1-b', epoch: 1 }); w.mails[1].state.messages = [{ id, thread_id: 'e3-n-2', account_id: 'mail-m-1-b' }]; }, 'destination_unavailable'], [w => { const inner = w.mails[1].call; w.mails[1].call = async (name, args) => { if (name === 'env.snapshot') throw new Error('inbox unreadable'); return inner(name, args); }; }, 'destination_unknown']]) {
    const down = {};
    const w = await world({ f, seed, accounts, options: { down } });
    prepare(w);
    down['mail-m-1-b'] = true;
    const out = await w.adapter.send();
    assert.deepEqual([out.held.find(h => h.notice_id === 'n-2').reason, w.r.log.published.filter(p => p[1] === 'e3-n-2').length], [reason, 0], reason);
  }
});

test('T11b a Router discovery that times out returns a resumable setup on the same Router instead of stranding it', async () => {
  const run = RUN();
  const r = routers(run);
  const inner = r.make('mail-m-1');
  let failures = 2, opened = 0;
  const flaky = { definitions: inner.definitions, call: async (name, args) => { if (name === 'router.capabilities' && failures > 0) { failures--; throw new Error('MCP request timed out: tools/call'); } return inner.call(name, args); } };
  const open = attempts => sender.openSession({ run, stateDir: 's', account: MAIL[0], config: configFor(MAIL), attempts, openMail: async () => mailFake(MAIL[0], run), openRouter: async () => { opened++; return flaky; } });
  const err = await open(1).then(() => null, e => e);
  assert.ok(err && err.setup && /resume this setup/.test(err.message));
  const again = await err.setup.resume().then(() => null, e => e);
  assert.ok(again && again.setup);
  const session = await again.setup.resume();
  assert.deepEqual([session.account_id, session.router === flaky, opened, session.contract === sender.CONTRACT], ['mail-m-1', true, 1, true]);
  failures = 1;
  const retried = await open(3);
  assert.deepEqual([retried.router === flaky, opened], [true, 2]);
  const wrong = { definitions: inner.definitions, call: async () => ({ status: 'ok', run_id: 'other-run', publisher: 'larkfield-health', halted: false, channels: [] }) };
  const permanent = await sender.openSession({ run, stateDir: 's', account: MAIL[0], config: configFor(MAIL), openMail: async () => mailFake(MAIL[0], run), openRouter: async () => wrong }).then(() => null, e => e);
  assert.ok(permanent && !permanent.setup && /does not serve this publisher/.test(permanent.message));
});

test('T11b the first alignment of a pass and align() advance Larkfield only under the publish lock', async () => {
  const { f, seed } = daily();
  for (const run of [w => w.adapter.send(), w => w.adapter.align()]) {
    const w = await world({ f, seed, mailNow: '2026-11-30T10:00:00-05:00' });
    let moved = null;
    const section = w.adapter.exclusive(async () => { const before = w.app.state.version.revision; await new Promise(resolve => setTimeout(resolve, 20)); moved = w.app.state.version.revision - before; });
    await Promise.all([section, run(w)]);
    assert.deepEqual([moved, w.app.state.now], [0, '2026-11-30T10:00:00-05:00']);
  }
});

test('T11b a send scheduled from inside adapter.exclusive runs once the section has ended', async () => {
  const { f, seed } = daily();
  const w = await world({ f, seed });
  let later = null;
  await w.adapter.exclusive(async () => { setTimeout(() => { later = w.adapter.send(); }, 0); });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal((await later).status, 'published');
});

test('T11b a fresh adapter reports a halted run once its run is resolved', async () => {
  const { f, seed } = daily();
  const w = await world({ f, seed, respond: () => undefined });
  await w.adapter.send();
  const fresh = sender.create({ app: w.app, sessions: w.sessions, onHalt: w.r.stop });
  await fresh.ready;
  assert.deepEqual([fresh.status().status, fresh.status().cause.code], ['halted', 'publish_unconfirmed']);
});

test('T11b a pass stops when Larkfield cannot reach, or does not keep, the aligned time before a publish', async () => {
  const { f, seed } = daily();
  let w;
  w = await world({ f, seed, options: { after: (args, i) => { if (i === 1) w.adapter.exclusive(async () => { w.mails[0].state.now = '2026-11-30T09:40:00-05:00'; w.app.call = (call => async (name, a) => (name === 'env.advance_time' ? { status: 'stale_version' } : call(name, a)))(w.app.call); }); } } });
  const stuck = await w.adapter.send();
  assert.deepEqual([stuck.status, stuck.clock.failed, w.r.log.published.length], ['unaligned', [0], 1]);
  let v, reads = -1;
  v = await world({ f, seed, options: { after: (args, i) => { if (i === 1) reads = 0; } } });
  const inner = v.app.call;
  v.app.call = async (name, a) => { const out = await inner(name, a); if (name === 'env.snapshot' && reads >= 0 && ++reads === 2) return { ...out, snapshot: { ...out.snapshot, virtual_now: '2026-11-30T09:20:00-05:00' } }; return out; };
  const drift = await v.adapter.send();
  assert.deepEqual([drift.status, v.r.log.published.length], ['unaligned', 1]);
});

test('T11b a configuration with two grants for one Mail account opens no session', async () => {
  const run = RUN();
  const config = { ...example, publishers: [{ ...example.publishers[0], allowed_recipients: [GRANT('mail-m-1'), { ...GRANT('mail-m-1') }] }] };
  await assert.rejects(sender.openSession({ run, stateDir: 's', account: MAIL[0], config, openMail: async () => assert.fail('no Mail before the grant check'), openRouter: async () => assert.fail('no Router') }), /exactly one grant/);
});

test('T11b a configuration verdict recorded for a session still removes its route while that session is also unreachable', async () => {
  const accounts = [MAIL[0], MAIL[1], { app_id: 'mail', account_id: 'mail-m-2-b', owner_person_id: 'm-2' }];
  const { f, seed } = daily(null, accounts, false);
  const down = {};
  const changed = { ...wire, description: 'A changed copy whose content no longer matches the receiver.' };
  const w = await world({ f, seed, accounts, options: { down, schemas: { 'mail-m-2-b': changed } } });
  down['mail-m-2-b'] = true;
  const out = await w.adapter.send();
  assert.deepEqual(out.receipts.filter(x => x.notice_id === 'n-3').map(x => x.account_id), ['mail-m-2']);
  const identity = {}, down2 = {};
  const v = await world({ f, seed, accounts, options: { identity, down: down2 } });
  identity['mail-m-2-b'] = 'other-run';
  const first = await v.adapter.send();
  down2['mail-m-2-b'] = true;
  delete identity['mail-m-2-b'];
  const second = await v.adapter.send();
  assert.deepEqual([first.receipts.filter(x => x.notice_id === 'n-3').map(x => x.account_id), second.receipts.filter(x => x.notice_id === 'n-3').map(x => x.account_id), second.held.filter(h => h.notice_id === 'n-3')], [['mail-m-2'], ['mail-m-2'], []]);
});

test('T11b status() reports unknown, not ready, while the run cannot be resolved', async () => {
  const { f, seed } = daily();
  const w = await world({ f, seed, respond: () => undefined });
  await w.adapter.send();
  let failing = true;
  const flaky = { call: async (name, args) => { if (failing && name === 'env.snapshot') throw new Error('MCP request timed out: tools/call'); return w.app.call(name, args); } };
  const fresh = sender.create({ app: flaky, sessions: w.sessions, onHalt: w.r.stop });
  await fresh.ready;
  assert.deepEqual(fresh.status(), { status: 'unknown', reason: 'run_unresolved', reconciliation: null });
  failing = false;
  assert.deepEqual([(await fresh.send()).code, fresh.status().status, fresh.status().cause.code], ['run_halted', 'halted', 'publish_unconfirmed']);
  const ok = await world({ f, seed });
  await ok.adapter.ready;
  assert.equal(ok.adapter.status().status, 'ready');
});

test('T11b a Mail-bound minor and both guardians each get their own copy of the minor\'s notice', async () => {
  const accounts = [...MAIL, { app_id: 'mail', account_id: 'mail-m-3', owner_person_id: 'm-3' }];
  const { f, seed } = daily(null, accounts, false);
  const w = await world({ f, seed, accounts });
  const out = await w.adapter.send();
  assert.deepEqual([out.status, out.held, w.r.log.published.map(p => [p[0], p[1], p[3]])], ['published', [], [['mail-m-1', 'e3-n-2', 'm-1'], ['mail-m-2', 'e3-n-3', 'm-2'], ['mail-m-3', 'e3-n-4', 'm-3']]]);
});

test('T11b a revocation in the event that commits a due notice, or at the exact instant of that timer, keeps the viewer\'s entry and sends it nothing', async () => {
  for (const at of ['2026-11-21T09:00:00-05:00', '2026-11-20T23:59:00-05:00']) {
    const seed = dailySeed();
    const f = fixture({ seed, binding: bound() });
    ev(f, ...DECIDE);
    ev(f, at, 'grant.changed', { grant_id: 'gr-h1', status: 'revoked' });
    const entries = f.data().notices.filter(x => x.kind === 'notice.info_requested');
    assert.deepEqual(entries.map(x => [x.notice_id, x.recipient_id, x.at]), [['n-5', 'm-1', '2026-11-20T23:59:00-05:00'], ['n-6', 'm-2', '2026-11-20T23:59:00-05:00']], at);
    const w = await world({ f, seed });
    const out = await w.adapter.send();
    assert.deepEqual([out.held.map(h => [h.notice_id, h.reason]), w.r.log.published.map(p => p[1])], [[['n-4', 'no_mail_account'], ['n-5', 'access_changed']], ['e3-n-2', 'e3-n-3', 'e3-n-6']], at);
  }
});

test('T11b a publish that times out halts at once and keeps the publish lock until the Router has settled the request', async () => {
  const { f, seed } = daily();
  const run = RUN();
  const order = [];
  let pending = null, stopped = false, probes = 0, adapter = null;
  const base = routers(run);
  const make = account => {
    const inner = base.make(account);
    return { definitions: inner.definitions, call: async (name, args) => {
      if (name === 'router.capabilities') {
        probes++;
        if (pending) { await new Promise(resolve => setTimeout(resolve, 5)); throw new Error('MCP request timed out: tools/call'); }
        return { ...(await inner.call(name, args)), halted: stopped };
      }
      if (stopped) return { status: 'halted', code: 'run_halted', stop_run: true };
      if (args.message.id.endsWith('-n-5')) {
        adapter.exclusive(async () => { order.push('revocation committed'); ev(f, '2026-11-21T09:00:00-05:00', 'grant.changed', { grant_id: 'gr-h1', status: 'revoked' }); });
        pending = setTimeout(() => { order.push(stopped ? 'pending request refused' : 'pending request delivered'); pending = null; }, 40);
        throw new Error('MCP request timed out: tools/call');
      }
      return inner.call(name, args);
    } };
  };
  const mails = MAIL.map(a => mailFake(a, run));
  const sessions = [];
  for (const [i, account] of MAIL.entries()) sessions.push(await sender.openSession({ run, stateDir: 's', account, config: configFor(MAIL), openMail: async () => mails[i], openRouter: async () => make(account.account_id) }));
  adapter = sender.create({ app: appFake(f, seed, run), sessions, onHalt: () => { order.push('stop mechanism invoked'); stopped = true; } });
  const out = await adapter.send();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual([out.code, out.message_id.endsWith('-n-5'), out.stop_verified, order], ['publish_unconfirmed', true, true, ['stop mechanism invoked', 'pending request refused', 'revocation committed']]);
  assert.ok(probes >= 2 + 2);
});

test('T11b an entry held after a revocation stays pending and is delivered once the viewer holds a grant on that member again', async () => {
  const { f, seed } = daily();
  ev(f, '2026-11-21T09:00:00-05:00', 'grant.changed', { grant_id: 'gr-h1', status: 'revoked' });
  const w = await world({ f, seed });
  const first = await w.adapter.send();
  ev(f, '2026-11-21T09:10:00-05:00', 'grant.changed', { grant_id: 'gr-9', member_id: 'm-2', grantor_id: 'm-2', grantee_id: 'm-1', scope: 'view', expires_at: null, status: 'active' });
  w.app.state.now = '2026-11-21T09:10:00-05:00';
  const second = await w.adapter.send();
  assert.deepEqual([first.held.map(h => [h.notice_id, h.reason]), second.held.map(h => [h.notice_id, h.reason]), w.r.log.published.filter(p => p[1] === 'e3-n-5').map(p => p[0])], [[['n-4', 'no_mail_account'], ['n-5', 'access_changed']], [['n-4', 'no_mail_account']], ['mail-m-1']]);
});

test('T11b an unknown publish keeps the lock until Mail shows the receive committed, its epoch moved on, or a version fence rules the receive out', async () => {
  const { f, seed } = daily();
  const thrown = () => new Error('MCP request timed out: tools/call');
  const unconfirmed = () => ({ status: 'unknown', code: 'receiver_unconfirmed', stop_run: true });
  for (const [reply, mode, router, mail, order] of [
    [thrown, 'commits', ['answered', 1], 'committed', ['receive committed', 'revocation committed']],
    [thrown, 'never', ['answered', 1], 'fenced', ['fence committed', 'revocation committed']],
    [thrown, 'reset', ['answered', 1], 'epoch_changed', ['Mail reset', 'revocation committed']],
    [unconfirmed, 'commits', ['replied', 0], 'committed', ['receive committed', 'revocation committed']],
    [unconfirmed, 'never', ['replied', 0], 'fenced', ['fence committed', 'revocation committed']],
  ]) {
    const seen = [];
    let w, armed = false, calls = 0, before = null;
    w = await world({ f, seed, respond: args => {
      if (!args.message.id.endsWith('-n-5')) return { status: 'committed' };
      armed = true;
      w.adapter.exclusive(async () => { seen.push('revocation committed'); });
      return reply();
    } });
    const viewer = w.mails[0].state;
    viewer.before = (name, args) => {
      if (!armed) return;
      if (++calls < 3) throw new Error('App is locked; retry later. No write was committed.');
      if (calls === 3 && mode === 'commits') { viewer.receipts = { [args.event_id]: { status: 'committed', event_id: args.event_id } }; viewer.version.revision++; seen.push('receive committed'); }
      if (calls === 3 && mode === 'reset') { viewer.version = { epoch: 2, revision: 0 }; seen.push('Mail reset'); }
      if (name === 'env.advance_time') { before = { version: { ...viewer.version }, now: viewer.now }; seen.push('fence committed'); }
    };
    const out = await w.adapter.send();
    await w.adapter.exclusive(async () => {});
    const label = reply.name + ' ' + mode;
    assert.deepEqual([out.status, out.stopped_at, out.stop_verified, out.settled, seen], ['unknown', 'n-5', true, { settled: true, router: router[0], router_attempts: router[1], mail, mail_attempts: 3 }, order], label);
    const fences = viewer.advances.filter(a => /^settle-/.test(a.request_id));
    if (mode !== 'never') { assert.deepEqual(fences, [], label); continue; }
    assert.deepEqual(fences, [{ expected_version: before.version, virtual_now: new Date(Date.parse(before.now) + 1).toISOString(), request_id: 'settle-' + out.expected_event_id + '-e1-r' + before.version.revision }], label);
  }
});

test('T11b a Router client error is not an exit: the lock is kept until the Router process has exited, then Mail settles the dispatch', async () => {
  const { f, seed } = daily();
  const run = RUN(), order = [], child = { exitCode: null, signalCode: null };
  let adapter = null, ended = false, errors = 0;
  const base = routers(run);
  const make = account => {
    const inner = base.make(account);
    return { definitions: inner.definitions, ...(account === 'mail-m-1' ? { child } : {}), call: async (name, args) => {
      if (account === 'mail-m-1' && ended) {
        if (++errors === 3) setTimeout(() => { child.exitCode = 0; order.push('Router exited'); }, 20);
        throw Object.assign(new Error('write after end'), { code: 'ERR_STREAM_WRITE_AFTER_END' });
      }
      if (name === 'router.publish' && args.message.id.endsWith('-n-5')) {
        ended = true;
        adapter.exclusive(async () => { order.push('revocation committed'); });
        throw new Error('MCP request timed out: tools/call');
      }
      return inner.call(name, args);
    } };
  };
  const mails = MAIL.map(a => mailFake(a, run));
  const sessions = [];
  for (const [i, account] of MAIL.entries()) sessions.push(await sender.openSession({ run, stateDir: 's', account, config: configFor(MAIL), openMail: async () => mails[i], openRouter: async () => make(account.account_id) }));
  adapter = sender.create({ app: appFake(f, seed, run), sessions, onHalt: () => { base.log.halted = true; } });
  const out = await adapter.send();
  await adapter.exclusive(async () => {});
  assert.deepEqual([out.code, out.settled.router, out.settled.mail, order], ['publish_unconfirmed', 'exited', 'fenced', ['Router exited', 'revocation committed']]);
  assert.ok(errors >= 3);
});

test('T11b an onHalt hook that calls back into the adapter is refused instead of waiting for the publish lock', { timeout: 5000 }, async () => {
  const { f, seed } = daily();
  let w, inner = null;
  w = await world({ f, seed, respond: () => new Error('MCP request timed out: tools/call'), onHalt: async cause => { w.r.stop(cause); if (inner === null) inner = await w.adapter.exclusive(async () => 'ran').then(x => x, e => e.message); } });
  const out = await w.adapter.send();
  assert.deepEqual([out.code, inner, out.stop_verified, w.r.log.published.length], ['publish_unconfirmed', 'adapter.exclusive cannot run inside the onHalt hook for the same run.', true, 1]);
});

test('T11b sessions absorb errors on their clients\' input streams, and the sender writes nothing to a client that is closing', async () => {
  const { EventEmitter } = require('node:events');
  const { f, seed } = daily();
  for (const shape of [stream => ({ child: { stdin: stream, exitCode: null, signalCode: null } }), stream => ({ stdin: stream })]) {
    const run = RUN(), base = routers(run), mails = MAIL.map(a => mailFake(a, run)), calls = [], sessions = [];
    const streams = MAIL.map(() => Object.assign(new EventEmitter(), { writableEnded: false, destroyed: false }));
    for (const [i, account] of MAIL.entries()) {
      const inner = base.make(account.account_id);
      const router = { definitions: inner.definitions, ...shape(streams[i]), call: async (name, args) => { calls.push([account.account_id, name]); return inner.call(name, args); } };
      sessions.push(await sender.openSession({ run, stateDir: 's', account, config: configFor(MAIL), openMail: async () => mails[i], openRouter: async () => router }));
    }
    assert.doesNotThrow(() => streams.forEach(s => s.emit('error', Object.assign(new Error('write after end'), { code: 'ERR_STREAM_WRITE_AFTER_END' }))));
    streams[0].writableEnded = true;
    const seen = calls.length;
    const out = await sender.create({ app: appFake(f, seed, run), sessions, onHalt: base.stop }).send();
    const reasons = out.held.filter(h => h.recipient_id === MAIL[0].owner_person_id).map(h => h.reason);
    assert.deepEqual([calls.slice(seen).filter(c => c[0] === MAIL[0].account_id), reasons.length > 0 && reasons.every(x => x === 'router_unavailable')], [[], true]);
  }
});

test('T11b a lost fence acknowledgement is recovered with the same request and target, so Mail moves by 1 ms only', async () => {
  const { f, seed } = daily();
  let w, armed = false, start = null, dropped = false;
  w = await world({ f, seed, respond: args => { if (!args.message.id.endsWith('-n-5')) return { status: 'committed' }; armed = true; return new Error('MCP request timed out: tools/call'); } });
  const viewer = w.mails[0], inner = viewer.call, done = new Map(), fences = [];
  viewer.call = async (name, args) => {
    if (!armed || name !== 'env.advance_time') return inner(name, args);
    if (start === null) start = viewer.state.now;
    fences.push(args);
    if (done.has(args.request_id)) return { ...done.get(args.request_id), duplicate: true };
    const reply = await inner(name, args);
    done.set(args.request_id, reply);
    if (!dropped) { dropped = true; throw new Error('MCP request timed out: tools/call'); }
    return reply;
  };
  const out = await w.adapter.send();
  assert.deepEqual([out.settled.mail, fences.length, fences[1], Date.parse(viewer.state.now) - Date.parse(start)], ['fenced', 2, fences[0], 1]);
});

test('T11b a Router that ends by a signal counts as exited, so settlement goes on to Mail', async () => {
  const { f, seed } = daily();
  const run = RUN(), order = [], child = { exitCode: null, signalCode: null };
  let adapter = null, killed = false;
  const base = routers(run);
  const make = account => {
    const inner = base.make(account);
    return { definitions: inner.definitions, ...(account === MAIL[0].account_id ? { child } : {}), call: async (name, args) => {
      if (account === MAIL[0].account_id && killed) throw new Error('Server exited: ');
      if (name === 'router.publish' && args.message.id.endsWith('-n-5')) {
        killed = true;
        adapter.exclusive(async () => { order.push('revocation committed'); });
        setTimeout(() => { child.signalCode = 'SIGKILL'; order.push('Router killed'); }, 20);
        throw new Error('Server exited: ');
      }
      return inner.call(name, args);
    } };
  };
  const mails = MAIL.map(a => mailFake(a, run));
  const sessions = [];
  for (const [i, account] of MAIL.entries()) sessions.push(await sender.openSession({ run, stateDir: 's', account, config: configFor(MAIL), openMail: async () => mails[i], openRouter: async () => make(account.account_id) }));
  adapter = sender.create({ app: appFake(f, seed, run), sessions, onHalt: () => { base.log.halted = true; } });
  let timer = null;
  const out = await Promise.race([adapter.send(), new Promise((resolve, reject) => { timer = setTimeout(() => { child.exitCode = 0; reject(new Error('adapter.send() did not return within 2000 ms of a signal exit')); }, 2000); })]).finally(() => clearTimeout(timer));
  await adapter.exclusive(async () => {});
  assert.deepEqual([out.code, out.settled.router, out.settled.mail, order], ['publish_unconfirmed', 'exited', 'fenced', ['Router killed', 'revocation committed']]);
});

test('T11b a fence retry refused as stale drops that fence and checks Mail afresh before fencing again', async () => {
  const { f, seed } = daily();
  let w, armed = false, released = false;
  w = await world({ f, seed, respond: args => { if (!args.message.id.endsWith('-n-5')) return { status: 'committed' }; armed = true; return new Error('MCP request timed out: tools/call'); } });
  const viewer = w.mails[0], inner = viewer.call, fences = [];
  viewer.call = async (name, args) => {
    if (released) return name === 'env.advance_time' ? { status: 'committed', advanced: true } : inner(name, args);
    if (!armed || name !== 'env.advance_time') return inner(name, args);
    fences.push(args.request_id);
    if (fences.length === 1) { viewer.state.version.revision++; throw new Error('MCP request timed out: tools/call'); }
    if (args.expected_version.revision !== viewer.state.version.revision) return { status: 'stale_version', applied: false };
    return inner(name, args);
  };
  let timer = null;
  const out = await Promise.race([w.adapter.send(), new Promise((resolve, reject) => { timer = setTimeout(() => { released = true; reject(new Error('adapter.send() did not return within 2000 ms')); }, 2000); })]).finally(() => clearTimeout(timer));
  assert.deepEqual([out.settled.mail, fences.length, fences[1] === fences[0], fences[2] !== fences[0]], ['fenced', 3, true, true]);
});
