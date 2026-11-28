'use strict';
// Renders the station-board crop from its visible text lines, and encodes/decodes 8-bit RGB PNG.
// dev/build-assets.cjs writes assets/board-crop.png with it; the business tests decode the shipped
// file and compare its pixels with a fresh render of the lines quoted in the post's alt text.
// Pixels, not bytes, are compared, so zlib differences between Node versions do not matter.
const zlib = require('node:zlib');

// 5x7 LED font: each row is five bits, most significant on the left.
const FONT = {
  ' ': [0, 0, 0, 0, 0, 0, 0], ':': [0, 12, 12, 0, 12, 12, 0], '.': [0, 0, 0, 0, 0, 12, 12], '-': [0, 0, 0, 31, 0, 0, 0],
  0: [14, 17, 19, 21, 25, 17, 14], 1: [4, 12, 4, 4, 4, 4, 14], 2: [14, 17, 1, 2, 4, 8, 31], 3: [31, 2, 4, 2, 1, 17, 14],
  4: [2, 6, 10, 18, 31, 2, 2], 5: [31, 16, 30, 1, 1, 17, 14], 6: [6, 8, 16, 30, 17, 17, 14], 7: [31, 1, 2, 4, 8, 8, 8],
  8: [14, 17, 17, 14, 17, 17, 14], 9: [14, 17, 17, 15, 1, 2, 12],
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14], D: [28, 18, 17, 17, 17, 18, 28],
  E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16], G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14], J: [7, 2, 2, 2, 2, 18, 12], K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17], N: [17, 17, 25, 21, 19, 17, 17], O: [14, 17, 17, 17, 17, 17, 14], P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17], S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14], V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 21, 10], X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31],
};
const SCALE = 5, PAD = 4, GAP = 3;

function render(lines) {
  if (!Array.isArray(lines) || !lines.length) throw Error('At least one board line is required');
  for (const ch of lines.join('')) if (!FONT[ch]) throw Error('No glyph for ' + JSON.stringify(ch));
  const cols = PAD * 2 + Math.max(...lines.map(l => l.length * 6 - 1)), rows = PAD * 2 + lines.length * 7 + (lines.length - 1) * GAP;
  const width = cols * SCALE, height = rows * SCALE, rgb = Buffer.alloc(width * height * 3);
  let seed = 20261010;
  const noise = () => {seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 16) % 9 - 4;};
  // Dark housing with a slight vertical gradient and grain, as in a phone photo of a board.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const base = 18 + Math.round(10 * y / height), n = noise(), o = (y * width + x) * 3;
      rgb[o] = base + n; rgb[o + 1] = base + 2 + n; rgb[o + 2] = base + 6 + n;
    }
  }
  const lit = new Set();
  lines.forEach((line, li) => {
    [...line].forEach((ch, ci) => {
      FONT[ch].forEach((bits, r) => {
        for (let b = 0; b < 5; b++) if (bits & (16 >> b)) lit.add((PAD + ci * 6 + b) + ',' + (PAD + li * (7 + GAP) + r));
      });
    });
  });
  // Every LED position draws a dot: amber when lit, a faint dark dot otherwise.
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const on = lit.has(gx + ',' + gy), color = on ? [255, 170, 40] : [42, 34, 26];
      for (let dy = 1; dy < SCALE - 1; dy++) {
        for (let dx = 1; dx < SCALE - 1; dx++) {
          const o = ((gy * SCALE + dy) * width + gx * SCALE + dx) * 3;
          rgb[o] = color[0]; rgb[o + 1] = color[1]; rgb[o + 2] = color[2];
        }
      }
    }
  }
  return {width, height, rgb};
}

const CRC = Array.from({length: 256}, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, body) {
  const head = Buffer.alloc(8), tail = Buffer.alloc(4);
  head.writeUInt32BE(body.length, 0); head.write(type, 4, 'ascii');
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, tail]);
}
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function encode({width, height, rgb}) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const stride = width * 3, raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, {level: 9})), chunk('IEND', Buffer.alloc(0))]);
}

function decode(png) {
  if (!png.subarray(0, 8).equals(SIGNATURE)) throw Error('Not a PNG file');
  let offset = 8, header = null;
  const data = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset), type = png.toString('ascii', offset + 4, offset + 8), body = png.subarray(offset + 8, offset + 8 + length);
    if (png.readUInt32BE(offset + 8 + length) !== crc32(png.subarray(offset + 4, offset + 8 + length))) throw Error('Bad PNG chunk CRC');
    if (type === 'IHDR') header = {width: body.readUInt32BE(0), height: body.readUInt32BE(4), depth: body[8], color: body[9], interlace: body[12]};
    if (type === 'IDAT') data.push(body);
    offset += 12 + length;
  }
  if (!header || header.depth !== 8 || header.color !== 2 || header.interlace !== 0) throw Error('Only 8-bit RGB, non-interlaced PNG is supported');
  const {width, height} = header, stride = width * 3, raw = zlib.inflateSync(Buffer.concat(data)), rgb = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= 3 ? rgb[y * stride + x - 3] : 0, b = y ? rgb[(y - 1) * stride + x] : 0, c = x >= 3 && y ? rgb[(y - 1) * stride + x - 3] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const predict = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter];
      if (predict === undefined) throw Error('Unknown PNG filter');
      rgb[y * stride + x] = (line[x] + predict) & 255;
    }
  }
  return {width, height, rgb};
}

// The board lines are the double-quoted strings in the alt text.
const linesFromAltText = alt => [...alt.matchAll(/"([^"]+)"/g)].map(m => m[1]);

module.exports = {render, encode, decode, linesFromAltText};
