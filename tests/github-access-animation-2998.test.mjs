#!/usr/bin/env node
/**
 * Issue #2998: the "give Hive Mind write access" animation. Hosts render it
 * once per account, owner kind and language into the guides folder and reuse
 * it; the example for `konard` is committed under docs/assets/github-access/.
 *
 * Everything here runs without a browser: frames are plain HTML, rendering is
 * exercised with fake loaders and a synthetic GIF.
 *
 * Run with: node tests/github-access-animation-2998.test.mjs
 */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildAccessAnimationCaptions, buildAccessAnimationFrames, ensureAccessAnimation, getAccessAnimationPath, getGuidesDir, renderAccessAnimation, setGifFrameDelays } from '../src/github-access-animation.lib.mjs';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}`);
    failed++;
  }
}

// Minimal GIF89a: 2-colour global table, a NETSCAPE loop block, then one
// Graphic Control Extension and one 1x1 image per frame.
function syntheticGif(frameCount, delay = 50) {
  const parts = [Buffer.from('GIF89a'), Buffer.from([1, 0, 1, 0, 0x80, 0, 0]), Buffer.alloc(6)];
  parts.push(Buffer.from([0x21, 0xff, 0x0b]), Buffer.from('NETSCAPE2.0'), Buffer.from([3, 1, 0, 0, 0]));
  for (let i = 0; i < frameCount; i++) {
    parts.push(Buffer.from([0x21, 0xf9, 4, 0, delay & 0xff, delay >> 8, 0, 0]));
    parts.push(Buffer.from([0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x4c, 0x01, 0]));
  }
  parts.push(Buffer.from([0x3b]));
  return Buffer.concat(parts);
}

// Frame delays in centiseconds, read back from the Graphic Control Extensions.
function readGifDelays(gif) {
  const delays = [];
  for (let i = 0; i < gif.length - 5; i++) {
    if (gif[i] === 0x21 && gif[i + 1] === 0xf9 && gif[i + 2] === 4) delays.push(gif.readUInt16LE(i + 4));
  }
  return delays;
}

await test('cache path is per owner kind, account and language, inside the guides folder', () => {
  assert.equal(getAccessAnimationPath({ login: 'Konard', ownerType: 'User', locale: 'ru', dir: '/g' }), '/g/github-access/personal-konard-ru.gif');
  assert.equal(getAccessAnimationPath({ login: 'hive-app[bot]', ownerType: 'Organization', locale: 'de', dir: '/g' }), '/g/github-access/organization-hive-app-bot-en.gif');
  assert.equal(getAccessAnimationPath({ login: '../etc', dir: '/g' }), null, 'no path traversal through the login');
  assert.equal(getAccessAnimationPath({ login: null, dir: '/g' }), null);
  assert.equal(getGuidesDir({ HIVE_MIND_GUIDES_DIR: '/srv/guides' }), '/srv/guides');
  assert.match(getGuidesDir({}), /[/\\]\.hive-mind[/\\]guides$/);
});

await test('captions are translated and number the confirm step by owner kind', async () => {
  const personal = await buildAccessAnimationCaptions({ login: 'konard', ownerType: 'User', locale: 'ru' });
  assert.equal(personal.locale, 'ru');
  assert.match(personal.title, /[а-я]/);
  assert.ok(personal.title.includes('konard') && !personal.title.includes('`'));
  assert.equal(personal.role, null);
  assert.match(personal.confirm, /^5\./);
  const organization = await buildAccessAnimationCaptions({ login: 'konard', ownerType: 'Organization', locale: 'en' });
  assert.match(organization.role, /Write/);
  assert.match(organization.confirm, /^6\./);
  for (const locale of ['en', 'ru', 'zh', 'hi']) {
    const captions = await buildAccessAnimationCaptions({ login: 'x', ownerType: 'Organization', locale });
    for (const value of Object.values(captions)) assert.ok(!String(value).includes('github_access.') && !String(value).includes('{{'), `${locale}: ${value}`);
  }
});

await test('frames show every step, hold each one, and escape the login', async () => {
  const captions = await buildAccessAnimationCaptions({ login: 'konard', ownerType: 'User', locale: 'en' });
  const frames = buildAccessAnimationFrames({ login: 'konard', ownerType: 'User', captions });
  const distinct = frames.filter((html, i) => html !== frames[i - 1]);
  assert.equal(distinct.length, 11);
  assert.equal(frames.length, 26);
  const escaped = text => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  for (const key of ['open', 'add', 'search', 'select', 'confirm', 'pending'])
    assert.ok(
      frames.some(html => html.includes(escaped(captions[key]))),
      key
    );
  assert.ok(frames.at(-1).includes('Pending invite'));
  assert.ok(!frames.some(html => html.includes('Maintain')), 'personal repositories have no role picker');
  const organization = buildAccessAnimationFrames({ login: 'konard', ownerType: 'Organization', captions: await buildAccessAnimationCaptions({ login: 'konard', ownerType: 'Organization', locale: 'en' }) });
  assert.ok(organization.some(html => html.includes('Maintain') && html.includes('Can read, clone, and push')));
  const hostile = buildAccessAnimationFrames({ login: '<b>', ownerType: 'User', captions: { ...captions, title: '<script>' } });
  assert.ok(!hostile.some(html => html.includes('<script>') || html.includes('<b><')), 'HTML is escaped');
});

await test('setGifFrameDelays rewrites each frame delay and keeps the rest of the file', () => {
  const gif = syntheticGif(3);
  const patched = setGifFrameDelays(gif, [200, 1, 150]);
  assert.deepEqual(readGifDelays(patched), [200, 2, 150], 'browsers treat delays under 2cs as 10cs, so 2 is the floor');
  assert.equal(patched.length, gif.length);
  assert.deepEqual(readGifDelays(gif), [50, 50, 50], 'input is not mutated');
  assert.throws(() => setGifFrameDelays(Buffer.concat([gif.subarray(0, 13 + 6), Buffer.from([0x99])]), [1]), /Unexpected GIF block/);
});

await test('renderAccessAnimation shoots each held step once and stretches its delay', async () => {
  const shots = [];
  const fakePage = { content: null, setContent: async html => void (fakePage.content = html) };
  const commander = {
    screenshot: async ({ page }) => {
      shots.push(page.content);
      return Buffer.from(page.content);
    },
    encodeAnimation: async (pngs, { format, fps }) => {
      assert.equal(format, 'gif');
      assert.equal(fps, 2);
      return syntheticGif(pngs.length);
    },
  };
  const gif = await renderAccessAnimation({ frames: ['a', 'a', 'a', 'b', 'c', 'c'], page: fakePage, loaders: { loadBrowserCommander: async () => commander } });
  assert.deepEqual(shots, ['a', 'b', 'c']);
  assert.deepEqual(readGifDelays(gif), [150, 50, 100]);
});

await test('ensureAccessAnimation renders once, reuses the file, and never throws', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hive-guides-'));
  try {
    let calls = 0;
    const generate = async ({ login, locale }) => {
      calls++;
      await new Promise(resolve => setTimeout(resolve, 10));
      return { gif: Buffer.from(`GIF89a ${login} ${locale}`), locale };
    };
    const [first, second] = await Promise.all([ensureAccessAnimation({ login: 'konard', ownerType: 'User', locale: 'ru', dir, generate }), ensureAccessAnimation({ login: 'konard', ownerType: 'User', locale: 'ru', dir, generate })]);
    assert.equal(first, join(dir, 'github-access', 'personal-konard-ru.gif'));
    assert.equal(second, first);
    assert.equal(calls, 1, 'concurrent requests share one render');
    assert.equal(await readFile(first, 'utf8'), 'GIF89a konard ru');
    assert.equal(await ensureAccessAnimation({ login: 'konard', ownerType: 'User', locale: 'ru', dir, generate }), first);
    assert.equal(calls, 1, 'cached file is reused');

    const errors = [];
    const broken = async () => {
      throw new Error('no chromium');
    };
    assert.equal(await ensureAccessAnimation({ login: 'konard', ownerType: 'Organization', locale: 'en', dir, generate: broken, onError: error => errors.push(error.message) }), null);
    assert.deepEqual(errors, ['no chromium']);
    assert.equal(await ensureAccessAnimation({ login: 'not a login', dir, generate }), null);

    // An empty file (e.g. a crash mid-write elsewhere) is regenerated.
    const empty = join(dir, 'github-access', 'personal-other-en.gif');
    await mkdir(join(dir, 'github-access'), { recursive: true });
    await writeFile(empty, '');
    assert.equal(await ensureAccessAnimation({ login: 'other', locale: 'en', dir, generate }), empty);
    assert.equal(calls, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

await test('committed konard examples are GIFs with one frame per step', async () => {
  const expected = { 'personal-konard-en.gif': 11, 'personal-konard-ru.gif': 11, 'personal-konard-zh.gif': 11, 'personal-konard-hi.gif': 11, 'organization-konard-en.gif': 12 };
  for (const [name, count] of Object.entries(expected)) {
    const gif = await readFile(new URL(`../docs/assets/github-access/${name}`, import.meta.url));
    assert.equal(gif.subarray(0, 6).toString(), 'GIF89a', name);
    assert.equal(gif.readUInt16LE(6), 720, `${name} width`);
    assert.equal(gif.readUInt16LE(8), 420, `${name} height`);
    const delays = readGifDelays(gif);
    assert.equal(delays.length, count, `${name} frames`);
    assert.equal(delays.at(-1), 300, `${name} holds the final step for 3s`);
  }
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
