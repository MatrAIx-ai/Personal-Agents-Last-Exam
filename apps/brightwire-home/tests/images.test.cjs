'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {snapshotImage} = require('../scripts/materialize.cjs');

const root = path.resolve(__dirname, '..');
const catalog = require('../contribution/assets.catalog.json');
const shots = [
  ['nursery', 'NUR', 0xE7C7C7],
  ['living', 'LIV', 0xC9D4E4],
  ['hallway', 'HAL', 0xD5D8DC],
  ['kitchen', 'KIT', 0xE6D3B3],
  ['garage', 'GAR', 0xD5DCCB],
  ['entry', 'ENT', 0xE4D0C4]
];

test('committed snapshots match the asset catalog and omit an encoder version', () => {
  const listed = catalog.assets.filter(asset => /^snap-[a-z]+$/.test(asset.asset_id));
  assert.equal(listed.length, shots.length);
  const owned = catalog.assets.filter(asset => asset.roles.includes('ui.snapshot'));
  assert.equal(owned.length, shots.length * 3);
  for (const asset of owned) {
    const file = path.join(root, asset.storage.path);
    const bytes = fs.readFileSync(file);
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    assert.equal(digest, asset.integrity.sha256, asset.asset_id);
    assert.equal(bytes.includes(Buffer.from('Lavc')), false, asset.asset_id);
    assert.equal(asset.availability.status, 'ready');
    assert.equal(asset.media.image.width, 320);
    assert.equal(asset.media.image.height, 176);
  }
});

test('snapshot images redraw to the committed bytes', () => {
  for (const [name, label, color] of shots) {
    const committed = fs.readFileSync(path.join(root, 'assets/snapshots', name + '.jpg'));
    const again = snapshotImage(label, color);
    assert.equal(crypto.createHash('sha256').update(again).digest('hex'), crypto.createHash('sha256').update(committed).digest('hex'), name);
  }
});
