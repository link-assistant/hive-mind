#!/usr/bin/env node
/**
 * Record the "give Hive Mind write access" guide on the real github.com page
 * (see record-github-access-guide.lib.mjs). Needs a browser session that is
 * signed in as an admin of the repository: a Chromium profile directory
 * (--user-data-dir) or a Playwright storage state file (--storage-state). With
 * --headed you can sign in, or confirm your password, in the window; recording
 * starts once "Add people" is on screen.
 *
 *   node scripts/record-github-access-guide.mjs --repo OWNER/REPO --login BOT --user-data-dir ~/.config/hm-recorder --headed
 *   node scripts/record-github-access-guide.mjs --mock --login konard --owner-type Organization --output /tmp/mock.gif
 *
 * Nothing is sent to GitHub unless --send-invite is given.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { buildAccessAnimationCaptions, loadBrowserCommander, loadChromium } from '../src/github-access-animation.lib.mjs';
import { encodeDiffGif } from '../src/gif-frames.lib.mjs';
import { buildRecorderMockPage, findTarget, getRecorderSteps, recordAccessGuide } from './record-github-access-guide.lib.mjs';

const USAGE = `Usage: node scripts/record-github-access-guide.mjs --login <account-to-invite> (--repo OWNER/REPO | --mock)
  [--owner-type User|Organization] [--locale en|ru|zh|hi] [--output guide.gif]
  [--user-data-dir DIR | --storage-state state.json] [--headed] [--width 1280] [--height 800]
  [--wait-seconds 300] [--send-invite]`;

const args = process.argv.slice(2);
const option = name => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
const flag = name => args.includes(`--${name}`);
const login = option('login');
const repo = option('repo');
const mock = flag('mock');
if (!login || !/^[A-Za-z0-9-]+(\[bot\])?$/.test(login) || (!mock && !/^[\w.-]+\/[\w.-]+$/.test(repo || ''))) {
  console.error(USAGE);
  process.exit(2);
}
const ownerType = option('owner-type') || 'User';
const locale = option('locale') || 'en';
const output = option('output') || `github-access-${ownerType === 'Organization' ? 'organization' : 'personal'}-${login}-${locale}.gif`;
const viewport = { width: Number(option('width') || 1280), height: Number(option('height') || 800) };
const headed = flag('headed');
const contextOptions = { viewport, colorScheme: 'dark', bypassCSP: true, locale: 'en-US' };

const chromium = await loadChromium();
const commander = await loadBrowserCommander();
let browser = null;
let context;
if (option('user-data-dir')) {
  context = await chromium.launchPersistentContext(option('user-data-dir'), { ...contextOptions, headless: !headed });
} else {
  browser = await chromium.launch({ headless: !headed, args: headed ? [] : ['--no-sandbox'] });
  context = await browser.newContext({ ...contextOptions, storageState: option('storage-state') });
}
try {
  const page = context.pages()[0] || (await context.newPage());
  if (mock) {
    await page.setContent(buildRecorderMockPage({ login, ownerType }));
  } else {
    await page.goto(`https://github.com/${repo}/settings/access`);
    console.log(`Waiting for "Add people" on ${page.url()} (sign in or confirm access in the window if asked)…`);
    const [add] = getRecorderSteps({ login, ownerType }).filter(step => step.id === 'add');
    await findTarget(page, add.targets, { timeoutMs: Number(option('wait-seconds') || 300) * 1000 });
  }
  const captions = await buildAccessAnimationCaptions({ login, ownerType, locale });
  const shots = await recordAccessGuide({
    page,
    login,
    ownerType,
    captions,
    sendInvite: flag('send-invite'),
    screenshot: target => commander.screenshot({ page: target, engine: 'playwright', format: 'png' }),
    log: message => console.log(message),
  });
  console.log(`${shots.length} frames, encoding…`);
  const gif = await encodeDiffGif({ shots, encodeAnimation: commander.encodeAnimation });
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, gif);
  console.log(`${output} (${gif.length} bytes)`);
} finally {
  await context.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
}
