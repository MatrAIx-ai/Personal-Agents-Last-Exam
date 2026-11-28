'use strict';
const crypto = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const { relation, fillAccess } = require('../src/authority.cjs');
const { byId } = require('../src/util.cjs');
const wireSchema = require('../schemas/router-message.schema.json');

const APP = 'mendwell-pharmacy';
const CHANNEL = 'channel.email';
const WIRE = { schema_id: 'urn:pale:email-message:2', event_type: 'org.pale.mail.notification.v1', payload_schema_id: 'urn:pale:email-payload:1' };
const PRE_DISPATCH = new Set(['invalid_arguments', 'incompatible_contract', 'required_extension_unsupported', 'source_identity_mismatch', 'idempotency_conflict', 'unsupported_recipient', 'ambiguous_recipient', 'recipient_unavailable', 'recipient_not_authorized', 'operation_unavailable']);
const canonical = x => JSON.stringify(x, (_, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v));
const digest = x => crypto.createHash('sha256').update(canonical(x)).digest('hex');
const CONTRACT = digest(wireSchema);
const sourceUri = account => 'urn:pale:app:' + encodeURIComponent(APP) + ':account:' + encodeURIComponent(account);
const namespace = account => 'mail-' + crypto.createHash('sha256').update(String(account)).digest('hex').slice(0, 32);
const eventId = ({ run_id, source, message_id, account_id, epoch }) => 'router-' + digest({ run: run_id, source, id: message_id, target: 'mail', account: account_id, epoch }).slice(0, 32);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const later = (a, b) => (Date.parse(b) > Date.parse(a) ? b : a);

function message(snapshot, entry) {
  const { account_id } = snapshot.data;
  return {
    specversion: '1.0',
    id: 'e' + snapshot.epoch + '-' + entry.notice_id,
    source: sourceUri(account_id),
    type: WIRE.event_type,
    time: entry.at,
    datacontenttype: 'application/json',
    dataschema: WIRE.payload_schema_id,
    data: {
      channel: CHANNEL,
      recipient: { kind: 'person_ref', id: entry.recipient_id },
      source_object: { app_id: APP, account_id, object_type: entry.subject.type, object_id: entry.subject.id },
      content: { title: entry.title, body: { format: 'text/plain', text: entry.body }, asset_ids: [] },
      extensions: [],
    },
  };
}

const seeded = snapshot => Boolean(snapshot && snapshot.initial_data && Array.isArray(snapshot.initial_data.notices) && snapshot.data && Array.isArray(snapshot.data.notices));

function pending(snapshot) {
  if (!seeded(snapshot)) throw new Error('The snapshot carries no loaded seed, so history cannot be told from new entries.');
  const history = new Set(snapshot.initial_data.notices.map(n => n.notice_id));
  return snapshot.data.notices.filter(n => !history.has(n.notice_id));
}

function patientOf(data, subject) {
  const parent = subject.type === 'fill' ? byId(data.fills, 'fill_id', subject.id) : subject.type === 'renewal' ? byId(data.renewals, 'renewal_id', subject.id) : null;
  const rx = parent && byId(data.prescriptions, 'rx_id', parent.rx_id);
  return rx ? rx.patient_id : null;
}

function eligible(data, entry, now) {
  if (entry.audience === 'card_owner') return data.cards.some(c => c.owner_id === entry.recipient_id && c.last4 === entry.fields.card_last4);
  const patientId = patientOf(data, entry.subject);
  if (patientId === null) return false;
  const rel = relation(data, entry.recipient_id, patientId, Date.parse(now));
  if (entry.audience === 'full') return rel.view;
  return entry.audience === 'logistics' && entry.subject.type === 'fill' && fillAccess(rel, entry.subject.id) !== null;
}

const mailAccounts = (binding, person) => binding.accounts.filter(a => a.app_id === 'mail' && (person === undefined || a.owner_person_id === person));
const TRANSIENT = new Set(['router_unavailable', 'receiver_unavailable', 'clock_unaligned']);
const granted = session => (session.grants || []).some(g => g.app_id === 'mail' && g.account_id === session.account_id && g.channel === CHANNEL);

function route(snapshot, sessions, entry, usable = () => true) {
  if (!eligible(snapshot.data, entry, snapshot.virtual_now)) return { reason: 'access_changed' };
  const accounts = mailAccounts(snapshot.binding, entry.recipient_id);
  if (!accounts.length) return { reason: 'no_mail_account' };
  const candidates = accounts.flatMap(a => sessions.filter(s => s.account_id === a.account_id && granted(s)));
  if (!candidates.length) return { reason: 'no_email_grant' };
  const verdicts = candidates.map(s => ({ session: s, verdict: usable(s) }));
  const open = verdicts.filter(v => v.verdict === true);
  if (open.length > 1 || (open.length === 1 && verdicts.some(v => TRANSIENT.has(v.verdict)))) return { reason: 'ambiguous_route' };
  return open.length ? { session: open[0].session } : { reason: verdicts[0].verdict };
}

function sessionConfigs(config) {
  const publishers = config.publishers.filter(p => p.app_id === APP);
  if (publishers.length !== 1) throw new Error('The Router configuration needs exactly one Mendwell publisher entry.');
  const publisher = publishers[0];
  return publisher.allowed_recipients.filter(g => g.app_id === 'mail' && g.channel === CHANNEL).map(grant => {
    const entry = { ...publisher, allowed_recipients: [grant] };
    return { account_id: grant.account_id, namespace: namespace(grant.account_id), config: { ...config, receiver_state_namespace: namespace(grant.account_id), publishers: config.publishers.map(p => (p === publisher ? entry : p)) } };
  });
}

const input = client => (client && (client.stdin || (client.child && client.child.stdin))) || null;
const closing = client => Boolean(client) && (client.closed === true || Boolean(input(client) && (input(client).writableEnded || input(client).destroyed)));
const refuse = () => Promise.reject(new Error('The client is closing or closed, so no request was written.'));
const ask = (client, name, args = {}) => (closing(client) ? refuse() : client.call(name, args));
const guarded = new WeakSet();
const guard = client => {
  const stream = input(client);
  if (stream && typeof stream.on === 'function' && !guarded.has(stream)) { guarded.add(stream); stream.on('error', () => {}); }
  return client;
};

async function receiver(mail, account) {
  const s = (await ask(mail, 'env.snapshot')).snapshot;
  const bound = s.binding.accounts.filter(a => a.app_id === 'mail' && a.account_id === account.account_id);
  if (s.data.account_id !== account.account_id || s.data.owner_person_id !== account.owner_person_id || bound.length !== 1 || bound[0].owner_person_id !== account.owner_person_id) return { status: 'invalid', reason: 'receiver_not_loaded', account_id: account.account_id };
  return { status: 'ok', run_id: s.run_id, account_id: s.data.account_id, owner_person_id: s.data.owner_person_id, epoch: s.epoch };
}

const built = new WeakSet();

async function openSession({ run, stateDir, account, config, openMail, openRouter, attempts = 3 }) {
  const entries = sessionConfigs(config).filter(c => c.account_id === account.account_id);
  if (entries.length !== 1) throw new Error('The Router configuration needs exactly one grant for Mail account ' + account.account_id + '.');
  const { namespace: space, config: sessionConfig } = entries[0];
  const mail = guard(await openMail({ run, stateDir, namespace: space, account }));
  const setup = await receiver(mail, account);
  if (setup.status !== 'ok' || setup.run_id !== run) throw new Error('Mail account ' + account.account_id + ' must be loaded and bound in run ' + run + ' before its Router session starts.');
  const router = guard(await openRouter({ run, stateDir, namespace: space, config: sessionConfig, account }));
  const discover = async () => {
    const caps = await ask(router, 'router.capabilities');
    if (!caps || caps.status !== 'ok' || caps.run_id !== run || caps.publisher !== APP) throw Object.assign(new Error('The Router for Mail account ' + account.account_id + ' does not serve this publisher in run ' + run + '.'), { permanent: true });
    const tools = Array.isArray(router.definitions) ? router.definitions : typeof router.request === 'function' ? (((await (closing(router) ? refuse() : router.request('tools/list'))) || {}).result || {}).tools : null;
    const publish = (tools || []).find(t => t.name === 'router.publish');
    const offered = publish && publish.inputSchema && publish.inputSchema.properties && publish.inputSchema.properties.message ? publish.inputSchema.properties.message.anyOf || [] : [];
    const contracts = offered.filter(x => x && x.$id === WIRE.schema_id).map(digest);
    const session = Object.freeze({
      account_id: account.account_id, owner_person_id: account.owner_person_id, run, namespace: space, receiver_state_namespace: sessionConfig.receiver_state_namespace,
      grants: Object.freeze(sessionConfig.publishers.find(p => p.app_id === APP).allowed_recipients.map(g => Object.freeze({ ...g }))),
      receiver: Object.freeze(setup), contract: contracts.length === 1 ? contracts[0] : null, router, mail,
    });
    built.add(session);
    return session;
  };
  const attempt = async tries => {
    let last = null;
    for (let i = 0; i < tries; i++) {
      try { return await discover(); } catch (e) { if (e.permanent) throw e; last = e; }
    }
    throw Object.assign(new Error('Discovery of the Router for Mail account ' + account.account_id + ' did not complete; resume this setup with the same Router: ' + String(last && last.message)), { setup: Object.freeze({ account_id: account.account_id, router, resume: (more = 1) => attempt(Math.max(1, more)) }) });
  };
  return attempt(Math.max(1, attempts));
}

async function align(clients) {
  const states = [], failed = [], advanced = [];
  let reply;
  for (const [i, client] of clients.entries()) {
    try { const s = await ask(client, 'env.snapshot'); states.push({ i, client, version: s.version, now: s.snapshot.virtual_now }); } catch (e) { failed.push(i); }
  }
  if (!states.length) return { status: 'unaligned', virtual_now: null, advanced, failed };
  const target = states.map(s => s.now).reduce(later);
  for (const st of states) {
    if (Date.parse(st.now) >= Date.parse(target)) continue;
    let out = null;
    try { out = await ask(st.client, 'env.advance_time', { expected_version: st.version, virtual_now: target, request_id: 'align-e' + st.version.epoch + '-r' + st.version.revision + '-' + Date.parse(target) }); } catch (e) { out = null; }
    if (out && out.status === 'committed') advanced.push(st.i);
    else { failed.push(st.i); if (reply === undefined) reply = out; }
  }
  failed.sort((a, b) => a - b);
  return { status: failed.length ? 'unaligned' : 'aligned', virtual_now: target, advanced, failed, ...(reply === undefined ? {} : { reply }) };
}

async function reconcile({ mail, setup, outcome }) {
  const indeterminate = reason => ({ status: 'indeterminate', reason, event_id: outcome?.event_id ?? null, account_id: setup?.account_id ?? null });
  if (!outcome || !outcome.message_id || !outcome.source) return indeterminate('no_message');
  if (!setup) return indeterminate('no_receiver');
  const expected = eventId({ run_id: setup.run_id, source: outcome.source, message_id: outcome.message_id, account_id: setup.account_id, epoch: setup.epoch });
  if (outcome.event_id && outcome.event_id !== expected) return indeterminate('event_id_mismatch');
  const inEpoch = s => s.run_id === setup.run_id && s.epoch === setup.epoch && s.data.account_id === setup.account_id;
  const before = (await ask(mail, 'env.snapshot')).snapshot;
  if (!inEpoch(before)) return indeterminate('receiver_changed');
  const found = before.data.messages.find(m => m.id === expected);
  const answer = await ask(mail, 'env.event_status', { event_id: expected });
  const after = (await ask(mail, 'env.snapshot')).snapshot;
  if (!inEpoch(after) || !answer || !answer.version || answer.version.epoch !== setup.epoch) return indeterminate('receiver_changed');
  const receipt = answer.receipt;
  const record = after.data.messages.find(m => m.id === expected);
  const trace = receipt && receipt.trace, cloud = trace && trace.cloud_event;
  const receiptOk = Boolean(receipt) && receipt.status === 'committed' && receipt.event_id === expected && Boolean(receipt.version) && receipt.version.epoch === setup.epoch
    && Boolean(trace) && trace.run_id === setup.run_id && Boolean(cloud) && cloud.source === outcome.source && cloud.id === outcome.message_id;
  const recordOk = Boolean(found) && Boolean(record) && same(found, record) && record.account_id === setup.account_id && record.thread_id === outcome.message_id;
  if (receiptOk && recordOk) return { status: 'committed', event_id: expected, record_id: record.id, account_id: setup.account_id, epoch: setup.epoch };
  return indeterminate(!receipt && !record ? 'not_found' : 'receipt_and_record_disagree');
}

const queues = new Map(), stopped = new Map(), destinations = new Map(), inside = new AsyncLocalStorage();
const destinationKey = (run, source, messageId) => JSON.stringify([run, source, messageId]);
function serial(key, fn) {
  const prior = queues.get(key) || Promise.resolve();
  const next = prior.then(() => fn());
  const tail = next.then(() => undefined, () => undefined);
  queues.set(key, tail);
  tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
  return next;
}

const configured = new WeakMap();

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const exited = router => Boolean(router && router.child && (router.child.exitCode !== null || router.child.signalCode !== null));
const ANSWERED = new Set(['run_halted', 'concurrent_dispatch', 'receiver_lifecycle_changed', 'receiver_rejected']);
const answered = receipt => Boolean(receipt) && typeof receipt === 'object' && (receipt.status === 'committed' ? receipt.stop_run !== true
  : receipt.stop_run === true ? ANSWERED.has(receipt.code) : ['rejected', 'permission_denied'].includes(receipt.status) && PRE_DISPATCH.has(receipt.code));
const verdict = receipt => (receipt && receipt.stop_run === true ? [typeof receipt.code === 'string' ? receipt.code : 'stop_run', ['rejected', 'unknown', 'halted'].includes(receipt.status) ? receipt.status : 'unknown'] : ['publish_unconfirmed', 'unknown']);

async function routerDone(router) {
  for (let attempt = 1; ; attempt++) {
    if (exited(router)) return { router: 'exited', router_attempts: attempt - 1 };
    try { await ask(router, 'router.capabilities'); return { router: 'answered', router_attempts: attempt }; } catch (e) { await pause(50); }
  }
}

async function mailDone(mail, setup, expected) {
  let fence = null;
  const fenced = out => Boolean(out) && out.status === 'committed' && out.advanced === true;
  for (let attempt = 1; ; attempt++) {
    try {
      if (fence) {
        const again = await ask(mail, 'env.advance_time', fence);
        if (fenced(again)) return { mail: 'fenced', mail_attempts: attempt };
        if (again && typeof again.status === 'string') fence = null;
      } else {
        const answer = await ask(mail, 'env.event_status', { event_id: expected });
        const v = answer && answer.status === 'ok' ? answer.version : null, receipt = v ? answer.receipt : null;
        if (v && v.epoch !== setup.epoch) return { mail: 'epoch_changed', mail_attempts: attempt };
        if (receipt && receipt.status === 'committed' && receipt.event_id === expected) return { mail: 'committed', mail_attempts: attempt };
        const s = v ? await ask(mail, 'env.snapshot') : null;
        if (s && s.version && s.version.epoch === v.epoch && s.version.revision === v.revision) {
          fence = { expected_version: v, virtual_now: new Date(Date.parse(s.snapshot.virtual_now) + 1).toISOString(), request_id: 'settle-' + expected + '-e' + v.epoch + '-r' + v.revision };
          const out = await ask(mail, 'env.advance_time', fence);
          if (fenced(out)) return { mail: 'fenced', mail_attempts: attempt };
          if (out && typeof out.status === 'string') fence = null;
        }
      }
    } catch (e) {}
    await pause(50);
  }
}

async function settleDispatch(session, setup, expected, thrown) {
  const router = thrown ? await routerDone(session.router) : { router: 'replied', router_attempts: 0 };
  return { settled: true, ...router, ...(await mailDone(session.mail, setup, expected)) };
}

async function endpoint(session, source, account) {
  const invalid = reason => ({ status: 'invalid', reason });
  const fixed = reason => { configured.set(session, reason); return invalid(reason); };
  if (!built.has(session)) return invalid('session_unverified');
  if (session.run !== source.run_id) return invalid('session_not_in_run');
  if (configured.has(session)) return invalid(configured.get(session));
  if (session.contract !== CONTRACT) return fixed('incompatible_contract');
  let caps = null;
  try { caps = await ask(session.router, 'router.capabilities'); } catch (e) { return invalid('router_unavailable'); }
  if (!caps || caps.status !== 'ok') return invalid('router_unavailable');
  if (caps.run_id !== source.run_id || caps.publisher !== APP) return fixed('router_not_in_run');
  if (caps.halted === true) return { status: 'halted' };
  if (!(caps.channels || []).some(c => c.channel === CHANNEL && c.schema_id === WIRE.schema_id && c.event_type === WIRE.event_type && c.payload_schema_id === WIRE.payload_schema_id)) return fixed('no_email_channel');
  let r = null;
  try { r = await receiver(session.mail, account); } catch (e) { return invalid('receiver_unavailable'); }
  if (r.status !== 'ok') return invalid(r.reason);
  if (r.run_id !== source.run_id || r.account_id !== session.receiver.account_id) return fixed('receiver_not_in_run');
  return { status: 'ok', receiver: r };
}

function create({ mendwell, sessions = [], onHalt } = {}) {
  if (typeof onHalt !== 'function') throw new Error('The sender needs Infra\'s shared stop mechanism, an onHalt function that halts every Router session of the run.');
  let halt = null, reconciliation = null, run = null;
  const source = async () => (await ask(mendwell, 'env.snapshot')).snapshot;
  const runKey = async () => (run = run || (await source()).run_id);
  const reentry = async name => { const key = await runKey(), store = inside.getStore(); if (store && store.key === key && store.active) throw new Error(store.hook ? 'adapter.' + name + ' cannot run inside the onHalt hook for the same run.' : 'adapter.' + name + ' cannot run inside adapter.exclusive for the same run; wrap only Mendwell writes, events and resets.'); return key; };
  const callHook = async cause => { const flag = { key: run, active: true, hook: true }; try { return await inside.run(flag, () => onHalt(cause)); } finally { flag.active = false; } };
  const passes = async (name, fn) => { const key = await reentry(name); return serial('pass:' + key, fn); };
  const publishLock = async fn => serial('publish:' + (await runKey()), fn);
  const exclusive = async fn => {
    const key = await reentry('exclusive');
    return serial('publish:' + key, async () => { const flag = { key, active: true }; try { return await inside.run(flag, fn); } finally { flag.active = false; } });
  };
  const current = () => halt || stopped.get(run) || null;
  const halted = extra => ({ status: 'halted', code: 'run_halted', cause: current(), receipts: [], held: [], refused: [], ...extra });
  const status = () => (current() ? { status: 'halted', code: 'run_halted', cause: current(), reconciliation } : run === null ? { status: 'unknown', reason: 'run_unresolved', reconciliation } : { status: 'ready', reconciliation });
  const open = async () => {
    const left = [];
    for (const s of sessions.filter(x => built.has(x) && x.run === run)) {
      try { const c = await ask(s.router, 'router.capabilities'); if (!(c && c.status === 'ok' && c.run_id === run && c.halted === true)) left.push(s.account_id); } catch (e) { left.push(s.account_id); }
    }
    return left;
  };
  const haltNow = async cause => {
    halt = { ...cause };
    stopped.set(run, halt);
    try { await callHook(halt); } catch (e) { halt = { ...halt, on_halt_error: String(e && e.message) }; stopped.set(run, halt); }
  };
  const stop = async cause => {
    const earlier = halt && halt.message_id !== undefined && halt.message_id === cause.message_id ? halt : null;
    halt = { ...(earlier || {}), ...cause };
    stopped.set(run, halt);
    let left = await open(), hook = null;
    if (left.length) {
      try { await callHook(halt); } catch (e) { hook = String(e && e.message); }
      left = await open();
    }
    halt = { ...halt, stop_verified: left.length === 0, unhalted: left, ...(hook ? { on_halt_error: hook } : {}) };
    stopped.set(run, halt);
    return halt;
  };

  async function validate(first) {
    const checks = new Map();
    for (const s of sessions) {
      const account = mailAccounts(first.binding).find(a => a.account_id === s.account_id);
      const c = account ? await endpoint(s, first, account) : { status: 'invalid', reason: 'not_bound' };
      if (c.status === 'halted') { await stop({ code: 'run_halted', status: 'halted', account_id: s.account_id, observed: 'router.capabilities' }); return null; }
      if (c.status === 'ok' && c.receiver.epoch !== s.receiver.epoch) {
        await stop({ code: 'receiver_lifecycle_changed', status: 'rejected', account_id: s.account_id, observed: 'adapter', expected_epoch: s.receiver.epoch, receiver: c.receiver });
        return null;
      }
      checks.set(s, c);
    }
    return checks;
  }

  async function clocks() {
    await runKey();
    if (current()) return halted();
    const checks = await validate(await source());
    if (!checks) return halted();
    const valid = sessions.filter(s => checks.get(s).status === 'ok');
    const clock = await publishLock(() => align([mendwell, ...valid.map(s => s.mail)]));
    return { ...clock, sessions: valid.map((s, i) => ({ account_id: s.account_id, status: clock.failed.includes(i + 1) ? 'clock_unaligned' : 'aligned' })) };
  }

  async function pass() {
    await runKey();
    if (current()) return halted();
    const first = await source();
    if (!seeded(first)) return { status: 'invalid_snapshot', reason: 'no_initial_data', receipts: [], held: [], refused: [] };
    if (!mailAccounts(first.binding).length) {
      const waiting = pending(first);
      return { status: 'skipped', reason: 'no_mail_account', pending: waiting.map(n => n.notice_id), receipts: [], refused: [], held: waiting.map(n => ({ notice_id: n.notice_id, recipient_id: n.recipient_id, reason: 'no_mail_account' })) };
    }
    const checks = await validate(first);
    if (!checks) return halted();
    const sync = async () => {
      const valid = sessions.filter(s => checks.get(s).status === 'ok');
      const c = await align([mendwell, ...valid.map(s => s.mail)]);
      for (const i of c.failed) if (i > 0) checks.set(valid[i - 1], { status: 'invalid', reason: 'clock_unaligned' });
      return c;
    };
    const { clock, base } = await publishLock(async () => ({ clock: await sync(), base: await source() }));
    if (clock.failed.includes(0) || !clock.virtual_now) return { status: 'unaligned', clock, receipts: [], held: [], refused: [] };
    if (!seeded(base)) return { status: 'invalid_snapshot', reason: 'no_initial_data', clock, receipts: [], held: [], refused: [] };
    const moved = now => now.epoch !== base.epoch || now.run_id !== base.run_id || !same(now.binding, base.binding);
    if (moved(first)) return { status: 'source_changed', clock, receipts: [], held: [], refused: [] };
    const usable = s => (configured.has(s) ? configured.get(s) : checks.get(s).status === 'ok' ? true : checks.get(s).reason);
    const held = [], refused = [], receipts = [];
    for (const entry of pending(base)) {
      const step = await publishLock(async () => {
        const latest = await sync();
        const now = await source();
        if (!seeded(now)) return { invalid: true };
        if (moved(now)) return { changed: now };
        if (Date.parse(now.virtual_now) !== Date.parse(latest.virtual_now)) return { unaligned: latest };
        const entryNow = pending(now).find(n => n.notice_id === entry.notice_id);
        if (!entryNow || !same(entryNow, entry)) return { reason: 'entry_changed' };
        const r = route(now, sessions, entryNow, usable);
        if (['access_changed', 'no_mail_account', 'no_email_grant'].includes(r.reason)) return { reason: r.reason };
        const wire = message(now, entryNow);
        const candidates = mailAccounts(now.binding, entryNow.recipient_id).flatMap(a => sessions.filter(x => x.account_id === a.account_id && granted(x)));
        const key = destinationKey(now.run_id, wire.source, wire.id);
        let target = destinations.get(key) || null;
        if (!target && candidates.length > 1) {
          for (const other of candidates) {
            if (r.session && other === r.session) continue;
            let snap = null;
            try { snap = (await ask(other.mail, 'env.snapshot')).snapshot; } catch (e) { return { reason: 'destination_unknown' }; }
            const prior = eventId({ run_id: now.run_id, source: wire.source, message_id: wire.id, account_id: other.account_id, epoch: snap.epoch });
            if (snap.run_id === now.run_id && snap.data.messages.some(m => m.id === prior)) { target = other.account_id; break; }
          }
        }
        let chosen = r.session || null;
        if (target) {
          chosen = candidates.find(x => x.account_id === target && usable(x) === true) || null;
          if (!chosen) return { reason: 'destination_unavailable' };
        }
        if (!chosen) return { reason: r.reason };
        const fresh = !destinations.has(key);
        destinations.set(key, chosen.account_id);
        let receipt = null, error = null;
        try { receipt = await ask(chosen.router, 'router.publish', { request_id: wire.id, message: wire }); } catch (e) { error = String(e && e.message); }
        if (error === null && answered(receipt)) return { session: chosen, wire, key, fresh, receipt };
        const setup = checks.get(chosen).receiver, expected = eventId({ run_id: now.run_id, source: wire.source, message_id: wire.id, account_id: chosen.account_id, epoch: setup.epoch });
        const [code, state] = error === null ? verdict(receipt) : ['publish_unconfirmed', 'unknown'];
        await haltNow({ code, status: state, notice_id: entryNow.notice_id, account_id: chosen.account_id, source: wire.source, message_id: wire.id, event_id: receipt && typeof receipt.event_id === 'string' ? receipt.event_id : null, expected_event_id: expected, receiver: setup, ...(error === null ? {} : { error }) });
        const settled = await settleDispatch(chosen, setup, expected, error !== null);
        return { session: chosen, wire, key, fresh, receipt, ...(error === null ? {} : { error }), settled };
      });
      if (step.invalid) return { status: 'invalid_snapshot', reason: 'no_initial_data', clock, receipts, held, refused };
      if (step.changed) return { status: 'source_changed', epoch: step.changed.epoch, clock, receipts, held, refused };
      if (step.unaligned) return { status: 'unaligned', clock: step.unaligned, receipts, held, refused };
      if (step.reason) { held.push({ notice_id: entry.notice_id, recipient_id: entry.recipient_id, reason: step.reason }); continue; }
      const { session, wire } = step, receipt = step.receipt && typeof step.receipt === 'object' ? step.receipt : null;
      const setup = checks.get(session).receiver;
      receipts.push({ notice_id: entry.notice_id, recipient_id: entry.recipient_id, account_id: session.account_id, message_id: wire.id, receipt: step.receipt });
      const expected = eventId({ run_id: base.run_id, source: wire.source, message_id: wire.id, account_id: session.account_id, epoch: setup.epoch });
      const outcome = { notice_id: entry.notice_id, account_id: session.account_id, source: wire.source, message_id: wire.id, event_id: (receipt && typeof receipt.event_id === 'string' && receipt.event_id) || null, expected_event_id: expected, receiver: setup };
      const end = async (code, state) => {
        const cause = await stop({ code, status: state, ...outcome, ...(step.error ? { error: step.error } : {}), ...(step.settled ? { settled: step.settled } : {}) });
        return { status: state, code, stopped_at: entry.notice_id, ...outcome, halted: true, stop_verified: cause.stop_verified, ...(step.settled ? { settled: step.settled } : {}), clock, receipts, held, refused };
      };
      if (receipt && receipt.stop_run === true) return end(...verdict(receipt));
      if (receipt && receipt.status === 'committed') {
        const ok = receipt.event_id === expected && receipt.run_id === base.run_id && receipt.target && receipt.target.app_id === 'mail' && receipt.target.account_id === session.account_id
          && receipt.cloud_event && receipt.cloud_event.id === wire.id && receipt.cloud_event.source === wire.source && (receipt.duplicate === undefined || receipt.duplicate === true);
        if (ok) continue;
        return end('receipt_mismatch', 'unknown');
      }
      if (receipt && ['rejected', 'permission_denied'].includes(receipt.status) && PRE_DISPATCH.has(receipt.code)) {
        refused.push({ notice_id: entry.notice_id, account_id: session.account_id, code: receipt.code });
        if (step.fresh && destinations.get(step.key) === session.account_id) destinations.delete(step.key);
        if (receipt.code === 'incompatible_contract') configured.set(session, 'incompatible_contract');
        continue;
      }
      return end('publish_unconfirmed', 'unknown');
    }
    return { status: refused.length ? 'partial' : 'published', clock, receipts, held, refused };
  }

  async function settle(outcome) {
    const session = sessions.find(s => built.has(s) && s.account_id === outcome?.account_id);
    const result = session ? await reconcile({ mail: session.mail, setup: outcome.receiver, outcome }) : { status: 'indeterminate', reason: 'no_receiver', event_id: outcome?.event_id ?? null, account_id: outcome?.account_id ?? null };
    reconciliation = result;
    return result;
  }

  const ready = runKey().then(() => undefined, () => undefined);
  return { ready, send: () => passes('send', pass), align: () => passes('align', clocks), reconcile: outcome => passes('reconcile', () => settle(outcome)), exclusive, status };
}

module.exports = { APP, CHANNEL, CONTRACT, namespace, eventId, digest, message, pending, eligible, route, mailAccounts, sessionConfigs, receiver, openSession, align, reconcile, create };
