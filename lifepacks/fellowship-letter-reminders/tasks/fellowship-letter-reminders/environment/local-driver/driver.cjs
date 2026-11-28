'use strict';
// LOCAL STAND-IN RUNNER (not the shared LifePack loader / global scheduler / user harness, which are
// not released on main as of 2026-11-25). It does only what this task needs:
//   1. launches the shipped Apps (Mail, Messages, Notes, Files, Contacts) as real MCP processes
//      through runtime/client.cjs with the repository's apps.registry.json,
//   2. loads the task seeds with Infra env.load_seed (identical start for every run),
//   3. delivers timeline.yaml events with Infra env.apply_event in chronological order, advancing
//      every App with env.advance_time and checking the clock barrier before each session,
//   4. drives an agent adapter session by session over the Agent MCP connections plus a user-chat
//      channel that applies Ana's out-of-office rule, and
//   5. exports run.json (final App data, per-session checkpoints, transcript, tool calls, events)
//      for tests/test_outcomes.py.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const world = require('./world.cjs');

const TASK = path.resolve(__dirname, '../..');
const APPS = ['mail', 'messages', 'notes', 'files', 'contacts'];
const t = s => Date.parse(s);

function readJsonYaml(file) {
  // timeline.yaml / permissions.yaml / rubrics.yaml are JSON bodies under '#' comment headers.
  const text = fs.readFileSync(file, 'utf8').split('\n').filter(l => !/^\s*#/.test(l)).join('\n');
  return JSON.parse(text);
}
function findRepoRoot() {
  const candidates = [process.env.PALE_REPO_ROOT, path.resolve(TASK, '../../../..')].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(path.join(c, 'runtime/client.cjs')) && fs.existsSync(path.join(c, 'apps.registry.json'))) return c;
  throw new Error('Cannot find the PALE repository root (set PALE_REPO_ROOT).');
}
const stripBytes = v => JSON.parse(JSON.stringify(v, (k, x) => (k === 'base64' && typeof x === 'string' ? `<${x.length} base64 chars>` : x)));

class Run {
  constructor({agent, hinted = false, runId, stateDir, label}) {
    this.root = findRepoRoot();
    this.agent = agent; this.hinted = hinted; this.label = label || agent.name || 'agent';
    this.runId = runId || ('flr-' + Date.now().toString(36));
    this.stateDir = stateDir || fs.mkdtempSync(path.join(os.tmpdir(), 'flr-state-'));
    this.timeline = readJsonYaml(path.join(TASK, 'context/timeline.yaml'));
    this.script = JSON.parse(fs.readFileSync(path.join(TASK, 'context/user/script.json'), 'utf8'));
    this.clients = []; this.infra = {}; this.agentConn = {};
    this.transcript = []; this.toolCalls = []; this.events = []; this.delivered = new Set();
    this.checkpoints = {}; this.seq = 0; this.oooSentFor = new Set();
  }
  async open(app, role) {
    const {Client} = require(path.join(this.root, 'runtime/client.cjs'));
    const c = new Client(app, role, this.runId, this.stateDir, 'flr-local-driver', {registry: path.join(this.root, 'apps.registry.json')});
    this.clients.push(c); await c.initialize(); return c;
  }
  async snap(app) { return this.infra[app].call('env.snapshot'); }
  async data() { const d = {}; for (const a of APPS) d[a] = (await this.snap(a)).snapshot.data; return d; }

  async setup() {
    const ws = path.join(TASK, 'environment/workspace');
    this.seedIds = {};
    for (const app of APPS) {
      this.infra[app] = await this.open(app, 'infra');
      const tools = (await this.infra[app].request('tools/list')).result.tools.map(x => x.name);
      if (!tools.includes('env.advance_time')) throw new Error(app + ': host lacks env.advance_time (runtime >= 1.6.0 required)');
      const read = f => JSON.parse(fs.readFileSync(path.join(ws, app, f), 'utf8'));
      const seed = read('seed.json');
      const s = await this.snap(app);
      const r = await this.infra[app].call('env.load_seed', {expected_version: s.version, request_id: 'flr-seed', data: seed,
        binding: read('binding.json'), policies: read('policies.json'), bundle: read('bundle.json'), virtual_now: this.timeline.initial_virtual_now});
      if (r.status !== 'ready') throw new Error(app + ' seed failed: ' + JSON.stringify(r));
      if (!r.quality?.automated_pass) throw new Error(app + ' seed quality failed: ' + JSON.stringify(r.quality));
      const key = {mail: 'messages', messages: 'messages', notes: 'notes', files: 'files', contacts: 'contacts'}[app];
      this.seedIds[app] = new Set(seed[key].map(x => x.id));
      this.agentConn[app] = await this.open(app, 'agent');
    }
    this.agentTools = [];
    for (const app of APPS) for (const tl of (await this.agentConn[app].request('tools/list')).result.tools) this.agentTools.push({...tl, app});
  }

  async advanceAll(at, tag) {
    for (const app of APPS) {
      const s = await this.snap(app);
      if (t(s.snapshot.virtual_now) >= t(at)) continue;
      const r = await this.infra[app].call('env.advance_time', {request_id: 'clk-' + tag + '-' + (++this.seq), expected_version: s.version, virtual_now: at});
      if (r.status !== 'committed') throw new Error('advance_time failed for ' + app + ': ' + JSON.stringify(r));
    }
  }
  async barrier(at) {
    for (const app of APPS) { const v = (await this.snap(app)).snapshot.virtual_now; if (t(v) !== t(at)) throw new Error(`clock barrier: ${app} at ${v}, expected ${at}`); }
  }
  async apply(app, event) {
    const s = await this.snap(app);
    const r = await this.infra[app].call('env.apply_event', {expected_version: s.version, event});
    if (r.status !== 'committed') throw new Error('apply_event failed: ' + JSON.stringify(r));
    return r;
  }
  async out() { return world.outgoing(await this.data(), this.seedIds); }

  mailEvent(id, at, {from, thread_id, subject, body}) {
    return {event_id: id, at, operation: 'mail.deliver', payload: {id: 'in-' + id, thread_id, account_id: 'mail-ana', from, to: ['ana.reyes@cs.harrow.example.org'],
      subject: subject.slice(0, 200), body, received_at: at, folder: 'inbox', read: false, attachments: []}};
  }
  messageEvent(id, at, conversation_id, author, text) {
    return {event_id: id, at, operation: 'messages.upsert', payload: {id: 'in-' + id, account_id: 'messages-ana', created_at: at, updated_at: at,
      history: [{at, action: 'received'}], conversation_id, author_person_id: author, text, sent_at: at, received_at: at,
      read_by: [author], retracted: false, attachments: [], edits: []}};
  }
  async replyOnChannel(ev, at, trigger) {
    if (trigger.app === 'mail') {
      const from = world.PEOPLE[ev.from_person].addresses[0];
      const subject = /^re:/i.test(trigger.subject) ? trigger.subject : 'Re: ' + trigger.subject;
      return ['mail', await this.apply('mail', this.mailEvent(ev.id, at, {from, thread_id: trigger.thread_id, subject, body: ev.text}))];
    }
    return ['messages', await this.apply('messages', this.messageEvent(ev.id, at, trigger.conversation_id, ev.from_person, ev.text))];
  }

  // Deliver every due event up to `until`, in chronological order (ties: table order).
  async processDue(until) {
    for (;;) {
      const out = await this.out();
      const pending = this.timeline.events.map((ev, i) => ({ev, i, at: this.events.some(e => e.id === ev.id) ? null : world.resolveAt(ev, out)}))
        .filter(x => x.at && t(x.at) <= t(until)).sort((a, b) => t(a.at) - t(b.at) || a.i - b.i);
      if (!pending.length) return;
      const {ev, at} = pending[0];
      if (ev.kind === 'seeded_history') { this.events.push({id: ev.id, at, status: 'seeded', condition: ev.condition, status_of: ev.status, record_id: ev.record_ref.id}); continue; }
      await this.advanceAll(at, ev.id);
      const outAt = out.filter(o => t(o.at) <= t(at));
      const cond = world.evaluate(ev.condition, {out: outAt, at, delivered: this.delivered});
      if (!cond.holds) { this.events.push({id: ev.id, at, status: 'skipped', condition: ev.condition}); continue; }
      let app, r;
      if (ev.kind === 'status_mail') { app = 'mail'; r = await this.apply('mail', this.mailEvent(ev.id, at, ev.mail)); }
      else if (ev.kind === 'reply_on_channel') [app, r] = await this.replyOnChannel(ev, at, cond.trigger);
      else throw new Error('Unknown event kind ' + ev.kind);
      this.delivered.add(ev.id);
      this.events.push({id: ev.id, at, status: 'delivered', condition: ev.condition, app, record_id: 'in-' + ev.id,
        status_of: ev.status || null, triggered_by: cond.trigger ? {app: cond.trigger.app, id: cond.trigger.id, at: cond.trigger.at} : null, receipt_version: r.version});
    }
  }
  pendingAtEnd(out) {
    for (const ev of this.timeline.events) {
      if (this.events.some(e => e.id === ev.id)) continue;
      const at = world.resolveAt(ev, out);
      this.events.push({id: ev.id, at, status: at ? 'not_due_before_end' : 'never_scheduled', condition: ev.condition});
    }
  }

  oooRule() { return this.timeline.auto_replies.find(a => a.id === 'ev-ana-ooo'); }
  async chatToAna(session, at, text, kind = 'message') {
    this.transcript.push({session, at, role: 'agent', channel: 'chat', kind, text});
    const ooo = this.oooRule();
    if (t(at) < t(ooo.before)) {
      this.transcript.push({session, at, role: 'auto_reply', channel: 'chat', event_id: ooo.id, text: ooo.channels.chat});
      return {status: 'delivered', auto_reply: ooo.channels.chat};
    }
    if (kind === 'final') return {status: 'delivered'};  // Ana reads the session's final answer; no reply
    const {id, answer} = this.answer(text);
    this.transcript.push({session, at, role: 'user', channel: 'chat', scripted_answer_id: id, text: answer});
    return {status: 'delivered', reply: answer};
  }
  answer(question) {
    // Fixed answers from script.json (first match wins); Ana never gives new instructions.
    const q = String(question).toLowerCase();
    const hit = this.script.fixed_answers.find(a => a.match_any.some(m => q.includes(m)));
    return hit ? {id: hit.id, answer: hit.answer} : {id: 'default', answer: this.script.default_answer};
  }
  async mailToAnaAutoReplies(session) {
    const ooo = this.oooRule(), mail = (await this.snap('mail')).snapshot.data;
    for (const m of mail.messages) {
      if (this.seedIds.mail.has(m.id) || m.folder !== 'sent' || this.oooSentFor.has(m.id)) continue;
      if (!m.to.map(world.personForAddress).includes(world.ANA) || t(m.sent_at) >= t(ooo.before)) continue;
      this.oooSentFor.add(m.id);
      const id = 'ev-ana-ooo-' + m.id;
      await this.apply('mail', this.mailEvent(id, m.sent_at, {from: ooo.channels.mail.from, thread_id: m.thread_id,
        subject: ooo.channels.mail.subject_prefix + m.subject, body: ooo.channels.mail.body}));
      this.events.push({id, at: m.sent_at, status: 'delivered', condition: 'agent_message_to_ana_before:' + ooo.before, app: 'mail', record_id: 'in-' + id, triggered_by: {app: 'mail', id: m.id, at: m.sent_at}});
      this.transcript.push({session, at: m.sent_at, role: 'auto_reply', channel: 'mail', event_id: id, text: ooo.channels.mail.body});
    }
  }

  userMessage(session) {
    if (session.kind === 'scheduled_check_in') return null;
    if (session.message_ref === 'instruction.md') return fs.readFileSync(path.join(TASK, 'instruction.md'), 'utf8').trim();
    return this.script.sessions[session.id].message;
  }
  hintText() {
    const md = fs.readFileSync(path.join(TASK, 'tests/hints.md'), 'utf8');
    return md.match(/<!-- hint:start -->\s*([\s\S]*?)\s*<!-- hint:end -->/)[1].trim();
  }

  async runSession(session) {
    await this.processDue(session.start);
    await this.advanceAll(session.start, session.id);
    await this.barrier(session.start);
    const at = session.start, user = this.userMessage(session);
    if (user) this.transcript.push({session: session.id, at, role: 'user', channel: 'chat', text: user});
    else this.transcript.push({session: session.id, at, role: 'system', channel: 'chat', text: session.system_notice});
    const hint = this.hinted ? this.hintText() : null;
    if (hint) this.transcript.push({session: session.id, at, role: 'system', channel: 'hint', text: hint});
    let finalText = null;
    const ctx = {
      session: session.id, now: at, userMessage: user, systemNotice: user ? null : session.system_notice, hint,
      tools: [...this.agentTools.map(x => ({name: x.name, description: x.description, inputSchema: x.inputSchema})),
        {name: 'user.send_message', description: 'Send a chat message to Ana (the user). Returns any reply or automatic reply.',
         inputSchema: {type: 'object', properties: {text: {type: 'string'}}, required: ['text']}}],
      call: async (name, args = {}) => {
        let result, error = null;
        try {
          if (name === 'user.send_message') result = await this.chatToAna(session.id, at, args.text);
          else {
            const tool = this.agentTools.find(x => x.name === name);
            if (!tool) throw new Error('Unknown tool ' + name);
            result = await this.agentConn[tool.app].call(name, args);
            if (name === 'mail.send' && result.status === 'committed') await this.mailToAnaAutoReplies(session.id);
          }
        } catch (e) { error = String(e.message || e); result = {status: 'error', message: error}; }
        this.toolCalls.push({session: session.id, at, name, args: stripBytes(args), status: result.status, error});
        return result;
      },
      final: text => { finalText = text; },
    };
    await this.agent.runSession(ctx);
    if (finalText) await this.chatToAna(session.id, at, finalText, 'final');
    this.checkpoints[session.id] = {virtual_now: at, data: await this.data()};
  }

  async assets() {
    const out = {};
    for (const app of APPS) {
      const s = (await this.snap(app)).snapshot;
      out[app] = Object.fromEntries(s.resources.bundle.catalog.assets.map(a => [a.asset_id, {sha256: a.integrity?.sha256 || null,
        filename: path.basename(a.storage.path || a.asset_id), mime_type: a.mime_type, owner: a.subjects[0] || null}]));
    }
    return out;
  }

  async execute() {
    const started = new Date().toISOString();
    try {
      await this.setup();
      for (const s of this.timeline.sessions) await this.runSession(s);
      this.pendingAtEnd(await this.out());
      const audit = {};
      for (const app of APPS) audit[app] = (await this.snap(app)).snapshot.audit.map(r => ({seq: r.seq, actor: r.actor, tool: r.tool, decision: r.decision, virtual_time: r.virtual_time, clock: r.clock || null}));
      return {
        schema: 'flr.run.v1', task_id: 'fellowship-letter-reminders', run_id: this.runId, label: this.label, hinted: this.hinted,
        runner: {name: 'fellowship-letter-reminders local stand-in driver', version: '1.0.0', stand_in: true},
        agent: this.agent.describe ? this.agent.describe() : {name: this.agent.name},
        runtime_version: require(path.join(this.root, 'runtime/package.json')).version, node: process.version,
        wall: {started, finished: new Date().toISOString()},
        timezone: this.timeline.timezone,
        seed_ids: Object.fromEntries(APPS.map(a => [a, [...this.seedIds[a]]])),
        sessions: this.timeline.sessions.map(s => ({id: s.id, start: s.start, kind: s.kind})),
        transcript: this.transcript, tool_calls: this.toolCalls,
        events: this.events.sort((a, b) => (t(a.at) || Infinity) - (t(b.at) || Infinity)),
        checkpoints: this.checkpoints, final: await this.data(), assets: await this.assets(), audit,
      };
    } finally {
      await Promise.allSettled(this.clients.map(c => c.close()));
      if (!process.env.FLR_KEEP_STATE) fs.rmSync(this.stateDir, {recursive: true, force: true});
    }
  }
}
module.exports = {Run, readJsonYaml, TASK};
