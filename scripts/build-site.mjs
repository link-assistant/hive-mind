#!/usr/bin/env node
/**
 * Bundle the download page (React + JSX) into a static site under `site/dist`
 * that GitHub Pages can serve directly. The bundle is self-contained (no remote
 * CDN) so the page works under the strict CSP declared in `site/index.html`.
 */
import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const siteDir = resolve(repoRoot, 'site');
const distDir = resolve(siteDir, 'dist');

async function main() {
  await rm(distDir, { recursive: true, force: true });
  await mkdir(resolve(distDir, 'assets'), { recursive: true });

  await Promise.all([cp(resolve(siteDir, 'index.html'), resolve(distDir, 'index.html')), cp(resolve(siteDir, 'styles.css'), resolve(distDir, 'styles.css'))]);

  await build({
    entryPoints: [resolve(siteDir, 'bootstrap.jsx')],
    bundle: true,
    minify: true,
    format: 'esm',
    target: ['es2020'],
    jsx: 'automatic',
    loader: { '.js': 'jsx', '.jsx': 'jsx' },
    outfile: resolve(distDir, 'assets', 'site.js'),
    sourcemap: true,
    logLevel: 'info',
  });

  console.log(`[build-site] wrote ${distDir}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
