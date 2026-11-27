'use strict';
// App-only test context: real Fernshelf hooks, the package's own schemas and the vendored public
// schema validator. It is not a second Core: write idempotency, stale versions, policies,
// persistence and the Agent/Infra split are tested against the real runtime in scripts/real-mcp.cjs.
//
// Commit/discard semantics mirror runtime/core/runtime.cjs execute(): the hook receives a working
// copy of the data; on success the result is validated (seed schema, validateSeed, output schema)
// and becomes the data; on any throw the working copy is discarded and a denial row is appended
// to the audit, and for an event the clock rolls back. Because of that discard, "a refusal leaves
// data unchanged" is true by construction for the stored data, so the harness checks a stronger
// property: every refusal, of an Agent write and of an event, is decided before the hook changes
// anything in its working copy (`working_copy_changed`). Core's replay of a committed event_id
// (stored receipt, no handler run) is mirrored so that tests can show a replay keeps the first
// resolution of an album_match. The asset reader stands in for Core's ctx.assets.read: it serves
// the package's catalogued bytes only for an asset whose parent item holds it.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {compile} = require('./schema-validator.cjs');
const plugin = require('../plugin.cjs');
const tools = require('../tools.json');
const pkg = path.resolve(__dirname, '..'), schemas = path.join(pkg, 'schemas');
const seedValid = compile(require('../schemas/seed.schema.json'), schemas);
const eventValid = compile(require('../schemas/events.schema.json'), schemas);
const input = new Map(tools.map(t => [t.name, compile(t.inputSchema, pkg)]));
const output = new Map(tools.map(t => [t.name, compile(t.outputSchema, pkg)]));
const eventTypes = require('../app.json').event_types;
const catalog = require('../contribution/assets.catalog.json');
const deepFreeze = o => { if (o && typeof o === 'object') { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
const SEEDS = {minimal: path.join(pkg, 'fixtures/minimal.json'), reference: path.join(pkg, 'fixtures/reference.json')};
const loaded = new Map();
// Every activity row the App writes in any test, by shape (action, actor, details keys, effect or
// not), so tests/log-shapes.test.cjs can compare it with the rows the fixture checker accepts.
const written = new Map();
const note = (before, after) => { for (const r of after.activity.slice(before.activity.length)) { const k = [r.action, r.actor, r.details ? Object.keys(r.details).sort().join(',') : '-', r.cause_seq !== undefined].join('|'); if (!written.has(k)) written.set(k, r); } };
const seedOf = name => { if (!loaded.has(name)) loaded.set(name, JSON.parse(fs.readFileSync(SEEDS[name], 'utf8'))); return loaded.get(name); };
const CLOCK = require('../fixtures/clock.json').initial_time;

function assetReader(getData) {
  return {read(id) {
    const a = catalog.assets.find(x => x.asset_id === id);
    const refs = plugin.assetReferences(getData());
    if (!a || !refs.some(r => r.asset_id === id && a.subjects.some(s => s.object_id === r.object_id))) {
      throw Object.assign(new Error('Attachment is not available to this caller'), {code: 'not_available'});
    }
    const bytes = fs.readFileSync(path.join(pkg, a.storage.path));
    return {filename: path.basename(a.storage.path), mime_type: a.mime_type, base64: bytes.toString('base64'), sha256: a.integrity.sha256, media: structuredClone(a.media)};
  }};
}

function fixture({seed = 'minimal', now = CLOCK, mutate, logging = true} = {}) {
  let data = structuredClone(typeof seed === 'string' ? seedOf(seed) : seed);
  if (mutate) mutate(data);
  const logs = [], audit = [], receipts = new Map();
  let virtualNow = now, revision = 0, seq = 0, working = null;
  const binding = structuredClone(require('../fixtures/binding.json'));
  const ctx = role => {
    const c = {app_id: 'fernshelf', run_id: 'test', role, binding: structuredClone(binding), virtual_now: virtualNow};
    if (logging) c.log = (step, details = {}) => logs.push({step, details: structuredClone(details)});
    deepFreeze(c);
    // ctx.assets is a live reader over the working copy, as Core's is over its state.
    return Object.freeze({...c, assets: assetReader(() => working || data)});
  };
  function validate(value) {
    assert.ok(seedValid(value), 'Seed schema');
    plugin.validateSeed(ctx('agent'), value);
  }
  validate(data);
  const fail = (code, message) => { throw Object.assign(new Error(message), {code}); };
  function call(name, args = {}) {
    const tool = tools.find(t => t.name === name);
    if (!tool) fail('permission_denied', 'Unknown tool');
    const full = tool.read_only ? args : {expected_version: {epoch: 1, revision}, request_id: 'local-' + (++seq), ...args};
    if (!input.get(name)(full)) fail('invalid_arguments', 'Input schema: ' + name);
    const before = JSON.stringify(data), work = structuredClone(data);
    let out;
    working = work;
    try { out = plugin.handleTool(ctx('agent'), work, name, structuredClone(full)); } catch (e) {
      e.working_copy_changed = JSON.stringify(work) !== before;
      throw e;
    } finally { working = null; }
    if (tool.read_only) assert.equal(JSON.stringify(out.data), before, 'A read must not change business data: ' + name);
    validate(out.data);
    if (!tool.read_only) { revision++; note(data, out.data); }
    const result = {...out.result, status: tool.read_only ? 'ok' : 'committed', app_id: 'fernshelf', version: {epoch: 1, revision}};
    assert.ok(output.get(name)(result), 'Output schema: ' + name + ' ' + JSON.stringify(out.result).slice(0, 300));
    data = out.data;
    return structuredClone(result);
  }
  function event(e) {
    if (!eventValid(e)) fail('invalid_arguments', 'Event schema');
    if (!eventTypes.includes(e.operation)) fail('invalid_event', 'Undeclared event');
    const fp = JSON.stringify(e);
    if (receipts.has(e.event_id)) {
      if (receipts.get(e.event_id).fp !== fp) fail('idempotency_conflict', 'The same event ID cannot identify different content.');
      return {...receipts.get(e.event_id).receipt, duplicate: true};
    }
    if (Date.parse(e.at) < Date.parse(virtualNow)) fail('invalid_event', 'The App virtual clock cannot move backwards.');
    const previous = virtualNow, before = JSON.stringify(data), work = structuredClone(data);
    virtualNow = e.at;
    working = work;
    try {
      const out = plugin.applyEvent(ctx('infra'), work, structuredClone(e));
      validate(out);
      note(data, out);
      data = out; revision++;
      const receipt = {status: 'committed', event_id: e.event_id, version: {epoch: 1, revision}};
      receipts.set(e.event_id, {fp, receipt});
      return structuredClone(receipt);
    } catch (err) {
      virtualNow = previous;
      err.working_copy_changed = JSON.stringify(work) !== before;
      throw err;
    } finally { working = null; }
  }
  // Records the outcome the way Core does: a refusal leaves data untouched and adds a denial row.
  function attempt(fn) {
    const before = JSON.stringify(data);
    try { const r = fn(); audit.push({decision: 'allow'}); return r; } catch (e) {
      if (!e.code) throw e;
      assert.equal(JSON.stringify(data), before, 'Core semantics: the working copy of a refused call is discarded');
      assert.notEqual(e.working_copy_changed, true, 'A refusal must be decided before any change: ' + e.message);
      audit.push({decision: 'deny', reason: e.code});
      return {status: e.code, message: e.message};
    }
  }
  return {
    get data() { return structuredClone(data); }, get logs() { return structuredClone(logs); }, get audit() { return structuredClone(audit); },
    get now() { return virtualNow; }, get revision() { return revision; },
    call, event,
    try: (name, args) => attempt(() => call(name, args)),
    tryEvent: e => attempt(() => event(e)),
    // Infra's env.advance_time: moves the clock forward; runs no App code.
    advance(iso) { assert.ok(Date.parse(iso) >= Date.parse(virtualNow), 'Clock cannot move backwards'); virtualNow = iso; revision++; }
  };
}
// Business data excluding the activity log and notifications, for "nothing else changed" checks.
const business = data => { const {activity, notifications, ...rest} = data; return rest; };
let eventSeq = 0;
const ev = (operation, at, payload, event_id = 'ev-test-' + (++eventSeq)) => ({event_id, at, operation: 'fernshelf.' + operation, payload});
module.exports = {fixture, business, ev, written};
