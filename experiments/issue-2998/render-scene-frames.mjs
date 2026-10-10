// Screenshot the animated access scene at chosen times (seconds) for review.
// Usage: node experiments/issue-2998/render-scene-frames.mjs <login> <locale> <User|Organization> <outdir> [t1 t2 ...]
import { mkdir, writeFile } from 'node:fs/promises';
import { buildAccessAnimationCaptions, loadChromium } from '../../src/github-access-animation.lib.mjs';
import { buildAccessAnimationHtml, buildAccessScene, SCENE_SIZE } from '../../src/github-access-scene.lib.mjs';

const [login = 'konard', locale = 'en', ownerType = 'User', out = '/tmp/scene', ...times] = process.argv.slice(2);
await mkdir(out, { recursive: true });
const captions = await buildAccessAnimationCaptions({ login, ownerType, locale });
const { duration, plan } = buildAccessScene({ login, ownerType, captions });
const samples = times.length ? times.map(Number) : plan.clicks.map(c => c.t + 0.1).concat([duration - 0.5]);
const browser = await (await loadChromium()).launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: SCENE_SIZE });
await page.setContent(buildAccessAnimationHtml({ login, ownerType, captions }));
for (const [i, t] of samples.entries()) {
  await page.evaluate(
    ms =>
      document.getAnimations().forEach(a => {
        a.pause();
        a.currentTime = ms;
      }),
    t * 1000
  );
  await writeFile(`${out}/${String(i).padStart(2, '0')}-${t.toFixed(2)}.png`, await page.screenshot());
}
await browser.close();
console.log(`duration ${duration.toFixed(2)}s, ${samples.length} frames in ${out}`);
