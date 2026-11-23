import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

const pngSignature = Buffer.from('89504e470d0a1a0a', 'hex');
const maxSide = 2048;

export function decodeProbePhoto(data) {
  try {
    if (!Buffer.isBuffer(data) || data.length > 2 * 1024 * 1024) throw new Error();
    if (data.subarray(0, 8).equals(pngSignature)) {
      // Check the IHDR before the decoder allocates any pixel or inflate buffers.
      if (data.length < 33 || data.toString('ascii', 12, 16) !== 'IHDR') throw new Error();
      const width = data.readUInt32BE(16);
      const height = data.readUInt32BE(20);
      if (!width || !height || width > maxSide || height > maxSide) throw new Error();
      return { ...PNG.sync.read(data), extension: 'png' };
    }
    if (data[0] === 0xff && data[1] === 0xd8 && data.at(-2) === 0xff && data.at(-1) === 0xd9) {
      const image = jpeg.decode(data, { useTArray: true, tolerantDecoding: false, maxResolutionInMP: 4.2, maxMemoryUsageInMB: 48 });
      if (!image.width || !image.height || image.width > maxSide || image.height > maxSide) throw new Error();
      return { ...image, extension: 'jpg' };
    }
  } catch {
    // Decoder errors can contain bytes supplied by the sender.
  }
  throw new Error('Could not decode a bounded JPEG or PNG probe photo.');
}

export function createProbePhoto() {
  const image = new PNG({ width: 128, height: 128 });
  const colors = [
    [230, 38, 52],
    [56, 165, 214],
    [243, 201, 38],
    [81, 37, 127],
  ];
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const color = colors[(x >= 64 ? 1 : 0) + (y >= 64 ? 2 : 0)];
      image.data.set([...color, 255], (y * image.width + x) * 4);
    }
  }
  return PNG.sync.write(image);
}

export function verifyProbePhoto(expected, received) {
  const actual = decodeProbePhoto(received);
  const { width, height } = expected;
  if (width !== actual.width || height !== actual.height) throw new Error('The downloaded photo dimensions differ from the probe photo.');
  // Compare RGB over a white background. Tile and channel means prevent a
  // localized or single-channel change from disappearing in the overall mean.
  const tiles = Array.from({ length: 16 }, () => [0, 0, 0, 0]);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tile = tiles[Math.floor((y * 4) / height) * 4 + Math.floor((x * 4) / width)];
      const i = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        const left = 255 - ((255 - expected.data[i + channel]) * expected.data[i + 3]) / 255;
        const right = 255 - ((255 - actual.data[i + channel]) * actual.data[i + 3]) / 255;
        tile[channel] += Math.abs(left - right);
      }
      tile[3]++;
    }
  }
  const total = tiles.reduce((sum, [red, green, blue]) => sum + red + green + blue, 0);
  if (total > width * height * 3 * 12 || tiles.some(([red, green, blue, pixels]) => Math.max(red, green, blue) > pixels * 24)) {
    throw new Error('The downloaded photo pixels differ from the probe photo beyond recompression tolerance.');
  }
}
