// Crop and enlarge a region of a PNG (to inspect GIF artefacts).
// Usage: node experiments/issue-2998/zoom.mjs in.png out.png left top width height [scale]
import { readFileSync, writeFileSync } from 'node:fs';
import { decodePng, encodePng, cropImage } from '../../src/gif-frames.lib.mjs';
const [input, output, ...numbers] = process.argv.slice(2);
const [left, top, width, height, scale = 4] = numbers.map(Number);
const crop = cropImage(decodePng(readFileSync(input)), { left, top, width, height });
const data = Buffer.alloc(width * scale * height * scale * 4);
for (let y = 0; y < height * scale; y++) for (let x = 0; x < width * scale; x++) crop.data.copy(data, (y * width * scale + x) * 4, (Math.floor(y / scale) * width + Math.floor(x / scale)) * 4, (Math.floor(y / scale) * width + Math.floor(x / scale)) * 4 + 4);
writeFileSync(output, encodePng({ width: width * scale, height: height * scale, data }));
