#!/usr/bin/env node
/* global window */
/**
 * Regenerate the download-page preview screenshots in light and dark themes
 * for each maintained locale, so README/docs images always reflect the current
 * UI rather than a hand-captured snapshot. Drives the built site through a
 * headless Chromium with the GitHub Release API stubbed to a fixture so the
 * captures are reproducible across runs.
 *
 * Outputs (under docs/screenshots/download/):
 *   download-{en,ru,zh,hi}-{light,dark}.png
 *
 * Usage:
 *   node scripts/update-preview-images.mjs
 *   node scripts/update-preview-images.mjs --skip-build
 */
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

import { RELEASE_API_URL, createStaticServer, makeReleaseFixture } from './site-static-server.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const siteDistDir = path.resolve(repoRoot, 'site', 'dist');
const shotsDir = path.resolve(repoRoot, 'docs', 'screenshots', 'download');

const RELEASE_TAG = 'v1.73.6';
const VIEWPORT = { width: 1280, height: 900 };
const LOCALES = [
  { locale: 'en', contextLocale: 'en-US' },
  { locale: 'ru', contextLocale: 'ru-RU' },
  { locale: 'zh', contextLocale: 'zh-CN' },
  { locale: 'hi', contextLocale: 'hi-IN' },
];
const THEMES = ['light', 'dark'];

function runNpm(scriptName) {
  return new Promise((resolve, reject) => {
    console.log(`[preview] running npm run ${scriptName}`);
    const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const child = spawn(npmCommand, ['run', scriptName], {
      cwd: repoRoot,
      stdio: 'inherit',
      env: process.env,
    });

    child.once('error', reject);
    child.once('exit', code => (code === 0 ? resolve() : reject(new Error(`npm run ${scriptName} exited with code ${code}`))));
  });
}

async function capture({ browser, url, locale, contextLocale, theme }) {
  console.log(`[preview] capturing ${locale}/${theme}`);
  const context = await browser.newContext({
    locale: contextLocale,
    colorScheme: theme,
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  });

  await context.addInitScript(
    ([key, value]) => {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // localStorage may be locked down; colorScheme emulation still applies.
      }
    },
    ['hive-mind:theme', theme]
  );

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
    const outFile = path.resolve(shotsDir, `download-${locale}-${theme}.png`);
    await page.screenshot({
      path: outFile,
      fullPage: true,
      animations: 'disabled',
      caret: 'hide',
    });
    console.log(`[preview] wrote ${outFile}`);
  } finally {
    await context.close();
  }
}

async function main() {
  if (!process.argv.includes('--skip-build')) {
    await runNpm('build:site');
  }

  await mkdir(shotsDir, { recursive: true });
  const server = await createStaticServer(siteDistDir);
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    for (const { locale, contextLocale } of LOCALES) {
      for (const theme of THEMES) {
        await capture({ browser, url: server.url, locale, contextLocale, theme });
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }

  console.log('[preview] all preview images regenerated');
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
