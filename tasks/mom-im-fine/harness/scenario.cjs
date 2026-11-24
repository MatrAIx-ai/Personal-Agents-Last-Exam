'use strict';
// Local stand-in for the session runner and user harness (until #135 ships).
// Drives Messages, Files, Notes, Contacts and Mail over real MCP stdio from apps.registry.json.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '../../..');
const { Client } = require(path.join(ROOT, 'runtime/client.cjs'));

const TASK = path.resolve(__dirname, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(TASK, p), 'utf8'));
const task = read('task.json');
const timeline = read(task.scenario);
const REGISTRY = path.join(ROOT, task.registry);
// MOM_PAYLOAD_DIR points a pilot at payloads built from other data (see data/build.cjs).
if (process.env.MOM_RULE4 && !process.env.MOM_PAYLOAD_DIR) throw new Error('MOM_RULE4 only takes effect in a build: run MOM_RULE4=... MOM_PAYLOAD_DIR=DIR node tasks/mom-im-fine/data/build.cjs, then set MOM_PAYLOAD_DIR=DIR');
const readPayload = (p) => (process.env.MOM_PAYLOAD_DIR ? JSON.parse(fs.readFileSync(path.join(process.env.MOM_PAYLOAD_DIR, path.basename(p)), 'utf8')) : read(p));
const apps = Object.fromEntries(task.apps.map((a) => [a.app_id, { payload: readPayload(a.payload), events: a.events ? readPayload(a.events) : [] }]));
const APP_IDS = Object.keys(apps);

// Branch rule from timeline.json as a fixed check: the first meeting reply asks Jun something.
const ASKS_JUN = /\?|\b(let me know|please confirm|confirm (which|whether|if)|should i|do you want|would you like|want me to)\b/i;
const askedJun = (reply) => ASKS_JUN.test(reply);

// agent(turn, tools) gets { session, turn, at, text, system, history, chat, env }.
//   history: earlier turns of this session. chat: turns of the earlier session (text only, no tool calls).
// branch: optional { askedJun(reply), askedAboutAunt(reply) } to replace the fixed checks, for example with a user simulator.
async function runScenario(agent, { label = 'case', hinted = false, branch = {} } = {}) {
  const asked = branch.askedJun || askedJun;
  const askedAunt = branch.askedAboutAunt || askedJun;
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pale-mom-'));
  const runId = 'mom-im-fine-' + label;
  const system = task.system_instructions + (hinted ? '\n\n' + task.hint : '');
  const clients = [];
  const open = async (app, role) => {
    const c = new Client(app, role, runId, stateDir, `mom-im-fine-${role}`, { registry: REGISTRY });
    clients.push(c);
    await c.initialize();
    return c;
  };
  const version = {};
  const track = (app, r) => { if (r && r.version && !r.duplicate) version[app] = r.version; return r; };
  let rid = 0;
  try {
    const infra = {};
    for (const app of APP_IDS) {
      infra[app] = await open(app, 'infra');
      const s = await infra[app].call('env.snapshot');
      const p = apps[app].payload;
      const r = await infra[app].call('env.load_seed', {
        expected_version: s.version, request_id: 'seed', data: p.data, binding: p.binding, policies: p.policies, bundle: p.bundle,
        virtual_now: task.seed_virtual_now,
      });
      if (r.status !== 'ready') throw new Error(`${app} load_seed: ${r.status} ${r.message || ''}`);
      track(app, r);
    }
    const agentConn = {};
    for (const app of APP_IDS) agentConn[app] = await open(app, 'agent');

    // An external agent writes through its own MCP connection, so read the current version before each Infra write.
    const fresh = async (app) => { version[app] = (await infra[app].call('env.snapshot')).version; };
    const advanceAll = async (at, step) => {
      for (const app of APP_IDS) {
        await fresh(app);
        const r = await infra[app].call('env.advance_time', { expected_version: version[app], request_id: `clock-${step}-${at}`, virtual_now: at });
        if (r.status !== 'committed') throw new Error(`advance ${app} to ${at}: ${r.status} ${r.message || ''}`);
        track(app, r);
      }
    };
    const applyEvent = async (app, eventId) => {
      const event = apps[app].events.find((e) => e.event_id === eventId);
      if (!event) throw new Error(`unknown ${app} event ${eventId}`);
      await fresh(app);
      const r = await infra[app].call('env.apply_event', { expected_version: version[app], event });
      if (r.status !== 'committed') throw new Error(`apply ${eventId}: ${r.status} ${r.message || ''}`);
      track(app, r);
    };

    // Tool surface for scripted agents. Writes that do not commit are kept in write_errors.
    const writeErrors = [];
    const call = async (app, name, args = {}, write = false) => {
      if (write) await fresh(app);
      const full = write ? { ...args, expected_version: version[app], request_id: `${label}-${++rid}` } : args;
      const r = track(app, await agentConn[app].call(name, full));
      if (write && (!r || r.status !== 'committed')) writeErrors.push({ tool: name, args: { ...args, files: args.files && args.files.map((f) => f.filename) }, status: r && r.status, message: r && r.message });
      return r;
    };
    const tools = { call, read: (app, name, args) => call(app, name, args), write: (app, name, args) => call(app, name, args, true) };

    const transcript = [];
    const messagesAfter = {};
    const messagesNow = async () => (await infra.messages.call('env.snapshot')).snapshot;
    for (const [i, step] of timeline.steps.entries()) {
      if (step.kind === 'app_event') { await advanceAll(step.at, i); await applyEvent(step.app, step.event_id); continue; }
      if (step.kind === 'end') { await advanceAll(step.at, i); break; }
      if (step.only_if === 'agent_asked_jun_a_question') {
        const first = transcript.find((x) => x.session === 'meeting');
        if (!first || transcript[transcript.length - 1] !== first || !(await asked(first.agent))) continue;
      }
      if (step.only_if === 'agent_asked_jun_about_the_aunt_reply') {
        // Only when the agent asked Jun and sent Hye-jin nothing since Jun's request.
        const last = transcript[transcript.length - 1];
        if (!last || last.turn !== 'answer_aunt') continue;
        const ms = (await messagesNow()).data;
        const direct = new Set(ms.conversations.filter((c) => c.participant_ids.length === 2 && c.participant_ids.includes(task.people.hyejin)).map((c) => c.id));
        const answered = ms.messages.some((m) => m.author_person_id === task.people.jun && direct.has(m.conversation_id) && Date.parse(m.sent_at) >= Date.parse(last.at));
        if (answered || !(await askedAunt(last.agent))) continue;
      }
      await advanceAll(step.at, i);
      const history = transcript.filter((x) => x.session === step.session);
      const chat = transcript.filter((x) => x.session !== step.session).map(({ at, user, agent: said }) => ({ at, user, agent: said }));
      const reply = String(await agent({ session: step.session, turn: step.turn, at: step.at, text: step.text, system, history, chat, env: { runId, stateDir, registry: REGISTRY, apps: APP_IDS } }, tools) || '');
      transcript.push({ session: step.session, turn: step.turn, at: step.at, user: step.text, agent: reply });
      // Session 1 items are graded on what session 1 left behind, so keep Messages as each session leaves it.
      const ms = await messagesNow();
      messagesAfter[step.session] = { messages: ms.data.messages, conversations: ms.data.conversations, sha: Object.fromEntries(ms.resources.bundle.catalog.assets.map((x) => [x.asset_id, x.integrity && x.integrity.sha256])) };
    }

    const snapshots = {};
    for (const app of APP_IDS) snapshots[app] = (await infra[app].call('env.snapshot')).snapshot;
    return { transcript, write_errors: writeErrors, messages_after: messagesAfter, snapshots };
  } finally {
    await Promise.allSettled(clients.map((c) => c.close()));
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
}

const notesPayload = apps.notes.payload.data.notes.find((n) => n.title === 'For my assistant');
const provenance = { payload_dir: process.env.MOM_PAYLOAD_DIR || null, rules_note: notesPayload && notesPayload.body, notes_sha256: require('node:crypto').createHash('sha256').update(JSON.stringify(apps.notes.payload)).digest('hex') };

module.exports = { runScenario, askedJun, task, timeline, apps, provenance };
