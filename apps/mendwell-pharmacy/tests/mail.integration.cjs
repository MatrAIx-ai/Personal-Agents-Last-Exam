'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const argv = process.argv.slice(2);
const option = (name, fallback) => { const i = argv.lastIndexOf(name); return i >= 0 ? argv[i + 1] : fallback; };
const appDir = path.resolve(__dirname, '..');
const runtimeSource = path.resolve(option('--runtime', process.env.PALE_RUNTIME_ROOT || path.join(appDir, '..', '..', 'runtime')));
const mailSource = path.resolve(option('--with', path.join(path.dirname(runtimeSource), 'examples', 'apps', 'mail')));
const reportFile = option('--report', null);
const sender = require('../infra/sender.cjs');
const { compile } = require('./schema-validator.cjs');
const { householdSeed, only } = require('./seeds.cjs');
const fixtureBinding = require('../fixtures/binding.json');

const checks = [];
const check = (name, ok) => { assert.ok(ok, name); checks.push({ name, status: 'passed' }); };
const equal = (name, actual, expected) => { assert.deepEqual(actual, expected, name); checks.push({ name, status: 'passed' }); };
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const ms = Date.parse;
const NOW = '2026-11-30T09:00:00-05:00';
const LOADED = '2026-11-30T08:30:00-05:00';
const MAIL_LOADED = '2026-11-20T08:00:00-05:00';
const MAIL = [{ app_id: 'mail', account_id: 'mail-p-1', owner_person_id: 'p-1' }, { app_id: 'mail', account_id: 'mail-p-2', owner_person_id: 'p-2' }];
const HOLD = ['fill.hold_placed', '2026-11-30T09:10:00-05:00', { fill_id: 'f-31', note: 'Pharmacist review' }];
const DOWNGRADE = [['grant.changed', { grant_id: 'g-2', status: 'revoked' }], ['grant.changed', { grant_id: 'g-9', patient_id: 'p-1', grantor_id: 'p-1', grantee_id: 'p-2', scope: 'pickup', fill_id: null, expires_at: null, status: 'active' }]];
const omit = (o, key) => { const { [key]: gone, ...rest } = o; return rest; };

function dailySeed() {
  const s = only(householdSeed(), ['f-5', 'f-31']);
  s.seed_id = 'mendwell-mail-1';
  const f = s.fills.find(x => x.fill_id === 'f-31');
  s.notices.push({ notice_id: 'n-1', kind: 'notice.fill_ready', recipient_id: 'p-1', audience: 'full', subject: { type: 'fill', id: 'f-31' }, at: f.ready_at, title: 'Fill ready for pickup', body: 'Fill f-31 is ready.', fields: { fill_id: 'f-31', store_id: 'st-1', state: 'ready', amount_due_cents: 1000 } });
  s.issued.n = 1;
  return s;
}

function voidSeed() {
  const s = only(householdSeed(), ['f-5']);
  s.seed_id = 'mendwell-mail-2';
  s.grants.find(g => g.grant_id === 'g-1').scope = 'view';
  s.authorizations.push({ authorization_id: 'au-1', fill_id: 'f-5', card_id: 'card-1', amount_cents: 1200, state: 'live', at: '2026-11-29T13:00:00-05:00', ended_at: null });
  Object.assign(s.fills.find(f => f.fill_id === 'f-5'), { authorization_id: 'au-1', warned_at: '2026-12-06T12:00:00-05:00', warning_due_at: null });
  s.issued.au = 1;
  return s;
}

function stage(root) {
  fs.cpSync(runtimeSource, path.join(root, 'runtime'), { recursive: true });
  const core = path.join(root, 'runtime/core/mcp.cjs'), anchor = "let result,diagnostic;", arm = JSON.stringify(path.join(root, 'receiver-hold.arm'));
  const code = fs.readFileSync(core, 'utf8');
  assert.equal(code.split(anchor).length, 2, 'Core tool-call anchor found once');
  fs.writeFileSync(core, code.replace(anchor, anchor + "{const arm=" + arm + ";if(p.name==='env.apply_event'&&clientName==='pale-router-receiver'&&fs.existsSync(arm)&&dir.includes(fs.readFileSync(arm,'utf8'))){fs.writeFileSync(arm+'.pid',String(process.pid));fs.unlinkSync(arm);process.kill(process.pid,'SIGSTOP');}}"));
  fs.cpSync(appDir, path.join(root, 'apps', 'mendwell-pharmacy'), { recursive: true });
  fs.cpSync(mailSource, path.join(root, 'apps', 'mail'), { recursive: true });
  const mail = read(path.join(mailSource, 'app.json'));
  fs.writeFileSync(path.join(root, 'registry.mail.json'), JSON.stringify({ schema_version: 1, apps: [{ app_id: 'mail', version: mail.version, path: 'apps/mail' }], initial_time: read(path.join(mailSource, 'fixtures/clock.json')).initial_time }));
}

async function main(root, opened) {
  const runtimeDir = path.join(root, 'runtime');
  const { prepare } = require(path.join(runtimeDir, 'prepare.cjs'));
  const { Client } = require(path.join(runtimeDir, 'client.cjs'));
  const { create: createRouter } = require(path.join(runtimeDir, 'messaging', 'src', 'router.cjs'));
  equal('Mail 1.3.0 is the receiver', read(path.join(mailSource, 'app.json')).version, '1.3.0');
  equal('The package wire schema is byte-identical to the runtime contract', fs.readFileSync(path.join(appDir, 'schemas/router-message.schema.json')), fs.readFileSync(path.join(runtimeSource, 'contracts/schemas/router-message.schema.json')));
  equal('The package wire schema is byte-identical to Mail\'s receive schema', fs.readFileSync(path.join(appDir, 'schemas/router-message.schema.json')), fs.readFileSync(path.join(mailSource, 'schemas/router-message.schema.json')));
  const payloadValid = compile(read(path.join(mailSource, 'schemas/email-payload.schema.json')), path.join(mailSource, 'schemas'));

  const prepared = prepare(path.join(root, 'apps', 'mendwell-pharmacy'));
  opened.prepared = prepared;
  const track = async c => { opened.clients.push(c); await c.initialize(); return c; };
  const stateOf = run => path.join(root, 'state', run);
  const stopFile = run => path.join(stateOf(run), run, 'router.halted.json');
  const mendwellClient = run => track(new Client(prepared.app, 'infra', run, path.join(prepared.root, 'state'), 'mendwell-mail-check', { registry: prepared.registry }));
  const mailClient = (role, run, dir) => track(new Client('mail', role, run, dir, 'mendwell-mail-' + role, { registry: path.join(root, 'registry.mail.json') }));
  const baseConfig = accounts => { const c = read(path.join(appDir, 'infra/router.config.example.json')); c.registry = 'registry.mail.json'; c.publishers[0].allowed_recipients = accounts.map(a => ({ app_id: 'mail', account_id: a.account_id, channel: 'channel.email' })); return c; };
  const configFile = (run, name, c) => { const file = path.join(root, run + '-' + name + '-router.json'); fs.writeFileSync(file, JSON.stringify(c)); return file; };
  const routerService = (run, name, c) => track(new Client(null, null, null, null, 'mendwell-router', { commandArgs: [path.join(runtimeDir, 'messaging/service.cjs'), '--config', configFile(run, name, c), '--publisher', 'mendwell-pharmacy', '--run', run, '--state-dir', stateOf(run)] }));
  const routerInProcess = async (run, name, c) => { const r = await createRouter({ config: configFile(run, name, c), publisher: 'mendwell-pharmacy', run, stateDir: stateOf(run) }); opened.routers.push(r); return r; };

  const loadMail = async (run, account, dir) => {
    const infra = await mailClient('infra', run, dir);
    const dataset = read(path.join(mailSource, 'contribution/dataset.json'));
    dataset.dataset_id = 'mendwell-mail-fixture';
    dataset.expected_counts = { records: 0, assets: 0 };
    const bundle = { dataset, catalog: { schema_version: 'pale.asset-catalog.v1', catalog_id: 'mendwell-mail-empty', app_id: 'mail', dataset_ref: 'dataset.json', assets: [], extensions: [] }, blobs: {} };
    const before = await infra.call('env.snapshot');
    const loaded = await infra.call('env.load_seed', {
      expected_version: before.version, request_id: 'mendwell-mail-load', bundle, virtual_now: MAIL_LOADED,
      data: { account_id: account.account_id, owner_person_id: account.owner_person_id, address: account.account_id + '@pale.example', messages: [] },
      binding: { people: fixtureBinding.people.filter(p => p.person_id === account.owner_person_id), accounts: [account], objects: {} },
      policies: read(path.join(mailSource, 'fixtures/policies.json')),
    });
    assert.equal(loaded.status, 'ready', JSON.stringify(loaded));
    const agent = await mailClient('agent', run, dir);
    const snapshot = async () => (await infra.call('env.snapshot')).snapshot;
    return {
      account, infra, agent,
      records: async () => (await snapshot()).data.messages,
      now: async () => (await snapshot()).virtual_now,
      reset: async () => assert.equal((await infra.call('env.reset', { expected_version: (await infra.call('env.snapshot')).version })).status, 'ready'),
    };
  };

  const loadMendwell = async (run, seed, at, accounts) => {
    const infra = await mendwellClient(run);
    const binding = structuredClone(fixtureBinding);
    binding.accounts.push(...accounts);
    const loaded = await infra.call('env.load_seed', { expected_version: (await infra.call('env.snapshot')).version, data: seed, binding, virtual_now: at, request_id: run + '-seed' });
    assert.equal(loaded.status, 'ready', JSON.stringify(loaded));
    let n = 0;
    const snapshot = async () => (await infra.call('env.snapshot')).snapshot;
    const version = async () => (await infra.call('env.snapshot')).version;
    const event = async (operation, when, payload) => {
      const out = await infra.call('env.apply_event', { expected_version: await version(), event: { event_id: run + '-e' + (++n), at: when, operation, payload } });
      assert.equal(out.status, 'committed', JSON.stringify(out));
      return out;
    };
    const reset = async () => assert.equal((await infra.call('env.reset', { expected_version: await version() })).status, 'ready');
    return { infra, snapshot, version, event, reset, now: async () => (await snapshot()).virtual_now };
  };

  const within = (adapter, ms = 40000) => ({ ...adapter, send: async () => { let timer = null; try { return await Promise.race([adapter.send(), new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('adapter.send() did not return within ' + ms + ' ms')), ms); })]); } finally { clearTimeout(timer); } } });
  const openRun = async (run, { seed, at = NOW, accounts = MAIL, withMail = true, inProcess = false, configure = (account, c) => c, wrapRouter = (account, router) => router, wrapMail = (account, mail) => mail, onHalt } = {}) => {
    const m = await loadMendwell(run, seed, at, withMail ? accounts : []);
    const mails = [], sessions = [];
    for (const account of accounts) {
      sessions.push(await sender.openSession({
        run, stateDir: stateOf(run), account, config: baseConfig(accounts),
        openMail: async ({ stateDir, namespace }) => { const x = await loadMail(run, account, path.join(stateDir, namespace)); mails.push(x); return wrapMail(account.account_id, x.infra); },
        openRouter: async ({ config, namespace }) => { const c = configure(account.account_id, config); return wrapRouter(account.account_id, inProcess ? await routerInProcess(run, namespace, c) : await routerService(run, namespace, c)); },
      }));
    }
    const stop = onHalt || (cause => fs.writeFileSync(stopFile(run), JSON.stringify({ status: cause.status, code: cause.code, run_id: run, stop_run: true }), { mode: 0o600 }));
    return { run, m, mails, setups: sessions.map(x => x.receiver), configs: sender.sessionConfigs(baseConfig(accounts)), sessions, onHalt: stop, adapter: within(sender.create({ mendwell: m.infra, sessions, onHalt: stop })) };
  };
  const halted = async session => (await session.router.call('router.capabilities', {})).halted;
  const counts = async r => Promise.all(r.mails.map(async x => (await x.records()).length));
  const rows = list => list.map(x => [x.notice_id, x.account_id, x.receipt.status]);
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const unlocked = async fn => { for (let i = 0; ; i++) { try { return await fn(); } catch (e) { if (i >= 50 || !/-32001/.test(String(e && e.message))) throw e; await pause(100); } } };
  const routerAudit = run => fs.readFileSync(path.join(stateOf(run), run, 'messaging.receipts.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const slowRegistry = (name, ms = 7500) => {
    const dir = path.join(root, 'apps', 'mail-slow-' + name), file = path.join(dir, 'src/messaging.cjs'), hook = 'function receiveNotification(ctx,data,event){';
    fs.cpSync(path.join(root, 'apps', 'mail'), dir, { recursive: true });
    const code = fs.readFileSync(file, 'utf8');
    assert.ok(code.includes(hook), 'Mail receive hook found');
    fs.writeFileSync(file, code.replace(hook, hook + "const marker=require('node:path').join(__dirname,'..','slow-once.marker');if(!require('node:fs').existsSync(marker)){require('node:fs').writeFileSync(marker,'');" + (ms === 'stop' ? "process.kill(process.pid,'SIGSTOP');" : "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0," + ms + ");") + "}"));
    const registry = 'registry.mail-slow-' + name + '.json';
    fs.writeFileSync(path.join(root, registry), JSON.stringify({ ...read(path.join(root, 'registry.mail.json')), apps: [{ app_id: 'mail', version: read(path.join(dir, 'app.json')).version, path: 'apps/mail-slow-' + name }] }));
    return registry;
  };
  const slowFor = (name, registry) => (account, c) => (account === name ? { ...c, registry } : c);
  const wrapWith = fn => (account, router) => ({ definitions: router.definitions, request: typeof router.request === 'function' ? (...a) => router.request(...a) : undefined, child: router.child, call: (name, args) => fn(account, name, args, router) });

  {
    const r = await openRun('mail-ok', { seed: dailySeed(), at: LOADED });
    const [one, two] = r.mails;
    equal('Each Mail account\'s seed and binding were loaded and checked before its Router session started', r.setups.map(s => [s.status, s.account_id, s.owner_person_id, s.run_id]), [['ok', 'mail-p-1', 'p-1', 'mail-ok'], ['ok', 'mail-p-2', 'p-2', 'mail-ok']]);
    equal('One Router session per recipient Mail account, each with its own grant and a digest namespace shared by its Mail state', r.configs.map(c => [c.config.receiver_state_namespace, c.config.publishers[0].allowed_recipients.map(g => g.account_id), fs.existsSync(path.join(stateOf(r.run), c.namespace, r.run))]), MAIL.map(a => [sender.namespace(a.account_id), [a.account_id], true]));
    equal('Both sessions share one Router state directory and run, one session file each', fs.readdirSync(path.join(stateOf(r.run), r.run)).filter(f => f.endsWith('.session')).length, 2);
    await r.m.event(...HOLD);
    await r.m.event('fill.collection_attempted', '2026-11-30T09:15:00-05:00', { fill_id: 'f-5', collector_id: 'p-4' });
    const s = await r.m.snapshot();
    const waiting = sender.pending(s);
    equal('Only entries appended in the current epoch are pending, not the seeded history', waiting.map(n => [n.notice_id, n.kind, n.recipient_id, n.audience]), [
      ['n-2', 'notice.held', 'p-1', 'full'], ['n-3', 'notice.held', 'p-2', 'full'],
      ['n-4', 'notice.refused', 'p-2', 'full'], ['n-5', 'notice.refused', 'p-4', 'full'], ['n-6', 'notice.refused', 'p-1', 'logistics']]);
    for (const n of waiting) check('Payload for ' + n.notice_id + ' (' + n.kind + ', ' + n.audience + ') matches the Mail payload schema', payloadValid(sender.message(s, n).data));
    const before = await r.m.version();
    const out = await r.adapter.send();
    equal('Each routed entry is published in log order through its recipient\'s own session and committed there', [out.status, out.receipts.map(x => [x.notice_id, x.account_id, x.receipt.status, x.receipt.target.account_id, x.receipt.run_id])], ['published', [
      ['n-2', 'mail-p-1', 'committed', 'mail-p-1', 'mail-ok'], ['n-3', 'mail-p-2', 'committed', 'mail-p-2', 'mail-ok'], ['n-4', 'mail-p-2', 'committed', 'mail-p-2', 'mail-ok'], ['n-6', 'mail-p-1', 'committed', 'mail-p-1', 'mail-ok']]]);
    equal('An entry without exactly one eligible route stays in the log', [out.held, out.refused], [[{ notice_id: 'n-5', recipient_id: 'p-4', reason: 'no_mail_account' }], []]);
    const audit = () => fs.readFileSync(path.join(stateOf(r.run), r.run, 'messaging.receipts.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    const expectedIds = ['n-2', 'n-3', 'n-4', 'n-6'].map(id => 'e' + s.epoch + '-' + id);
    equal('The Router audit shows each request ID and CloudEvents ID built from the Mendwell epoch and the notice ID', audit().map(a => [a.request_id, a.cloud_event.id, a.cloud_event.source, a.result.status]), expectedIds.map(id => [id, id, 'urn:pale:app:mendwell-pharmacy:account:mendwell-p-2', 'committed']));
    equal('Both Mail clocks were advanced with env.advance_time to Mendwell\'s time before delivery', [out.clock.advanced, ms(await one.now()), ms(await two.now())], [[1, 2], ms(s.virtual_now), ms(s.virtual_now)]);
    const entry = id => waiting.find(n => n.notice_id === id);
    const byReceipt = x => [x.receipt.event_id, 'inbox', entry(x.notice_id).title, entry(x.notice_id).body, s.virtual_now, x.message_id];
    equal('mail-p-1 holds its full hold notice and its logistics refusal, received at the aligned time', (await one.records()).map(m => [m.id, m.folder, m.subject, m.body, m.received_at, m.thread_id]), out.receipts.filter(x => x.account_id === 'mail-p-1').map(byReceipt));
    equal('mail-p-2 holds its full hold and refusal notices, received at the aligned time', (await two.records()).map(m => [m.id, m.folder, m.subject, m.body, m.received_at, m.thread_id]), out.receipts.filter(x => x.account_id === 'mail-p-2').map(byReceipt));
    check('The logistics refusal carries only fill, store and amount', !/atorvastatin|Elena|payment/.test(entry('n-6').body) && /f-5/.test(entry('n-6').body));
    const delivered = await one.agent.call('mail.get', { id: out.receipts[3].receipt.event_id });
    equal('The delivered notice reads back in Mail', [delivered.status, delivered.message.body, delivered.message.from], ['ok', entry('n-6').body, 'mendwell-pharmacy@pale.example']);
    equal('The receipt keeps the notice time as the CloudEvents time', out.receipts.map(x => x.receipt.cloud_event.time), out.receipts.map(x => entry(x.notice_id).at));
    equal('Publishing leaves Mendwell unchanged', await r.m.version(), before);
    const retry = await r.adapter.send();
    equal('An identical retry returns each original receipt unchanged, marked duplicate', retry.receipts.map(x => [x.account_id, x.receipt.duplicate, omit(x.receipt, 'duplicate')]), out.receipts.map(x => [x.account_id, true, x.receipt]));
    equal('A retry creates no second record', await counts(r), [2, 2]);
    const [p1, p2] = await Promise.all([r.adapter.send(), sender.create({ mendwell: r.m.infra, sessions: r.sessions, onHalt: r.onHalt }).send()]);
    equal('Two simultaneous passes on the run are serialized: both complete as duplicates and neither session halts', [p1.status, p2.status, p1.receipts.every(x => x.receipt.duplicate), p2.receipts.every(x => x.receipt.duplicate), await halted(r.sessions[0]), await halted(r.sessions[1]), await counts(r)], ['published', 'published', true, true, false, false, [2, 2]]);
    const kept = [await one.records(), await two.records()];
    await r.m.reset();
    equal('A Mendwell reset keeps both inboxes record for record', [await one.records(), await two.records()], kept);
    equal('The reset moves Mendwell\'s clock back to its loaded time, not the fixture clock', [ms(await r.m.now()), LOADED === NOW], [ms(LOADED), false]);
    const aligned = await r.adapter.align();
    equal('After the reset the lagging Mendwell clock is advanced to the Mail clocks', [aligned.status, aligned.advanced, ms(await r.m.now()), ms(await one.now()), ms(await two.now())], ['aligned', [0], ms(s.virtual_now), ms(s.virtual_now), ms(s.virtual_now)]);
    await r.m.event('fill.hold_placed', '2026-11-30T09:20:00-05:00', { fill_id: 'f-31', note: 'Second review' });
    const after = await r.adapter.send();
    const epoch = (await r.m.snapshot()).epoch;
    equal('After the reset each eligible inbox gets exactly one new message whose ID carries the new epoch', [epoch, after.status, after.receipts.map(x => [x.account_id, x.message_id, x.receipt.status]), await counts(r)], [s.epoch + 1, 'published', [['mail-p-1', 'e' + epoch + '-n-2', 'committed'], ['mail-p-2', 'e' + epoch + '-n-3', 'committed']], [3, 3]]);
    equal('The clocks agree at the new delivery', [ms(await one.now()), ms(await two.now())], [ms(await r.m.now()), ms(await r.m.now())]);
    equal('The earlier records are unchanged after the new delivery', [(await one.records()).slice(0, 2), (await two.records()).slice(0, 2)], kept);
  }
  {
    const accounts = [{ app_id: 'mail', account_id: 'mail:p-1', owner_person_id: 'p-1' }, { app_id: 'mail', account_id: 'mail.p-2', owner_person_id: 'p-2' }];
    const r = await openRun('mail-colon', { seed: dailySeed(), accounts });
    await r.m.event(...HOLD);
    const out = await r.adapter.send();
    equal('Account IDs with a colon or a dot get digest namespaces used by both their Mail state and their Router sessions, and both are delivered', [r.configs.map(c => c.config.receiver_state_namespace), accounts.map(a => fs.existsSync(path.join(stateOf(r.run), sender.namespace(a.account_id), r.run))), rows(out.receipts), await counts(r)], [accounts.map(a => sender.namespace(a.account_id)), [true, true], [['n-2', 'mail:p-1', 'committed'], ['n-3', 'mail.p-2', 'committed']], [1, 1]]);
  }
  {
    let fired = false, r;
    r = await openRun('mail-recheck', { seed: dailySeed(), wrapRouter: wrapWith(async (account, name, args, router) => {
      const result = await router.call(name, args);
      if (name === 'router.publish' && !fired) { fired = true; r.adapter.exclusive(async () => { for (const [op, payload] of DOWNGRADE) await r.m.event(op, '2026-11-30T09:16:00-05:00', payload); }); }
      return result;
    }) });
    await r.m.event(...HOLD);
    await r.m.event('fill.collection_attempted', '2026-11-30T09:15:00-05:00', { fill_id: 'f-5', collector_id: 'p-4' });
    const out = await r.adapter.send();
    equal('A downgrade to pickup queued while the first publish was in flight lands before the next check, and the full entry is not sent', [out.status, rows(out.receipts), out.held.map(h => [h.notice_id, h.reason])], ['published', [['n-2', 'mail-p-1', 'committed'], ['n-4', 'mail-p-2', 'committed'], ['n-6', 'mail-p-1', 'committed']], [['n-3', 'access_changed'], ['n-5', 'no_mail_account']]]);
    equal('The downgraded viewer\'s inbox has only the entry still covered by its remaining grant', (await r.mails[1].records()).map(m => m.thread_id), [out.receipts[1].message_id]);
  }
  {
    let fired = false, r;
    r = await openRun('mail-reset-between', { seed: dailySeed(), wrapRouter: wrapWith(async (account, name, args, router) => {
      const result = await router.call(name, args);
      if (name === 'router.publish' && !fired) { fired = true; await r.m.reset(); }
      return result;
    }) });
    await r.m.event(...HOLD);
    const adapter = r.adapter;
    const out = await adapter.send();
    const epoch = (await r.m.snapshot()).epoch;
    equal('A Mendwell reset between two publishes stops the pass before the next one', [out.status, out.epoch, rows(out.receipts), await counts(r)], ['source_changed', epoch, [['n-2', 'mail-p-1', 'committed']], [1, 0]]);
    const next = await adapter.send();
    equal('The new epoch has no pending entry, so nothing more is delivered and nothing halts', [next.status, next.receipts, await counts(r), adapter.status().status], ['published', [], [1, 0], 'ready']);
  }
  {
    const r = await openRun('mail-downgrade', { seed: voidSeed(), at: '2026-12-09T11:30:00-05:00' });
    await r.m.event('store.restocked', '2026-12-09T12:05:00-05:00', { store_id: 'st-2', drug_id: 'd-amoxicillin-250-5' });
    const s = await r.m.snapshot();
    equal('The return writes full entries for the viewer, a logistics entry for the pickup holder and the card owner\'s masked void', sender.pending(s).map(n => [n.notice_id, n.kind, n.recipient_id, n.audience]), [
      ['n-1', 'notice.returned', 'p-2', 'full'], ['n-2', 'notice.returned', 'p-4', 'full'], ['n-3', 'notice.returned', 'p-1', 'logistics'],
      ['n-4', 'notice.payment_voided', 'p-2', 'full'], ['n-5', 'notice.payment_voided', 'p-4', 'full'], ['n-6', 'notice.payment_voided', 'p-1', 'card_owner']]);
    await r.m.event('grant.changed', '2026-12-09T12:10:00-05:00', { grant_id: 'g-1', status: 'revoked' });
    await r.m.event('grant.changed', '2026-12-09T12:10:00-05:00', { grant_id: 'g-9', patient_id: 'p-4', grantor_id: 'p-4', grantee_id: 'p-2', scope: 'pickup', fill_id: null, expires_at: null, status: 'active' });
    await r.m.event('grant.changed', '2026-12-09T12:10:00-05:00', { grant_id: 'g-3', status: 'revoked' });
    const out = await r.adapter.send();
    equal('A viewer downgraded to pickup before dispatch gets no full-detail mail, and the card owner who lost pickup access keeps only the masked void', [out.status, out.held.map(h => [h.notice_id, h.reason]), rows(out.receipts)], ['published',
      [['n-1', 'access_changed'], ['n-2', 'no_mail_account'], ['n-3', 'access_changed'], ['n-4', 'access_changed'], ['n-5', 'no_mail_account']], [['n-6', 'mail-p-1', 'committed']]]);
    equal('The downgraded viewer\'s inbox stays empty', await counts(r), [1, 0]);
    const masked = (await r.mails[0].records())[0];
    equal('The masked void shows only the card, amount and void status', [masked.subject, masked.body], ['Payment voided', 'A prepayment of $12.00 on your card ending 2208 was voided.']);
    equal('The masked void\'s Mail source object is the notice itself', sender.message(s, sender.pending(s)[5]).data.source_object, { app_id: 'mendwell-pharmacy', account_id: 'mendwell-p-2', object_type: 'notice', object_id: 'n-6' });
  }
  {
    const a = await openRun('mail-foreign-a', { seed: dailySeed() });
    const b = await openRun('mail-foreign-b', { seed: dailySeed() });
    await a.m.event(...HOLD);
    await b.m.event('fill.hold_placed', '2026-12-01T09:00:00-05:00', { fill_id: 'f-31', note: 'Later run' });
    await b.adapter.align();
    const aBefore = await a.m.snapshot();
    const crossed = sender.create({ mendwell: a.m.infra, sessions: [b.sessions[0], Object.freeze({ ...a.sessions[1], router: b.sessions[1].router })], onHalt: a.onHalt });
    const out = await crossed.send();
    const aAfter = await a.m.snapshot();
    equal('A session built for another run and a hand-assembled session are refused before any clock alignment or publish', [out.status, out.held.map(h => [h.notice_id, h.reason]), out.receipts], ['published', [['n-2', 'session_not_in_run'], ['n-3', 'session_unverified']], []]);
    equal('Nothing reaches the other run\'s inboxes and the source clock keeps its own time', [await counts(a), await counts(b), aAfter.virtual_now, aAfter.epoch], [[0, 0], [0, 0], aBefore.virtual_now, aBefore.epoch]);
    let refused = null;
    try { await sender.openSession({ run: a.run, stateDir: stateOf(a.run), account: MAIL[0], config: baseConfig(MAIL), openMail: async () => a.mails[0].infra, openRouter: async () => b.sessions[0].router }); } catch (e) { refused = e.message; }
    check('A session is never built around another run\'s Router', /does not serve this publisher in run mail-foreign-a/.test(refused || ''));
  }
  {
    const r = await openRun('mail-ungranted', { seed: dailySeed(), configure: (account, c) => (account === 'mail-p-1' ? { ...c, publishers: c.publishers.map(p => ({ ...p, allowed_recipients: [] })) } : c) });
    await r.m.event(...HOLD);
    const known = sender.create({ mendwell: r.m.infra, sessions: [r.sessions[1]], onHalt: r.onHalt });
    const out = await known.send();
    equal('Without a granted session for one account its entry stays in the log while the other inbox still receives its own', [out.status, out.held, rows(out.receipts)], ['published', [{ notice_id: 'n-2', recipient_id: 'p-1', reason: 'no_email_grant' }], [['n-3', 'mail-p-2', 'committed']]]);
    const refused = await r.adapter.send();
    equal('A publish the Router does not authorize is refused before dispatch; the pass continues without halting', [refused.status, refused.refused, rows(refused.receipts), r.adapter.status().status], ['partial', [{ notice_id: 'n-2', account_id: 'mail-p-1', code: 'recipient_not_authorized' }], [['n-2', 'mail-p-1', 'rejected'], ['n-3', 'mail-p-2', 'committed']], 'ready']);
    equal('A refusal before dispatch creates no Mail record and leaves both sessions available', [await counts(r), await halted(r.sessions[0]), await halted(r.sessions[1])], [[0, 1], false, false]);
  }
  {
    const copy = path.join(root, 'apps', 'mendwell-incompatible');
    fs.cpSync(path.join(root, 'apps', 'mendwell-pharmacy'), copy, { recursive: true });
    const schemaFile = path.join(copy, 'schemas/router-message.schema.json');
    fs.writeFileSync(schemaFile, JSON.stringify({ ...read(schemaFile), description: 'A changed copy whose content no longer matches the receiver.' }, null, 2));
    const r = await openRun('mail-incompatible', { seed: dailySeed(), configure: (account, c) => (account === 'mail-p-1' ? { ...c, publishers: c.publishers.map(p => ({ ...p, package_root: 'apps/mendwell-incompatible' })) } : c) });
    await r.m.event(...HOLD);
    await r.m.event('fill.collection_attempted', '2026-11-30T09:15:00-05:00', { fill_id: 'f-5', collector_id: 'p-4' });
    const out = await r.adapter.send();
    equal('A session whose Router serves an incompatible contract is held before routing and the other account is still served', [out.status, r.sessions.map(x => x.contract === sender.CONTRACT), out.held.map(h => [h.notice_id, h.reason]), rows(out.receipts)], ['published', [false, true], [['n-2', 'incompatible_contract'], ['n-5', 'no_mail_account'], ['n-6', 'incompatible_contract']], [['n-3', 'mail-p-2', 'committed'], ['n-4', 'mail-p-2', 'committed']]]);
    equal('An incompatible contract creates no Mail record in its inbox and halts nothing', [await counts(r), r.adapter.status().status, await halted(r.sessions[0]), await halted(r.sessions[1])], [[0, 2], 'ready', false, false]);
    const accounts = [MAIL[0], { app_id: 'mail', account_id: 'mail-p-1-b', owner_person_id: 'p-1' }, MAIL[1]];
    const two = await openRun('mail-two-routes', { seed: dailySeed(), accounts, configure: (account, c) => (account === 'mail-p-1' ? { ...c, publishers: c.publishers.map(p => ({ ...p, package_root: 'apps/mendwell-incompatible' })) } : c) });
    await two.m.event(...HOLD);
    const routed = await two.adapter.send();
    equal('With two granted accounts for one person, the sole compatible route is used instead of being held as ambiguous', [routed.status, rows(routed.receipts), await counts(two)], ['published', [['n-2', 'mail-p-1-b', 'committed'], ['n-3', 'mail-p-2', 'committed']], [0, 1, 1]]);
    const viewer = [MAIL[0], MAIL[1], { app_id: 'mail', account_id: 'mail-p-2-b', owner_person_id: 'p-2' }];
    const masked = await openRun('mail-known-incompatible', { seed: dailySeed(), accounts: viewer, configure: (account, c) => (account === 'mail-p-2-b' ? { ...c, publishers: c.publishers.map(p => ({ ...p, package_root: 'apps/mendwell-incompatible' })) } : c) });
    await masked.m.event(...HOLD);
    masked.sessions[2].router.child.kill('SIGSTOP');
    const kept = await masked.adapter.send();
    masked.sessions[2].router.child.kill('SIGCONT');
    equal('A Router whose contract is known to be incompatible stays excluded while it is also unreachable, so the sole compatible inbox still gets the notice', [masked.sessions[2].contract === sender.CONTRACT, rows(kept.receipts).filter(x => x[0] === 'n-3'), await counts(masked)], [false, [['n-3', 'mail-p-2', 'committed']], [1, 1, 0]]);
  }
  {
    const calls = [];
    let r;
    r = await openRun('mail-reject', { seed: dailySeed(), wrapRouter: wrapWith(async (account, name, args, router) => {
      calls.push(account + ' ' + name);
      if (name !== 'router.publish' || account !== 'mail-p-1') return router.call(name, args);
      return router.call(name, { ...args, message: { ...args.message, id: args.message.id.split('-')[0] + '-' + 'x'.repeat(98) } });
    }) });
    await r.m.event(...HOLD);
    const s = await r.m.snapshot();
    const adapter = r.adapter;
    const before = await r.m.infra.call('env.snapshot');
    const out = await adapter.send();
    equal('A receiver rejection in one session stops the run and the adapter halts', [out.status, out.code, out.account_id, out.halted, adapter.status().status, adapter.status().cause?.code], ['rejected', 'receiver_rejected', 'mail-p-1', true, 'halted', 'receiver_rejected']);
    const wire = sender.message(s, sender.pending(s)[1]);
    equal('The other session then reports halted and refuses with run_halted', [await halted(r.sessions[1]), (await r.sessions[1].router.call('router.publish', { request_id: wire.id, message: wire })).code], [true, 'run_halted']);
    const made = calls.length;
    const again = await adapter.send();
    equal('The halted adapter refuses with run_halted without calling either Router', [again.status, again.code, calls.length], ['halted', 'run_halted', made]);
    const fresh = sender.create({ mendwell: r.m.infra, sessions: [r.sessions[1]], onHalt: r.onHalt });
    const mirrored = await fresh.send();
    equal('A fresh adapter for the run in the same Infra process refuses at once with the original cause', [mirrored.status, mirrored.code, fresh.status().status, fresh.status().cause?.code, fresh.status().cause?.stop_verified], ['halted', 'run_halted', 'halted', 'receiver_rejected', true]);
    const after = await r.m.infra.call('env.snapshot');
    equal('A receiver rejection creates no Mail record and leaves Mendwell\'s committed state', [await counts(r), after.snapshot.data, after.version], [[0, 0], before.snapshot.data, before.version]);
  }
  {
    const r = await openRun('mail-receiver-reset', { seed: dailySeed() });
    await r.m.event(...HOLD);
    assert.equal((await r.adapter.send()).status, 'published');
    await r.m.event('fill.hold_released', '2026-11-30T09:20:00-05:00', { fill_id: 'f-31', note: 'Review done' });
    await r.mails[0].reset();
    const out = await r.adapter.send();
    equal('A Mail reset is detected against the session\'s checked epoch before any clock change or publish, and the adapter halts every session', [out.status, r.adapter.status().cause?.code, r.adapter.status().cause?.observed, await r.mails[0].now(), await halted(r.sessions[0]), await halted(r.sessions[1])], ['halted', 'receiver_lifecycle_changed', 'adapter', MAIL_LOADED, true, true]);
    equal('After that stop the reset inbox stays empty and the other keeps only its earlier record', await counts(r), [0, 1]);
  }
  {
    const hooks = [];
    let r;
    r = await openRun('mail-receiver-reset-late', { seed: dailySeed(), onHalt: c => hooks.push(c.code), wrapRouter: wrapWith(async (account, name, args, router) => {
      if (name === 'router.publish' && account === 'mail-p-1') await r.mails[0].reset();
      return router.call(name, args);
    }) });
    await r.m.event(...HOLD);
    const adapter = r.adapter;
    const out = await adapter.send();
    equal('A Mail reset after the check and before dispatch is refused by the Router with receiver_lifecycle_changed, and the adapter halts on it', [out.status, out.code, out.stopped_at, out.halted, adapter.status().cause?.code, await halted(r.sessions[1]), await counts(r), hooks], ['rejected', 'receiver_lifecycle_changed', 'n-2', true, 'receiver_lifecycle_changed', true, [0, 0], []]);
  }
  {
    const lossy = () => { let drop = true; return wrapWith(async (account, name, args, router) => {
      const result = await router.call(name, args);
      if (name === 'router.publish' && drop) { drop = false; throw new Error('reply lost'); }
      return result;
    }); };
    const r = await openRun('mail-reply-lost', { seed: dailySeed(), wrapRouter: lossy() });
    await r.m.event(...HOLD);
    const adapter = r.adapter;
    const lost = await adapter.send();
    equal('A publish whose Router reply is lost is unknown and halts the adapter', [lost.status, lost.code, lost.account_id, lost.event_id, lost.halted, adapter.status().status], ['unknown', 'publish_unconfirmed', 'mail-p-1', null, true, 'halted']);
    equal('Infra\'s stop mechanism then halts every session of the run, and the adapter verifies it', [lost.stop_verified, await halted(r.sessions[0]), await halted(r.sessions[1]), (await adapter.send()).code, (await sender.create({ mendwell: r.m.infra, sessions: r.sessions, onHalt: r.onHalt }).send()).code], [true, true, true, 'run_halted', 'run_halted']);
    const reconciled = await adapter.reconcile(lost);
    const record = (await r.mails[0].records())[0];
    equal('Reconciliation finds the dispatched message by its ID in the dispatch epoch and reports committed', [reconciled.status, reconciled.event_id, record.thread_id, await counts(r)], ['committed', record.id, lost.message_id, [1, 0]]);
    equal('The run stays halted after reconciliation', [adapter.status().status, adapter.status().reconciliation.status, await halted(r.sessions[0]), await halted(r.sessions[1])], ['halted', 'committed', true, true]);
    let threw = null;
    try { sender.create({ mendwell: r.m.infra, sessions: r.sessions }); } catch (e) { threw = e.message; }
    check('Without a shared stop mechanism the adapter refuses to start', /shared stop mechanism/.test(threw || ''));
    const u = await openRun('mail-reply-lost-unverified', { seed: dailySeed(), wrapRouter: lossy(), onHalt: () => { throw new Error('stop file not writable'); } });
    await u.m.event(...HOLD);
    const unverified = await u.adapter.send();
    equal('When the stop mechanism fails the halt is reported unverified, never healthy', [unverified.code, unverified.stop_verified, u.adapter.status().status, u.adapter.status().cause.on_halt_error, u.adapter.status().cause.unhalted], ['publish_unconfirmed', false, 'halted', 'stop file not writable', ['mail-p-1', 'mail-p-2']]);
    const late = await sender.create({ mendwell: u.m.infra, sessions: u.sessions, onHalt: u.onHalt }).send();
    equal('A fresh adapter for that run in the same Infra process still refuses, so nothing more is published there', [late.status, late.code, await counts(u)], ['halted', 'run_halted', [1, 0]]);
  }
  {
    const accounts = [MAIL[0], { app_id: 'mail', account_id: 'mail-p-1-b', owner_person_id: 'p-1' }, MAIL[1]];
    const r = await openRun('mail-ambiguous', { seed: dailySeed(), accounts });
    await r.m.event(...HOLD);
    const [a, b] = r.sessions;
    const reasons = [];
    for (const paused of [null, a, null, b]) {
      if (paused) paused.router.child.kill('SIGSTOP');
      const out = await r.adapter.send();
      if (paused) paused.router.child.kill('SIGCONT');
      reasons.push(out.held.find(h => h.notice_id === 'n-2').reason);
    }
    const inbox = async i => (await r.mails[i].records()).map(m => m.thread_id);
    equal('With two granted inboxes for p-1, a Router unreachable for one pass, alternating, never turns the ambiguous entry into a delivery', [reasons, await inbox(0), await inbox(1), (await inbox(2)).length], [['ambiguous_route', 'ambiguous_route', 'ambiguous_route', 'ambiguous_route'], [], [], 1]);
    await r.mails[1].infra.close();
    const closed = await r.adapter.send();
    equal('A closed Mail client for one of them keeps the entry waiting too', [closed.held.find(h => h.notice_id === 'n-2').reason, await inbox(0)], ['destination_unknown', []]);
  }
  {
    const accounts = [MAIL[0], { app_id: 'mail', account_id: 'mail-p-1-b', owner_person_id: 'p-1' }, MAIL[1]];
    const r = await openRun('mail-pinned', { seed: dailySeed(), accounts });
    await r.m.event(...HOLD);
    const [a, b, c] = r.sessions;
    const first = await sender.create({ mendwell: r.m.infra, sessions: [a, c], onHalt: r.onHalt }).send();
    const both = await r.adapter.send();
    a.router.child.kill('SIGSTOP');
    const paused = await r.adapter.send();
    a.router.child.kill('SIGCONT');
    const back = await r.adapter.send();
    const inbox = async i => (await r.mails[i].records()).map(m => m.thread_id);
    const id = 'e' + (await r.m.snapshot()).epoch + '-n-2';
    equal('An entry sent while only one inbox had a session stays with that inbox once the second session exists', [rows(first.receipts).filter(x => x[0] === 'n-2'), rows(both.receipts).filter(x => x[0] === 'n-2'), both.receipts.find(x => x.notice_id === 'n-2').receipt.duplicate], [[['n-2', 'mail-p-1', 'committed']], [['n-2', 'mail-p-1', 'committed']], true]);
    equal('With that inbox\'s Router paused the retry waits instead of switching to the other inbox', [paused.held.find(h => h.notice_id === 'n-2').reason, rows(paused.receipts).filter(x => x[0] === 'n-2'), await inbox(1)], ['destination_unavailable', [], []]);
    equal('Once it is back the retry returns the original receipt; the notice exists in exactly one inbox', [back.receipts.find(x => x.notice_id === 'n-2').receipt.duplicate, await inbox(0), await inbox(1)], [true, [id], []]);
  }
  {
    const run = 'mail-resume';
    const m = await loadMendwell(run, dailySeed(), NOW, MAIL);
    const mails = [];
    const openMail = async ({ stateDir, namespace, account }) => { const x = await loadMail(run, account, path.join(stateDir, namespace)); mails.push(x); return x.infra; };
    let paused = null;
    const first = await sender.openSession({ run, stateDir: stateOf(run), account: MAIL[0], config: baseConfig(MAIL), attempts: 1, openMail, openRouter: async ({ config, namespace }) => { paused = await routerService(run, namespace, config); paused.child.kill('SIGSTOP'); return paused; } }).then(() => null, e => e);
    check('A Router discovery that times out returns a resumable setup instead of a stranded Router', Boolean(first && first.setup && first.setup.router === paused));
    let reopened = null;
    await sender.openSession({ run, stateDir: stateOf(run), account: MAIL[0], config: baseConfig(MAIL), openMail: async () => mails[0].infra, openRouter: async ({ config, namespace }) => routerService(run, namespace, config) }).catch(e => { reopened = e.message; });
    check('A second session for that account cannot be opened in the run', /Server exited|did not complete/.test(reopened || ''));
    paused.child.kill('SIGCONT');
    const resumed = await first.setup.resume();
    const other = await sender.openSession({ run, stateDir: stateOf(run), account: MAIL[1], config: baseConfig(MAIL), openMail, openRouter: async ({ config, namespace }) => routerService(run, namespace, config) });
    const stop = cause => fs.writeFileSync(stopFile(run), JSON.stringify({ status: cause.status, code: cause.code, run_id: run, stop_run: true }), { mode: 0o600 });
    await m.event(...HOLD);
    const out = await sender.create({ mendwell: m.infra, sessions: [resumed, other], onHalt: stop }).send();
    equal('Resuming the setup on the same Router delivers the pending notice', [resumed.router === paused, out.status, rows(out.receipts), (await mails[0].records()).length], [true, 'published', [['n-2', 'mail-p-1', 'committed'], ['n-3', 'mail-p-2', 'committed']], 1]);
  }
  {
    const r = await openRun('mail-disconnected', { seed: dailySeed() });
    await r.m.event(...HOLD);
    await r.sessions[0].router.close();
    const out = await r.adapter.send();
    equal('A disconnected Router fails discovery for its own session only; the other inbox is still served', [out.status, out.held.map(h => [h.notice_id, h.reason]), rows(out.receipts), r.adapter.status().status, await counts(r)], ['published', [['n-2', 'router_unavailable']], [['n-3', 'mail-p-2', 'committed']], 'ready', [0, 1]]);
  }
  {
    const stray = { app_id: 'mail', account_id: 'second-inbox', owner_person_id: 'p-1' };
    let strayRouter = null, strayMail = null;
    const r = await openRun('mail-misbound', { seed: dailySeed(), wrapRouter: (account, router) => (account === 'mail-p-1' && strayRouter ? strayRouter : router) });
    strayMail = await loadMail(r.run, stray, path.join(stateOf(r.run), sender.namespace(stray.account_id)));
    const [strayConfig] = sender.sessionConfigs(baseConfig([stray]));
    strayRouter = await routerService(r.run, strayConfig.namespace, strayConfig.config);
    const misbound = await sender.openSession({ run: r.run, stateDir: stateOf(r.run), account: MAIL[0], config: baseConfig(MAIL), openMail: async () => r.mails[0].infra, openRouter: async () => strayRouter });
    await r.m.event(...HOLD);
    const adapter = sender.create({ mendwell: r.m.infra, sessions: [misbound, r.sessions[1]], onHalt: r.onHalt });
    const out = await adapter.send();
    equal('A Router built for another inbox of the same owner cannot be seen before dispatch; its receipt is caught and every session halts', [out.status, out.code, out.stop_verified, (await strayMail.records()).length, await counts(r), await halted(r.sessions[1])], ['unknown', 'receipt_mismatch', true, 1, [0, 0], true]);
  }
  const lostAcknowledgement = async (run, afterLoss) => {
    const r = await openRun(run, { seed: dailySeed(), configure: slowFor('mail-p-1', slowRegistry(run)) });
    await r.m.event(...HOLD);
    const before = await r.m.infra.call('env.snapshot');
    const lost = await r.adapter.send();
    const present = (await unlocked(() => r.mails[0].records())).some(m => m.id === lost.expected_event_id);
    await afterLoss(r);
    const reconciled = await r.adapter.reconcile(lost);
    const s = await r.m.snapshot();
    const wire = sender.message(s, sender.pending(s)[1]);
    const other = await r.sessions[1].router.call('router.publish', { request_id: wire.id, message: wire });
    const routed = routerAudit(run).find(a => a.cloud_event && a.cloud_event.id === lost.message_id);
    return { r, lost, present, reconciled, before, routed, after: await r.m.infra.call('env.snapshot'), again: await r.adapter.send(), other, otherHalted: await halted(r.sessions[1]) };
  };
  {
    const x = await lostAcknowledgement('mail-lost', async () => {});
    const id = x.lost.expected_event_id;
    equal('Through a spawned Router whose receiver replies after the acknowledgement deadline, the Router records the receiver\'s acknowledgement as lost', [x.routed.result.status, x.routed.result.code, x.routed.result.event_id, x.routed.result.stop_run], ['unknown', 'receiver_unconfirmed', id, true]);
    check('The adapter reports the publish as unknown and halts, and verifies the halt only once Mail holds the late receive', x.lost.status === 'unknown' && ['publish_unconfirmed', 'receiver_unconfirmed'].includes(x.lost.code) && x.lost.halted === true && x.lost.account_id === 'mail-p-1' && x.lost.stop_verified === true && x.present && (x.lost.settled || {}).mail === 'committed');
    equal('Reconciliation by the derived event ID in the dispatch run, account and epoch reports committed only because the receipt and the record agree', x.reconciled, { status: 'committed', event_id: id, record_id: id, account_id: 'mail-p-1', epoch: x.lost.receiver.epoch });
    equal('The lost publish left exactly one record, in mail-p-1 only', [(await x.r.mails[0].records()).map(m => [m.id, m.thread_id]), (await x.r.mails[1].records()).length], [[[id, x.lost.message_id]], 0]);
    equal('The other session reports halted and refuses with run_halted', [x.otherHalted, x.other.status, x.other.code], [true, 'halted', 'run_halted']);
    equal('The run stays halted after reconciliation', [x.again.status, x.again.code, x.r.adapter.status().status, x.r.adapter.status().reconciliation.status], ['halted', 'run_halted', 'halted', 'committed']);
    equal('Mendwell stays committed after an unknown acknowledgement', [x.after.snapshot.data, x.after.version], [x.before.snapshot.data, x.before.version]);
    const probe = async (mail, outcome) => (await sender.reconcile({ mail, setup: x.lost.receiver, outcome })).reason;
    equal('Reconciliation is never committed for another event ID, another message, another publisher or another account', [await probe(x.r.mails[0].infra, { ...x.lost, event_id: 'router-' + '0'.repeat(32) }), await probe(x.r.mails[0].infra, { ...x.lost, event_id: null, message_id: 'e9-n-99' }), await probe(x.r.mails[0].infra, { ...x.lost, event_id: null, source: 'urn:pale:app:mendwell-pharmacy:account:mendwell-p-9' }), await probe(x.r.mails[1].infra, x.lost)], ['event_id_mismatch', 'not_found', 'not_found', 'receiver_changed']);
  }
  {
    const x = await lostAcknowledgement('mail-lost-reset', async r => { await r.mails[0].reset(); });
    equal('After a receiver reset the unknown outcome reconciles as indeterminate, never committed', [x.lost.status, x.reconciled.status, x.reconciled.reason, x.again.status], ['unknown', 'indeterminate', 'receiver_changed', 'halted']);
  }
  {
    const r = await openRun('mail-lock', { seed: dailySeed(), configure: slowFor('mail-p-1', slowRegistry('mail-lock')) });
    await r.m.event(...HOLD);
    await r.adapter.align();
    const s = await r.m.snapshot();
    const [a, b] = sender.pending(s).map(n => sender.message(s, n));
    const first = r.sessions[0].router.call('router.publish', { request_id: a.id, message: a }).then(x => x, e => ({ thrown: String(e && e.message) }));
    await pause(1000);
    const rb = await r.sessions[1].router.call('router.publish', { request_id: b.id, message: b });
    const ra = await first;
    equal('Across spawned Router sessions the shared lock admits one dispatch at a time: while A is held by its receiver, B is refused with concurrent_dispatch and the run stops', [rb.status, rb.code, rb.stop_run, /timed out/.test(ra.thrown || '')], ['rejected', 'concurrent_dispatch', true, true]);
    equal('After a concurrent dispatch both sessions report halted, the adapter refuses, and the other inbox gets nothing', [await halted(r.sessions[0]), await halted(r.sessions[1]), (await r.adapter.send()).status, (await r.mails[1].records()).length], [true, true, 'halted', 0]);
  }
  {
    let r, paused = false, resumedAt = 0, revokedAt = 0;
    r = await openRun('mail-timeout', { seed: dailySeed(), wrapRouter: wrapWith(async (account, name, args, router) => {
      if (name === 'router.publish' && !paused && args.message.id.endsWith('-n-3')) {
        paused = true;
        router.child.kill('SIGSTOP');
        r.adapter.exclusive(async () => { revokedAt = Date.now(); await r.m.event('grant.changed', '2026-11-30T09:11:00-05:00', { grant_id: 'g-2', status: 'revoked' }); });
        setTimeout(() => { resumedAt = Date.now(); router.child.kill('SIGCONT'); }, 14000);
      }
      return router.call(name, args);
    }) });
    await r.m.event(...HOLD);
    const out = await r.adapter.send();
    await r.adapter.exclusive(async () => {});
    const routed = routerAudit(r.run).filter(a => a.cloud_event && /-n-3$/.test(a.cloud_event.id));
    const grant = (await r.m.snapshot()).data.grants.find(g => g.grant_id === 'g-2');
    equal('A publish whose Router request times out halts at once, before any probe, and its outcome is unknown', [out.status, out.code, out.stopped_at, out.halted, out.stop_verified], ['unknown', 'publish_unconfirmed', 'n-3', true, true]);
    equal('The delayed request reaches a halted Router and is refused, so the revoked viewer gets nothing', [routed.map(a => [a.result.status, a.result.code]), (await r.mails[1].records()).filter(m => /-n-3$/.test(m.thread_id))], [[['halted', 'run_halted']], []]);
    check('The queued revocation commits only after the Router settled the delayed request', resumedAt > 0 && revokedAt > resumedAt && grant.status === 'revoked');
  }
  const mailState = (run, account) => read(path.join(stateOf(run), sender.namespace(account), run, 'mail.json'));
  const slowViewer = async (run, { inProcess = false, kill = false } = {}) => {
    let r, queued = false, before = null;
    const inbox = () => mailState(run, 'mail-p-2').data.messages.filter(m => /-n-3$/.test(m.thread_id)).map(m => m.id);
    const wrap = wrapWith(async (account, name, args, router) => {
      if (name === 'router.publish' && !queued && args.message.id.endsWith('-n-3')) {
        queued = true;
        r.adapter.exclusive(async () => { before = inbox(); await r.m.event('grant.changed', '2026-11-30T09:11:00-05:00', { grant_id: 'g-2', status: 'revoked' }); });
        if (kill) setTimeout(() => { for (const pid of descendants(router.child.pid)) opened.pids.add(pid); router.child.kill('SIGKILL'); }, 2000);
      }
      return router.call(name, args);
    });
    r = await openRun(run, { seed: dailySeed(), inProcess, configure: slowFor('mail-p-2', slowRegistry(run)), wrapRouter: wrap });
    await r.m.event(...HOLD);
    const out = await r.adapter.send();
    const atReturn = inbox();
    await r.adapter.exclusive(async () => {});
    for (let i = 0; i < 150 && !mailState(run, 'mail-p-2').audit.some(a => a.trace && a.trace.event_id === out.expected_event_id); i++) await pause(100);
    const routed = routerAudit(run).filter(a => a.cloud_event && /-n-3$/.test(a.cloud_event.id));
    return { out, before, atReturn, final: inbox(), routed, grant: (await r.m.snapshot()).data.grants.find(g => g.grant_id === 'g-2') };
  };
  const unconfirmed = [['unknown', 'receiver_unconfirmed']];
  for (const [run, options, how, code, routed, router, verified] of [
    ['mail-slow-receiver', {}, 'When the publish times out', 'publish_unconfirmed', unconfirmed, 'answered', true],
    ['mail-slow-reply', { inProcess: true }, 'When the Router replies that its receiver did not confirm', 'receiver_unconfirmed', unconfirmed, 'replied', true],
    ['mail-router-killed', { kill: true }, 'When the Router is killed while its receiver holds the delivery', 'publish_unconfirmed', [], 'exited', false],
  ]) {
    const x = await slowViewer(run, options);
    equal(how + ', the Router is done with the request while its receive is still unconfirmed in Mail', [x.out.status, x.out.code, x.out.stopped_at, x.routed.map(a => [a.result.status, a.result.code])], ['unknown', code, 'n-3', routed]);
    equal(how + ', the lock is kept until Mail shows the slow receive committed, and only then is the halt reported', [(x.out.settled || {}).router, (x.out.settled || {}).mail, x.out.stop_verified, x.atReturn, x.final.length], [router, 'committed', verified, x.final, 1]);
    equal(how + ', the viewer gets the notice before the queued revocation commits, never after it', [x.before, x.grant.status], [x.final, 'revoked']);
  }
  {
    let r, armed = false, revokedAt = 0, resumedAt = 0, before = null, resumeError = null;
    const run = 'mail-fence-refuses-queued', arm = path.join(root, 'receiver-hold.arm');
    const inbox = () => mailState(run, 'mail-p-2').data.messages.filter(m => /-n-3$/.test(m.thread_id)).map(m => m.id);
    const hold = wrapWith(async (account, name, args, router) => {
      if (name === 'router.publish' && !armed && args.message.id.endsWith('-n-3')) {
        armed = true;
        fs.writeFileSync(arm, sender.namespace('mail-p-2'));
        r.adapter.exclusive(async () => { revokedAt = Date.now(); before = inbox(); await r.m.event('grant.changed', '2026-11-30T09:11:00-05:00', { grant_id: 'g-2', status: 'revoked' }); });
        setTimeout(() => { try { const pid = Number(fs.readFileSync(arm + '.pid', 'utf8')); opened.pids.add(pid); resumedAt = Date.now(); process.kill(pid, 'SIGCONT'); } catch (e) { resumeError = String(e && e.message); } }, 12000);
      }
      return router.call(name, args);
    });
    r = await openRun(run, { seed: dailySeed(), wrapRouter: hold });
    await r.m.event(...HOLD);
    const out = await r.adapter.send();
    await r.adapter.exclusive(async () => {});
    const refusal = () => mailState(run, 'mail-p-2').audit.find(a => a.trace && a.trace.event_id === out.expected_event_id);
    for (let i = 0; i < 200 && !refusal(); i++) await pause(100);
    const grant = (await r.m.snapshot()).data.grants.find(g => g.grant_id === 'g-2');
    equal('A receive still queued in Mail when the adapter fences arrives after the revocation, is refused as stale, and the viewer gets nothing', [(out.settled || {}).mail, resumeError, revokedAt > 0 && revokedAt < resumedAt, refusal() && [refusal().decision, refusal().reason], before, inbox(), grant.status], ['fenced', null, true, ['deny', 'stale_version'], [], [], 'revoked']);
  }
  const stranded = async (run, how) => {
    let r, queued = false, revokedAt = 0, routerExit = null, publishedAt = 0, outcome = 'pending', finished = false;
    const strays = [];
    const inbox = () => mailState(run, 'mail-p-2').data.messages.filter(m => /-n-3$/.test(m.thread_id)).map(m => m.id);
    r = await openRun(run, { seed: dailySeed(), configure: slowFor('mail-p-2', slowRegistry(run, how === 'close' ? 12000 : 'stop')), wrapRouter: wrapWith(async (account, name, args, router) => {
      if (name === 'router.publish' && !queued && args.message.id.endsWith('-n-3')) {
        queued = true;
        publishedAt = Date.now();
        r.adapter.exclusive(async () => { if (finished) return; revokedAt = Date.now(); await r.m.event('grant.changed', '2026-11-30T09:11:00-05:00', { grant_id: 'g-2', status: 'revoked' }); });
        router.child.once('exit', (code, signal) => { routerExit = [code, signal]; });
        setTimeout(() => { for (const pid of descendants(router.child.pid)) { opened.pids.add(pid); strays.push(pid); } if (how === 'close') router.close(); else router.child.kill('SIGKILL'); }, 2000);
      }
      return router.call(name, args);
    }) });
    await r.m.event(...HOLD);
    r.adapter.send().then(() => { if (outcome === 'pending') outcome = 'resolved'; }, e => { if (outcome === 'pending') outcome = 'rejected: ' + String(e && e.message); });
    for (let i = 0; i < 200 && !publishedAt; i++) await pause(50);
    await pause(Math.max(0, publishedAt + 14000 - Date.now()));
    const lockedOut = await r.mails[1].infra.call('env.snapshot').then(() => false, e => /-32001/.test(String(e && e.message)));
    const status = r.adapter.status();
    const grant = (await r.m.snapshot()).data.grants.find(g => g.grant_id === 'g-2');
    const send = outcome;
    finished = true;
    for (const pid of strays) signal(pid, 'SIGKILL');
    return { send, revokedAt, routerExit, lockedOut, inbox: inbox(), grant: grant.status, status: [status.status, Boolean(status.cause && status.cause.code), Boolean(status.cause) && 'stop_verified' in status.cause] };
  };
  for (const [run, how, exit, label] of [['mail-close-mid-transaction', 'close', [0, null], 'Closing a Router that still answers'], ['mail-killed-router', 'kill', [null, 'SIGKILL'], 'Killing a Router']]) {
    const x = await stranded(run, how);
    equal(label + ' ends or orphans its Mail receiver inside the transaction and leaves that Mail instance unusable', [x.routerExit, x.lockedOut], [exit, true]);
    equal(label + ' leaves the run halted: send() is still pending with the publish lock held, the queued revocation has not run, the viewer\'s inbox is empty, and status() shows the halt without stop_verified', [x.send, x.revokedAt, x.grant, x.inbox, x.status], ['pending', 0, 'active', [], ['halted', true, false]]);
  }
  {
    let r, queued = false, exitedAt = 0, revokedAt = 0, alive = null, closed = null, aliveAtClose = null, late = 0;
    const errors = [];
    r = await openRun('mail-close-during-settlement', { seed: dailySeed(), wrapRouter: (account, router) => ({ definitions: router.definitions, request: (...a) => router.request(...a), child: router.child, call: async (name, args) => {
      if (router === closed) late++;
      if (name === 'router.publish' && !queued && args.message.id.endsWith('-n-3')) {
        queued = true;
        router.child.once('exit', () => { exitedAt = Date.now(); });
        router.child.kill('SIGSTOP');
        r.adapter.exclusive(async () => { revokedAt = Date.now(); alive = router.child.exitCode === null && router.child.signalCode === null; await r.m.event('grant.changed', '2026-11-30T09:11:00-05:00', { grant_id: 'g-2', status: 'revoked' }); });
        setTimeout(() => { closed = router; aliveAtClose = router.child.exitCode === null; router.close(); }, 8000);
        setTimeout(() => { router.child.kill('SIGCONT'); }, 15000);
      }
      try { return await router.call(name, args); } catch (e) { errors.push(e.code || String(e.message)); throw e; }
    } }) });
    await r.m.event(...HOLD);
    const out = await r.adapter.send();
    await r.adapter.exclusive(async () => {});
    const grant = (await r.m.snapshot()).data.grants.find(g => g.grant_id === 'g-2');
    equal('When Infra closes the live Router during settlement, the sender writes nothing more to it and keeps running', [aliveAtClose, late, errors.filter(e => /WRITE_AFTER_END/.test(e))], [true, 0, []]);
    equal('Closing is not an exit: the lock is kept until the Router process has exited, and the revocation commits after it', [out.code, (out.settled || {}).router, exitedAt > 0, alive, revokedAt > exitedAt, grant.status], ['publish_unconfirmed', 'exited', true, false, true, 'revoked']);
    equal('After the exit Mail settles the dispatch, and the viewer gets nothing', [(out.settled || {}).mail, (await r.mails[1].records()).filter(m => /-n-3$/.test(m.thread_id))], ['fenced', []]);
  }
  {
    let r, thrown = false, dropped = false, start = null;
    const fences = [];
    r = await openRun('mail-fence-ack-lost', { seed: dailySeed(),
      wrapRouter: wrapWith(async (account, name, args, router) => {
        if (name === 'router.publish' && !thrown && args.message.id.endsWith('-n-3')) { thrown = true; throw new Error('reply lost'); }
        return router.call(name, args);
      }),
      wrapMail: (account, mail) => ({ child: mail.child, call: async (name, args) => {
        if (name !== 'env.advance_time' || !/^settle-/.test(args.request_id)) return mail.call(name, args);
        if (start === null) start = (await mail.call('env.snapshot')).snapshot.virtual_now;
        const reply = await mail.call(name, args);
        fences.push([args, reply.status, reply.duplicate === true]);
        if (!dropped) { dropped = true; throw new Error('MCP request timed out: tools/call'); }
        return reply;
      } }),
    });
    await r.m.event(...HOLD);
    const out = await r.adapter.send();
    const now = await r.mails[1].now();
    equal('A fence whose acknowledgement is lost is retried with the same request and target, and Mail returns the stored receipt', [(out.settled || {}).mail, fences.length, fences.length === 2 && fences[1][0], fences.map(x => [x[1], x[2]])], ['fenced', 2, fences[0] && fences[0][0], [['committed', false], ['committed', true]]]);
    equal('So the viewer\'s Mail clock moves by exactly 1 ms and the viewer gets nothing', [ms(now) - ms(start), (await r.mails[1].records()).filter(m => /-n-3$/.test(m.thread_id))], [1, []]);
  }
  {
    const r = await openRun('mail-none', { seed: dailySeed(), withMail: false });
    await r.m.event(...HOLD);
    const out = await r.adapter.send();
    equal('Without a bound Mail account nothing is published', [out.status, out.reason, out.pending], ['skipped', 'no_mail_account', ['n-2', 'n-3']]);
    equal('No Mail record is created and the entries stay in the Mendwell log', [await counts(r), (await r.m.snapshot()).data.notices.map(n => n.notice_id)], [[0, 0], ['n-1', 'n-2', 'n-3']]);
  }
  {
    const run = 'mail-early';
    const infra = await mailClient('infra', run, path.join(stateOf(run), sender.namespace('mail-p-1')));
    equal('A Mail instance whose seed is not loaded fails the receiver check', (await sender.receiver(infra, MAIL[0])).status, 'invalid');
    const [first] = sender.sessionConfigs(baseConfig(MAIL));
    await routerInProcess(run, 'early', first.config);
    let reopened = null;
    try { await routerInProcess(run, 'again', first.config); } catch (e) { reopened = e.code || e.message; }
    equal('A session opened before its Mail seed was loaded cannot be reopened for that account in the run', reopened, 'EEXIST');
  }
}

const nap = new Int32Array(new SharedArrayBuffer(4));
const signal = (pid, name) => { try { process.kill(pid, name); } catch (e) {} };
const table = () => { try { return execFileSync('ps', ['-A', '-o', 'pid=,ppid=,stat='], { encoding: 'utf8' }).trim().split('\n').map(line => line.trim().split(/\s+/)).map(([pid, ppid, stat]) => ({ pid: Number(pid), ppid: Number(ppid), stat })); } catch (e) { return []; } };
const descendants = root => { const rows = table(), out = [], queue = [root]; while (queue.length) { const parent = queue.shift(); for (const row of rows) if (row.ppid === parent) { out.push(row.pid); queue.push(row.pid); } } return out; };
const living = pids => { const states = new Map(table().map(row => [row.pid, row.stat])); return pids.filter(pid => states.has(pid) && !/^Z/.test(states.get(pid))); };
function reap(pids) {
  for (const pid of pids) { signal(pid, 'SIGCONT'); signal(pid, 'SIGTERM'); }
  const end = Date.now() + 5000;
  let left = living(pids);
  while (left.length && Date.now() < end) { Atomics.wait(nap, 0, 0, 50); left = living(left); }
  for (const pid of left) { signal(pid, 'SIGCONT'); signal(pid, 'SIGKILL'); }
}

const write = report => { if (reportFile) { fs.mkdirSync(path.dirname(path.resolve(reportFile)), { recursive: true }); fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n'); } };
(async () => {
  let root = null;
  const opened = { clients: [], routers: [], prepared: null, pids: new Set(), cleaned: false };
  process.on('exit', () => {
    if (opened.cleaned) return;
    reap([...new Set([...descendants(process.pid), ...opened.pids])]);
    try { if (opened.prepared) opened.prepared.cleanup(); } catch (e) {}
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });
  for (const name of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(name, () => { process.exitCode = 1; process.exit(); });
  try {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'mendwell-mail-'));
    stage(root);
    await main(root, opened);
    write({ schema: 'mendwell.mail-integration.v1', receiver: 'mail ' + read(path.join(mailSource, 'app.json')).version, runtime: read(path.join(runtimeSource, 'package.json')).version, node: process.version, checks, passed: true });
    console.log('mail integration passed ' + checks.length + ' checks');
  } catch (error) {
    write({ schema: 'mendwell.mail-integration.v1', checks, passed: false, error: error.message });
    console.error(error.stack || error.message);
    process.exitCode = 1;
  } finally {
    const pids = [...new Set([...descendants(process.pid), ...opened.pids])];
    for (const pid of pids) signal(pid, 'SIGCONT');
    let timer = null;
    await Promise.race([Promise.allSettled([...opened.clients.map(c => c.close()), ...opened.routers.map(r => r.close())]), new Promise(resolve => { timer = setTimeout(resolve, 10000); })]);
    clearTimeout(timer);
    reap(pids);
    if (opened.prepared) opened.prepared.cleanup();
    if (root) fs.rmSync(root, { recursive: true, force: true });
    opened.cleaned = true;
  }
  setTimeout(() => process.exit(), 1000).unref();
})();
