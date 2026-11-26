#!/usr/bin/env node
'use strict';
// Shows Mail 1.3.0 and Notes 1.0.0 through the real stdio tools, including reset.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PACKAGE = path.resolve(__dirname, '..');
const TASK = path.join(PACKAGE, 'tasks/inbox-cleanup-consent');

function repoRoot(start) {
  const configured = process.env.PALE_REPO_ROOT;
  if (configured) {
    if (fs.existsSync(path.join(configured, 'runtime/client.cjs')) && fs.existsSync(path.join(configured, 'apps.registry.json'))) return configured;
    throw new Error('PALE checkout not found');
  }
  let dir = start;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'runtime/client.cjs')) && fs.existsSync(path.join(dir, 'apps.registry.json'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('PALE checkout not found');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function counts(messages) {
  const out = {};
  for (const message of messages) out[message.folder] = (out[message.folder] || 0) + 1;
  return out;
}

async function main() {
  const root = repoRoot(TASK);
  const {Client} = require(path.join(root, 'runtime/client.cjs'));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pale-icc-demo-'));
  const registry = path.join(root, 'apps.registry.json');
  const clients = [];
  const open = async (app, role) => {
    const client = new Client(app, role, 'icc-demo', stateDir, 'inbox-cleanup-demo', {
      registry,
      initialProfile: role === 'infra' ? 'sandbox' : undefined
    });
    clients.push(client);
    await client.initialize();
    return client;
  };
  try {
    const mail = await open('mail', 'infra');
    const notes = await open('notes', 'infra');
    const now = '2026-11-16T09:02:00-08:00';
    const loaded = {};
    for (const [app, client, data, binding, policies] of [
      ['mail', mail, readJson(path.join(TASK, 'environment/workspace/mail/seed.json')), readJson(path.join(TASK, 'environment/workspace/mail/binding.json')), readJson(path.join(TASK, 'environment/workspace/mail/policies.json'))],
      ['notes', notes, readJson(path.join(TASK, 'environment/workspace/notes/seed-a.json')), readJson(path.join(TASK, 'environment/workspace/notes/binding.json')), readJson(path.join(TASK, 'environment/workspace/notes/policies.json'))]
    ]) {
      const snap = await client.call('env.snapshot');
      const result = await client.call('env.load_seed', {expected_version: snap.version, request_id: 'seed-' + app, data, binding, policies, virtual_now: now});
      loaded[app] = {status: result.status, loaded: result.loaded, version: result.version};
    }
    const agentMail = await open('mail', 'agent');
    const agentNotes = await open('notes', 'agent');
    const labels = readJson(path.join(TASK, 'tests/labels.json'));
    const opened = await mail.call('env.snapshot');
    const search = await agentMail.call('mail.search', {folder: 'inbox'});
    const delgadoHit = search.messages.find((message) => String(message.subject || '').includes('Parenting-plan'));
    const one = await agentMail.call('mail.get', {id: delgadoHit.id});
    const listed = await agentNotes.call('notes.list', {});
    const note = await agentNotes.call('notes.get', {id: 'note-2026-03-03-delete'});
    let denied = null;
    try {
      denied = await agentMail.call('env.advance_time', {expected_version: search.version, virtual_now: '2026-11-16T09:03:00-08:00', request_id: 'deny-clock'});
    } catch (err) {
      denied = {status: 'error', message: String(err.message || err)};
    }
    const before = counts(opened.snapshot.data.messages);
    const moved = await agentMail.call('mail.move', {id: labels.eligible[0], folder: 'archive', expected_version: search.version, request_id: 'demo-move'});
    const mid = await mail.call('env.snapshot');
    const reset = await mail.call('env.reset', {expected_version: mid.version});
    const after = await mail.call('env.snapshot');
    const {countMessages} = require('./tokenize.cjs');
    const measured = countMessages(search.messages);
    const report = {
      schema: 'pale.inbox-cleanup.dependency-demo.v1',
      apps: {
        mail: {version: '1.3.0', path: 'examples/apps/mail'},
        notes: {version: '1.0.0', path: 'apps/notes'},
        runtime: {version: '1.6.0', path: 'runtime'}
      },
      loaded,
      inbox_search: {
        status: search.status,
        count: search.messages.length,
        bytes: JSON.stringify(search.messages).length,
        character_tokens: measured.character_tokens,
        o200k_base: measured.o200k_base,
        cl100k_base: measured.cl100k_base,
        tokenizer: 'js-tiktoken'
      },
      folder_counts_at_start: before,
      delgado: {id: one.message.id, received_at: one.message.received_at, read: one.message.read, folder: one.message.folder, subject: one.message.subject},
      notes_list_ids: listed.items.map((item) => item.id),
      delete_note: {id: note.item.id, body: note.item.body},
      agent_clock_call: denied,
      move: {id: moved.id, status: moved.status},
      after_move: counts(mid.snapshot.data.messages),
      reset: {status: reset.status, virtual_now: after.snapshot.virtual_now, folders: counts(after.snapshot.data.messages)}
    };
    const out = path.join(PACKAGE, 'demo/inbox-cleanup-consent/evidence/dependency-demo.json');
    fs.mkdirSync(path.dirname(out), {recursive: true});
    fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
    const ok = report.inbox_search.count === 900
      && report.inbox_search.o200k_base > 0
      && report.inbox_search.o200k_base <= 120000
      && report.inbox_search.character_tokens > 0
      && report.folder_counts_at_start.inbox === 900
      && report.folder_counts_at_start.sent === 4
      && !report.folder_counts_at_start.archive
      && !report.folder_counts_at_start.trash
      && report.delgado.read === false
      && report.delgado.subject.includes('Parenting-plan')
      && report.notes_list_ids.length === 5
      && report.reset.folders.inbox === 900
      && report.reset.folders.sent === 4
      && !report.reset.folders.archive
      && !report.reset.folders.trash
      && report.reset.virtual_now === now
      && report.agent_clock_call.status === 'permission_denied';
    console.log(JSON.stringify({ok, tokens: report.inbox_search, reset: report.reset, denied: report.agent_clock_call.status}));
    if (!ok) process.exit(1);
  } finally {
    await Promise.allSettled(clients.map((client) => client.close()));
    fs.rmSync(stateDir, {recursive: true, force: true});
  }
}

main().catch((err) => {
  console.error(err.stack || err);
  process.exit(1);
});
