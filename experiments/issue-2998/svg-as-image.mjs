// Show an animated SVG through <img> (as GitHub's markdown does) and screenshot
// it at a few wall-clock moments. Usage: node experiments/issue-2998/svg-as-image.mjs file.svg outdir [seconds...]
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadChromium } from '../../src/github-access-animation.lib.mjs';

const [svgPath, outDir, ...moments] = process.argv.slice(2);
const svg = await readFile(svgPath);
const server = createServer((request, response) => {
  if (request.url === '/a.svg') response.writeHead(200, { 'content-type': 'image/svg+xml' }).end(svg);
  else response.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><body style="margin:0;background:#0d1117"><img src="/a.svg">');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const chromium = await loadChromium();
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await mkdir(outDir, { recursive: true });
  const start = Date.now();
  for (const moment of (moments.length ? moments : ['1', '6']).map(Number)) {
    await page.waitForTimeout(Math.max(0, moment * 1000 - (Date.now() - start)));
    await page.screenshot({ path: join(outDir, `img-${moment}s.png`) });
  }
  console.log(`saved to ${outDir}`);
} finally {
  await browser.close();
  server.close();
}
