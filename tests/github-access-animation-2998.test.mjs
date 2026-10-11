#!/usr/bin/env node
/**
 * Issue #2998: the "give Hive Mind write access" animation. Hosts render it
 * once per account, owner kind and language into the guides folder and reuse
 * it; the example for `konard` is committed under docs/assets/github-access/.
 *
 * Everything here runs without a browser: rendering is exercised with a fake
 * page and fake loaders (the scene itself is covered by
 * tests/github-access-scene-2998.test.mjs).
 *
 * Run with: node tests/github-access-animation-2998.test.mjs
 */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ACCESS_ANIMATION_RETRY_MS, buildAccessAnimationCaptions, buildAccessAnimationSvg, ensureAccessAnimation, getAccessAnimationPath, getAccessAnimationSampleTimes, getGuidesDir, renderAccessAnimation, replyWithAccessAnimation } from '../src/github-access-animation.lib.mjs';
import { encodePng } from '../src/gif-frames.lib.mjs';

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

// Frame delays in centiseconds, read back from the Graphic Control Extensions. Walks the
// blocks instead of searching bytes: "21 F9 04" also occurs inside LZW image data.
function readGifDelays(gif) {
  const tableSize = packed => (packed & 0x80 ? 3 * 2 ** ((packed & 0x07) + 1) : 0);
  const skipSubBlocks = offset => {
    while (gif[offset] !== 0) offset += gif[offset] + 1;
    return offset + 1;
  };
  const delays = [];
  let offset = 13 + tableSize(gif[10]);
  while (offset < gif.length && gif[offset] !== 0x3b) {
    if (gif[offset] === 0x21) {
      if (gif[offset + 1] === 0xf9) delays.push(gif.readUInt16LE(offset + 4));
      offset = skipSubBlocks(offset + 2);
    } else if (gif[offset] === 0x2c) {
      offset = skipSubBlocks(offset + 10 + tableSize(gif[offset + 9]) + 1);
    } else {
      throw new Error(`unexpected GIF block 0x${gif[offset].toString(16)} at ${offset}`);
    }
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

await test('the animation is sampled at a steady frame rate over one loop', () => {
  assert.deepEqual(getAccessAnimationSampleTimes(0.5, 10), [0, 0.1, 0.2, 0.3, 0.4]);
  assert.equal(getAccessAnimationSampleTimes(16.04, 10).length, 161);
});

await test('renderAccessAnimation seeks the CSS timeline, screenshots each moment and keeps only changes', async () => {
  // A 4x2 "page" whose top-left pixel turns white at 200 ms.
  const pixel = ms => {
    const data = Buffer.alloc(4 * 2 * 4);
    for (let i = 0; i < 8; i++) data.writeUInt32BE(i === 0 && ms >= 200 ? 0xffffffff : 0x0d1117ff, i * 4);
    return encodePng({ width: 4, height: 2, data });
  };
  const fakePage = {
    content: null,
    ms: null,
    setContent: async html => void (fakePage.content = html),
    evaluate: async (fn, ms) => {
      assert.equal(typeof fn, 'function');
      fakePage.ms = ms;
    },
  };
  const seen = [];
  const commander = {
    screenshot: async ({ page, format }) => {
      assert.equal(format, 'png');
      seen.push(page.ms);
      return pixel(page.ms);
    },
    encodeAnimation: async (_pngs, { format, palette }) => {
      assert.equal(format, 'gif');
      // One-frame GIF89a with a 4-colour table and a 1x1 image; transparent when asked.
      const transparent = Array.isArray(palette);
      return Buffer.concat([Buffer.from('GIF89a'), Buffer.from([1, 0, 1, 0, 0x81, 0, 0]), Buffer.alloc(12), Buffer.from([0x21, 0xf9, 4, transparent ? 1 : 0, 10, 0, 3, 0]), Buffer.from([0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x4c, 0x01, 0, 0x3b])]);
    },
  };
  const gif = await renderAccessAnimation({ html: '<p>scene</p>', duration: 0.5, fps: 10, page: fakePage, loaders: { loadBrowserCommander: async () => commander } });
  assert.equal(fakePage.content, '<p>scene</p>');
  assert.deepEqual(seen, [0, 100, 200, 300, 400]);
  assert.deepEqual([gif.readUInt16LE(6), gif.readUInt16LE(8)], [4, 2]);
  assert.deepEqual(readGifDelays(gif), [20, 30], 'two still moments, then the change held to the end');
});

await test('the SVG version is the same scene, for docs and READMEs', async () => {
  const captions = await buildAccessAnimationCaptions({ login: 'konard', ownerType: 'Organization', locale: 'ru' });
  const svg = buildAccessAnimationSvg({ login: 'konard', ownerType: 'Organization', captions });
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640"'));
  assert.ok(svg.includes(captions.role.replace(/"/g, '&quot;')));
  assert.ok(svg.includes('@keyframes hm-cursor'));
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

await test('a failed render is not retried for an hour', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hive-guides-'));
  try {
    let calls = 0;
    const generate = async () => {
      calls++;
      if (calls === 1) throw new Error('no chromium');
      return { gif: Buffer.from('GIF89a'), locale: 'en' };
    };
    const options = { login: 'retry-check', ownerType: 'User', locale: 'en', dir, generate };
    assert.equal(await ensureAccessAnimation({ ...options, now: 1000 }), null);
    assert.equal(await ensureAccessAnimation({ ...options, now: 1000 + ACCESS_ANIMATION_RETRY_MS - 1 }), null);
    assert.equal(calls, 1);
    assert.ok(await ensureAccessAnimation({ ...options, now: 1000 + ACCESS_ANIMATION_RETRY_MS }));
    assert.equal(calls, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

await test('Telegram reply sends the cached GIF with a translated caption, and stays quiet on failure', async () => {
  const sent = [];
  const ctx = { chat: { id: 1 }, replyWithAnimation: async (animation, options) => sent.push({ animation, options }) };
  const ok = await replyWithAccessAnimation({ ctx, login: 'konard', ownerType: 'User', locale: 'ru', replyToMessageId: 42, ensure: async () => '/g/personal-konard-ru.gif' });
  assert.equal(ok, true);
  assert.deepEqual(sent[0].animation, { source: '/g/personal-konard-ru.gif' });
  assert.equal(sent[0].options.reply_to_message_id, 42);
  assert.match(sent[0].options.caption, /^🎞 .*konard/);
  assert.match(sent[0].options.caption, /[а-я]/);

  assert.equal(await replyWithAccessAnimation({ ctx, login: 'konard', ensure: async () => null }), false);
  const failing = {
    chat: { id: 1 },
    replyWithAnimation: async () => {
      throw new Error('network');
    },
  };
  assert.equal(await replyWithAccessAnimation({ ctx: failing, login: 'konard', ensure: async () => '/g/x.gif' }), false);
  assert.equal(sent.length, 1);
});

await test('telegram-bot sends the animation after the not-accessible reply, without awaiting it', async () => {
  const source = await readFile(new URL('../src/telegram-bot.mjs', import.meta.url), 'utf8');
  assert.match(source, /if \(entityCheck\.botLogin\) void \(await import\('\.\/github-access-animation\.lib\.mjs'\)\)\.replyWithAccessAnimation\(\{ ctx, login: entityCheck\.botLogin, ownerType: entityCheck\.ownerType, locale: solveLocale/);
});

await test('committed konard examples: a GIF and an animated SVG of the 960x640 scene', async () => {
  const names = ['personal-konard-en', 'personal-konard-ru', 'personal-konard-zh', 'personal-konard-hi', 'organization-konard-en'];
  for (const name of names) {
    const gif = await readFile(new URL(`../docs/assets/github-access/${name}.gif`, import.meta.url));
    assert.equal(gif.subarray(0, 6).toString(), 'GIF89a', name);
    assert.equal(gif.readUInt16LE(6), 960, `${name} width`);
    assert.equal(gif.readUInt16LE(8), 640, `${name} height`);
    const delays = readGifDelays(gif);
    assert.ok(delays.length > 30, `${name} is animated (${delays.length} frames)`);
    const seconds = delays.reduce((sum, delay) => sum + delay, 0) / 100;
    assert.ok(seconds > 14 && seconds < 20, `${name} loop length ${seconds}s`);
    assert.ok(gif.length < 600_000, `${name} stays small (${gif.length} bytes)`);
    const svg = await readFile(new URL(`../docs/assets/github-access/${name}.svg`, import.meta.url), 'utf8');
    assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640"'), `${name}.svg`);
    assert.ok(svg.includes('@keyframes hm-cursor') && svg.includes('konard'), `${name}.svg is animated`);
  }
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
