#!/usr/bin/env node
'use strict';
// Management commands for one task container. They use the Infra connection of every App.
// In the image only the service account "pale" and root can run them: the agent's account cannot read the state directory.
//   pale-task.cjs init                 load every App's records and set the clock to the first session (image build, as pale)
//   pale-task.cjs session -            open the next session from the step data on standard input (through the door, as pale)
//   pale-task.cjs snapshot OUT.json    write every App's full state and the chat log (the verifier, as root)
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { PRIVATE_DIR, STATE_DIR, SESSION_FILE, CHAT_FILE, readJson, writeJson, taskConfig, withConns } = require('./lib.cjs');

const ok = (r, statuses, what) => {
  if (!r || !statuses.includes(r.status)) throw new Error(`${what}: ${r && r.status} ${(r && r.message) || ''}`);
  return r;
};
const version = async (conn) => (await conn.call('env.snapshot')).version;

async function init() {
  const task = taskConfig();
  if (fs.existsSync(SESSION_FILE)) throw new Error('This state directory is already initialized.');
  await withConns('infra', 'pale-task-init', async (open) => {
    for (const app of task.apps) {
      const conn = await open(app);
      const payload = readJson(path.join(PRIVATE_DIR, 'seed', `${app}.json`));
      ok(await conn.call('env.load_seed', { ...payload, expected_version: await version(conn), request_id: 'seed', virtual_now: task.start }), ['ready'], `load ${app}`);
    }
  });
  writeJson(CHAT_FILE, { messages: [] });
  writeJson(SESSION_FILE, { id: null, at: task.start, replies: [], used: {}, opened: [] });
  console.log(`initialized ${task.apps.length} Apps at ${task.start}`);
}

// The step data arrives from the agent's side of the container, so it is checked before anything is applied:
// it must be exactly the data this build made for the next session, and each session opens once.
// The agent therefore cannot open a session early, repeat one, or deliver events of its own.
async function session(source) {
  const task = taskConfig();
  const raw = fs.readFileSync(source === '-' ? 0 : source);
  const digest = crypto.createHash('sha256').update(raw).digest('hex');
  // private/steps holds one empty file per session, named "<position>-<sha256 of its step data>".
  const allowed = fs.readdirSync(path.join(PRIVATE_DIR, 'steps')).sort();
  const index = allowed.findIndex((name) => name.slice(name.indexOf('-') + 1) === digest);
  if (index < 0) throw new Error('the step data is not part of this task build');
  const step = JSON.parse(raw.toString('utf8'));
  const current = readJson(SESSION_FILE);
  if (current.id === step.id) { console.log(`session ${step.id} is already open`); return; }
  if (current.opened.includes(step.id)) throw new Error(`session ${step.id} was already used`);
  if (index !== current.opened.length) throw new Error(`session ${step.id} is not the next session`);
  await withConns('infra', 'pale-task-session', async (open) => {
    // 1. Deliver due events in order. Each event carries its own time.
    for (const event of step.events) {
      const conn = await open(event.app);
      const r = ok(await conn.call('env.apply_event', { expected_version: await version(conn), event: event.event }), ['committed'], `event ${event.id}`);
      if (r.duplicate) console.log(`event ${event.id} was already applied`);
    }
    // 2. Move every App to the session time, including Apps that received nothing.
    for (const app of task.apps) {
      const conn = await open(app);
      const snap = await conn.call('env.snapshot');
      if (snap.snapshot.virtual_now === step.at) continue;
      ok(await conn.call('env.advance_time', { expected_version: snap.version, request_id: `session-${step.id}`, virtual_now: step.at }), ['committed'], `advance ${app}`);
    }
    // 3. Confirm the clock barrier before the agent starts.
    for (const app of task.apps) {
      const now = (await (await open(app)).call('env.snapshot')).snapshot.virtual_now;
      if (now !== step.at) throw new Error(`${app} is at ${now}, expected ${step.at}`);
    }
  });
  const chat = readJson(CHAT_FILE);
  chat.messages.push({ id: `${step.id}-open`, session: step.id, at: step.at, role: 'user', text: step.opening });
  writeJson(CHAT_FILE, chat);
  writeJson(SESSION_FILE, { id: step.id, at: step.at, replies: step.replies || [], used: {}, opened: [...current.opened, step.id] });
  console.log(`session ${step.id} open at ${step.at}; events applied: ${step.events.map((e) => e.id).join(', ') || 'none'}`);
}

async function snapshot(outFile) {
  const task = taskConfig();
  const out = { task_id: task.task_id, session: readJson(SESSION_FILE), chat: readJson(CHAT_FILE), apps: {} };
  await withConns('infra', 'pale-task-snapshot', async (open) => {
    for (const app of task.apps) out.apps[app] = (await (await open(app)).call('env.snapshot')).snapshot;
  });
  writeJson(path.resolve(outFile), out);
}

const [command, arg] = process.argv.slice(2);
const run = { init, session: () => session(arg), snapshot: () => snapshot(arg) }[command];
if (!run || (command !== 'init' && !arg)) {
  console.error('Usage: pale-task.cjs init | session - | snapshot OUT.json');
  process.exit(2);
}
fs.mkdirSync(STATE_DIR, { recursive: true });
run().catch((e) => { console.error(`pale-task ${command} failed: ${e.message}`); process.exit(1); });
