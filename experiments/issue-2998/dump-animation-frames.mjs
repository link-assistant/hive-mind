// Render each distinct frame of the access animation to PNG for review.
// Usage: node experiments/issue-2998/dump-animation-frames.mjs <login> <locale> <User|Organization> <outdir>
import { mkdir, writeFile } from 'node:fs/promises';
import { buildAccessAnimationCaptions, buildAccessAnimationFrames, loadChromium, ACCESS_ANIMATION_SIZE } from '../../src/github-access-animation.lib.mjs';

const [login = 'konard', locale = 'en', ownerType = 'User', out = '/tmp/frames'] = process.argv.slice(2);
await mkdir(out, { recursive: true });
const captions = await buildAccessAnimationCaptions({ login, ownerType, locale });
const frames = [...new Set(buildAccessAnimationFrames({ login, ownerType, captions }))];
const browser = await (await loadChromium()).launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: ACCESS_ANIMATION_SIZE });
for (const [i, html] of frames.entries()) {
  await page.setContent(html);
  await writeFile(`${out}/${String(i).padStart(2, '0')}.png`, await page.screenshot());
}
await browser.close();
console.log(`${frames.length} frames in ${out}`);
