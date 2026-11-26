'use strict';
const zlib = require('node:zlib');

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function png(width, height, rgb) {
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x += 1) {
      row[1 + x * 3] = rgb[0];
      row[2 + x * 3] = rgb[1];
      row[3 + x * 3] = rgb[2];
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const idat = zlib.deflateSync(Buffer.concat(rows));
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function jpeg(width, height, rgb) {
  // Baseline JPEG, one solid color, standard Huffman tables, 4:2:0 sampling.
  const y = Math.max(0, Math.min(255, Math.round(0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2])));
  const dc = Math.round((y - 128) / 8);
  const bits = [];
  function put(value, length) {
    for (let i = length - 1; i >= 0; i -= 1) bits.push((value >> i) & 1);
  }
  const magnitude = dc === 0 ? 0 : Math.floor(Math.log2(Math.abs(dc))) + 1;
  put(magnitude === 0 ? 0x00 : (0x100 >> (8 - magnitude)), magnitude === 0 ? 2 : magnitude + 2);
  if (magnitude) {
    const coded = dc < 0 ? dc + (1 << magnitude) - 1 : dc;
    put(coded, magnitude);
  }
  put(0x00, 2);
  while (bits.length % 8) bits.push(1);
  const scan = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let b = 0; b < 8; b += 1) byte = (byte << 1) | bits[i + b];
    scan.push(byte);
    if (byte === 0xff) scan.push(0x00);
  }
  const dqt = Buffer.from([
    8, 6, 6, 8, 6, 6, 8, 8, 8, 8, 10, 10, 8, 10, 12, 12,
    10, 10, 10, 10, 12, 16, 12, 12, 12, 12, 12, 16, 16, 16, 16, 16,
    16, 16, 16, 16, 20, 20, 20, 20, 20, 24, 24, 24, 24, 28, 28, 28,
    28, 32, 32, 32, 36, 36, 40, 40, 44, 48, 48, 52, 56, 60, 64, 68
  ]);
  const sof = Buffer.alloc(15);
  sof.writeUInt16BE(13, 0);
  sof[2] = 8;
  sof.writeUInt16BE(height, 3);
  sof.writeUInt16BE(width, 5);
  sof[7] = 1;
  sof[8] = 1;
  sof[9] = 0x11;
  sof[10] = 0;
  const dht = Buffer.from([
    0x00, 0x00,
    0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0,
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11
  ]);
  const sos = Buffer.from([0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]);
  function marker(code, body) {
    const head = Buffer.alloc(2);
    head[0] = 0xff;
    head[1] = code;
    return body ? Buffer.concat([head, body]) : head;
  }
  const quant = Buffer.concat([Buffer.from([0x00, 0x43, 0x00]), dqt]);
  return Buffer.concat([
    marker(0xd8),
    marker(0xdb, quant),
    marker(0xc0, sof),
    marker(0xc4, dht),
    marker(0xda, sos),
    Buffer.from(scan),
    marker(0xd9)
  ]);
}

function describe(bytes, role, mime) {
  return {role, mime, byte_length: bytes.length, bytes};
}

module.exports = {png, jpeg, describe};
