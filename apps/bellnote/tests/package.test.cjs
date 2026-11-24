'use strict';
// Package-level checks: generated contracts match their source, the fixture is valid, reads are
// side-effect free, and optional diagnostics never change business results.
const test = require('node:test');
const assert = require('node:assert/strict');
const {build} = require('../scripts/build-contracts.cjs');
const {fixture, ev} = require('./harness.cjs');
const tools = require('../tools.json');

test('generated tools and schemas match scripts/build-contracts.cjs', () => {
  assert.deepEqual(build({check: true}), []);
  assert.equal(tools.length, 23);
  assert.equal(tools.filter(t => t.read_only).length, 12);
  for (const t of tools.filter(t => !t.read_only)) {
    assert.ok(t.inputSchema.required.includes('request_id') && t.inputSchema.required.includes('expected_version'), t.name);
    assert.equal(t.inputSchema.properties.expected_version.properties.epoch.type, 'integer', t.name + ' takes Core\'s {epoch, revision}');
  }
  assert.ok(tools.every(t => t.name.startsWith('bellnote.')));
  assert.ok(!JSON.stringify(tools).includes('$ref'), 'Published tool schemas are self-contained');
});

test('every read leaves business data byte-identical', () => {
  const f = fixture(), before = JSON.stringify(f.data);
  const reads = {
    'bellnote.children.list': {}, 'bellnote.schools.get': {id: 'school-alder'}, 'bellnote.attendance.list': {},
    'bellnote.absences.list': {}, 'bellnote.forms.list': {}, 'bellnote.forms.get': {id: 'form-fluclinic'},
    'bellnote.pickup.get': {id: 'child-theo'}, 'bellnote.lunch.account_get': {id: 'lunch-ines'}, 'bellnote.menu.list': {},
    'bellnote.payments.list': {}, 'bellnote.notifications.list': {}, 'bellnote.preferences.get': {}
  };
  assert.deepEqual(Object.keys(reads).sort(), tools.filter(t => t.read_only).map(t => t.name).sort());
  for (const [name, args] of Object.entries(reads)) assert.equal(f.call(name, args).status, 'ok', name);
  assert.equal(JSON.stringify(f.data), before);
});

test('optional diagnostics cannot change business results', () => {
  const run = opts => {
    const f = fixture({now: '2026-11-17T07:00:00-08:00', ...opts});
    f.call('bellnote.absences.report', {id: 'child-theo', kind: 'absent', start: '2026-11-17', reason: 'Fever'});
    f.event(ev('attendance.marked', '2026-11-17T09:20:00-08:00', {child_id: 'child-ines', date: '2026-11-17', status: 'absent', marked_by: 'staff-office-alder'}, 'ev-diag'));
    return f;
  };
  const on = run(), off = run({logging: false});
  assert.deepEqual(on.data, off.data);
  assert.ok(on.logs.length > 0); assert.equal(off.logs.length, 0);
  assert.ok(on.logs.every(l => !JSON.stringify(l).includes('Fever')), 'Diagnostics carry no free text');
});
