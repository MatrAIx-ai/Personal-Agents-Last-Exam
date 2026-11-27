'use strict';
// Script-drawn stand-in images for the reference fixture, with Node built-ins only (zlib for PNG).
// Each image is a flat scene: colour fields for sky and ground, a few shapes (sun or moon, hills,
// a house, trees, water) chosen from the scene kind, light deterministic grain and a stamped
// caption in a tiny bitmap font. No people, no faces, no photographs and no generative model.
// The images stand in for the originals; storage is counted from each item's declared_bytes.
const zlib = require('node:zlib');

// ---- PNG encoding -------------------------------------------------------------------------------
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(buf) { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4), crc = Buffer.alloc(4), body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePNG(width, height, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit RGB, no interlace
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 1; // Sub filter
    for (let x = 0; x < width * 3; x++) {
      const v = rgb[y * width * 3 + x], left = x >= 3 ? rgb[y * width * 3 + x - 3] : 0;
      raw[row + 1 + x] = (v - left) & 255;
    }
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, {level: 9})), chunk('IEND', Buffer.alloc(0))]);
}

// ---- a tiny 3x5 bitmap font ---------------------------------------------------------------------
const GLYPHS = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111', F: '111100110100100',
  G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111',
  M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100', Q: '010101101110011', R: '110101110101101',
  S: '011100010001110', T: '111010010010010', U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101',
  Y: '101101010010010', Z: '111001010100111', 0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110',
  4: '101101111001001', 5: '111100110001110', 6: '011100111101111', 7: '111001010010010', 8: '111101111101111', 9: '111101111001110',
  '-': '000000111000000', ' ': '000000000000000', '.': '000000000000010', ',': '000000000010100', '&': '010101010101011'
};

// ---- scenes -------------------------------------------------------------------------------------
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hash = s => { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const PALETTES = {
  beach: {sky: [150, 200, 235], ground: [226, 205, 150], accent: [40, 110, 170]},
  garden: {sky: [175, 215, 240], ground: [86, 140, 70], accent: [210, 80, 120]},
  hall: {sky: [200, 190, 175], ground: [120, 95, 80], accent: [230, 200, 90]},
  mountain: {sky: [160, 190, 225], ground: [90, 120, 95], accent: [235, 235, 240]},
  night: {sky: [25, 30, 70], ground: [40, 45, 60], accent: [250, 220, 120]},
  city: {sky: [185, 200, 215], ground: [110, 110, 120], accent: [200, 90, 60]},
  snow: {sky: [205, 215, 230], ground: [240, 244, 248], accent: [120, 150, 190]},
  kitchen: {sky: [235, 220, 195], ground: [170, 130, 95], accent: [80, 150, 120]}
};
const KINDS = Object.keys(PALETTES);

function draw({width = 128, height = 96, scene, caption, seed}) {
  const r = rng(seed), p = PALETTES[scene], img = new Uint8Array(width * height * 3), horizon = Math.floor(height * (0.5 + 0.15 * r()));
  const set = (x, y, c) => { if (x < 0 || y < 0 || x >= width || y >= height) return; const i = (y * width + x) * 3; img[i] = c[0]; img[i + 1] = c[1]; img[i + 2] = c[2]; };
  const mix = (a, b, t) => a.map((v, k) => Math.round(v + (b[k] - v) * t));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sky = y < horizon;
    set(x, y, sky ? mix(p.sky, [255, 255, 255], (horizon - y) / horizon * 0.25) : mix(p.ground, [0, 0, 0], (y - horizon) / (height - horizon) * 0.3));
  }
  // Sun or moon.
  const cx = Math.floor(width * (0.15 + 0.7 * r())), cy = Math.floor(horizon * (0.25 + 0.3 * r())), rad = 5 + Math.floor(r() * 6);
  for (let y = -rad; y <= rad; y++) for (let x = -rad; x <= rad; x++) if (x * x + y * y <= rad * rad) set(cx + x, cy + y, scene === 'night' ? [235, 235, 210] : [250, 225, 120]);
  // Hills or ridges.
  const hills = 1 + Math.floor(r() * 3);
  for (let h = 0; h < hills; h++) {
    const base = Math.floor(r() * width), peak = Math.floor(horizon * (0.45 + 0.4 * r())), span = 20 + Math.floor(r() * 40);
    const colour = scene === 'mountain' ? mix(p.ground, [70, 80, 90], 0.5) : mix(p.ground, [30, 60, 30], 0.3 + 0.2 * h);
    for (let x = base - span; x <= base + span; x++) {
      const top = peak + Math.abs(x - base) * (horizon - peak) / span;
      for (let y = Math.floor(top); y < horizon; y++) set(x, y, colour);
      if (scene === 'mountain' && top < peak + 6) for (let y = Math.floor(top); y < peak + 6; y++) set(x, y, p.accent);
    }
  }
  // A house, trees or water, depending on the scene.
  if (['hall', 'city', 'kitchen', 'snow', 'garden'].includes(scene)) {
    const hx = Math.floor(width * (0.2 + 0.5 * r())), hw = 18 + Math.floor(r() * 16), hh = 14 + Math.floor(r() * 10);
    for (let y = horizon - hh; y < horizon; y++) for (let x = hx; x < hx + hw; x++) set(x, y, p.accent);
    for (let k = 0; k < hw / 2 + 1; k++) for (let x = hx + k; x < hx + hw - k; x++) set(x, horizon - hh - k, mix(p.accent, [60, 40, 40], 0.5));
    for (let y = horizon - 8; y < horizon; y++) for (let x = hx + Math.floor(hw / 2) - 2; x < hx + Math.floor(hw / 2) + 2; x++) set(x, y, [70, 50, 40]);
  }
  if (['garden', 'mountain', 'snow'].includes(scene)) {
    for (let k = 0, n = 2 + Math.floor(r() * 4); k < n; k++) {
      const tx = Math.floor(r() * width), th = 10 + Math.floor(r() * 12);
      for (let y = 0; y < th; y++) for (let x = -Math.floor(y / 2); x <= Math.floor(y / 2); x++) set(tx + x, horizon - th + y + 4, [30, 90, 50]);
    }
  }
  if (scene === 'beach') for (let y = horizon; y < horizon + Math.floor((height - horizon) * 0.4); y++) for (let x = 0; x < width; x++) set(x, y, mix(p.accent, [255, 255, 255], ((x + y * 3) % 17) / 40));
  if (scene === 'night') for (let k = 0; k < 30; k++) set(Math.floor(r() * width), Math.floor(r() * horizon), [255, 255, 230]);
  // Light grain, so the stand-in compresses like an image rather than a flat diagram.
  for (let i = 0; i < img.length; i++) img[i] = Math.max(0, Math.min(255, img[i] + Math.floor(r() * 3) - 1));
  // Stamped caption on a dark band, wrapped at spaces onto up to two lines so no word (or date) is cut.
  const shown = captionLines(caption, width), band = 3 + shown.length * 7;
  for (let y = height - band; y < height; y++) for (let x = 0; x < width; x++) set(x, y, [20, 20, 24]);
  shown.forEach((line, row) => [...line].forEach((ch, k) => {
    const g = GLYPHS[ch] || GLYPHS[' '];
    for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < 3; gx++) if (g[gy * 3 + gx] === '1') set(2 + k * 4 + gx, height - band + 2 + row * 7 + gy, [245, 245, 235]);
  }));
  return {width, height, bytes: encodePNG(width, height, img)};
}
// The stamped caption's lines: words wrapped at spaces to the image width, at most two lines.
function captionLines(caption, width) {
  const fit = Math.floor((width - 4) / 4), lines = [];
  for (const word of caption.toUpperCase().replace(/[^A-Z0-9 .,&-]/g, ' ').split(/\s+/).filter(Boolean)) {
    const last = lines[lines.length - 1];
    if (last !== undefined && (last + ' ' + word).length <= fit) lines[lines.length - 1] = last + ' ' + word;
    else lines.push(word.slice(0, fit));
  }
  return lines.slice(0, 2);
}
module.exports = {draw, encodePNG, KINDS, hash, captionLines};
