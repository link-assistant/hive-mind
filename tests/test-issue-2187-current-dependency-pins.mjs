#!/usr/bin/env node

/**
 * Issue #2187 follow-up: once box#119 repaired multi-architecture publishing,
 * refresh Hive Mind's reproducible image and runtime dependency pins together.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/2187
 * @see https://github.com/link-foundation/box/issues/119
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relativePath => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

const expected = {
  agent: '0.26.2',
  box: '2.10.2',
  bun: '1.4.2',
  eslint: '10.10.0',
  formalAi: '0.349.2',
  jscpd: '5.2.0',
  lintStaged: '17.5.1',
  node: '24.21.0',
  sentry: '10.74.0',
  sentryProfiler: '2.4.4',
  startCommand: '0.33.0',
  useM: '8.15.1',
};

const regularDockerfiles = ['Dockerfile', 'coolify/Dockerfile'];
for (const file of regularDockerfiles) {
  const source = read(file);
  assert.match(source, new RegExp(`^FROM ghcr\\.io/link-foundation/box:${expected.box}$`, 'm'), `${file} should pin Box ${expected.box}`);
  assert.match(source, new RegExp(`^ARG FORMAL_AI_VERSION=${expected.formalAi}$`, 'm'), `${file} should pin Formal AI ${expected.formalAi}`);
  assert.match(source, new RegExp(`^ARG HIVE_MIND_NODE_VERSION=${expected.node}$`, 'm'), `${file} should align Node.js with Box ${expected.box}`);
  assert.match(source, new RegExp(`^ARG HIVE_MIND_BUN_VERSION=${expected.bun}$`, 'm'), `${file} should align Bun with Box ${expected.box}`);
}

const dindDockerfile = read('Dockerfile.dind');
assert.match(dindDockerfile, new RegExp(`^FROM ghcr\\.io/link-foundation/box-dind:${expected.box}$`, 'm'), `Dockerfile.dind should pin Box ${expected.box}`);
assert.match(dindDockerfile, new RegExp(`^ARG FORMAL_AI_VERSION=${expected.formalAi}$`, 'm'), `Dockerfile.dind should pin Formal AI ${expected.formalAi}`);
assert.match(dindDockerfile, new RegExp(`^ARG HIVE_MIND_NODE_VERSION=${expected.node}$`, 'm'), `Dockerfile.dind should align Node.js with Box ${expected.box}`);
assert.match(dindDockerfile, new RegExp(`^ARG HIVE_MIND_BUN_VERSION=${expected.bun}$`, 'm'), `Dockerfile.dind should align Bun with Box ${expected.box}`);

for (const file of ['Dockerfile', 'Dockerfile.dind']) {
  const source = read(file);
  assert.match(source, new RegExp(`bun install -g @link-assistant/agent@${expected.agent}`), `${file} should pin Agent ${expected.agent}`);
  assert.match(source, new RegExp(`bun install -g start-command@${expected.startCommand}`), `${file} should pin start-command ${expected.startCommand}`);
}

const formalAiVersionSource = read('src/formal-ai-version.lib.mjs');
assert.match(formalAiVersionSource, new RegExp(`FORMAL_AI_BOOTSTRAP_VERSION = '${expected.formalAi}'`), 'the Formal AI runtime and image pins should match');

const useMSource = read('src/use-m-bootstrap.lib.mjs');
assert.match(useMSource, new RegExp(`unpkg\\.com/use-m@${expected.useM}/use\\.js`), `the primary use-m bootstrap should pin ${expected.useM}`);
assert.match(useMSource, new RegExp(`jsdelivr\\.net/npm/use-m@${expected.useM}/use\\.js`), `the fallback use-m bootstrap should pin ${expected.useM}`);

const packageJson = JSON.parse(read('package.json'));
assert.equal(packageJson.devDependencies.eslint, `^${expected.eslint}`);
assert.equal(packageJson.devDependencies.jscpd, `^${expected.jscpd}`);
assert.equal(packageJson.devDependencies['lint-staged'], `^${expected.lintStaged}`);
assert.equal(packageJson.dependencies['@sentry/node'], `^${expected.sentry}`);
assert.equal(packageJson.dependencies['@sentry/profiling-node'], `^${expected.sentry}`);
assert.equal(packageJson.allowScripts[`@sentry/node-cpu-profiler@${expected.sentryProfiler}`], true);

const packageLock = JSON.parse(read('package-lock.json'));
assert.equal(packageLock.packages['node_modules/eslint']?.version, expected.eslint);
assert.equal(packageLock.packages['node_modules/jscpd']?.version, expected.jscpd);
assert.equal(packageLock.packages['node_modules/lint-staged']?.version, expected.lintStaged);
assert.equal(packageLock.packages['node_modules/@sentry/node']?.version, expected.sentry);
assert.equal(packageLock.packages['node_modules/@sentry/profiling-node']?.version, expected.sentry);
assert.equal(packageLock.packages['node_modules/@sentry/node-cpu-profiler']?.version, expected.sentryProfiler);

console.log('Issue #2187 current dependency pin checks passed');
