#!/usr/bin/env node
/* global document */
/**
 * End-to-end smoke test for the built download page. Serves `site/dist` (or
 * hits a deployed `--url`), then drives Chromium through Playwright to assert
 * the page renders, switches OS/locale/theme, and exposes copyable install
 * commands for macOS, Windows, and Linux.
 *
 * Usage:
 *   node scripts/test-pages-e2e.mjs --site-dir site/dist
 *   node scripts/test-pages-e2e.mjs --url https://example.github.io/hive-mind/
 */
import { chromium } from 'playwright';

import { RELEASE_API_URL, createStaticServer, makeReleaseFixture } from './site-static-server.mjs';

const RELEASE_TAG = 'v1.73.6';

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === '--url') {
      args.url = argv[(index += 1)];
    } else if (value === '--site-dir') {
      args.siteDir = argv[(index += 1)];
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }

  if (!args.url && !args.siteDir) {
    throw new Error('Pass either --url <url> or --site-dir <path>.');
  }

  return args;
}

async function readPageState(page) {
  return page.evaluate(() => ({
    title: document.title,
    heading: document.querySelector('h1')?.textContent?.trim() ?? '',
    osTabs: document.querySelectorAll('.os-tabs button').length,
    themeButtons: document.querySelectorAll('.theme-switch button').length,
    localeButtons: document.querySelectorAll('.locale-switch button').length,
    installCards: document.querySelectorAll('.install-card').length,
    commandBlocks: document.querySelectorAll('.command-block').length,
    npmCommand: Array.from(document.querySelectorAll('.command-line')).some(node => node.textContent.includes('npm install -g')),
    dockerCommand: Array.from(document.querySelectorAll('.command-line')).some(node => node.textContent.includes('docker pull')),
  }));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function validate(page) {
  const state = await readPageState(page);

  assert(state.title.includes('Hive Mind'), `Unexpected page title: ${state.title}`);
  assert(state.heading.includes('Hive Mind'), `Unexpected page heading: ${state.heading}`);
  assert(state.osTabs === 3, `Expected 3 OS tabs, got ${state.osTabs}`);
  assert(state.themeButtons === 3, `Expected 3 theme buttons, got ${state.themeButtons}`);
  assert(state.localeButtons === 4, `Expected 4 locale buttons, got ${state.localeButtons}`);
  assert(state.installCards === 3, `Expected 3 install cards (macOS/Windows/Linux), got ${state.installCards}`);
  assert(state.npmCommand, 'Expected an "npm install -g" command on the page');
  assert(state.dockerCommand, 'Expected a "docker pull" command on the page');

  // Switch to dark theme and assert the document reflects it.
  await page.click('.theme-switch button[title="dark"]');
  await page
    .waitForFunction(() => document.documentElement.dataset.theme === 'dark', {
      timeout: 5000,
    })
    .catch(() => {
      throw new Error('Theme switch did not apply dark theme');
    });

  // Switch locale to Russian and assert the document language updates.
  await page.click('.locale-switch button:nth-child(2)');
  await page
    .waitForFunction(() => document.documentElement.lang === 'ru', {
      timeout: 5000,
    })
    .catch(() => {
      throw new Error('Locale switch did not set lang=ru');
    });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let server;
  let url = args.url;

  if (!url) {
    server = await createStaticServer(args.siteDir);
    url = server.url;
  }

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const context = await browser.newContext({
    colorScheme: 'light',
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  await page.route(RELEASE_API_URL, route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(makeReleaseFixture(RELEASE_TAG)),
    })
  );

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForSelector('.os-tabs', { timeout: 10000 });
    await validate(page);
    console.log(`Pages e2e checks passed for ${url}`);
  } finally {
    await browser.close();
    await server?.close();
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
