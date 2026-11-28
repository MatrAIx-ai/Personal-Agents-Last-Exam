'use strict';
const path = require('node:path');
const assert = require('node:assert/strict');
const { compile } = require('./schema-validator.cjs');
const plugin = require('../plugin.cjs');
const tools = require('../tools.json');

const APP = require('../app.json').app_id;
const UNIT_CLOCK = '2026-11-30T09:00:00-05:00';
const root = path.resolve(__dirname, '..');
const seedValid = compile(require('../schemas/seed.schema.json'), path.join(root, 'schemas'));
const eventValid = compile(require('../schemas/events.schema.json'), path.join(root, 'schemas'));
const byName = new Map(tools.map(t => [t.name, t]));
const input = new Map(tools.map(t => [t.name, compile(t.inputSchema, root)]));
const output = new Map(tools.map(t => [t.name, compile(t.outputSchema, root)]));

function fixture({ seed, now, binding } = {}) {
  let data = structuredClone(seed ?? require('./unit-seed.json'));
  const ctx = {
    app_id: APP, run_id: 'unit', role: 'agent',
    virtual_now: now ?? UNIT_CLOCK,
    binding: structuredClone(binding ?? require('../fixtures/binding.json')),
  };
  let revision = 0, requests = 0;
  const check = candidate => {
    assert.ok(seedValid(candidate), 'seed schema');
    plugin.validateSeed(ctx, candidate);
  };
  check(data);
  const attempt = fn => {
    try { return fn(); } catch (e) {
      if (e && e.code && !(e instanceof assert.AssertionError)) return { status: e.code, message: e.message };
      throw e;
    }
  };
  return {
    ctx,
    data: () => structuredClone(data),
    setNow(iso) { ctx.virtual_now = iso; },
    advance(minutes) { ctx.virtual_now = new Date(Date.parse(ctx.virtual_now) + minutes * 60000).toISOString(); },
    callRaw(name, args) {
      return attempt(() => plugin.handleTool(ctx, structuredClone(data), name, structuredClone(args)).result);
    },
    call(name, args = {}) {
      const tool = byName.get(name);
      assert.ok(tool, 'known tool ' + name);
      const full = tool.read_only ? args : { request_id: 'unit-' + (++requests), expected_version: { epoch: 1, revision }, ...args };
      if (!input.get(name)(full)) return { status: 'invalid_arguments', message: 'input schema' };
      return attempt(() => {
        const before = JSON.stringify(data);
        const out = plugin.handleTool(ctx, structuredClone(data), name, structuredClone(full));
        if (tool.read_only) assert.equal(JSON.stringify(out.data), before, 'read changed data: ' + name);
        else check(out.data);
        const result = { ...out.result, status: tool.read_only ? 'ok' : 'committed', app_id: APP, version: { epoch: 1, revision: tool.read_only ? revision : revision + 1 } };
        assert.ok(output.get(name)(result), 'output schema: ' + name);
        if (!tool.read_only) { data = out.data; revision++; }
        return result;
      });
    },
    event(envelope) {
      assert.ok(eventValid(envelope), 'event schema');
      const saved = ctx.virtual_now;
      ctx.virtual_now = envelope.at;
      return attempt(() => {
        try {
          const next = plugin.applyEvent({ ...ctx, role: 'infra' }, structuredClone(data), structuredClone(envelope));
          check(next);
          data = next; revision++;
          return { status: 'committed', event_id: envelope.event_id };
        } catch (e) { ctx.virtual_now = saved; throw e; }
      });
    },
  };
}
module.exports = { fixture, UNIT_CLOCK };
