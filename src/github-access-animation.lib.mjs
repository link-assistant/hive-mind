#!/usr/bin/env node
/**
 * Animated "give Hive Mind write access" guide (GIF).
 *
 * The text guide (github-access-guide.lib.mjs) says where to click; this module
 * shows it. The animation is one animated scene (github-access-scene.lib.mjs:
 * a replica of GitHub's Settings → Collaborators page with a moving cursor and
 * captions, driven by CSS keyframes). Here it is sampled in headless Chromium,
 * each sample screenshotted and encoded to a GIF with browser-commander
 * (https://github.com/link-foundation/browser-commander). The same scene is
 * also written as an animated SVG (buildAccessAnimationSvg).
 *
 * The login is part of the picture, so the GIF is made once per account,
 * owner kind (personal/organization) and caption language, then reused from
 * the host's Hive Mind folder: ~/.hive-mind/guides/github-access/ (override
 * with HIVE_MIND_GUIDES_DIR). Rendering needs Playwright's Chromium; when it is
 * missing every entry point returns null and callers keep the text guide.
 *
 * Command line (writes the GIF and prints its path):
 *   node src/github-access-animation.lib.mjs --login konard --locale ru [--owner-type Organization] [--output file.gif|file.svg]
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2998
 */

import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { t, loadTranslations, normalizeLocale } from './i18n.lib.mjs';
import { isOrganizationOwner } from './github-access-guide.lib.mjs';
import { encodeDiffGif } from './gif-frames.lib.mjs';
import { buildAccessAnimationHtml, buildAccessAnimationSvg, buildAccessScene, SCENE_SIZE } from './github-access-scene.lib.mjs';

export { buildAccessAnimationSvg };
export const ACCESS_ANIMATION_SIZE = SCENE_SIZE;
/** Samples per second of the scene; identical neighbours become one GIF frame. */
export const ACCESS_ANIMATION_FPS = 10;
export const BROWSER_COMMANDER_SPECIFIER = 'browser-commander@0.28.0';

const LOGIN_PATTERN = /^[A-Za-z0-9-]+(\[bot\])?$/;

/** Host folder for generated guides (`~/.hive-mind/guides` unless HIVE_MIND_GUIDES_DIR is set). */
export const getGuidesDir = (env = process.env) => env.HIVE_MIND_GUIDES_DIR || join(homedir(), '.hive-mind', 'guides');

/**
 * Where the GIF for one account/owner kind/language is cached.
 *
 * @returns {string|null} null for logins that are not GitHub logins
 */
export function getAccessAnimationPath({ login, ownerType, locale, dir = getGuidesDir() }) {
  if (!LOGIN_PATTERN.test(String(login || ''))) return null;
  const kind = isOrganizationOwner(ownerType) ? 'organization' : 'personal';
  const lang = normalizeLocale(locale) || 'en';
  return join(dir, 'github-access', `${kind}-${login.replace(/\[bot\]$/, '-bot').toLowerCase()}-${lang}.gif`);
}

/** Captions for every step, in `locale` (loads the translations). */
export async function buildAccessAnimationCaptions({ login, ownerType, locale }) {
  const lang = normalizeLocale(locale) || 'en';
  await loadTranslations('en');
  if (lang !== 'en') await loadTranslations(lang);
  const tr = (key, params = {}) => t(`github_access.${key}`, { login, ...params }, { locale: lang }).replace(/`/g, '');
  const organization = isOrganizationOwner(ownerType);
  return {
    locale: lang,
    title: tr('anim_title'),
    open: tr('anim_step_open'),
    add: tr('anim_step_add'),
    search: tr('anim_step_search'),
    select: tr('anim_step_select'),
    role: organization ? tr('anim_step_role') : null,
    confirm: tr('anim_step_confirm', { step: organization ? 6 : 5 }),
    pending: tr('anim_step_pending'),
  };
}

let globalNpmRoot;
async function requireFromGlobalNpm(name) {
  if (globalNpmRoot === undefined) {
    const { execFile } = await import('node:child_process');
    globalNpmRoot = await new Promise(resolve => execFile('npm', ['root', '-g'], { timeout: 15000 }, (error, stdout) => resolve(error ? null : stdout.trim())));
  }
  if (!globalNpmRoot) throw new Error('npm root -g unavailable');
  return createRequire(join(globalNpmRoot, 'noop.js'))(name);
}

/**
 * Playwright's chromium: a local install, then the global one Hive Mind images
 * ship (its browsers are already in ~/.cache/ms-playwright).
 */
export async function loadChromium() {
  const candidates = [() => import('playwright'), () => requireFromGlobalNpm('playwright'), () => requireFromGlobalNpm('@playwright/test'), () => requireFromGlobalNpm('@playwright/mcp/node_modules/playwright')];
  const errors = [];
  for (const load of candidates) {
    try {
      const mod = await load();
      const chromium = mod?.chromium || mod?.default?.chromium;
      if (chromium) return chromium;
    } catch (error) {
      errors.push(error.message);
    }
  }
  throw new Error(`Playwright is not installed (${errors.join('; ')})`);
}

/** browser-commander's capture API: a local install, else through use-m. */
export async function loadBrowserCommander() {
  try {
    return await import('browser-commander');
  } catch {
    const { ensureUseM } = await import('./use-m-bootstrap.lib.mjs');
    if (typeof globalThis.use === 'undefined') await ensureUseM();
    const { useWithRetry } = await import('./use-with-retry.lib.mjs');
    return await useWithRetry(globalThis.use, BROWSER_COMMANDER_SPECIFIER);
  }
}

// True when every character of `text` has a glyph in the page's fonts (a
// missing glyph draws the same box as an unassigned code point). Runs in the
// page, hence the browser globals.
export const GLYPH_PROBE = text => {
  const { document, getComputedStyle } = globalThis;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const context = canvas.getContext('2d');
  const draw = ch => {
    context.clearRect(0, 0, 32, 32);
    context.font = getComputedStyle(document.getElementById('hm-root') || document.body).font;
    context.fillText(ch, 4, 24);
    return context.getImageData(0, 0, 32, 32).data.join(',');
  };
  const tofu = draw('\u{10FFFD}');
  return [...new Set([...text].filter(ch => ch.codePointAt(0) > 0x7f && !/\s/.test(ch)))].every(ch => draw(ch) !== tofu);
};

/** Times (seconds) at which the scene is sampled: `fps` per second over one loop. */
export function getAccessAnimationSampleTimes(duration, fps = ACCESS_ANIMATION_FPS) {
  const times = [];
  for (let i = 0; i * (1 / fps) < duration - 1e-9; i++) times.push(Number((i / fps).toFixed(3)));
  return times;
}

// Freeze every CSS animation of the page at `ms` (runs in the page).
const SEEK_ANIMATIONS = ms => {
  for (const animation of globalThis.document.getAnimations()) {
    animation.pause();
    animation.currentTime = ms;
  }
};

/**
 * Render the animated scene to a GIF: freeze its keyframes at each sample
 * time, screenshot, and keep only what changed from one sample to the next.
 *
 * @param {Object} options
 * @param {string} options.html - the scene page (buildAccessAnimationHtml)
 * @param {number} options.duration - one loop, seconds
 * @param {number} [options.fps] - samples per second
 * @param {Object} [options.page] - an open Playwright page to reuse
 * @returns {Promise<Buffer>}
 */
export async function renderAccessAnimation({ html, duration, fps = ACCESS_ANIMATION_FPS, page, loaders = {} }) {
  const commander = await (loaders.loadBrowserCommander || loadBrowserCommander)();
  let browser = null;
  try {
    if (!page) {
      const chromium = await (loaders.loadChromium || loadChromium)();
      browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
      page = await browser.newPage({ viewport: ACCESS_ANIMATION_SIZE });
    }
    await page.setContent(html);
    const shots = [];
    for (const time of getAccessAnimationSampleTimes(duration, fps)) {
      await page.evaluate(SEEK_ANIMATIONS, time * 1000);
      shots.push({ png: await commander.screenshot({ page, engine: 'playwright', format: 'png' }), delay: 100 / fps });
    }
    return await encodeDiffGif({ shots, encodeAnimation: commander.encodeAnimation });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

/**
 * Render the guide for one account, falling back to English captions when the
 * host has no font for the requested language.
 *
 * @returns {Promise<{gif: Buffer, locale: string}>}
 */
export async function generateAccessAnimation({ login, ownerType, locale, loaders = {} }) {
  const chromium = await (loaders.loadChromium || loadChromium)();
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: ACCESS_ANIMATION_SIZE });
    let captions = await buildAccessAnimationCaptions({ login, ownerType, locale });
    await page.setContent(buildAccessAnimationHtml({ login, ownerType, captions }));
    if (captions.locale !== 'en' && !(await page.evaluate(GLYPH_PROBE, Object.values(captions).join('')))) {
      captions = await buildAccessAnimationCaptions({ login, ownerType, locale: 'en' });
    }
    const { duration } = buildAccessScene({ login, ownerType, captions });
    const gif = await renderAccessAnimation({ html: buildAccessAnimationHtml({ login, ownerType, captions }), duration, page, loaders });
    return { gif, locale: captions.locale };
  } finally {
    await browser.close().catch(() => {});
  }
}

const inFlight = new Map();
// Failed renders (no Chromium, no fonts, ...) are not retried for a while, so a
// host without a browser does not launch one for every failing command.
const failedAt = new Map();
export const ACCESS_ANIMATION_RETRY_MS = 60 * 60 * 1000;

/**
 * Path of the cached GIF for this account, generating it on first use.
 * Never throws: returns null when the login is unknown or rendering fails.
 *
 * @param {Object} options
 * @param {string|null} options.login - account Hive Mind runs as
 * @param {string|null} [options.ownerType] - 'User' or 'Organization'
 * @param {string} [options.locale] - caption language
 * @param {string} [options.dir] - guides folder (getGuidesDir())
 * @param {Function} [options.generate] - replaces generateAccessAnimation (tests)
 * @param {Function} [options.onError] - receives rendering errors (logging)
 * @param {number} [options.now] - current time in ms (tests)
 * @returns {Promise<string|null>}
 */
export async function ensureAccessAnimation({ login, ownerType, locale, dir = getGuidesDir(), generate = generateAccessAnimation, onError, now = Date.now() } = {}) {
  const path = getAccessAnimationPath({ login, ownerType, locale, dir });
  if (!path) return null;
  try {
    if ((await stat(path)).size > 0) return path;
  } catch {
    // not generated yet
  }
  if (now - (failedAt.get(path) ?? -Infinity) < ACCESS_ANIMATION_RETRY_MS) return null;
  if (!inFlight.has(path)) {
    const job = (async () => {
      try {
        const { gif } = await generate({ login, ownerType, locale });
        await mkdir(dirname(path), { recursive: true });
        const temporary = `${path}.${process.pid}.tmp`;
        await writeFile(temporary, gif);
        await rename(temporary, path);
        failedAt.delete(path);
        return path;
      } catch (error) {
        failedAt.set(path, now);
        onError?.(error);
        return null;
      } finally {
        inFlight.delete(path);
      }
    })();
    inFlight.set(path, job);
  }
  return inFlight.get(path);
}

/**
 * Telegram: send the access animation as a reply. The first request for an
 * account renders it (a few seconds), so callers need not await this.
 * Never throws; resolves to whether an animation was sent.
 *
 * @param {Object} options
 * @param {Object} options.ctx - Telegraf context
 * @param {string|null} options.login - account Hive Mind runs as
 * @param {string|null} [options.ownerType]
 * @param {string} [options.locale]
 * @param {number} [options.replyToMessageId]
 * @param {boolean} [options.verbose=false]
 * @param {Function} [options.ensure] - replaces ensureAccessAnimation (tests)
 * @returns {Promise<boolean>}
 */
export async function replyWithAccessAnimation({ ctx, login, ownerType, locale, replyToMessageId, verbose = false, ensure = ensureAccessAnimation }) {
  const log = message => verbose && console.log(`[VERBOSE] GitHub access animation: ${message}`);
  try {
    const path = await ensure({ login, ownerType, locale, onError: error => log(`not rendered: ${error?.message || error}`) });
    if (!path) return false;
    const { title } = await buildAccessAnimationCaptions({ login, ownerType, locale });
    const { safeReplyWithAnimation } = await import('./telegram-safe-reply.lib.mjs');
    await safeReplyWithAnimation(ctx, { source: path }, { caption: `🎞 ${title}`, reply_to_message_id: replyToMessageId, verbose });
    return true;
  } catch (error) {
    log(`not sent: ${error?.message || error}`);
    return false;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const option = name => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const login = option('login');
  if (!login) {
    console.error('Usage: node src/github-access-animation.lib.mjs --login <github-login> [--locale en|ru|zh|hi] [--owner-type User|Organization] [--output file.gif|file.svg]');
    process.exit(2);
  }
  const ownerType = option('owner-type') || 'User';
  const locale = option('locale') || 'en';
  const output = option('output');
  if (output?.endsWith('.svg')) {
    const svg = buildAccessAnimationSvg({ login, ownerType, captions: await buildAccessAnimationCaptions({ login, ownerType, locale }) });
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, svg);
    console.log(`${output} (${Buffer.byteLength(svg)} bytes)`);
  } else if (output) {
    const { gif, locale: rendered } = await generateAccessAnimation({ login, ownerType, locale });
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, gif);
    console.log(`${output} (${gif.length} bytes, ${rendered} captions)`);
  } else {
    const path = await ensureAccessAnimation({ login, ownerType, locale, onError: error => console.error(error) });
    if (!path) process.exit(1);
    console.log(path);
  }
}
