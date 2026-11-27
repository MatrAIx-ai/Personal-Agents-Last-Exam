'use strict';
// Replays a scripted history through the App's own hooks, so the App accepted every step: the account holder's writes
// through handleTool and the issuer's and merchants' acts through applyEvent. Used only by the dev scripts, never at run time.
const assert = require('node:assert/strict');
const path = require('node:path');
const plugin = require('../plugin.cjs');
const time = require('../src/time.cjs');
const {compile} = require('../tests/schema-validator.cjs');
const APP = require('../app.json').app_id;
const tools = require('../tools.json');
const schemaDir = path.resolve(__dirname, '../schemas');
const seedValid = compile(require('../schemas/seed.schema.json'), schemaDir);
const eventValid = compile(require('../schemas/events.schema.json'), schemaDir);
const input = new Map(tools.map(t => [t.name, compile(t.inputSchema, path.resolve(__dirname, '..'))]));
const binding = require('../fixtures/binding.json');

// A local time such as '2026-03-23 08:50' or '2026-11-30 23:59:59' in America/New_York, with the UTC offset of that date.
function at(local, zone = 'America/New_York') {
  for (const offset of ['-05:00', '-04:00']) {
    const value = local.replace(' ', 'T') + (local.length === 16 ? ':00' : '') + offset;
    if (time.iso(Date.parse(value), zone) === value) return value;
  }
  throw new Error('Not a local time in ' + zone + ': ' + local);
}
const ctxAt = (now, role = 'agent') => Object.freeze({app_id: APP, role, virtual_now: now, binding: structuredClone(binding)});
function check(data, now, label) {
  assert.ok(seedValid(data), 'Seed schema after ' + label);
  plugin.validateSeed(ctxAt(now), data);
}
// One step: {at, call, args, request_id?} or {at, event, payload, event_id}. A payload or args can be a function of the data at its time.
function apply(data, step, n) {
  const value = x => typeof x === 'function' ? x(data) : x;
  if (step.call) {
    const name = APP + '.' + step.call, args = {expected_version: {epoch: 1, revision: n}, request_id: step.request_id || 'req-' + String(n + 1).padStart(5, '0'), ...value(step.args)};
    assert.ok(input.get(name)(args), 'Input schema of ' + name + ' at ' + step.at);
    const out = plugin.handleTool(ctxAt(step.at), structuredClone(data), name, args);
    return {data: out.data, result: out.result};
  }
  const event = {event_id: step.event_id, at: step.at, operation: APP + '.' + step.event, payload: value(step.payload)};
  assert.ok(eventValid(event), 'Event schema of ' + event.event_id + ' ' + JSON.stringify(eventValid.errors || ''));
  return {data: plugin.applyEvent(ctxAt(step.at, 'infra'), structuredClone(data), event), result: null};
}
// Steps must be in time order. `onStep(data, step, result)` can look at the data after each step. With `checkEvery: false`
// the seed schema is checked only at the end, which is faster for long histories.
function replay(base, steps, {checkEvery = true, onStep = null} = {}) {
  let data = structuredClone(base), last = null;
  steps.forEach((step, n) => {
    if (last !== null && Date.parse(step.at) < Date.parse(last)) throw new Error('Steps out of time order at ' + step.at);
    let out;
    try { out = apply(data, step, n); } catch (error) { error.message = 'Step ' + n + ' (' + (step.call || step.event) + ' at ' + step.at + '): ' + error.message; throw error; }
    data = out.data;
    if (checkEvery) check(data, step.at, step.call || step.event_id);
    if (onStep) onStep(data, step, out.result);
    last = step.at;
  });
  return data;
}
module.exports = {at, replay, check, apply, ctxAt};
