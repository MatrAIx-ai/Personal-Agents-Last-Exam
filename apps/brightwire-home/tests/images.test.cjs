'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {draw} = require('../scripts/materialize.cjs');

const root = path.resolve(__dirname, '..');
const catalog = require('../contribution/assets.catalog.json');
const font = '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf';
const shots = [
  ['nursery', 'Nursery', '0xE7C7C7'],
  ['living', 'Living', '0xC9D4E4'],
  ['hallway', 'Hallway', '0xD5D8DC'],
  ['kitchen', 'Kitchen', '0xE6D3B3'],
  ['garage', 'Garage', '0xD5DCCB'],
  ['entry', 'Entry', '0xE4D0C4']
];
const ffmpeg = spawnSync('ffmpeg', ['-version'], {stdio: 'pipe'});
const canRedraw = !ffmpeg.error && ffmpeg.status === 0 && fs.existsSync(font);

test('committed snapshots match the asset catalog and omit an encoder version', () => {
  const listed = catalog.assets.filter(asset => String(asset.asset_id).startsWith('snap-'));
  assert.equal(listed.length, shots.length);
  for (const asset of listed) {
    const file = path.join(root, asset.storage.path);
    const bytes = fs.readFileSync(file);
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    assert.equal(digest, asset.integrity.sha256, asset.asset_id);
    assert.equal(bytes.includes(Buffer.from('Lavc')), false, asset.asset_id);
    assert.equal(asset.availability.status, 'ready');
  }
});

test('snapshot images redraw to the committed bytes', {skip: canRedraw ? false : 'ffmpeg or Liberation Sans is not installed'}, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-img-'));
  try {
    for (const [name, label, color] of shots) {
      const committed = path.join(root, 'assets/snapshots', name + '.jpg');
      const copy = path.join(dir, name + '.jpg');
      draw(copy, {
        input: 'color=c=' + color + ':s=320x180',
        filter: 'drawbox=x=24:y=24:w=120:h=80:color=0xFFFFFF:t=fill,drawtext=fontfile=' + font + ':text=' + label + ':fontcolor=0x243038:fontsize=28:x=160:y=70'
      });
      const again = crypto.createHash('sha256').update(fs.readFileSync(copy)).digest('hex');
      const stored = crypto.createHash('sha256').update(fs.readFileSync(committed)).digest('hex');
      assert.equal(again, stored, name);
    }
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});
