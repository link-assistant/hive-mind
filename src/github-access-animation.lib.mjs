#!/usr/bin/env node
/**
 * Animated "give Hive Mind write access" guide (GIF).
 *
 * The text guide (github-access-guide.lib.mjs) says where to click; this module
 * shows it. Each frame is a small HTML mock of GitHub's Settings → Collaborators
 * page with the Hive Mind account's login filled in, rendered in headless
 * Chromium and encoded with browser-commander
 * (https://github.com/link-foundation/browser-commander).
 *
 * The login is part of the picture, so the GIF is made once per account,
 * owner kind (personal/organization) and caption language, then reused from
 * the host's Hive Mind folder: ~/.hive-mind/guides/github-access/ (override
 * with HIVE_MIND_GUIDES_DIR). Rendering needs Playwright's Chromium; when it is
 * missing every entry point returns null and callers keep the text guide.
 *
 * Command line (writes the GIF and prints its path):
 *   node src/github-access-animation.lib.mjs --login konard --locale ru [--owner-type Organization] [--output file.gif]
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

export const ACCESS_ANIMATION_SIZE = Object.freeze({ width: 720, height: 420 });
export const ACCESS_ANIMATION_FPS = 2;
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

const escapeHtml = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

const STYLE = `
*{box-sizing:border-box}body{margin:0;width:720px;height:420px;font:14px -apple-system,"Segoe UI","Noto Sans","WenQuanYi Zen Hei","Noto Sans Devanagari",Helvetica,Arial,sans-serif;color:#1f2328;background:#fff;overflow:hidden}
.title{height:34px;background:#0d1117;color:#f0f6fc;font-weight:600;display:flex;align-items:center;padding:0 14px}
.repo{height:42px;border-bottom:1px solid #d1d9e0;display:flex;align-items:center;padding:0 14px;gap:16px;background:#f6f8fa}
.repo b{font-weight:600}.tab{color:#59636e}.tab.on{color:#1f2328;border-bottom:2px solid #fd8c73;padding:11px 0}
.wrap{display:flex;height:264px}.side{width:190px;padding:10px 8px;border-right:1px solid #d1d9e0}
.side div{padding:6px 8px;border-radius:6px;color:#59636e;position:relative}.side .on{background:#eff2f5;color:#1f2328;font-weight:600}
.main{flex:1;padding:14px 18px;position:relative}.h{font-size:18px;margin-bottom:10px}
.box{border:1px solid #d1d9e0;border-radius:6px}.row{display:flex;align-items:center;gap:10px;padding:10px 12px;border-top:1px solid #d1d9e0}
.row:first-child{border-top:0}.btn{display:inline-block;padding:5px 12px;border-radius:6px;background:#1f883d;color:#fff;font-weight:600;position:relative;border:1px solid #1a7f37}
.btn.wide{display:block;text-align:center;margin-top:12px}.av{width:26px;height:26px;border-radius:50%;background:#8250df;color:#fff;font-weight:700;display:flex;align-items:center;justify-content:center}
.muted{color:#59636e;font-size:12px}.badge{margin-left:auto;font-size:12px;color:#9a6700;border:1px solid #d4a72c;border-radius:12px;padding:1px 8px}
.dim{position:fixed;top:34px;left:0;right:0;bottom:80px;background:rgba(31,35,40,.45)}.modal{position:fixed;left:236px;top:58px;width:450px;background:#fff;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.3);padding:14px 16px}
.input{border:2px solid #0969da;border-radius:6px;padding:6px 10px;margin-top:10px;min-height:34px;position:relative}.caret{display:inline-block;width:1px;height:16px;background:#1f2328;vertical-align:middle}
.result{display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid #d1d9e0;border-radius:6px;margin-top:8px;position:relative}.result.on{background:#ddf4ff;border-color:#54aeff}
.role{display:flex;gap:8px;align-items:flex-start;padding:5px 8px;border-radius:6px;position:relative}.role.on{background:#ddf4ff}.dot{width:14px;height:14px;border-radius:50%;border:2px solid #59636e;margin-top:2px;flex:none}.role.on .dot{border:4px solid #0969da}
.ring{outline:3px solid #fb8500;outline-offset:2px}.cursor{position:absolute;right:-10px;bottom:-16px;width:22px;height:22px;z-index:5}
.caption{position:absolute;left:0;right:0;bottom:0;height:80px;background:#fff8c5;border-top:1px solid #d4a72c;display:flex;align-items:center;padding:0 18px;font-size:19px;font-weight:600}`;

const CURSOR = '<svg class="cursor" viewBox="0 0 24 24"><path d="M3 2l7 19 2.6-7.4L20 11z" fill="#1f2328" stroke="#fff" stroke-width="1.5"/></svg>';

/** Frames of the animation as HTML documents, in display order (pure; see renderAccessAnimation). */
export function buildAccessAnimationFrames({ login, ownerType, captions }) {
  const organization = isOrganizationOwner(ownerType);
  const user = escapeHtml(login);
  const avatar = `<span class="av">${escapeHtml(String(login).charAt(0).toUpperCase())}</span>`;
  const sideLabel = organization ? 'Collaborators and teams' : 'Collaborators';
  const ring = on => (on ? ' ring' : '');
  const page = ({ caption, sideCursor = false, addCursor = false, pending = false, modal = '' }) => `<!doctype html><html><head><meta charset="utf-8"><style>${STYLE}</style></head><body>
<div class="title">${escapeHtml(captions.title)}</div>
<div class="repo"><b>your-account / your-repository</b><span class="tab">Code</span><span class="tab">Issues</span><span class="tab">Pull requests</span><span class="tab on">Settings</span></div>
<div class="wrap"><div class="side"><div>General</div><div class="on${ring(sideCursor)}">${sideLabel}${sideCursor ? CURSOR : ''}</div><div>Branches</div><div>Rules</div><div>Actions</div></div>
<div class="main"><div class="h">Manage access</div><div class="box"><div class="row"><span class="muted">${organization ? 'Direct access · 3 members' : 'You have 1 collaborator'}</span><span style="margin-left:auto"><span class="btn${ring(addCursor)}">Add people${addCursor ? CURSOR : ''}</span></span></div>
<div class="row"><span class="av" style="background:#1f883d">Y</span><span>your-account</span><span class="muted" style="margin-left:auto">${organization ? 'Admin' : 'Owner'}</span></div>
${pending ? `<div class="row">${avatar}<b>${user}</b><span class="badge">Pending invite</span></div>` : ''}</div>${modal}</div></div>
<div class="caption">${escapeHtml(caption)}</div></body></html>`;
  const modal = ({ query, result = false, selected = false, role = false, confirm = false }) => {
    const roles = ['Read', 'Triage', 'Write', 'Maintain', 'Admin'].map(name => `<div class="role${name === 'Write' ? ' on' : ''}${ring(role && name === 'Write')}"><span class="dot"></span><span><b>${name}</b>${name === 'Write' ? '<br><span class="muted">Can read, clone, and push to this repository</span>' : ''}</span>${role && name === 'Write' ? CURSOR : ''}</div>`);
    const picked = selected ? `<div class="result on${ring(selected === 'cursor')}">${avatar}<b>${user}</b>${selected === 'cursor' ? CURSOR : ''}</div>` : '';
    const results = !selected && result ? `<div class="result">${avatar}<b>${user}</b><span class="muted">Invite collaborator</span></div>` : '';
    return `<div class="dim"></div><div class="modal"><b>Add people to your-repository</b>
<div class="input">${selected ? '' : escapeHtml(query)}<span class="caret"></span></div>${results}${picked}
${organization && role ? `<div style="margin-top:6px">${roles.filter((_, i) => i >= 1 && i <= 3).join('')}</div>` : ''}
${organization && confirm ? '<div class="muted" style="margin-top:10px">Role: <b>Write</b></div>' : ''}
${selected && !role ? `<span class="btn wide${ring(confirm)}">Add ${user} to this repository${confirm ? CURSOR : ''}</span>` : ''}</div>`;
  };
  const frames = [];
  const hold = (html, count) => {
    for (let i = 0; i < count; i++) frames.push(html);
  };
  hold(page({ caption: captions.open, sideCursor: true }), 4);
  hold(page({ caption: captions.add, addCursor: true }), 3);
  const typed = String(login);
  const steps = Math.min(typed.length, 5);
  for (let i = 1; i <= steps; i++) hold(page({ caption: captions.search, modal: modal({ query: typed.slice(0, Math.ceil((typed.length * i) / steps)) }) }), 1);
  hold(page({ caption: captions.search, modal: modal({ query: typed, result: true }) }), 2);
  hold(page({ caption: captions.select, modal: modal({ query: typed, selected: 'cursor' }) }), 3);
  if (organization) hold(page({ caption: captions.role, modal: modal({ query: typed, selected: true, role: true }) }), 4);
  hold(page({ caption: captions.confirm, modal: modal({ query: typed, selected: true, confirm: true }) }), 3);
  hold(page({ caption: captions.pending, pending: true }), 6);
  return frames;
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
    context.font = getComputedStyle(document.body).font;
    context.fillText(ch, 4, 24);
    return context.getImageData(0, 0, 32, 32).data.join(',');
  };
  const tofu = draw('\u{10FFFD}');
  return [...new Set([...text].filter(ch => ch.codePointAt(0) > 0x7f && !/\s/.test(ch)))].every(ch => draw(ch) !== tofu);
};

/**
 * Set each frame's display time in a GIF (centiseconds, in frame order) by
 * rewriting its Graphic Control Extensions. encodeAnimation() takes one fps for
 * all frames, so a held step is encoded once and stretched here instead of
 * being repeated (11 frames instead of 26, less than half the size).
 *
 * @param {Uint8Array} gif
 * @param {number[]} delays
 * @returns {Buffer}
 */
export function setGifFrameDelays(gif, delays) {
  const bytes = Buffer.from(gif);
  const skipSubBlocks = offset => {
    while (bytes[offset] !== 0) offset += bytes[offset] + 1;
    return offset + 1;
  };
  const tableSize = packed => (packed & 0x80 ? 3 * 2 ** ((packed & 0x07) + 1) : 0);
  let offset = 13 + tableSize(bytes[10]);
  let frame = 0;
  while (offset < bytes.length && bytes[offset] !== 0x3b) {
    if (bytes[offset] === 0x21) {
      if (bytes[offset + 1] === 0xf9 && frame < delays.length) bytes.writeUInt16LE(Math.max(2, Math.round(delays[frame++])), offset + 4);
      offset = skipSubBlocks(offset + 2);
    } else if (bytes[offset] === 0x2c) {
      offset = skipSubBlocks(offset + 10 + tableSize(bytes[offset + 9]) + 1);
    } else {
      throw new Error(`Unexpected GIF block 0x${bytes[offset].toString(16)} at ${offset}`);
    }
  }
  return bytes;
}

/**
 * Render frames to a GIF.
 *
 * @param {Object} options
 * @param {string[]} options.frames - HTML documents (buildAccessAnimationFrames); repeats hold a step
 * @param {number} [options.fps] - rate of `frames`
 * @param {Object} [options.page] - an open Playwright page to reuse
 * @returns {Promise<Buffer>}
 */
export async function renderAccessAnimation({ frames, fps = ACCESS_ANIMATION_FPS, page, loaders = {} }) {
  const commander = await (loaders.loadBrowserCommander || loadBrowserCommander)();
  let browser = null;
  try {
    if (!page) {
      const chromium = await (loaders.loadChromium || loadChromium)();
      browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
      page = await browser.newPage({ viewport: ACCESS_ANIMATION_SIZE });
    }
    const runs = [];
    for (const html of frames) {
      if (runs.at(-1)?.html === html) runs.at(-1).count++;
      else runs.push({ html, count: 1 });
    }
    const shots = [];
    for (const run of runs) {
      await page.setContent(run.html);
      shots.push(await commander.screenshot({ page, engine: 'playwright', format: 'png' }));
    }
    const gif = await commander.encodeAnimation(shots, { format: 'gif', fps });
    return setGifFrameDelays(
      gif,
      runs.map(run => (run.count * 100) / fps)
    );
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
    await page.setContent(buildAccessAnimationFrames({ login, ownerType, captions })[0]);
    if (captions.locale !== 'en' && !(await page.evaluate(GLYPH_PROBE, Object.values(captions).join('')))) {
      captions = await buildAccessAnimationCaptions({ login, ownerType, locale: 'en' });
    }
    const gif = await renderAccessAnimation({ frames: buildAccessAnimationFrames({ login, ownerType, captions }), page, loaders });
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
    console.error('Usage: node src/github-access-animation.lib.mjs --login <github-login> [--locale en|ru|zh|hi] [--owner-type User|Organization] [--output file.gif]');
    process.exit(2);
  }
  const ownerType = option('owner-type') || 'User';
  const locale = option('locale') || 'en';
  const output = option('output');
  if (output) {
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
