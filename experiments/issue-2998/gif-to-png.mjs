// Decode frames of a GIF the way Chromium shows them (WebCodecs ImageDecoder
// composites each frame over the previous ones) and save them as PNGs.
// Usage: node experiments/issue-2998/gif-to-png.mjs file.gif outdir [frameIndex...]
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadChromium } from '../../src/github-access-animation.lib.mjs';

const [gifPath, outDir, ...indices] = process.argv.slice(2);
const gif = await readFile(gifPath);
const chromium = await loadChromium();
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
// ImageDecoder needs a secure context; http://127.0.0.1 is one.
const server = createServer((request, response) => response.end('<!doctype html><title>gif</title>'));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const result = await page.evaluate(
    async ({ base64, wanted }) => {
      const data = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      const decoder = new globalThis.ImageDecoder({ data, type: 'image/gif' });
      await decoder.tracks.ready;
      const count = decoder.tracks.selectedTrack.frameCount;
      const frames = [];
      for (const frameIndex of wanted.length ? wanted : [0, count - 1]) {
        const { image } = await decoder.decode({ frameIndex });
        const canvas = new OffscreenCanvas(image.displayWidth, image.displayHeight);
        canvas.getContext('2d').drawImage(image, 0, 0);
        const blob = await canvas.convertToBlob({ type: 'image/png' });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        frames.push({ frameIndex, png: btoa(Array.from(bytes, b => String.fromCharCode(b)).join('')) });
      }
      return { count, frames };
    },
    { base64: gif.toString('base64'), wanted: indices.map(Number) }
  );
  await mkdir(outDir, { recursive: true });
  for (const { frameIndex, png } of result.frames) await writeFile(join(outDir, `frame-${String(frameIndex).padStart(3, '0')}.png`), Buffer.from(png, 'base64'));
  console.log(`${result.count} frames; wrote ${result.frames.length} to ${outDir}`);
} finally {
  await browser.close();
  server.close();
}
