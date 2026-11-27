'use strict';
// Portable flat images. PNG uses Node's zlib. JPEG uses integer DC coefficients so the bytes do not depend on ffmpeg, fonts, or floating point.
const zlib = require('node:zlib');

const GLYPHS = {
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  J: ['00111', '00010', '00010', '00010', '10010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111']
};

function rgb(value) {
  const color = typeof value === 'number' ? value : Number(value);
  return [(color >> 16) & 255, (color >> 8) & 255, color & 255];
}

function canvas(width, height, fill) {
  const data = Buffer.alloc(width * height * 3);
  const color = rgb(fill);
  for (let index = 0; index < width * height; index += 1) {
    data[index * 3] = color[0];
    data[index * 3 + 1] = color[1];
    data[index * 3 + 2] = color[2];
  }
  function plot(x, y, color) {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const index = (y * width + x) * 3;
    data[index] = color[0];
    data[index + 1] = color[1];
    data[index + 2] = color[2];
  }
  return {
    width,
    height,
    data,
    fillRect(x, y, w, h, color) {
      const ink = rgb(color);
      for (let row = y; row < y + h; row += 1) {
        for (let column = x; column < x + w; column += 1) plot(column, row, ink);
      }
    },
    text(label, x, y, color, scale) {
      const ink = rgb(color);
      let cursor = x;
      for (const character of String(label).toUpperCase()) {
        const rows = GLYPHS[character] || GLYPHS[' '];
        rows.forEach((row, dy) => {
          for (let dx = 0; dx < row.length; dx += 1) {
            if (row[dx] !== '1') continue;
            for (let sy = 0; sy < scale; sy += 1) {
              for (let sx = 0; sx < scale; sx += 1) plot(cursor + dx * scale + sx, y + dy * scale + sy, ink);
            }
          }
        });
        cursor += (rows[0].length + 1) * scale;
      }
    }
  };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, payload) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length);
  const body = Buffer.concat([Buffer.from(type), payload]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(image) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header[8] = 8;
  header[9] = 2;
  const raw = Buffer.alloc((image.width * 3 + 1) * image.height);
  for (let y = 0; y < image.height; y += 1) {
    const start = y * (image.width * 3 + 1);
    raw[start] = 0;
    image.data.copy(raw, start + 1, y * image.width * 3, (y + 1) * image.width * 3);
  }
  const compressed = zlib.deflateSync(raw, {level: 9});
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

function huffman(counts, symbols) {
  const codes = new Array(256);
  let code = 0;
  let index = 0;
  for (let length = 1; length <= 16; length += 1) {
    for (let used = 0; used < counts[length - 1]; used += 1) {
      codes[symbols[index]] = {code, length};
      code += 1;
      index += 1;
    }
    code <<= 1;
  }
  return codes;
}

const DC_LUMA_COUNTS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const DC_LUMA_SYMBOLS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const DC_CHROMA_COUNTS = [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0];
const DC_CHROMA_SYMBOLS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const AC_LUMA_COUNTS = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 125];
const AC_LUMA_SYMBOLS = [
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07,
  0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0,
  0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
  0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
  0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
  0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
  0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7,
  0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5,
  0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
  0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa
];
const AC_CHROMA_COUNTS = [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 119];
const AC_CHROMA_SYMBOLS = [
  0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71,
  0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0,
  0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26,
  0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48,
  0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68,
  0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87,
  0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5,
  0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3,
  0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda,
  0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa
];

const DC_LUMA = huffman(DC_LUMA_COUNTS, DC_LUMA_SYMBOLS);
const DC_CHROMA = huffman(DC_CHROMA_COUNTS, DC_CHROMA_SYMBOLS);
const AC_LUMA = huffman(AC_LUMA_COUNTS, AC_LUMA_SYMBOLS);
const AC_CHROMA = huffman(AC_CHROMA_COUNTS, AC_CHROMA_SYMBOLS);

function BitWriter() {
  this.parts = [];
  this.acc = 0;
  this.used = 0;
}

BitWriter.prototype.write = function write(value, length) {
  for (let shift = length - 1; shift >= 0; shift -= 1) {
    this.acc = (this.acc << 1) | ((value >> shift) & 1);
    this.used += 1;
    if (this.used === 8) {
      this.parts.push(this.acc);
      if (this.acc === 0xff) this.parts.push(0);
      this.acc = 0;
      this.used = 0;
    }
  }
};

BitWriter.prototype.bytes = function bytes() {
  const out = this.parts.slice();
  if (this.used) {
    const padded = (this.acc << (8 - this.used)) | ((1 << (8 - this.used)) - 1);
    out.push(padded);
  }
  return Buffer.from(out);
};

function magnitude(value) {
  let bits = 0;
  let left = Math.abs(value);
  while (left) {
    bits += 1;
    left >>= 1;
  }
  return bits;
}

function writeCoefficient(writer, table, value) {
  const bits = magnitude(value);
  const symbol = table[bits];
  writer.write(symbol.code, symbol.length);
  if (!bits) return;
  const extra = value >= 0 ? value : value + (1 << bits) - 1;
  writer.write(extra, bits);
}

function writeBlock(writer, dcTable, acTable, dc, previous) {
  writeCoefficient(writer, dcTable, dc - previous);
  const eob = acTable[0x00];
  writer.write(eob.code, eob.length);
  return dc;
}

function marker(bytes, code) {
  bytes.push(0xff, code);
}

function segment(bytes, code, payload) {
  marker(bytes, code);
  bytes.push((payload.length + 2) >> 8, (payload.length + 2) & 255);
  for (const byte of payload) bytes.push(byte);
}

function dht(counts, symbols) {
  return Buffer.from([...counts, ...symbols]);
}

function centered(red, green, blue) {
  const y = Math.round((19595 * red + 38470 * green + 7471 * blue) / 65536) - 128;
  const cb = Math.round((-11059 * red - 21709 * green + 32768 * blue) / 65536);
  const cr = Math.round((32768 * red - 27439 * green - 5329 * blue) / 65536);
  return [y, cb, cr];
}

function jpeg(image) {
  const width = image.width;
  const height = image.height;
  if (width % 8 || height % 8) throw new Error('JPEG width and height must be multiples of 8.');
  const writer = new BitWriter();
  let yDc = 0;
  let cbDc = 0;
  let crDc = 0;
  for (let blockY = 0; blockY < height; blockY += 8) {
    for (let blockX = 0; blockX < width; blockX += 8) {
      let red = 0;
      let green = 0;
      let blue = 0;
      for (let y = 0; y < 8; y += 1) {
        for (let x = 0; x < 8; x += 1) {
          const index = ((blockY + y) * width + blockX + x) * 3;
          red += image.data[index];
          green += image.data[index + 1];
          blue += image.data[index + 2];
        }
      }
      const [y, cb, cr] = centered(Math.round(red / 64), Math.round(green / 64), Math.round(blue / 64));
      yDc = writeBlock(writer, DC_LUMA, AC_LUMA, y * 8, yDc);
      cbDc = writeBlock(writer, DC_CHROMA, AC_CHROMA, cb * 8, cbDc);
      crDc = writeBlock(writer, DC_CHROMA, AC_CHROMA, cr * 8, crDc);
    }
  }
  const quant = Buffer.alloc(64, 1);
  const bytes = [0xff, 0xd8];
  segment(bytes, 0xe0, Buffer.from([0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]));
  segment(bytes, 0xdb, Buffer.concat([Buffer.from([0]), quant]));
  segment(bytes, 0xdb, Buffer.concat([Buffer.from([1]), quant]));
  const frame = Buffer.alloc(15);
  frame[0] = 8;
  frame.writeUInt16BE(height, 1);
  frame.writeUInt16BE(width, 3);
  frame[5] = 3;
  frame[6] = 1;
  frame[7] = 0x11;
  frame[8] = 0;
  frame[9] = 2;
  frame[10] = 0x11;
  frame[11] = 1;
  frame[12] = 3;
  frame[13] = 0x11;
  frame[14] = 1;
  segment(bytes, 0xc0, frame);
  segment(bytes, 0xc4, Buffer.concat([Buffer.from([0x00]), dht(DC_LUMA_COUNTS, DC_LUMA_SYMBOLS)]));
  segment(bytes, 0xc4, Buffer.concat([Buffer.from([0x10]), dht(AC_LUMA_COUNTS, AC_LUMA_SYMBOLS)]));
  segment(bytes, 0xc4, Buffer.concat([Buffer.from([0x01]), dht(DC_CHROMA_COUNTS, DC_CHROMA_SYMBOLS)]));
  segment(bytes, 0xc4, Buffer.concat([Buffer.from([0x11]), dht(AC_CHROMA_COUNTS, AC_CHROMA_SYMBOLS)]));
  segment(bytes, 0xda, Buffer.from([3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0]));
  const scan = writer.bytes();
  const body = Buffer.from(bytes);
  return Buffer.concat([body, scan, Buffer.from([0xff, 0xd9])]);
}

module.exports = {canvas, png, jpeg};
