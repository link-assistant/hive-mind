#!/usr/bin/env node
/**
 * Regenerate the example-app preview screenshots that ship with this
 * template (issue #62). Drives the built static bundle through a Chromium
 * controlled by `browser-commander` so the README/site images always reflect
 * the current UI rather than a hand-captured snapshot.
 *
 * Outputs:
 *   - docs/screenshots/example-app/example-app-{en,ru}-{light,dark}.png
 *   - docs/screenshots/example-app/example-app.png  (en/light fallback copy)
 *
 * Usage:
 *   node scripts/update-preview-images.mjs
 *   PREVIEW_VERBOSE=1 node scripts/update-preview-images.mjs
 *   node scripts/update-preview-images.mjs --skip-build   # reuse existing dist
 *
 * Pattern reused from konard/vk-bot-desktop#52 (closes konard/vk-bot-desktop#51).
 * The matrix is sized to demonstrate locale × theme variation even when the
 * shipped example app does not yet have i18n or a theme toggle: downstream
 * forks that add either get fresh per-cell screenshots without touching this
 * script. Verbose mode (`PREVIEW_VERBOSE=1`) enables browser-commander
 * tracing, dumps PNG signatures, and prints the resolved <html data-theme>
 * and <html lang> so any future regression is diagnosable from CI logs alone.
 */
/* global document, window, URL */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeBrowserCommander } from 'browser-commander';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const exampleAppRoot = path.resolve(repoRoot, 'examples', 'universal-app');
const exampleAppDistDir = path.resolve(exampleAppRoot, 'dist');
const screenshotsDir = path.resolve(
  repoRoot,
  'docs',
  'screenshots',
  'example-app'
);

const VERBOSE =
  process.env.PREVIEW_VERBOSE === '1' || process.env.PREVIEW_VERBOSE === 'true';

const VIEWPORT = { width: 1280, height: 800 };

const LOCALES = [
  { locale: 'en', contextLocale: 'en-US' },
  { locale: 'ru', contextLocale: 'ru-RU' },
];
const THEMES = ['light', 'dark'];

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

function log(message) {
  console.log(`[preview] ${message}`);
}

function verbose(message) {
  if (VERBOSE) {
    console.log(`[preview:verbose] ${message}`);
  }
}

function parseArgs(argv) {
  const args = { skipBuild: false };
  for (const value of argv) {
    if (value === '--skip-build') {
      args.skipBuild = true;
    } else if (value === '--help' || value === '-h') {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }
  return args;
}

function runNpm(args, cwd) {
  return new Promise((resolve, reject) => {
    log(`running npm ${args.join(' ')} (cwd=${cwd})`);
    const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const child = spawn(npmCommand, args, {
      cwd,
      stdio: 'inherit',
      env: process.env,
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`npm ${args.join(' ')} exited with code ${code}`));
      }
    });
  });
}

async function ensureExampleAppBuild() {
  // The example app keeps its own lockfile under examples/universal-app so a
  // top-level `npm ci` does not install vite/react. Make sure it is present
  // before invoking `vite build`.
  const distHasIndex = await stat(
    path.resolve(exampleAppDistDir, 'index.html')
  ).catch(() => null);
  if (!distHasIndex) {
    await runNpm(['ci'], exampleAppRoot).catch(async () => {
      // `npm ci` requires package-lock.json to match. Fall back to install.
      await runNpm(['install', '--no-audit', '--no-fund'], exampleAppRoot);
    });
  }
  await runNpm(['run', 'build'], exampleAppRoot);
}

async function createStaticServer(rootDir) {
  const root = path.resolve(rootDir);

  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
      const pathname =
        requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
      const requestedPath = path.resolve(
        root,
        `.${decodeURIComponent(pathname)}`
      );

      if (
        requestedPath !== root &&
        !requestedPath.startsWith(`${root}${path.sep}`)
      ) {
        response.writeHead(403);
        response.end('Forbidden');
        return;
      }

      const fileStat = await stat(requestedPath);
      const filePath = fileStat.isDirectory()
        ? path.join(requestedPath, 'index.html')
        : requestedPath;
      const body = await readFile(filePath);
      const contentType =
        contentTypes.get(path.extname(filePath)) ?? 'application/octet-stream';

      response.writeHead(200, { 'content-type': contentType });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end('Not found');
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/`;

  return {
    url,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function pngDimensions(buffer) {
  if (
    buffer.length < 24 ||
    buffer.toString('hex', 0, 8) !== '89504e470d0a1a0a'
  ) {
    return null;
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

async function reportPng(label, filePath) {
  const buffer = await readFile(filePath);
  const dimensions = pngDimensions(buffer);
  const dimText = dimensions
    ? `${dimensions.width}x${dimensions.height}`
    : 'unknown';
  log(`wrote ${label} (${buffer.length} bytes, ${dimText}) -> ${filePath}`);
  if (VERBOSE) {
    verbose(`PNG signature: ${buffer.toString('hex', 0, 8)}`);
  }
}

async function captureTile({ browser, locale, theme, contextLocale, url }) {
  log(`capturing preview tile: locale=${locale} theme=${theme}`);

  const context = await browser.newContext({
    locale: contextLocale,
    colorScheme: theme,
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  });

  // Seed common theme storage keys downstream apps tend to use so a fork
  // adding theme support gets matrix coverage with no script edits.
  await context.addInitScript((themeValue) => {
    try {
      window.localStorage.setItem('theme', themeValue);
      window.localStorage.setItem('color-scheme', themeValue);
      document.documentElement.setAttribute('data-theme', themeValue);
    } catch {
      // localStorage can be locked down; emulateMedia covers the CSS path.
    }
  }, theme);

  const page = await context.newPage();

  const commander = makeBrowserCommander({
    page,
    enableNavigationManager: false,
    enableNetworkTracking: false,
    verbose: VERBOSE,
  });

  try {
    await commander.emulateMedia({ colorScheme: theme });

    const navigation = await commander.goto({
      url,
      waitForStableUrlBefore: false,
      waitForStableUrlAfter: false,
      waitForNetworkIdle: false,
      timeout: 30000,
      verificationTimeout: 5000,
    });
    if (!navigation.verified) {
      throw new Error(
        `navigation not verified (${locale}/${theme}): ${navigation.reason}`
      );
    }

    await commander.waitForSelector({ selector: '.app-shell', timeout: 10000 });
    await commander.waitForSelector({
      selector: '#calculator-title',
      timeout: 10000,
    });
    await page.waitForLoadState('networkidle');

    if (VERBOSE) {
      const probe = await commander.evaluate({
        fn: () => ({
          dataTheme: document.documentElement.getAttribute('data-theme'),
          lang: document.documentElement.getAttribute('lang'),
          heading: document.querySelector('h1')?.textContent ?? '',
        }),
      });
      verbose(`probe(${locale}/${theme}): ${JSON.stringify(probe)}`);
    }

    const outFile = path.resolve(
      screenshotsDir,
      `example-app-${locale}-${theme}.png`
    );
    await mkdir(screenshotsDir, { recursive: true });
    await page.screenshot({
      path: outFile,
      fullPage: false,
      animations: 'disabled',
      caret: 'hide',
    });
    await reportPng(`tile ${locale}/${theme}`, outFile);
    return outFile;
  } finally {
    await commander.destroy();
    await context.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/update-preview-images.mjs [--skip-build]');
    return;
  }

  if (!args.skipBuild) {
    await ensureExampleAppBuild();
  }

  const server = await createStaticServer(exampleAppDistDir);
  log(`example-app server: ${server.url}`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    for (const { locale, contextLocale } of LOCALES) {
      for (const theme of THEMES) {
        await captureTile({
          browser,
          locale,
          theme,
          contextLocale,
          url: server.url,
        });
      }
    }

    const fallback = path.resolve(screenshotsDir, 'example-app.png');
    const fallbackSource = path.resolve(
      screenshotsDir,
      'example-app-en-light.png'
    );
    await copyFile(fallbackSource, fallback);
    await reportPng('fallback (en/light copy)', fallback);
  } finally {
    await browser.close();
    await server.close();
  }

  log('all preview images regenerated');
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
