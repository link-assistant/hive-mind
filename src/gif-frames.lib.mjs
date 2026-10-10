/**
 * Small GIFs from screenshots of a mostly still page.
 *
 * browser-commander's encodeAnimation() writes every frame at full size. For a
 * cursor moving over a page that is ~50 KB per frame, almost all of it
 * repeated. Here each screenshot is compared with the previous one, only the
 * changed rectangle is encoded (with encodeAnimation, one frame at a time),
 * with the pixels that did not change inside it left transparent, and the
 * pieces are spliced into one GIF at their offsets, each frame drawn over the
 * previous one.
 *
 * Only what Chromium screenshots need: 8-bit RGB/RGBA, non-interlaced PNGs.
 *
 * @see https://www.w3.org/Graphics/GIF/spec-gif89a.txt
 * @see https://www.w3.org/TR/png/
 */

import { crc32, deflateSync, inflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Decode a PNG into RGBA pixels. */
export function decodePng(png) {
  const bytes = Buffer.from(png);
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('not a PNG');
  let width, height, channels;
  const idat = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      channels = { 2: 3, 6: 4 }[data[9]];
      if (data[8] !== 8 || !channels || data[12] !== 0) throw new Error('only 8-bit RGB/RGBA non-interlaced PNGs are supported');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rows = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? rows[y * stride + x - channels] : 0;
      const b = y > 0 ? rows[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? rows[(y - 1) * stride + x - channels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = a;
      else if (filter === 2) predictor = b;
      else if (filter === 3) predictor = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
        predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      rows[y * stride + x] = (line[x] + predictor) & 0xff;
    }
  }
  if (channels === 4) return { width, height, data: rows };
  const data = Buffer.alloc(width * height * 4, 0xff);
  for (let i = 0; i < width * height; i++) rows.copy(data, i * 4, i * 3, i * 3 + 3);
  return { width, height, data };
}

/** Encode RGBA pixels as a PNG (no filtering; it is only handed to the GIF encoder). */
export function encodePng({ width, height, data }) {
  const chunk = (type, body) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, 'latin1');
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
    return Buffer.concat([head, body, tail]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) data.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([PNG_SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** Smallest rectangle where two equal-sized images differ, or null when they are the same. */
export function diffBounds(previous, next) {
  let left = next.width;
  let top = next.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < next.height; y++) {
    for (let x = 0; x < next.width; x++) {
      const i = (y * next.width + x) * 4;
      if (previous.data.readUInt32BE(i) === next.data.readUInt32BE(i)) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  return right < 0 ? null : { left, top, width: right - left + 1, height: bottom - top + 1 };
}

/**
 * Copy a rectangle out of an RGBA image. With `previous`, pixels equal to it
 * become transparent (alpha 0), so the GIF keeps showing them.
 */
export function cropImage(image, { left, top, width, height }, previous = null) {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const from = ((top + y) * image.width + left) * 4;
    image.data.copy(data, y * width * 4, from, from + width * 4);
    if (!previous) continue;
    for (let x = 0; x < width; x++) {
      if (previous.data.readUInt32BE(from + x * 4) === image.data.readUInt32BE(from + x * 4)) data.writeUInt32BE(0, (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

const tableSize = packed => (packed & 0x80 ? 3 * 2 ** ((packed & 0x07) + 1) : 0);

const skipSubBlocks = (bytes, offset) => {
  while (bytes[offset] !== 0) offset += bytes[offset] + 1;
  return offset + 1;
};

/**
 * The first image of a GIF: its color table (global or local), transparent
 * color index (or null) and LZW-compressed pixels.
 */
export function readGifImage(gif) {
  const bytes = Buffer.from(gif);
  const globalTable = bytes.subarray(13, 13 + tableSize(bytes[10]));
  const globalBits = bytes[10] & 0x07;
  let offset = 13 + globalTable.length;
  let transparentIndex = null;
  while (offset < bytes.length && bytes[offset] !== 0x3b) {
    if (bytes[offset] === 0x21) {
      if (bytes[offset + 1] === 0xf9) transparentIndex = bytes[offset + 3] & 0x01 ? bytes[offset + 6] : null;
      offset = skipSubBlocks(bytes, offset + 2);
    } else if (bytes[offset] === 0x2c) {
      const packed = bytes[offset + 9];
      const localTable = bytes.subarray(offset + 10, offset + 10 + tableSize(packed));
      const dataStart = offset + 10 + localTable.length;
      const dataEnd = skipSubBlocks(bytes, dataStart + 1);
      const table = packed & 0x80 ? { table: localTable, tableBits: packed & 0x07 } : { table: globalTable, tableBits: globalBits };
      return { ...table, transparentIndex, data: bytes.subarray(dataStart, dataEnd) };
    } else {
      throw new Error(`Unexpected GIF block 0x${bytes[offset].toString(16)} at ${offset}`);
    }
  }
  throw new Error('GIF has no image');
}

/**
 * Assemble a looping GIF from pieces drawn over each other.
 *
 * @param {Object} options
 * @param {number} options.width
 * @param {number} options.height
 * @param {Array<{left: number, top: number, width: number, height: number, gif: Uint8Array, delay: number}>} options.frames
 *   each piece as a one-frame GIF and its display time in centiseconds
 * @returns {Buffer}
 */
export function spliceGifFrames({ width, height, frames }) {
  const header = Buffer.alloc(13);
  header.write('GIF89a', 0, 'latin1');
  header.writeUInt16LE(width, 6);
  header.writeUInt16LE(height, 8);
  const loop = Buffer.from([0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0', 'latin1'), 0x03, 0x01, 0x00, 0x00, 0x00]);
  const parts = [header, loop];
  for (const frame of frames) {
    const { table, tableBits, transparentIndex, data } = readGifImage(frame.gif);
    // Dispose method 1: the next frame is drawn over this one.
    const control = Buffer.from([0x21, 0xf9, 0x04, transparentIndex === null ? 0x04 : 0x05, 0, 0, transparentIndex ?? 0, 0x00]);
    control.writeUInt16LE(Math.max(2, Math.round(frame.delay)), 4);
    const descriptor = Buffer.alloc(10);
    descriptor[0] = 0x2c;
    descriptor.writeUInt16LE(frame.left, 1);
    descriptor.writeUInt16LE(frame.top, 3);
    descriptor.writeUInt16LE(frame.width, 5);
    descriptor.writeUInt16LE(frame.height, 7);
    descriptor[9] = 0x80 | tableBits;
    parts.push(control, descriptor, table, data);
  }
  parts.push(Buffer.from([0x3b]));
  return Buffer.concat(parts);
}

/**
 * Up to `size` [r, g, b] colors for the opaque pixels of an image: all of them
 * when they fit (screenshots of a UI usually do, so the frame is lossless),
 * otherwise a median cut at full 8-bit precision.
 *
 * browser-commander's own quantizer works on 4 bits per channel, which merges
 * GitHub's dark grays (#010409, #0d1117, #151b23 …) and leaves the page
 * visibly tinted.
 */
export function buildPalette(image, size = 256) {
  const counts = new Map();
  for (let i = 0; i < image.width * image.height; i++) {
    if (image.data[i * 4 + 3] === 0) continue;
    const rgb = image.data.readUInt32BE(i * 4) >>> 8;
    counts.set(rgb, (counts.get(rgb) || 0) + 1);
  }
  const channel = (rgb, c) => (rgb >> (16 - 8 * c)) & 0xff;
  const describe = colors => {
    const ranges = [0, 1, 2].map(c => Math.max(...colors.map(([rgb]) => channel(rgb, c))) - Math.min(...colors.map(([rgb]) => channel(rgb, c))));
    const widest = ranges.indexOf(Math.max(...ranges));
    return { colors, widest, score: ranges[widest] * colors.reduce((sum, [, count]) => sum + count, 0) };
  };
  const boxes = [describe([...counts])];
  while (boxes.length < Math.min(size, counts.size)) {
    const box = boxes.reduce((best, next) => (next.score > best.score ? next : best));
    if (box.score === 0) break;
    const sorted = box.colors.sort((p, q) => channel(p[0], box.widest) - channel(q[0], box.widest));
    const half = sorted.reduce((sum, [, count]) => sum + count, 0) / 2;
    let split = 1;
    for (let seen = sorted[0][1]; split < sorted.length - 1 && seen + sorted[split][1] <= half; split++) seen += sorted[split][1];
    boxes.splice(boxes.indexOf(box), 1, describe(sorted.slice(0, split)), describe(sorted.slice(split)));
  }
  return boxes.map(({ colors }) => {
    const total = colors.reduce((sum, [, count]) => sum + count, 0);
    return [0, 1, 2].map(c => Math.round(colors.reduce((sum, [rgb, count]) => sum + channel(rgb, c) * count, 0) / total));
  });
}

/**
 * Replace each opaque pixel with its nearest palette color, so the encoder
 * has no error left to dither (noise compresses badly and flickers).
 */
export function snapToPalette(image, palette) {
  const nearest = new Map();
  const data = Buffer.from(image.data);
  for (let i = 0; i < image.width * image.height; i++) {
    if (data[i * 4 + 3] === 0) continue;
    const rgb = data.readUInt32BE(i * 4) >>> 8;
    if (!nearest.has(rgb)) {
      const [r, g, b] = [rgb >> 16, (rgb >> 8) & 0xff, rgb & 0xff];
      let best = palette[0];
      let distance = Infinity;
      for (const color of palette) {
        const delta = (color[0] - r) ** 2 + (color[1] - g) ** 2 + (color[2] - b) ** 2;
        if (delta < distance) [best, distance] = [color, delta];
      }
      nearest.set(rgb, best);
    }
    data.set(nearest.get(rgb).slice(0, 3), i * 4);
  }
  return { ...image, data };
}

/**
 * Encode screenshots as a GIF that stores only what changed between them.
 * Identical neighbours are merged into one longer frame.
 *
 * @param {Object} options
 * @param {Array<{png: Uint8Array, delay: number}>} options.shots - delay in centiseconds
 * @param {Function} options.encodeAnimation - browser-commander's encoder
 * @returns {Promise<Buffer>}
 */
export async function encodeDiffGif({ shots, encodeAnimation }) {
  const frames = [];
  let previous = null;
  for (const shot of shots) {
    const image = decodePng(shot.png);
    const bounds = previous ? diffBounds(previous, image) : { left: 0, top: 0, width: image.width, height: image.height };
    if (!bounds) {
      frames.at(-1).delay += shot.delay;
      continue;
    }
    // Opaque colors at full precision (plus one transparent entry after the
    // first frame). With every pixel already on the palette, `dither` is an
    // exact lookup that skips the encoder's 4-bit rounding.
    const colors = buildPalette(cropImage(image, bounds), previous ? 255 : 256).map(rgb => [...rgb, 255]);
    const palette = previous ? [...colors, [0, 0, 0, 0]] : colors.length > 1 ? colors : [...colors, ...colors];
    const piece = snapToPalette(cropImage(image, bounds, previous), colors);
    const gif = await encodeAnimation([encodePng(piece)], { format: 'gif', fps: 10, palette, dither: true });
    frames.push({ ...bounds, gif, delay: shot.delay });
    previous = image;
  }
  if (!previous) throw new Error('no frames');
  return spliceGifFrames({ width: previous.width, height: previous.height, frames });
}
