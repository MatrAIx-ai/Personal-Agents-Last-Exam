'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const load = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const copy = structuredClone;
const apps = ['mail', 'notes'];

class Scenario {
  constructor(task, core, saved) {
    this.task = task;
    const read = name => load(path.join(task, name));
    this.timeline = read('context/timeline.yaml');
    this.permissions = read('context/permissions.yaml');
    this.script = read('context/user/script.json');
    this.meta = read('environment/workspace/meta.json');
    this.seeds = Object.fromEntries(apps.map(id => [id, read('environment/workspace/' + id + '/seed.json')]));
    this.identity = crypto.createHash('sha256').update(JSON.stringify(
      [this.meta, this.timeline, this.permissions, this.script, this.seeds])).digest('hex');
    const {createRuntime} = require(path.join(core, 'runtime/core/runtime.cjs'));
    this.core = createRuntime({registryFile: path.join(core, 'apps.registry.json')});
    if (saved) {
      if (saved.format !== 1 || saved.identity !== this.identity) throw Error('Checkpoint belongs to a different fixture');
      this.run = saved;
      for (const app of apps) this.run.apps[app] = this.core.normalize(saved.apps[app]);
      const completed = this.timeline.sessions.slice(0, saved.session).map(s => s.id);
      if (saved.session < 0 || saved.session > this.timeline.sessions.length ||
          JSON.stringify(Object.keys(saved.checkpoints)) !== JSON.stringify(completed) ||
          apps.some(app => Date.parse(saved.apps[app].virtual_now) !== Date.parse(saved.clock))) {
        throw Error('Incomplete session or inconsistent App clocks');
      }
      return;
    }
    this.run = {format: 1, identity: this.identity, session: 0, clock: this.timeline.initial_time,
      apps: {}, delivered: [], transcript: [], checkpoints: {}, started: new Date().toISOString()};
    const binding = {people: [this.meta.person], accounts: apps.map(app_id => ({
      app_id, account_id: this.meta.accounts[app_id], owner_person_id: this.meta.person.person_id})), objects: {}};
    for (const app of apps) {
      this.run.apps[app] = this.core.create(app, 'blind-review-packet');
      if (this.run.apps[app].package_version !== this.meta.app_versions[app]) throw Error('App version mismatch: ' + app);
      const policy = this.permissions[app];
      this.infra(app, 'env.load_seed', {data: this.seeds[app], binding,
        policies: {scenario: policy, sandbox: policy}, virtual_now: this.timeline.initial_time,
        request_id: 'load-' + app});
    }
    this.run.initial = this.snapshot();
    this.record('controller', 'session.open', {session: this.current().id});
  }

  current() { return this.timeline.sessions[this.run.session]; }

  record(actor, type, data) {
    this.run.transcript.push({seq: this.run.transcript.length + 1, at: this.run.clock, actor, type, ...copy(data)});
  }

  infra(app, tool, args) {
    const state = this.run.apps[app];
    const {result, state: next} = this.core.execute(state, 'infra', tool,
      {expected_version: this.core.version(state), ...args});
    if (!['ready', 'ok', 'committed'].includes(result.status)) {
      throw Error(tool + ' failed on ' + app + ': ' + JSON.stringify(result));
    }
    this.run.apps[app] = next;
  }

  advance(at) {
    for (const entry of this.timeline.events) {
      if (this.run.delivered.includes(entry.event_id) || Date.parse(entry.at) > Date.parse(at)) continue;
      const {app, ...event} = entry;
      this.infra(app, 'env.apply_event', {event});
      this.run.delivered.push(event.event_id);
      this.run.clock = event.at;
      this.record('world', 'event.delivered', {app, event: event.event_id, record: event.payload.id});
    }
    for (const app of apps) {
      this.infra(app, 'env.advance_time', {virtual_now: at, request_id: 'clock-' + Date.parse(at)});
      if (Date.parse(this.run.apps[app].virtual_now) !== Date.parse(at)) throw Error('App clock mismatch');
    }
    this.run.clock = at;
  }

  snapshot() {
    return {at: this.run.clock, apps: Object.fromEntries(apps.map(app => {
      const state = this.run.apps[app];
      return [app, {at: state.virtual_now, version: this.core.version(state), data: copy(state.data)}];
    }))};
  }

  status() {
    const s = this.current();
    return {session: s ? s.id : 'complete', at: this.run.clock, deadline: s?.deadline};
  }

  agent(request) {
    const s = this.current();
    if (!s) throw Error('Both sessions are complete');
    if (request.op === 'status') return this.status();
    if (request.op === 'tools') return apps.flatMap(app => this.core.definitions(this.run.apps[app], 'agent')
      .map(({name, description, inputSchema}) => ({name, description, inputSchema})));
    if (request.op !== 'call' && !['say','ask'].includes(request.op)) throw Error('Unknown agent operation');
    if (this.run.clock === s.start) this.advance(s.work_time);
    if (request.op !== 'call') {
      if (typeof request.text !== 'string' || !request.text.trim()) throw Error('Message text is required');
      this.record('agent', 'message.to-ren', {text: request.text});
      const reply = request.op === 'ask' && this.run.session === 0 ? this.script.morning_clarification : null;
      if (reply) this.record('user', 'message.from-ren', {text: reply});
      return {delivered: true, reply};
    }
    const {name, args = {}} = request;
    const app = typeof name === 'string' && name.split('.')[0];
    if (!apps.includes(app)) throw Error('Unknown App');
    const {state, result} = this.core.execute(this.run.apps[app], 'agent', name, args);
    this.run.apps[app] = state;
    this.record('agent', 'app.call', {name, args, result});
    return result;
  }

  close(id) {
    if (Object.hasOwn(this.run.checkpoints, id)) return this.run.checkpoints[id];
    const s = this.current();
    if (!s || id !== s.id) throw Error('Unexpected session boundary: ' + id);
    this.advance(s.deadline);
    const snapshot = this.snapshot();
    this.run.checkpoints[id] = snapshot;
    this.record('controller', 'checkpoint', {session: id});
    this.run.session++;
    if (this.current()) {
      this.advance(this.current().start);
      this.record('controller', 'session.open', {session: this.current().id});
    }
    return snapshot;
  }

  evidence() {
    return copy({format: 1, identity: this.identity, started: this.run.started, ended: new Date().toISOString(),
      initial: this.run.initial, checkpoints: this.run.checkpoints, transcript: this.run.transcript,
      delivered: this.run.delivered, final: this.snapshot()});
  }
}
module.exports = {Scenario};
