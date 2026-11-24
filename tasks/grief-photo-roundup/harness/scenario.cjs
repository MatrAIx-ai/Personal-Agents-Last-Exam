'use strict';
// Local stand-in for the session runner and user harness (until #135 ships).
// Drives Messages, Files, Calendar, Contacts and Notes over real MCP stdio from apps.registry.json.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '../../..');
const { Client } = require(path.join(ROOT, 'runtime/client.cjs'));

const TASK = path.resolve(__dirname, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(TASK, p), 'utf8'));
const task = read('task.json');
// GRIEF_TIMELINE points a pilot at another timeline file, to try wording before the freeze. Cases never set it.
const timeline = process.env.GRIEF_TIMELINE ? JSON.parse(fs.readFileSync(process.env.GRIEF_TIMELINE, 'utf8')) : read(task.scenario);
const REGISTRY = path.join(ROOT, task.registry);
const apps = Object.fromEntries(task.apps.map((a) => [a.app_id, { payload: read(a.payload), events: a.events ? read(a.events) : [] }]));
const APP_IDS = Object.keys(apps);

// Branch rule from timeline.json as a fixed check: the first reply of a session asks Elena something.
const ASKS = /\?|\b(let me know|please confirm|confirm (which|whether|if)|should i|do you want|would you like|want me to)\b/i;
const askedElena = (reply) => ASKS.test(reply);

// Width and height of a PNG or baseline/progressive JPEG, or null.
function imageSize(mime, b) {
  if (mime === 'image/png' && b.length >= 24) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (mime !== 'image/jpeg') return null;
  for (let i = 2; i + 9 < b.length && b[i] === 0xff;) {
    const marker = b[i + 1];
    const len = b.readUInt16BE(i + 2);
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
    i += 2 + len;
  }
  return null;
}

// The asset bundle that goes with a Files event: the App's current bundle plus the event's own photo.
// An event bundle is checked in full, so files the agent added during the run must pass too:
// copies of a photo are allowed, and images the agent uploaded without a size get one from their bytes.
function eventBundle(snapshot, asset) {
  const bundle = structuredClone(snapshot.resources.bundle);
  for (const a of bundle.catalog.assets) {
    if (!a.mime_type.startsWith('image/') || Number.isInteger(a.media && a.media.image && a.media.image.width)) continue;
    const size = imageSize(a.mime_type, Buffer.from(bundle.blobs[a.asset_id] || '', 'base64'));
    a.media = { ...(a.media || {}), image: { ...((a.media || {}).image || {}), width: size ? size.width : 0, height: size ? size.height : 0 } };
  }
  if (asset) { bundle.catalog.assets.push(asset.descriptor); bundle.blobs[asset.descriptor.asset_id] = asset.base64; }
  bundle.dataset.expected_counts = { records: snapshot.data.files.length + 1, assets: bundle.catalog.assets.length };
  bundle.dataset.quality_policy = { ...bundle.dataset.quality_policy, duplicate_records: 'allow', duplicate_assets: 'allow' };
  return bundle;
}

// agent(turn, tools) gets { session, turn, at, text, system, history, chat, env }.
//   history: earlier turns of this session. chat: turns of earlier sessions (text only, no tool calls).
// branch: optional { asked(reply, turn) } to replace the fixed check, for example with a user simulator.
async function runScenario(agent, { label = 'case', hinted = false, branch = {} } = {}) {
  const asked = branch.asked || askedElena;
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pale-grief-'));
  const runId = 'grief-photo-roundup-' + label;
  const system = task.system_instructions + (hinted ? '\n\n' + task.hint : '');
  const clients = [];
  const open = async (app, role) => {
    const c = new Client(app, role, runId, stateDir, `grief-photo-roundup-${role}`, { registry: REGISTRY });
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
    const fresh = async (app) => { const s = await infra[app].call('env.snapshot'); version[app] = s.version; return s.snapshot; };
    const advanceAll = async (at, step) => {
      for (const app of APP_IDS) {
        await fresh(app);
        const r = await infra[app].call('env.advance_time', { expected_version: version[app], request_id: `clock-${step}-${at}`, virtual_now: at });
        if (r.status !== 'committed') throw new Error(`advance ${app} to ${at}: ${r.status} ${r.message || ''}`);
        track(app, r);
      }
    };
    // An event can fail after the agent changed the same objects (for example it trashed the folder
    // an upload goes to). The run goes on and the failure is kept in event_errors.
    const eventErrors = [];
    const applyEvent = async (app, eventId) => {
      const entry = apps[app].events.find((e) => (e.event || e).event_id === eventId);
      if (!entry) throw new Error(`unknown ${app} event ${eventId}`);
      const event = entry.event || entry;
      const snapshot = await fresh(app);
      const args = { expected_version: version[app], event };
      if (app === 'files' && entry.asset) args.bundle = eventBundle(snapshot, entry.asset);
      const r = await infra[app].call('env.apply_event', args);
      if (r.status !== 'committed') eventErrors.push({ app, event_id: eventId, status: r.status, message: r.message });
      track(app, r);
    };

    // Tool surface for scripted agents. Writes that do not commit are kept in write_errors.
    const writeErrors = [];
    const call = async (app, name, args = {}, write = false) => {
      if (write) await fresh(app);
      const full = write ? { ...args, expected_version: version[app], request_id: `${label}-${++rid}` } : args;
      const r = track(app, await agentConn[app].call(name, full));
      if (write && (!r || r.status !== 'committed')) writeErrors.push({ tool: name, args: { ...args, files: args.files && args.files.map((f) => f.filename), file: args.file && args.file.filename }, status: r && r.status, message: r && r.message });
      return r;
    };
    const tools = { call, read: (app, name, args) => call(app, name, args), write: (app, name, args) => call(app, name, args, true) };

    const transcript = [];
    const calendarAfter = {};
    const messagesAfter = {};
    for (const [i, step] of timeline.steps.entries()) {
      if (step.kind === 'app_event') { await advanceAll(step.at, i); for (const id of step.event_ids) await applyEvent(step.app, id); continue; }
      if (step.kind === 'end') { await advanceAll(step.at, i); break; }
      const history = transcript.filter((x) => x.session === step.session);
      if (step.only_if === 'agent_asked_elena_a_question') {
        if (history.length !== 1 || !(await asked(history[0].agent, history[0]))) continue;
      }
      await advanceAll(step.at, i);
      const chat = transcript.filter((x) => x.session !== step.session).map(({ at, user, agent: reply }) => ({ at, user, agent: reply }));
      const reply = String(await agent({ session: step.session, turn: step.turn, at: step.at, text: step.text, system, history, chat, env: { runId, stateDir, registry: REGISTRY, apps: APP_IDS } }, tools) || '');
      transcript.push({ session: step.session, turn: step.turn, at: step.at, user: step.text, agent: reply });
      // Some items are about what a session left behind (E2, E3, E4, E5), so keep Calendar and Messages as each session leaves them.
      calendarAfter[step.session] = (await infra.calendar.call('env.snapshot')).snapshot.data.events;
      const ms = (await infra.messages.call('env.snapshot')).snapshot;
      messagesAfter[step.session] = {
        messages: ms.data.messages, conversations: ms.data.conversations,
        sha: Object.fromEntries(ms.resources.bundle.catalog.assets.map((x) => [x.asset_id, x.integrity && x.integrity.sha256])),
      };
    }

    const snapshots = {};
    for (const app of APP_IDS) snapshots[app] = (await infra[app].call('env.snapshot')).snapshot;
    return { transcript, write_errors: writeErrors, event_errors: eventErrors, calendar_after: calendarAfter, messages_after: messagesAfter, snapshots };
  } finally {
    await Promise.allSettled(clients.map((c) => c.close()));
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
}

module.exports = { runScenario, askedElena, task, timeline, apps };
