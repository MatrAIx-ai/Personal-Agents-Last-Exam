#!/usr/bin/env node
'use strict';
// Draws Crossway's page icons from the 16x16 masks below, encodes each as a PNG
// and embeds the base64 bytes in gui/src/app.js between the ICONS markers. The
// shared Web Host serves only gui/index.html and gui/src/app.js, and its CSP
// allows images from 'self' and blob: but not data:, so the page turns each
// embedded PNG into a blob: URL. SVG is disabled. The icons are self-made (CC0).
//   node scripts/build-icons.cjs           rewrites the block in gui/src/app.js
//   node scripts/build-icons.cjs --check   compares only
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const file = path.resolve(__dirname, '../gui/src/app.js');
const INK = [0x4a, 0x5a, 0x73], WHITE = [0xff, 0xff, 0xff];

const MASKS = {
  brand: [
    '......####......',
    '......####......',
    '......#..#......',
    '......####......',
    '......#..#......',
    '......####......',
    '################',
    '##.##.#..#.##.##',
    '##.##.#..#.##.##',
    '################',
    '......####......',
    '......#..#......',
    '......####......',
    '......#..#......',
    '......####......',
    '......####......',
  ],
  account: [
    '................',
    '.......##.......',
    '......####......',
    '.....##..##.....',
    '....##....##....',
    '...##......##...',
    '..##........##..',
    '.##############.',
    '..#..........#..',
    '..#..........#..',
    '..#...####...#..',
    '..#...#..#...#..',
    '..#...#..#...#..',
    '..#...#..#...#..',
    '..############..',
    '................',
  ],
  topup: [
    '................',
    '.....######.....',
    '...##......##...',
    '..#..........#..',
    '..#....##....#..',
    '.#.....##.....#.',
    '.#..########..#.',
    '.#..########..#.',
    '.#.....##.....#.',
    '.#.....##.....#.',
    '..#..........#..',
    '..#..........#..',
    '...##......##...',
    '.....######.....',
    '................',
    '................',
  ],
  statements: [
    '................',
    '...##########...',
    '...#........#...',
    '...#.######.#...',
    '...#........#...',
    '...#.######.#...',
    '...#........#...',
    '...#.######.#...',
    '...#........#...',
    '...#.####...#...',
    '...#........#...',
    '...#....###.#...',
    '...#........#...',
    '...##########...',
    '................',
    '................',
  ],
  vehicles: [
    '................',
    '................',
    '................',
    '....########....',
    '...#..#..#..#...',
    '..#...#..#...#..',
    '.##############.',
    '.##############.',
    '.#.##########.#.',
    '.##############.',
    '..###......###..',
    '..###......###..',
    '................',
    '................',
    '................',
    '................',
  ],
  tolls: [
    '................',
    '.###............',
    '.#.#............',
    '.#.#............',
    '.#.###########..',
    '.#.#..#..#..##..',
    '.#.###########..',
    '.#.#............',
    '.#.#............',
    '.#.#............',
    '.#.#............',
    '#####...........',
    '................',
    '################',
    '................',
    '##..##..##..##..',
  ],
  notices: [
    '................',
    '................',
    '................',
    '.##############.',
    '.##..........##.',
    '.#.#........#.#.',
    '.#..#......#..#.',
    '.#...#....#...#.',
    '.#....####....#.',
    '.#............#.',
    '.#............#.',
    '.##############.',
    '................',
    '................',
    '................',
    '................',
  ],
  pay: [
    '................',
    '................',
    '................',
    '.##############.',
    '.#............#.',
    '.##############.',
    '.##############.',
    '.#............#.',
    '.#............#.',
    '.#.####...###.#.',
    '.#............#.',
    '.##############.',
    '................',
    '................',
    '................',
    '................',
  ],
  disputes: [
    '................',
    '..#.............',
    '..########......',
    '..#########.....',
    '..##########....',
    '..#########.....',
    '..########......',
    '..#.............',
    '..#.............',
    '..#.............',
    '..#.............',
    '..#.............',
    '..#.............',
    '.###............',
    '................',
    '................',
  ],
  policies: [
    '................',
    '..###########...',
    '..#.#.......#...',
    '..#.#.......#...',
    '..#.#.#####.#...',
    '..#.#.......#...',
    '..#.#.####..#...',
    '..#.#.......#...',
    '..#.#.......#...',
    '..#.#.......#...',
    '..#.#.......#...',
    '..###########...',
    '..#.........#...',
    '...##########...',
    '................',
    '................',
  ],
};

const CRC = Array.from({length: 256}, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, body) {
  const len = Buffer.alloc(4), crc = Buffer.alloc(4), tb = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  len.writeUInt32BE(body.length);
  crc.writeUInt32BE(crc32(tb));
  return Buffer.concat([len, tb, crc]);
}

// 16x16 RGBA, no interlace; each row starts with filter byte 0.
function png(mask, [r, g, b]) {
  if (mask.length !== 16 || mask.some(row => row.length !== 16 || /[^#.]/.test(row))) throw Error('Masks are 16 rows of 16 "#" or "." characters.');
  const raw = Buffer.concat(mask.map(row => Buffer.from([0, ...[...row].flatMap(ch => ch === '#' ? [r, g, b, 255] : [0, 0, 0, 0])])));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(16, 0);
  ihdr.writeUInt32BE(16, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, {level: 9})), chunk('IEND', Buffer.alloc(0))]);
}

function block() {
  const lines = Object.entries(MASKS).map(([name, mask]) => ` ${name}:'${png(mask, name === 'brand' ? WHITE : INK).toString('base64')}',`);
  return ['// ICONS BEGIN: generated by scripts/build-icons.cjs from 16x16 masks; PNG bytes, base64.', 'const ICONS={', ...lines, '};', '// ICONS END'].join('\n');
}

module.exports = {MASKS, png, block};

if (require.main === module) {
  const text = fs.readFileSync(file, 'utf8');
  const next = text.replace(/\/\/ ICONS BEGIN[\s\S]*?\/\/ ICONS END/, block());
  if (!/\/\/ ICONS BEGIN/.test(text)) throw Error('gui/src/app.js has no ICONS block.');
  if (process.argv.includes('--check')) {
    if (next !== text) throw Error('gui/src/app.js icons differ from scripts/build-icons.cjs.');
    console.log('gui/src/app.js icons match the masks.');
  } else {
    fs.writeFileSync(file, next);
    console.log('Wrote the icon block in gui/src/app.js');
  }
}
