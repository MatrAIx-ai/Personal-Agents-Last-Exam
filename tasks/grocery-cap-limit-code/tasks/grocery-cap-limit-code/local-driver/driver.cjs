'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Client } = require('../../../../../runtime/client.cjs');
const { create } = require('../../../../../runtime/messaging/src/router.cjs');
const cloudEvents = require('../../../../../runtime/core/cloud-events.cjs');

const taskRoot = path.resolve(__dirname, '..');
const packageRoot = path.resolve(taskRoot, '../..');
const repoRoot = path.resolve(packageRoot, '../..');
const deps = path.join(packageRoot, '.deps/keelcard');
const { loadSeed } = require(path.join(deps, 'src/load-seed.cjs'));
const { publishPending } = require(path.join(deps, 'src/publisher.cjs'));
const world = require('./world.cjs');

const APPS = ['keelcard', 'mail', 'freshcart', 'webstub'];
const SEED_CLOCK = '2026-11-18T09:00:00-08:00';

function readJson(file) {
  const text = fs.readFileSync(file, 'utf8');
  const body = text.split('\n').filter(line => !line.startsWith('#')).join('\n');
  return JSON.parse(body);
}

function writeRegistry(file) {
  const registry = {
    schema_version: 1,
    initial_time: SEED_CLOCK,
    apps: [
      { app_id: 'keelcard', version: '1.0.0', path: 'tasks/grocery-cap-limit-code/.deps/keelcard' },
      { app_id: 'mail', version: '1.3.0', path: 'examples/apps/mail' },
      { app_id: 'freshcart', version: '1.0.0', path: 'tasks/grocery-cap-limit-code/tasks/grocery-cap-limit-code/environment/apps/freshcart' },
      { app_id: 'webstub', version: '1.0.0', path: 'tasks/grocery-cap-limit-code/tasks/grocery-cap-limit-code/environment/apps/webstub' }
    ]
  };
  fs.writeFileSync(file, JSON.stringify(registry, null, 2));
}

function routerConfig(file, publisher) {
  const merchants = publisher === 'freshcart';
  const body = {
    schema_version: 2,
    registry: path.relative(repoRoot, file).replaceAll('\\', '/'),
    publishers: [{
      app_id: merchants ? 'freshcart' : 'keelcard',
      account_id: merchants ? 'fc-grace' : 'kc-adeyemi',
      owner_person_id: 'person-grace',
      package_root: merchants
        ? 'tasks/grocery-cap-limit-code/.deps/keelcard/examples/test-merchant'
        : 'tasks/grocery-cap-limit-code/.deps/keelcard',
      contribution_ref: 'contribution/contribution.json',
      allowed_recipients: merchants
        ? [{ app_id: 'keelcard', account_id: 'kc-adeyemi', channel: 'channel.card.authorization' }]
        : [{ app_id: 'mail', account_id: 'mail-grace', channel: 'channel.email' }]
    }],
    authentication: { mode: 'trusted-stdio' }
  };
  const config = file + '.' + (merchants ? 'merchant' : 'mail') + '.json';
  fs.writeFileSync(config, JSON.stringify(body, null, 2));
  return config;
}

class RunHalt extends Error {
  constructor(detail) {
    super('Mail publication halted');
    this.halt = true;
    this.detail = detail;
  }
}

async function runScenario(options) {
  const plan = options.plan;
  const variant = plan.variant || 'main';
  const hinted = Boolean(options.hinted);
  const runId = String(options.runId || plan.id || 'gcl').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gcl-'));
  const registryFile = path.join(repoRoot, 'grocery-cap.registry.json');
  const workspace = path.join(taskRoot, 'environment/workspace');
  const timeline = readJson(path.join(taskRoot, 'context/timeline.yaml'));
  const script = readJson(path.join(taskRoot, 'context/user/script.json'));
  const rules = world.parse(script);
  const historyName = variant === 'control-express' ? 'history-express.json' : 'history.json';
  const history = readJson(path.join(taskRoot, 'context/user', historyName));
  const arrivals = readJson(path.join(workspace, 'mail/arrivals.json'));
  const hint = hinted ? hintText() : '';
  const transcript = [];
  const toolLog = [];
  const delivered = [];
  let clock = SEED_CLOCK;
  let tick = 0;
  let trace = 0;
  let delivery = 'none';
  const infra = {};
  const agent = {};
  const routers = [];
  writeRegistry(registryFile);

  function logCall(entry) {
    trace += 1;
    toolLog.push({ trace, at: clock, ...entry });
  }

  function sayLine(row) {
    trace += 1;
    transcript.push({ trace, ...row });
  }

  async function callOn(role, app, name, args, meta) {
    const client = (role === 'infra' ? infra : agent)[app];
    const result = await client.call(name, args);
    if (!meta.probe) logCall({ actor: meta.actor || role, app, name, args, result });
    return result;
  }

  async function advanceApps(at) {
    if (Date.parse(at) < Date.parse(clock)) throw new Error('The clock cannot move backward to ' + at);
    if (Date.parse(at) === Date.parse(clock)) return;
    tick += 1;
    for (const id of APPS) {
      const snap = await infra[id].call('env.snapshot');
      const moved = await infra[id].call('env.advance_time', {
        expected_version: snap.version,
        request_id: 'adv-' + id + '-' + tick,
        virtual_now: at
      });
      if (moved.status !== 'committed') throw new Error(id + ' did not advance: ' + moved.status + ' ' + (moved.message || ''));
    }
    clock = at;
  }

  async function apply(app, event) {
    const snap = await infra[app].call('env.snapshot');
    const applied = await infra[app].call('env.apply_event', { expected_version: snap.version, event });
    logCall({ actor: 'infra', app, name: event.operation, args: { event_id: event.event_id }, result: { status: applied.status, message: applied.message || null } });
    if (applied.status !== 'committed' && applied.duplicate !== true) {
      throw new Error(app + ' ' + event.operation + ' ' + applied.status + ' ' + (applied.message || ''));
    }
    return applied;
  }

  async function publishMail() {
    const snap = await infra.keelcard.call('env.snapshot');
    const receiptLog = path.join(stateDir, runId, 'messaging.receipts.jsonl');
    const published = await publishPending({
      data: snap.snapshot.data,
      router: routers.find(item => item.name === 'mail').router,
      inspect: async ({ event_id }) => {
        const eventStatus = await infra.mail.call('env.event_status', { event_id });
        const mailbox = await infra.mail.call('env.snapshot');
        const mailRecord = mailbox.snapshot.data.messages.find(row => row.id === event_id) || null;
        return { eventStatus, mailRecord };
      },
      commit: item => applyReports([item]),
      read: async () => (await infra.keelcard.call('env.snapshot')).snapshot.data,
      receiptLog,
      runDir: path.join(stateDir, runId)
    });
    if (published.halted || published.stopped) {
      delivery = 'unresolved';
      throw new RunHalt(published.report || published);
    }
    if (published.sent && published.sent.length) delivery = 'confirmed';
    return published;
  }

  async function applyReports(reports) {
    let last = null;
    for (const item of reports) {
      const snap = await infra.keelcard.call('env.snapshot');
      const operation = item.kind === 'halt' ? 'publication.halt' : 'notice.delivery_result';
      const payload = {
        notice_id: item.notice_id,
        publish_request_id: item.publish_request_id,
        status: item.status || 'unknown'
      };
      if (item.receipt_event_id) payload.event_id = item.receipt_event_id;
      if (item.code) payload.code = item.code;
      if (item.cloud_event_id) payload.cloud_event_id = item.cloud_event_id;
      if (item.kind === 'halt') payload.stop_run = Boolean(item.stop_run);
      const event = { event_id: item.event_id, at: item.recorded_at || snap.snapshot.virtual_now, operation, payload };
      last = await infra.keelcard.call('env.apply_event', { expected_version: snap.version, event });
      if (last.status !== 'committed' && last.duplicate !== true) {
        throw new Error('Delivery evidence was not recorded: ' + last.status);
      }
    }
    return last;
  }

  async function mediate(attempt) {
    const request = attempt.authorization_request;
    const message = cloudEvents.create({
      id: 'fc-auth-' + attempt.id,
      app: 'freshcart',
      account: 'fc-grace',
      type: 'org.pale.card.authorization.v1',
      dataschema: 'urn:pale:card-authorization-payload:1',
      subject: attempt.order_id,
      data: {
        channel: 'channel.card.authorization',
        recipient: { kind: 'app_account_ref', app_id: 'keelcard', id: 'kc-adeyemi' },
        source_object: { app_id: 'freshcart', account_id: 'fc-grace', object_type: 'order', object_id: attempt.order_id },
        authorization: {
          authorization_key: request.authorization_key,
          card: { card_id: request.card.card_id },
          merchant: request.merchant,
          amount_cents: request.amount_cents,
          currency: 'USD'
        },
        extensions: []
      }
    });
    const receipt = await routers.find(item => item.name === 'merchant').router.call('router.publish', {
      request_id: 'pub-' + attempt.id,
      message
    });
    logCall({ actor: 'merchant', app: 'keelcard', name: 'channel.card.authorization', args: { authorization_key: request.authorization_key, amount_cents: request.amount_cents }, result: { status: receipt.status, code: receipt.code || null } });
    if (receipt.status !== 'committed') throw new RunHalt(receipt);
    const lookup = await agent.keelcard.call('keelcard.authorizations.lookup', { authorization_key: request.authorization_key });
    logCall({ actor: 'merchant', app: 'keelcard', name: 'keelcard.authorizations.lookup', args: { authorization_key: request.authorization_key }, result: lookup });
    const row = lookup.authorization;
    if (!row) throw new Error('Authorization lookup missed ' + request.authorization_key);
    const decision = row.decision === 'approved' ? 'approved' : 'declined';
    const fresh = await infra.freshcart.call('env.snapshot');
    const decided = await apply('freshcart', {
      event_id: 'decide-' + attempt.id,
      at: fresh.snapshot.virtual_now,
      operation: 'freshcart.checkout.decide',
      payload: {
        attempt_id: attempt.id,
        decision,
        decline_code: row.decline_code,
        authorization_id: row.authorization_id
      }
    });
    if (decision === 'approved') {
      const card = await infra.keelcard.call('env.snapshot');
      await apply('keelcard', {
        event_id: 'cap-' + attempt.id,
        at: card.snapshot.virtual_now,
        operation: 'authorization.capture',
        payload: {
          capture_key: 'cap-' + attempt.id,
          authorization_id: row.authorization_id,
          amount_cents: request.amount_cents
        }
      });
    }
    await publishMail();
    return {
      status: 'ok',
      app_id: 'freshcart',
      version: decided.version,
      attempt_id: attempt.id,
      order_id: attempt.order_id,
      total_cents: attempt.total_cents,
      outcome: decision,
      decision,
      decline_code: row.decline_code,
      authorization_key: request.authorization_key,
      hold_cents: row.hold_cents
    };
  }

  async function afterCheckout(name, result) {
    if (!result || result.outcome !== 'awaiting_authorization') return result;
    const snap = await infra.freshcart.call('env.snapshot');
    const attempt = snap.snapshot.data.checkout_attempts.find(row => row.id === result.attempt_id);
    if (!attempt) throw new Error('Checkout attempt was not stored');
    const mediated = await mediate(attempt);
    logCall({ actor: 'merchant', app: 'freshcart', name: name + '.decision', args: { attempt_id: attempt.id }, result: mediated });
    return mediated;
  }

  const ctx = {
    sessions: timeline.sessions,
    async call(name, args, meta = {}) {
      const app = name.split('.')[0];
      if (name === 'memory.search') {
        const query = String((args && args.query) || '').toLowerCase();
        const records = history.records.filter(row => Date.parse(row.at) <= Date.parse(clock) && (!query || (row.date + ' ' + row.text).toLowerCase().includes(query)));
        const result = { status: 'ok', records };
        logCall({ actor: 'agent', app: 'memory', name, args, result: { status: 'ok', count: records.length } });
        return result;
      }
      const result = await callOn('agent', app, name, args, { actor: meta.actor || 'agent', probe: meta.probe });
      if (result && result.status && !['ok', 'committed', 'ready'].includes(result.status) && result.applied === false) return result;
      if (name === 'keelcard.controls.request_change' || name === 'keelcard.controls.confirm_change') await publishMail();
      if (name === 'freshcart.checkout.place' || name === 'freshcart.substitutions.respond') return afterCheckout(name, result);
      return result;
    },
    async say(text) {
      sayLine({ at: clock, role: 'agent', text, session: ctx.currentSession });
      const follow = world.followUp(rules, transcript, text, clock, variant);
      if (follow) sayLine({ at: clock, role: 'user', text: follow, session: ctx.currentSession, cause: 'lunch-follow-up' });
    },
    async advance(at) { await deliverDue(at); },
    async openSession(session) {
      ctx.currentSession = session.id;
      await deliverDue(session.start);
      if (hint) sayLine({ at: session.start, role: 'system', text: hint, session: session.id });
      if (session.opening) sayLine({ at: session.start, role: 'user', text: session.opening, session: session.id });
    },
    async closeSession(session) { await deliverDue(session.end); },
    currentSession: null
  };

  function variantOn(event) {
    return event.variants.includes('*') || event.variants.includes(variant);
  }

  async function play(event) {
    if (event.kind === 'mail') {
      await apply('mail', { event_id: 'deliver-' + event.arrival, at: event.at, operation: 'mail.deliver', payload: arrivals[event.arrival] });
    } else if (event.kind === 'user_message') {
      sayLine({ at: event.at, role: 'user', text: event.text, session: ctx.currentSession, event_id: event.id });
    } else if (event.kind === 'grace_reply') {
      const text = world.replyAt(rules, transcript, event.at, variant);
      if (text) sayLine({ at: event.at, role: 'user', text, session: ctx.currentSession, event_id: event.id });
    } else if (event.kind === 'substitution') {
      const snap = await infra.freshcart.call('env.snapshot');
      const order = snap.snapshot.data.orders.find(row => row.status === 'confirmed' && (row.lines || []).some(line => line.item_id === 'item-lf-milk'));
      await apply('freshcart', {
        event_id: 'sub-milk',
        at: event.at,
        operation: 'freshcart.substitution.offer',
        payload: {
          id: 'sub-milk',
          order_id: order ? order.id : 'fc-order-missing',
          unavailable_item_id: 'item-lf-milk',
          offers: [
            { id: 'offer-whole', item_id: 'item-whole-milk', label: 'Regular whole milk, half gallon', delta_cents: 0 },
            { id: 'offer-lf-alt', item_id: 'item-lf-milk-alt', label: 'Lactose-free milk, other brand, half gallon', delta_cents: 40 }
          ]
        }
      });
    }
    delivered.push(event.id);
  }

  async function deliverDue(at) {
    const due = timeline.events.filter(event => variantOn(event) && !delivered.includes(event.id) && Date.parse(event.at) <= Date.parse(at));
    due.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.tie - b.tie);
    for (const event of due) {
      await advanceApps(event.at);
      await play(event);
    }
    await advanceApps(at);
  }

  try {
    for (const id of APPS) {
      infra[id] = new Client(id, 'infra', runId, stateDir, 'gcl-infra', { registry: registryFile });
      agent[id] = new Client(id, 'agent', runId, stateDir, 'gcl-agent', { registry: registryFile });
    }
    for (const id of APPS) {
      await infra[id].initialize();
      await agent[id].initialize();
    }
    await loadAll();
    routers.push({ name: 'mail', router: await create({ config: routerConfig(registryFile, 'keelcard'), publisher: 'keelcard', run: runId, stateDir }) });
    routers.push({ name: 'merchant', router: await create({ config: routerConfig(registryFile, 'freshcart'), publisher: 'freshcart', run: runId, stateDir }) });
    const { runPlan } = require('./plan-agent.cjs');
    await runPlan(ctx, plan);
    return await finish(null);
  } catch (error) {
    return await finish(error);
  } finally {
    for (const item of routers) await item.router.close().catch(() => {});
    for (const id of APPS) {
      if (infra[id]) await infra[id].close().catch(() => {});
      if (agent[id]) await agent[id].close().catch(() => {});
    }
    fs.rmSync(registryFile, { force: true });
    fs.rmSync(registryFile + '.mail.json', { force: true });
    fs.rmSync(registryFile + '.merchant.json', { force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
  }

  async function loadAll() {
    const keelSnap = await infra.keelcard.call('env.snapshot');
    const keelLoaded = await loadSeed(infra.keelcard, {
      expected_version: keelSnap.version,
      request_id: 'task-seed',
      data: keelSnap.snapshot.data,
      binding: readJson(path.join(workspace, 'keelcard/binding.json')),
      policies: readJson(path.join(workspace, 'keelcard/policies.json')),
      bundle: keelSnap.snapshot.resources.bundle,
      virtual_now: SEED_CLOCK
    });
    if (keelLoaded.status !== 'ready') throw new Error('Keelcard seed ' + keelLoaded.status + ' ' + (keelLoaded.message || ''));
    for (const id of ['mail', 'freshcart', 'webstub']) {
      const snap = await infra[id].call('env.snapshot');
      const seedFile = id === 'freshcart' && variant === 'control-under-cap' ? 'seed-under-cap.json' : 'seed.json';
      const loaded = await infra[id].call('env.load_seed', {
        expected_version: snap.version,
        request_id: 'task-seed',
        data: readJson(path.join(workspace, id, seedFile)),
        binding: readJson(path.join(workspace, id, 'binding.json')),
        policies: readJson(path.join(workspace, id, 'policies.json')),
        bundle: readJson(path.join(workspace, id, 'bundle.json')),
        virtual_now: SEED_CLOCK
      });
      if (loaded.status !== 'ready') throw new Error(id + ' seed ' + loaded.status + ' ' + (loaded.message || ''));
    }
  }

  async function finish(error) {
    const apps = {};
    for (const id of APPS) {
      try { apps[id] = (await infra[id].call('env.snapshot')).snapshot; }
      catch (snapError) { apps[id] = { error: snapError.message }; }
    }
    const state = {
      schema: 'grocery-cap-limit-code.run.v1',
      run_id: runId,
      plan_id: plan.id,
      variant,
      hinted,
      clock,
      delivery,
      transcript,
      tool_log: toolLog,
      events_delivered: delivered,
      error: error ? { message: error.message, halt: Boolean(error.halt) } : null,
      apps: {
        keelcard: apps.keelcard && apps.keelcard.data,
        freshcart: apps.freshcart && apps.freshcart.data,
        mail: apps.mail && apps.mail.data,
        webstub: apps.webstub && apps.webstub.data
      }
    };
    if (options.outDir) {
      fs.mkdirSync(options.outDir, { recursive: true });
      fs.writeFileSync(path.join(options.outDir, 'state.json'), JSON.stringify(state));
      fs.writeFileSync(path.join(options.outDir, 'run.json'), JSON.stringify({
        run_id: runId, plan_id: plan.id, variant, hinted, delivery, error: state.error,
        started_virtual: SEED_CLOCK, ended_virtual: clock
      }, null, 2));
    }
    if (error && !error.halt) throw error;
    return state;
  }
}

function hintText() {
  const file = fs.readFileSync(path.join(taskRoot, 'tests/hints.md'), 'utf8');
  const match = file.match(/<!-- hint:start -->([\s\S]*?)<!-- hint:end -->/);
  if (!match) throw new Error('Hint markers are missing');
  return match[1].trim();
}

module.exports = { runScenario, RunHalt };
