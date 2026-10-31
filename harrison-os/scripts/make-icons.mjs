// Pure Node PNG writer (zlib only, no downloads). Writes simple solid-background
// icons with a contrasting mark into public/icons/ at 180, 192 and 512 px.
// The mark is a white "H" with an amber bar beneath it (the "spike" stripe).
// Icons are full-bleed squares: iOS and Android apply their own masks.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'public', 'icons');

const BG = [0x1f, 0x4e, 0x5f]; // deep teal
const MARK = [0xff, 0xff, 0xff]; // white
const STRIPE = [0xf2, 0xb1, 0x34]; // amber

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([len, typeAndData, crc]);
}

function encodePng(size, pixelAt) {
  const rowLen = 1 + size * 3; // filter byte + RGB
  const raw = Buffer.alloc(rowLen * size);
  for (let y = 0; y < size; y++) {
    raw[y * rowLen] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixelAt(x, y);
      const o = y * rowLen + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Geometry in unit coordinates (0..1), kept inside the central ~60% safe zone
// so maskable crops never cut the mark.
function iconPixel(u, v) {
  const inRect = (x0, y0, x1, y1) => u >= x0 && u < x1 && v >= y0 && v < y1;
  // "H": two posts and a crossbar.
  if (inRect(0.3, 0.26, 0.4, 0.64)) return MARK;
  if (inRect(0.6, 0.26, 0.7, 0.64)) return MARK;
  if (inRect(0.4, 0.41, 0.6, 0.49)) return MARK;
  // amber stripe under the letter
  if (inRect(0.3, 0.69, 0.7, 0.74)) return STRIPE;
  return BG;
}

function makeIcon(size) {
  return encodePng(size, (x, y) => iconPixel((x + 0.5) / size, (y + 0.5) / size));
}

mkdirSync(outDir, { recursive: true });
for (const size of [180, 192, 512]) {
  const file = join(outDir, `icon-${size}.png`);
  const png = makeIcon(size);
  writeFileSync(file, png);
  console.log(`wrote public/icons/icon-${size}.png (${png.length} bytes)`);
}
