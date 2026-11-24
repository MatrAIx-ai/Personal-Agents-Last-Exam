#!/usr/bin/env node
'use strict';
// Draws Switchback's page icons as 24x24 PNG files from simple shapes and writes
// them, base64-encoded, into the ICONS block of gui/src/app.js. The Web Host
// serves only gui/index.html and gui/src/app.js, and the GUI content policy
// disables SVG, so the icons travel inside the controller and become blob: URLs
// in the browser. Self-made for Switchback and dedicated to the public domain
// (CC0 1.0). Deterministic: the same code always writes the same bytes.
//
// Run: node gui/icons.cjs          rewrite the block
//      node gui/icons.cjs --check  fail if the block differs
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const SIZE = 24, SAMPLES = 4;

// ---- Shapes: each is a predicate over a point in the 24x24 square -------------
const circle = (cx, cy, r) => (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
const ring = (cx, cy, r, w) => (x, y) => { const d = Math.hypot(x - cx, y - cy); return d <= r + w / 2 && d >= r - w / 2; };
const rect = (x0, y0, x1, y1) => (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
const frame = (x0, y0, x1, y1, w) => (x, y) => rect(x0, y0, x1, y1)(x, y) && !rect(x0 + w, y0 + w, x1 - w, y1 - w)(x, y);
function line(x0, y0, x1, y1, w) {
  return (x, y) => {
    const dx = x1 - x0, dy = y1 - y0, t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy)) <= w / 2;
  };
}
function polygon(...points) {
  return (x, y) => {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [xi, yi] = points[i], [xj, yj] = points[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
}
const any = (...shapes) => (x, y) => shapes.some(s => s(x, y));
const minus = (shape, ...holes) => (x, y) => shape(x, y) && !holes.some(h => h(x, y));

// ---- The icons ---------------------------------------------------------------
const GREEN = [47, 107, 79], SLATE = [55, 71, 94], AMBER = [178, 106, 0], RED = [178, 58, 46], BLUE = [37, 99, 168], BROWN = [122, 84, 52];
const ICONS = {
  tent: [GREEN, any(minus(polygon([2, 20], [12, 3.5], [22, 20]), polygon([8.5, 20.5], [12, 13], [15.5, 20.5])), rect(1, 20, 23, 21.5))],
  search: [SLATE, any(ring(10, 10, 6, 2.4), line(14.5, 14.5, 20.5, 20.5, 3))],
  calendar: [SLATE, any(frame(3, 5, 21, 21, 1.8), rect(3, 5, 21, 9.5), line(8, 2.5, 8, 6.5, 2), line(16, 2.5, 16, 6.5, 2),
    rect(6.5, 12, 9, 14.5), rect(11, 12, 13.5, 14.5), rect(15.5, 12, 18, 14.5), rect(6.5, 16.5, 9, 19))],
  person: [SLATE, any(circle(12, 7.5, 4), minus(circle(12, 22, 8.5), rect(0, 22, 24, 24)))],
  card: [SLATE, any(frame(2, 5.5, 22, 18.5, 1.8), rect(2, 8.5, 22, 11.5), rect(5, 14, 11, 15.6))],
  policy: [SLATE, any(frame(5, 2.5, 19, 21.5, 1.8), line(8.5, 8, 15.5, 8, 1.6), line(8.5, 12, 15.5, 12, 1.6), line(8.5, 16, 13, 16, 1.6))],
  electric: [BLUE, polygon([14, 1.5], [4.5, 13.5], [10.8, 13.5], [8.5, 22.5], [19.5, 9.5], [13.2, 9.5], [15.5, 1.5])],
  vehicle: [BROWN, any(minus(rect(1.5, 6, 17.5, 16.5), rect(4, 8.5, 9, 12)), line(17.5, 14.5, 22.5, 14.5, 1.8), circle(8, 18, 3))],
  accessible: [BLUE, any(circle(11, 4, 2.3), line(11, 7.5, 11, 13.5, 2.4), line(11, 13.5, 16.5, 13.5, 2.2), line(16.5, 13.5, 19, 19.5, 2.2),
    line(11, 9.5, 15.5, 9.5, 2), minus(ring(9.5, 16, 5.2, 2), rect(8, 9, 24, 15.8)))],
  walk_in: [BROWN, any(circle(12.5, 3.8, 2.3), line(12, 7.5, 10.5, 13.5, 2.6), line(10.5, 13.5, 7.5, 21, 2.4), line(10.5, 13.5, 14.5, 20.5, 2.4),
    line(11.8, 9, 15.5, 11.5, 2), line(17.5, 7, 18.5, 22, 1.6))],
  occupancy: [SLATE, any(circle(8, 8, 3.2), circle(16.5, 8, 3.2), minus(circle(8, 21, 6.5), rect(0, 21, 24, 24)), minus(circle(16.5, 21, 6.5), rect(0, 21, 24, 24)))],
  pets: [BROWN, any(circle(12, 16, 4.6), circle(5.5, 10, 2.2), circle(9.5, 5.5, 2.2), circle(14.5, 5.5, 2.2), circle(18.5, 10, 2.2))],
  alert: [AMBER, minus(polygon([12, 2], [23, 21.5], [1, 21.5]), rect(10.8, 8, 13.2, 14.5), circle(12, 17.7, 1.5))],
  closure: [RED, any(minus(rect(1.5, 7, 22.5, 13.5), polygon([5, 7], [9, 7], [5, 13.5], [1, 13.5]), polygon([13, 7], [17, 7], [13, 13.5], [9, 13.5]),
    polygon([21, 7], [24, 7], [24, 9], [21, 13.5], [17, 13.5])), rect(4, 13.5, 6.5, 21.5), rect(17.5, 13.5, 20, 21.5))],
  receipt: [GREEN, any(minus(polygon([5, 2], [19, 2], [19, 22], [16.5, 20], [14, 22], [11.5, 20], [9, 22], [6.5, 20], [5, 22]),
    rect(7.5, 6.5, 16.5, 8), rect(7.5, 10.5, 16.5, 12), rect(7.5, 14.5, 13, 16)))],
};

// ---- PNG encoding --------------------------------------------------------------
const CRC = Array.from({length: 256}, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length), body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}
function png([r, g, b], shape) {
  const raw = Buffer.alloc(SIZE * (1 + SIZE * 4));
  for (let y = 0; y < SIZE; y++) {
    raw[y * (1 + SIZE * 4)] = 0;
    for (let x = 0; x < SIZE; x++) {
      let hits = 0;
      for (let sy = 0; sy < SAMPLES; sy++) for (let sx = 0; sx < SAMPLES; sx++) if (shape(x + (sx + 0.5) / SAMPLES, y + (sy + 0.5) / SAMPLES)) hits++;
      const o = y * (1 + SIZE * 4) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = Math.round(255 * hits / (SAMPLES * SAMPLES));
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0); header.writeUInt32BE(SIZE, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, {level: 9})), chunk('IEND', Buffer.alloc(0))]);
}

function block() {
  const rows = Object.entries(ICONS).map(([name, [color, shape]]) => ` ${name}:'${png(color, shape).toString('base64')}',`);
  return ['// ICONS:BEGIN generated by gui/icons.cjs: self-made 24x24 PNG icons, CC0 1.0', 'const ICONS={', ...rows, '};', '// ICONS:END'].join('\n');
}

const controller = path.join(__dirname, 'src/app.js');
function current() {
  const text = fs.readFileSync(controller, 'utf8'), start = text.indexOf('// ICONS:BEGIN'), end = text.indexOf('// ICONS:END');
  if (start < 0 || end < 0) throw Error('gui/src/app.js has no ICONS block');
  return {text, start, end: end + '// ICONS:END'.length};
}

module.exports = {block, png, ICONS};

if (require.main === module) {
  const {text, start, end} = current(), next = text.slice(0, start) + block() + text.slice(end);
  if (process.argv.includes('--check')) {
    if (next !== text) { console.error('gui/src/app.js icons differ from gui/icons.cjs'); process.exitCode = 1; } else console.log('Icons match.');
  } else { fs.writeFileSync(controller, next); console.log(`Wrote ${Object.keys(ICONS).length} icons into gui/src/app.js`); }
}
