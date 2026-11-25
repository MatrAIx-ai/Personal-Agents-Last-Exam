'use strict';
// Package-level checks: generated contracts, tool shapes, the read-only rule and optional diagnostics.
const test = require('node:test');
const assert = require('node:assert/strict');
const {build} = require('../scripts/build-contracts.cjs');
const tools = require('../tools.json');
const app = require('../app.json');
const contribution = require('../contribution/contribution.json');
const {fixture} = require('./harness.cjs');

test('generated contracts match their source and the manifest declarations', () => {
  assert.deepEqual(build({check: true}), []);
  assert.equal(tools.length, 23);
  assert.deepEqual(tools.filter(t => t.read_only).map(t => t.name.slice(10)).sort(),
    ['account.get', 'albums.get', 'albums.list', 'exposure.get', 'items.get', 'items.read', 'items.search', 'notifications.list', 'removals.list', 'storage.summary']);
  for (const t of tools) {
    assert.ok(t.name.startsWith('fernshelf.'), t.name);
    if (!t.read_only) assert.ok(['expected_version', 'request_id'].every(k => t.inputSchema.required.includes(k)), t.name);
    if (!t.read_only) assert.ok(t.outputSchema.properties.id || t.outputSchema.properties.ids, t.name + ' returns an id or ids');
  }
  assert.deepEqual(contribution.interfaces[0].operations.map(o => o.name), tools.map(t => t.name));
  assert.deepEqual(contribution.events.accepts.map(e => e.type), app.event_types);
  assert.equal(app.event_types.length, 7);
});

test('a tool description names the refusals the tool gives (items.read: in_trash, no_file, gone)', () => {
  const f = fixture(), read = tools.find(t => t.name === 'fernshelf.items.read').description;
  for (const code of ['in_trash', 'no_file', 'gone']) assert.ok(read.includes(code), code);
  f.call('fernshelf.items.trash', {ids: ['it-m07']});
  assert.equal(f.try('fernshelf.items.read', {id: 'it-m07'}).status, 'in_trash');
});

test('diagnostics are optional: results are identical with and without a log hook', () => {
  const a = fixture({logging: true}), b = fixture({logging: false});
  const args = {ids: ['it-m07']};
  assert.deepEqual(a.call('fernshelf.items.trash', args), b.call('fernshelf.items.trash', args));
  assert.deepEqual(a.data, b.data);
  assert.ok(a.logs.some(l => l.step === 'write.prepare') && b.logs.length === 0);
  assert.ok(a.logs.every(l => !JSON.stringify(l.details).includes('caption')), 'no content in diagnostics');
});
