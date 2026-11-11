import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

// Original programmatic pixel icon. No downloaded imagery or fonts.
export async function makeIcon() {
  const size = 64, pixels = Buffer.alloc(size * size * 4);
  const put = (x, y, color) => { if (x >= 0 && x < size && y >= 0 && y < size) pixels.set(color, (y * size + x) * 4); };
  const rect = (x, y, w, h, c) => { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) put(xx, yy, c); };
  for (let y = 3; y < 61; y++) for (let x = 3; x < 61; x++) {
    const dx = Math.max(12 - x, 0, x - 51), dy = Math.max(12 - y, 0, y - 51);
    if (dx * dx + dy * dy < 100) put(x, y, [232, 229, 205, 255]);
  }
  rect(10, 48, 44, 4, [104, 124, 86, 255]);
  rect(15, 44, 35, 4, [153, 164, 117, 255]);
  for (let y = 27; y < 47; y++) for (let x = 14; x < 50; x++) {
    if (((x - 32) / 18) ** 2 + ((y - 37) / 11) ** 2 < 1) put(x, y, y < 36 ? [180, 119, 67, 255] : [137, 86, 49, 255]);
  }
  rect(28, 32, 18, 4, [73, 51, 36, 255]);
  rect(29, 31, 5, 6, [73, 51, 36, 255]);
  rect(20, 28, 10, 2, [219, 165, 98, 255]);
  for (let i = 0; i < 20; i++) rect(32 + Math.floor(i * .7), 27 - i, 3, 3, [110, 73, 43, 255]);
  rect(41, 8, 10, 7, [176, 121, 66, 255]);
  const crc = bytes => { let n = 0xffffffff; for (const byte of bytes) { n ^= byte; for (let b = 0; b < 8; b++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; } return (n ^ 0xffffffff) >>> 0; };
  const chunk = (name, value) => { const type = Buffer.from(name), len = Buffer.alloc(4), checksum = Buffer.alloc(4); len.writeUInt32BE(value.length); checksum.writeUInt32BE(crc(Buffer.concat([type, value]))); return Buffer.concat([len, type, value, checksum]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  const icoHeader = Buffer.alloc(22); icoHeader.writeUInt16LE(1, 2); icoHeader.writeUInt16LE(1, 4); icoHeader[6] = size; icoHeader[7] = size; icoHeader.writeUInt16LE(1, 10); icoHeader.writeUInt16LE(32, 12); icoHeader.writeUInt32LE(png.length, 14); icoHeader.writeUInt32LE(22, 18);
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'icon.png'), png);
  await fs.writeFile(path.join(dir, 'icon.ico'), Buffer.concat([icoHeader, png]));
}
