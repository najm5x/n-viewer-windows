'use strict';

// Expand the committed, complete G-logo icon into a Windows-compatible
// multi-resolution ICO. No external image tooling is required.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const iconPath = path.join(__dirname, '..', 'assets', 'n-viewer.ico');
const publicIconPath = path.join(__dirname, '..', 'renderer', 'public', 'n-viewer.ico');
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const iend = Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]);

function readIconEntries(ico) {
  if (ico.readUInt16LE(0) !== 0 || ico.readUInt16LE(2) !== 1) {
    throw new Error('Expected a Windows ICO source');
  }
  const entries = [];
  for (let i = 0; i < ico.readUInt16LE(4); i += 1) {
    const p = 6 + i * 16;
    const size = ico.readUInt32LE(p + 8);
    const offset = ico.readUInt32LE(p + 12);
    if (offset + size > ico.length) throw new Error('Truncated ICO entry');
    const png = ico.subarray(offset, offset + size);
    if (!png.subarray(0, 8).equals(signature) || !png.subarray(-12).equals(iend)) {
      throw new Error('Invalid PNG in ICO');
    }
    entries.push({ width: png.readUInt32BE(16), height: png.readUInt32BE(20), png });
  }
  return entries;
}

function decodePng(png) {
  let pos = 8, width = 0, height = 0, channels = 0;
  const compressed = [];
  while (pos + 12 <= png.length) {
    const length = png.readUInt32BE(pos);
    const type = png.toString('ascii', pos + 4, pos + 8);
    const data = png.subarray(pos + 8, pos + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6) throw new Error('Expected 8-bit RGBA PNG');
      channels = 4;
    }
    if (type === 'IDAT') compressed.push(data);
    pos += 12 + length;
    if (type === 'IEND') break;
  }

  const raw = zlib.inflateSync(Buffer.concat(compressed));
  const stride = width * channels;
  const rgba = Buffer.alloc(height * stride);
  let input = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[input++];
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? rgba[y * stride + x - channels] : 0;
      const up = y > 0 ? rgba[(y - 1) * stride + x] : 0;
      const upperLeft = y > 0 && x >= channels ? rgba[(y - 1) * stride + x - channels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = Math.floor((left + up) / 2);
      else if (filter === 4) {
        const p = left + up - upperLeft;
        const a = Math.abs(p - left), b = Math.abs(p - up), c = Math.abs(p - upperLeft);
        predictor = a <= b && a <= c ? left : b <= c ? up : upperLeft;
      } else if (filter !== 0) throw new Error('Unsupported PNG filter');
      rgba[y * stride + x] = (raw[input++] + predictor) & 255;
    }
  }
  return { width, height, rgba };
}

function resizedRgba(input, newSize) {
  const { width, height, rgba } = input;
  const out = Buffer.alloc(newSize * newSize * 4);
  for (let y = 0; y < newSize; y += 1) {
    const sy = Math.max(0, Math.min(height - 1, (y + 0.5) * height / newSize - 0.5));
    const y0 = Math.floor(sy), y1 = Math.min(height - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < newSize; x += 1) {
      const sx = Math.max(0, Math.min(width - 1, (x + 0.5) * width / newSize - 0.5));
      const x0 = Math.floor(sx), x1 = Math.min(width - 1, x0 + 1), fx = sx - x0;
      for (let c = 0; c < 4; c += 1) {
        const sample = (ix, iy) => rgba[(iy * width + ix) * 4 + c];
        const a = sample(x0, y0) * (1 - fx) + sample(x1, y0) * fx;
        const b = sample(x0, y1) * (1 - fx) + sample(x1, y1) * fx;
        out[(y * newSize + x) * 4 + c] = Math.round(a * (1 - fy) + b * fy);
      }
    }
  }
  return out;
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let c = index;
  for (let i = 0; i < 8; i += 1) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
  return c >>> 0;
});

function pngChunk(name, payload) {
  const type = Buffer.from(name, 'ascii');
  const header = Buffer.alloc(8);
  header.writeUInt32BE(payload.length, 0);
  type.copy(header, 4);
  const crcInput = Buffer.concat([type, payload]);
  let crc = 0xffffffff;
  for (const byte of crcInput) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  const footer = Buffer.alloc(4);
  footer.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([header, payload, footer]);
}

function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const lines = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) rgba.copy(lines, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(lines, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

function encodeIco(entries) {
  const headerSize = 6 + entries.length * 16;
  const output = Buffer.alloc(headerSize + entries.reduce((sum, entry) => sum + entry.png.length, 0));
  output.writeUInt16LE(1, 2);
  output.writeUInt16LE(entries.length, 4);
  let offset = headerSize;
  for (let i = 0; i < entries.length; i += 1) {
    const { width, height, png } = entries[i];
    const at = 6 + i * 16;
    output[at] = width === 256 ? 0 : width;
    output[at + 1] = height === 256 ? 0 : height;
    output.writeUInt16LE(1, at + 4);
    output.writeUInt16LE(32, at + 6);
    output.writeUInt32LE(png.length, at + 8);
    output.writeUInt32LE(offset, at + 12);
    png.copy(output, offset);
    offset += png.length;
  }
  return output;
}

const entries = readIconEntries(fs.readFileSync(iconPath));
if (!entries.some(({ width, height }) => width === 256 && height === 256)) {
  const source = entries.find(({ width }) => width === 32) || entries.at(-1);
  const rgba = resizedRgba(decodePng(source.png), 256);
  entries.push({ width: 256, height: 256, png: encodePng(rgba, 256) });
}
const updated = encodeIco(entries);
fs.writeFileSync(iconPath, updated);
fs.writeFileSync(publicIconPath, updated);
console.log('Prepared Gabatee Windows icon (including 256x256 artwork).');
