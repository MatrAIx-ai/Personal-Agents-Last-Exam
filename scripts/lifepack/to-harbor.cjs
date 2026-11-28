#!/usr/bin/env node
'use strict';
// Turns one LifePack task into a directory that Harbor can run.
//
//   node scripts/lifepack/to-harbor.cjs <package>/tasks/<task-id> --out <dir> [--hinted] [--probe] [--force]
//
//   --hinted   add the hint from tests/hints.md to every session's opening text
//   --probe    run probe.sh in place of the reference solution, to check what the agent's account can reach
//
// The LifePack task stays the only place where sessions are written (context/timeline.yaml).
// This script reads it and writes one Harbor step per session. The output is a build product: do not commit it.
//
// The build also separates the agent from the Apps: the agent runs as its own account and reaches the Apps
// only through image/door (see image/install.sh).
//
// Supported in this version (adapter "harbor-steps" 0.2):
//   - any number of sessions, each opened by a fixed user message
//   - events that arrive before or between sessions, delivered with env.apply_event
//   - scripted user replies inside a session, matched by simple rules on what the assistant says in the chat
// Not supported, and reported as an error instead of being skipped:
//   - sessions opened by an event or a wake-up, events during a session, events that depend on agent actions
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const yaml = require('./yaml.cjs');

const ADAPTER = { name: 'harbor-steps', version: '0.2.0' };
// The account the evaluated agent runs as. image/install.sh creates it, and the App state belongs to another account.
const AGENT_USER = 'agent';
// After each session, Harbor runs the snapshot command as root in the agent's container, collects this file, and
// places it at the same path in the verifier's own container. The folder is closed to the agent's account.
const SNAPSHOT_PATH = '/var/pale/collect/state.json';
// The file's name among the run records (steps/<session>/artifacts/).
const SNAPSHOT_RECORD = 'pale-state.json';
const REPO = path.resolve(__dirname, '../..');
const IMAGE_FILES = path.join(__dirname, 'image');
const MARKER = 'lifepack-build.json';

function usage(message) {
  if (message) console.error(`Error: ${message}\n`);
  console.error('Usage: node scripts/lifepack/to-harbor.cjs <package>/tasks/<task-id> --out <dir> [--hinted] [--probe] [--force]');
  process.exit(2);
}
function options(argv) {
  const out = { hinted: false, probe: false, force: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--out') out.out = argv[++i];
    else if (a === '--hinted') out.hinted = true;
    else if (a === '--probe') out.probe = true;
    else if (a === '--force') out.force = true;
    else if (a.startsWith('--')) usage(`unknown option ${a}`);
    else if (!out.task) out.task = a;
    else usage(`unexpected argument ${a}`);
  }
  if (!out.task || !out.out) usage();
  return out;
}

const problems = [];
const need = (condition, message) => { if (!condition) problems.push(message); return !!condition; };
const isTime = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
const isId = (value) => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(value);

function load(taskDir) {
  const file = (rel) => path.join(taskDir, rel);
  const text = (rel) => {
    if (!need(fs.existsSync(file(rel)), `missing ${rel}`)) return null;
    return fs.readFileSync(file(rel), 'utf8');
  };
  const json = (rel) => { const t = text(rel); try { return t === null ? null : JSON.parse(t); } catch (e) { problems.push(`${rel}: ${e.message}`); return null; } };
  const yml = (rel) => { const t = text(rel); try { return t === null ? null : yaml.parse(t, rel); } catch (e) { problems.push(e.message); return null; } };
  const task = {
    dir: taskDir,
    id: path.basename(taskDir),
    toml: text('task.toml'),
    instruction: text('instruction.md'),
    timeline: yml('context/timeline.yaml'),
    permissions: yml('context/permissions.yaml'),
    persona: json('context/user/persona.json'),
    script: fs.existsSync(file('context/user/script.json')) ? json('context/user/script.json') : { messages: [], replies: [] },
    meta: json('environment/workspace/meta.json'),
    rubrics: yml('tests/rubrics.yaml'),
    hint: text('tests/hints.md'),
  };
  for (const rel of ['environment/Dockerfile', 'solution/solve.sh', 'tests/test.sh']) need(fs.existsSync(file(rel)), `missing ${rel}`);
  need(isId(task.id), `task folder name "${task.id}" must be lowercase letters, digits and hyphens`);
  return task;
}

// Checks the timeline and returns the sessions with their opening text, due events and reply rules.
function plan(task) {
  const { timeline, script, meta, permissions } = task;
  if (!timeline || !meta || !permissions) return [];
  need(timeline.schema === 'pale.timeline/0.1', `context/timeline.yaml: schema must be pale.timeline/0.1, found ${timeline.schema}`);
  need(isTime(timeline.start), 'context/timeline.yaml: start must be a time with a UTC offset, such as 2026-11-16T09:00:00-08:00');
  need(typeof timeline.timezone === 'string', 'context/timeline.yaml: timezone is required');
  need(meta.simulated_time === timeline.start, `environment/workspace/meta.json: simulated_time (${meta.simulated_time}) must equal the timeline start (${timeline.start})`);
  const apps = (meta.apps || []).map((a) => a.app_id);
  need(apps.length > 0, 'environment/workspace/meta.json: apps is empty');
  for (const app of meta.apps || []) need(fs.existsSync(path.join(task.dir, 'environment/workspace', app.dir || app.app_id, 'seed.json')), `environment/workspace/${app.dir || app.app_id}/seed.json is missing`);
  for (const entry of permissions.apps || []) {
    need(apps.includes(entry.app), `context/permissions.yaml: App "${entry.app}" is not in meta.json`);
    need(fs.existsSync(path.join(task.dir, entry.policies || '')), `context/permissions.yaml: policies file not found for ${entry.app}`);
  }
  need(typeof permissions.system_instructions === 'string' && permissions.system_instructions.trim(), 'context/permissions.yaml: system_instructions is required');

  const sessions = Array.isArray(timeline.sessions) ? timeline.sessions : [];
  need(sessions.length > 0, 'context/timeline.yaml: at least one session is required');
  const messages = new Map((script.messages || []).map((m) => [m.id, m]));
  let previous = Date.parse(timeline.start) - 1;
  const seen = new Set();
  const out = [];
  for (const s of sessions) {
    const where = `context/timeline.yaml: session ${s && s.id}`;
    if (!need(s && isId(s.id) && !seen.has(s.id), `${where}: id must be unique, lowercase letters, digits and hyphens`)) continue;
    seen.add(s.id);
    if (!need(isTime(s.at), `${where}: at must be a time with a UTC offset`)) continue;
    need(Date.parse(s.at) > previous, `${where}: sessions must be in time order, at or after the start`);
    previous = Date.parse(s.at);
    need(s.opened_by === 'user', `${where}: opened_by "${s.opened_by}" is not supported. This adapter runs only sessions opened by a user message.`);
    let opening = null;
    if (typeof s.opening === 'string' && s.opening.startsWith('script:')) {
      const m = messages.get(s.opening.slice(7));
      if (need(m && typeof m.text === 'string', `${where}: opening ${s.opening} needs a message with text in context/user/script.json`)) opening = m.text;
    } else if (typeof s.opening === 'string') {
      const f = path.join(task.dir, s.opening);
      if (need(fs.existsSync(f), `${where}: opening file ${s.opening} not found`)) opening = fs.readFileSync(f, 'utf8');
    } else problems.push(`${where}: opening is required (a file path, or script:<message id>)`);
    out.push({ id: s.id, at: s.at, opening: opening && opening.trim(), events: [], replies: [] });
  }

  for (const [i, e] of (timeline.events || []).entries()) {
    const where = `context/timeline.yaml: event ${e && e.id}`;
    if (!need(e && isId(e.id) && isTime(e.at), `${where}: id and at are required`)) continue;
    need(!('when' in e) && !('condition' in e), `${where}: conditional events are not supported by this adapter`);
    need(apps.includes(e.app), `${where}: App "${e.app}" is not in meta.json`);
    const payloadFile = path.join(task.dir, 'context', e.payload || '');
    if (!need(e.payload && fs.existsSync(payloadFile), `${where}: payload file context/${e.payload} not found`)) continue;
    const event = JSON.parse(fs.readFileSync(payloadFile, 'utf8'));
    need(event.at === e.at, `${where}: the payload's "at" (${event.at}) must equal the timeline's (${e.at})`);
    const target = out.find((s) => Date.parse(s.at) >= Date.parse(e.at));
    if (!need(target, `${where}: it is later than the last session, so it would never be delivered`)) continue;
    const before = out[out.indexOf(target) - 1];
    need(!before || Date.parse(e.at) >= Date.parse(before.at), `${where}: events must be listed in time order`);
    // An event after the previous session's opening lands "between" sessions only because a session has no length here.
    target.events.push({ id: e.id, app: e.app, order: i, event });
  }
  for (const s of out) s.events.sort((a, b) => Date.parse(a.event.at) - Date.parse(b.event.at) || a.order - b.order);

  for (const r of script.replies || []) {
    const where = `context/user/script.json: reply ${r && r.id}`;
    const target = out.find((s) => s.id === r.session);
    if (!need(target, `${where}: session "${r.session}" is not in the timeline`)) continue;
    const keys = Object.keys(r.match || {});
    need(keys.length > 0 && keys.every((k) => ['question', 'pattern'].includes(k)), `${where}: match supports only "question" and "pattern"`);
    need(typeof r.text === 'string' && r.text, `${where}: text is required`);
    target.replies.push({ id: r.id, match: r.match, text: r.text, max_uses: r.max_uses || 1 });
  }
  return out;
}

function copyDir(from, to, skip = () => false) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, entry.name);
    const b = path.join(to, entry.name);
    if (skip(a, entry)) continue;
    if (entry.isDirectory()) copyDir(a, b, skip);
    else if (entry.isFile()) fs.copyFileSync(a, b);
  }
}
const write = (file, content, mode) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  if (mode) fs.chmodSync(file, mode);
};
const tomlString = (s) => JSON.stringify(s);

function humanTime(at, timezone) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return `${f.format(new Date(at))} (${timezone}, ${at})`;
}

function build(task, sessions, opts) {
  const out = path.resolve(opts.out);
  if (fs.existsSync(out) && fs.readdirSync(out).length) {
    if (!fs.existsSync(path.join(out, MARKER))) usage(`${out} exists and was not written by this script; choose another --out`);
    if (!opts.force) usage(`${out} already holds a build; pass --force to replace it`);
    fs.rmSync(out, { recursive: true, force: true });
  }
  const apps = task.meta.apps.map((a) => a.app_id);
  const taskSrc = (rel) => path.join(task.dir, rel);

  // ---- environment/: the author's files, the runtime at this checkout, and the task's load payloads.
  copyDir(taskSrc('environment'), path.join(out, 'environment'), (p) => p === taskSrc('environment/workspace'));
  const junk = (p, entry) => entry.isDirectory() && ['node_modules', '.state', '.artifacts', '.git'].includes(entry.name);
  for (const dir of ['runtime', 'apps', 'examples/apps']) copyDir(path.join(REPO, dir), path.join(out, 'environment/pale', dir), junk);
  for (const f of ['apps.registry.json', 'examples/registry.json', 'package.json', 'LICENSE']) {
    if (fs.existsSync(path.join(REPO, f))) write(path.join(out, 'environment/pale', f), fs.readFileSync(path.join(REPO, f)));
  }
  const assets = require(path.join(REPO, 'runtime/core/assets.cjs'));
  const { inside } = require(path.join(REPO, 'runtime/core/registry.cjs'));
  for (const app of task.meta.apps) {
    const dir = taskSrc(path.join('environment/workspace', app.dir || app.app_id));
    const read = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    const payload = { data: read('seed.json'), binding: read('binding.json'), policies: read('policies.json') };
    if (fs.existsSync(path.join(dir, 'catalog.json'))) {
      payload.bundle = assets.fromPackage({ dir, dataset: read('dataset.json'), resources: { catalog: read('catalog.json'), directory: path.join(dir, 'assets') } }, inside);
    }
    write(path.join(out, 'environment/pale-task/private/seed', `${app.app_id}.json`), JSON.stringify(payload) + '\n');
  }
  for (const f of fs.readdirSync(IMAGE_FILES)) {
    const from = path.join(IMAGE_FILES, f);
    write(path.join(out, 'environment/pale-task', f), fs.readFileSync(from), fs.statSync(from).mode & 0o777);
  }
  write(path.join(out, 'environment/pale-task/private/apps.txt'), apps.join('\n') + '\n');

  // ---- tests/: everything the verifier runs. The hint never goes into the container.
  copyDir(taskSrc('tests'), path.join(out, 'tests'), (p) => ['hints.md', 'rubrics.yaml'].includes(path.basename(p)));
  write(path.join(out, 'tests/rubrics.json'), JSON.stringify(task.rubrics, null, 2) + '\n');
  fs.chmodSync(path.join(out, 'tests/test.sh'), 0o755);

  // ---- steps/: one per session.
  const user = (task.persona && task.persona.name) || 'The user';
  const system = task.permissions.system_instructions.trim() + (opts.hinted ? `\n\n${task.hint.trim()}` : '');
  for (const s of sessions) {
    const step = path.join(out, 'steps', s.id);
    write(path.join(step, 'instruction.md'), `${system}\n\nCurrent time: ${humanTime(s.at, task.timeline.timezone)}.\n\n${user} writes:\n\n${s.opening}\n`);
    // The step data reaches the container only when its session starts. The image holds its SHA-256, so the door
    // accepts exactly this file, once, in order. The random value keeps the file from being guessed.
    // The SHA-256 is stored as a file name ("<position>-<sha256>"), not inside a file: Docker's build cache compares
    // a file's size and time, and two builds made in the same second would otherwise share one stale file.
    const stepData = JSON.stringify({ id: s.id, at: s.at, opening: s.opening, events: s.events.map(({ id, app, event }) => ({ id, app, event })), replies: s.replies, nonce: crypto.randomBytes(16).toString('hex') }, null, 2) + '\n';
    s.sha256 = crypto.createHash('sha256').update(stepData).digest('hex');
    write(path.join(step, 'workdir/.pale-step.json'), stepData);
    write(path.join(out, 'environment/pale-task/private/steps', `${String(sessions.indexOf(s)).padStart(2, '0')}-${s.sha256}`), '');
    write(path.join(step, 'workdir/setup.sh'), [
      '#!/bin/bash',
      `# Opens session ${s.id}: delivers the events that are due and moves every App to the session time.`,
      '# Generated by scripts/lifepack/to-harbor.cjs. It removes itself so the workspace stays empty for the agent.',
      'set -euo pipefail',
      'cd "$(dirname "$0")"',
      '# Harbor does not keep the output of a setup script, so a failure also leaves its reason with the run records.',
      'if ! out="$(pale-session < .pale-step.json 2>&1)"; then',
      '  echo "$out" | tee /logs/agent/setup-error.txt >&2',
      '  exit 1',
      'fi',
      'rm -f .pale-step.json setup.sh',
      '',
    ].join('\n'), 0o755);
    if (opts.probe) {
      // The IDs of events that are due in later sessions, encoded so the probe's search does not find its own command line.
      const laterIds = sessions.slice(sessions.indexOf(s) + 1).flatMap((x) => x.events.flatMap((e) => [e.id, e.event.event_id])).filter(Boolean);
      const encoded = Buffer.from([...new Set(laterIds)].join('\n')).toString('base64');
      write(path.join(step, 'solution/probe.sh'), fs.readFileSync(path.join(__dirname, 'probe.sh')), 0o755);
      write(path.join(step, 'solution/solve.sh'), [
        '#!/bin/bash',
        `# Runs the isolation probe for session ${s.id} in place of the reference solution. Generated by scripts/lifepack/to-harbor.cjs.`,
        'DIR="$(cd "$(dirname "$0")" && pwd)"',
        `bash "$DIR/probe.sh" ${s.id} "${encoded}" ${apps.join(',')}`,
        '',
      ].join('\n'), 0o755);
      continue;
    }
    copyDir(taskSrc('solution'), path.join(step, 'solution/reference'));
    write(path.join(step, 'solution/solve.sh'), [
      '#!/bin/bash',
      `# Runs the reference solution for session ${s.id}. Generated by scripts/lifepack/to-harbor.cjs.`,
      'set -euo pipefail',
      'DIR="$(cd "$(dirname "$0")" && pwd)"',
      `bash "$DIR/reference/solve.sh" ${s.id}`,
      '',
    ].join('\n'), 0o755);
  }

  write(path.join(out, 'environment/pale-task/private/task.json'), JSON.stringify({
    task_id: task.id, start: task.timeline.start, timezone: task.timeline.timezone, apps,
    sessions: sessions.map((s) => ({ id: s.id, at: s.at })),
  }, null, 2) + '\n');

  // ---- task.toml: the author's configuration plus the generated sessions, App connections and agent account.
  const lines = task.toml.replace(/\s+$/, '').split('\n');
  const agentTable = lines.findIndex((l) => /^\s*\[agent\]\s*(#.*)?$/.test(l));
  if (agentTable < 0) lines.push('', '[agent]', `user = ${tomlString(AGENT_USER)}`);
  else lines.splice(agentTable + 1, 0, `user = ${tomlString(AGENT_USER)}`);
  const firstTable = lines.findIndex((l) => /^\s*\[/.test(l));
  lines.splice(firstTable < 0 ? lines.length : firstTable, 0,
    '# The score of the task is the verifier result after the last session.', 'multi_step_reward_strategy = "final"',
    '# The state snapshot that each session hands to the verifier.',
    `artifacts = [{ source = ${tomlString(SNAPSHOT_PATH)}, destination = ${tomlString(SNAPSHOT_RECORD)} }]`, '');
  // The verifier gets a container of its own, so the tests and the rubric never enter the agent's container.
  const verifierTable = lines.findIndex((l) => /^\s*\[verifier\]\s*(#.*)?$/.test(l));
  if (verifierTable < 0) lines.push('', '[verifier]', 'environment_mode = "separate"');
  else lines.splice(verifierTable + 1, 0, 'environment_mode = "separate"');
  const server = (name) => ['[[environment.mcp_servers]]', `name = ${tomlString(name)}`, 'transport = "stdio"', 'command = "pale-mcp"', `args = [${tomlString(name)}]`, ''];
  const generated = ['', `# ---- Generated by scripts/lifepack/to-harbor.cjs (${ADAPTER.name} ${ADAPTER.version}). Edit the LifePack task, not this file. ----`, ''];
  for (const name of [...apps, 'chat']) generated.push(...server(name));
  generated.push('[[verifier.collect]]', `command = ${tomlString(`node /opt/pale-task/pale-task.cjs snapshot ${SNAPSHOT_PATH}`)}`, 'user = "root"', 'timeout_sec = 120.0', '');
  for (const s of sessions) generated.push('[[steps]]', `name = ${tomlString(s.id)}`, '');
  write(path.join(out, 'task.toml'), lines.concat(generated).join('\n'));

  let revision = 'unknown';
  let dirty = null;
  try {
    const quiet = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] };
    revision = execFileSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], quiet).trim();
    dirty = execFileSync('git', ['-C', REPO, 'status', '--porcelain', '--', 'runtime', 'apps', 'examples/apps', 'apps.registry.json'], quiet).trim() !== '';
  } catch { /* not a git checkout */ }
  write(path.join(out, MARKER), JSON.stringify({
    format: 'lifepack', format_version: '1.0', adapter: ADAPTER, task_id: task.id, hinted: opts.hinted, probe: opts.probe,
    source: path.relative(REPO, task.dir), runtime_revision: revision, runtime_modified: dirty,
    agent_user: AGENT_USER, verifier: 'separate container', apps, steps: sessions.map((s) => ({ id: s.id, at: s.at, events: s.events.map((e) => e.id), replies: s.replies.map((r) => r.id) })),
  }, null, 2) + '\n');
  return out;
}

const hasChatApp = (task) => ((task.meta && task.meta.apps) || []).some((a) => a.app_id === 'chat');

function main() {
  const opts = options(process.argv.slice(2));
  const taskDir = path.resolve(opts.task);
  if (!fs.existsSync(taskDir)) usage(`${taskDir} does not exist`);
  const task = load(taskDir);
  if (task.toml) {
    need(!/^\s*\[\[steps\]\]/m.test(task.toml), 'task.toml: remove [[steps]]; sessions come from context/timeline.yaml');
    need(!/mcp_servers/.test(task.toml.replace(/^\s*#.*$/gm, '')), 'task.toml: remove mcp_servers; App connections come from environment/workspace/meta.json');
    need(!/^\s*multi_step_reward_strategy\s*=/m.test(task.toml), 'task.toml: remove multi_step_reward_strategy; the adapter sets it');
    const agentSection = (task.toml.split(/^\s*\[agent\]\s*(?:#.*)?$/m)[1] || '').split(/^\s*\[/m)[0];
    need(!/^\s*user\s*=/m.test(agentSection), 'task.toml: remove [agent] user; the adapter sets the account the agent runs as');
    const verifierSection = (task.toml.split(/^\s*\[verifier\]\s*(?:#.*)?$/m)[1] || '').split(/^\s*\[/m)[0];
    need(!/^\s*environment_mode\s*=/m.test(verifierSection), 'task.toml: remove [verifier] environment_mode; the adapter gives the verifier its own container');
    need(!/^\s*artifacts\s*=/m.test(task.toml.split(/^\s*\[/m)[0]), 'task.toml: remove the top-level artifacts; the adapter sets it');
    need(!hasChatApp(task), 'environment/workspace/meta.json: an App cannot be named "chat"; that name is the user chat');
  }
  if (opts.hinted) need(task.hint && task.hint.trim(), 'tests/hints.md is empty, so a hinted build cannot be made');
  const sessions = plan(task);
  if (problems.length) {
    console.error(`Cannot build ${task.id}:`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  const out = build(task, sessions, opts);
  console.log(`${task.id}: ${sessions.length} session(s) -> ${path.relative(process.cwd(), out) || '.'}${opts.hinted ? ' (hinted)' : ''}${opts.probe ? ' (probe)' : ''}`);
  for (const s of sessions) console.log(`  ${s.id}  ${s.at}  events: ${s.events.map((e) => e.id).join(', ') || 'none'}  reply rules: ${s.replies.length}`);
}

main();
