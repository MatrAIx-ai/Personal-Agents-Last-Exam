'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { run, PAGES } = require('./reference.cjs');

const COMMITTED = path.resolve(__dirname, '..', 'reference');
const RENEWAL = '05-refill-faq-renewal.png';

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(kind, data) {
  const len = Buffer.alloc(4), crc = Buffer.alloc(4), body = Buffer.concat([Buffer.from(kind, 'ascii'), data]);
  len.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  const raw = Buffer.alloc((width + 1) * height, 0xee);
  for (let y = 0; y < height; y++) raw[y * (width + 1)] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function copyCommitted() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mendwell-reference-test-'));
  for (const f of fs.readdirSync(COMMITTED)) fs.copyFileSync(path.join(COMMITTED, f), path.join(dir, f));
  return dir;
}
const tree = dir => Object.fromEntries(fs.readdirSync(dir).sort().map(f => [f, crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, f))).digest('hex')]));
const committed = () => JSON.parse(fs.readFileSync(path.join(COMMITTED, 'references.json'), 'utf8')).references;

function stubs(dir, changes = {}) {
  const calls = { index: 0, captures: 0 };
  const byUrl = url => Object.values(PAGES).find(p => p.url === url);
  return {
    calls,
    cdxIndex: async (url, onlyOk) => { calls.index++; const p = byUrl(url); return onlyOk ? (p.snapshot ? { timestamp: p.snapshot, status: '200' } : null) : { timestamp: '20251201000000', status: '403' }; },
    launch: async () => ({ version: () => 'stub', close: async () => {} }),
    captureShot: async (browser, src, page) => {
      calls.captures++;
      const before = committed().find(e => e.file === src.file), change = changes[src.file] || {};
      return { bytes: change.bytes || fs.readFileSync(path.join(dir, src.file)), title: before.page_title, revealed: change.revealed !== undefined ? change.revealed : before.presentation ? 3 : 0, masked: before.redactions, blocked: 0, archiveUrl: before.archive_url };
    },
    log: () => {}
  };
}

test('a capture whose rendering mode changed is refused and nothing is replaced', async () => {
  const dir = copyCommitted(), before = tree(dir), s = stubs(dir, { [RENEWAL]: { revealed: 7 } });
  await assert.rejects(run({ argv: ['--date', '2026-12-01'], out: dir, ...s }), /05-refill-faq-renewal\.png: rendering mode "the page as it renders" became "content revealed by the capture \(opacity set to 1\)".*--update/);
  assert.deepEqual(tree(dir), before);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a capture whose size changed is refused and nothing is replaced', async () => {
  const dir = copyCommitted(), before = tree(dir), s = stubs(dir, { [RENEWAL]: { bytes: png(1280, 1062) } });
  await assert.rejects(run({ argv: [], out: dir, ...s }), /05-refill-faq-renewal\.png: size 1256 x 1279 at scale 1 became 1280 x 1062 at scale 1\. The committed file and manifest are kept/);
  assert.deepEqual(tree(dir), before);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('unchanged captures keep their committed capture date and bytes', async () => {
  const dir = copyCommitted(), before = tree(dir), s = stubs(dir);
  const manifest = await run({ argv: ['--date', '2026-12-01'], out: dir, ...s });
  assert.deepEqual(manifest.references.map(e => e.captured_on), committed().map(e => e.captured_on));
  assert.deepEqual(manifest.references.map(e => [e.file, e.sha256, e.width, e.height, e.presentation]), committed().map(e => [e.file, e.sha256, e.width, e.height, e.presentation]));
  for (const [f, h] of Object.entries(before)) if (f.endsWith('.png')) assert.equal(tree(dir)[f], h);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('with --update a changed capture replaces the file and carries the given date', async () => {
  const dir = copyCommitted(), before = tree(dir), bytes = png(1280, 1062), s = stubs(dir, { [RENEWAL]: { bytes, revealed: 7 } });
  const manifest = await run({ argv: ['--update', '--date', '2026-12-01'], out: dir, ...s });
  const e = manifest.references.find(x => x.file === RENEWAL);
  assert.equal(e.captured_on, '2026-12-01');
  assert.deepEqual([e.width, e.height, !!e.presentation], [1280, 1062, true]);
  assert.ok(fs.readFileSync(path.join(dir, RENEWAL)).equals(bytes));
  for (const x of manifest.references.filter(x => x.file !== RENEWAL)) { assert.equal(x.captured_on, '2026-11-27'); assert.equal(tree(dir)[x.file], before[x.file]); }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('an unknown option or a bad date is refused before the archive is asked', async () => {
  const dir = copyCommitted(), before = tree(dir);
  for (const argv of [['--updat'], ['--date'], ['--date', '2026-02-30']]) {
    const s = stubs(dir);
    await assert.rejects(run({ argv, out: dir, ...s }), /Unknown argument --updat|--date needs a calendar date/);
    assert.deepEqual(s.calls, { index: 0, captures: 0 });
  }
  assert.deepEqual(tree(dir), before);
  fs.rmSync(dir, { recursive: true, force: true });
});
