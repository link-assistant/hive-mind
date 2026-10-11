// Decode a GIF in Chromium (ImageDecoder) and print frame count, size and per-frame durations.
// Usage: node experiments/issue-2998/decode-gif.mjs <file.gif>
import { readFileSync } from 'node:fs';
import { loadChromium } from '../../src/github-access-animation.lib.mjs';
const b64 = readFileSync(process.argv[2]).toString('base64');
const browser = await (await loadChromium()).launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.route('https://decode.test/**', route => route.fulfill({ contentType: 'text/html', body: '<p>ok</p>' }));
await page.goto('https://decode.test/');
console.log(
  await page.evaluate(async b64 => {
    const data = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const d = new ImageDecoder({ data, type: 'image/gif' });
    await d.tracks.ready;
    const n = d.tracks.selectedTrack.frameCount;
    const out = [];
    for (let i = 0; i < n; i++) {
      const { image } = await d.decode({ frameIndex: i });
      out.push(image.duration / 1000);
      if (i === 0) out.size = `${image.displayWidth}x${image.displayHeight}`;
    }
    return JSON.stringify({ n, size: out.size, durationsMs: out });
  }, b64)
);
await browser.close();
