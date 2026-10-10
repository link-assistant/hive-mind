// List each frame of a GIF: offset, size, delay and compressed bytes.
// Usage: node experiments/issue-2998/gif-frame-sizes.mjs file.gif
import { readFileSync } from 'node:fs';
const bytes = readFileSync(process.argv[2]);
const tableSize = packed => (packed & 0x80 ? 3 * 2 ** ((packed & 0x07) + 1) : 0);
const skip = offset => {
  while (bytes[offset] !== 0) offset += bytes[offset] + 1;
  return offset + 1;
};
let offset = 13 + tableSize(bytes[10]);
let delay = 0;
let total = 0;
const rows = [];
while (offset < bytes.length && bytes[offset] !== 0x3b) {
  if (bytes[offset] === 0x21) {
    if (bytes[offset + 1] === 0xf9) delay = bytes.readUInt16LE(offset + 4);
    offset = skip(offset + 2);
  } else {
    const start = offset;
    const [left, top, width, height] = [1, 3, 5, 7].map(i => bytes.readUInt16LE(offset + i));
    offset = skip(offset + 10 + tableSize(bytes[offset + 9]) + 1);
    total += delay;
    rows.push({ t: total / 100, left, top, width, height, delay, bytes: offset - start });
  }
}
console.table(rows);
console.log(`${rows.length} frames, ${bytes.length} bytes, ${total / 100}s`);
