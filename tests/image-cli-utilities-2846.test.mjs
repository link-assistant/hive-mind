#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for issue #2846 (and #2687 before it).
 *
 * `konard/hive-mind-dind:2.34.0` had no jq, so AI tools' `… | jq -r …` and the
 * solver's own printed "Raw command" (`… | jq -c .`) exited 127 with
 * `jq: command not found`. Box's runtime does not guarantee jq or file, so
 * every hive-mind image that starts from a Box base installs them itself, and
 * the image verification step fails the build if either one is missing.
 *
 * Every Dockerfile in the repository root and in coolify/ is discovered, so a
 * new image cannot be added without deciding where its CLI utilities come from.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relativePath => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

const UTILITIES = ['file', 'jq'];

// Images that agents run in and that start from a Box base: each installs the
// utilities itself.
const BOX_BASED_IMAGES = ['Dockerfile', 'Dockerfile.dind', 'coolify/Dockerfile'];

// Images that extend another hive-mind image and inherit its utilities.
const DERIVED_IMAGES = {
  // FROM konard/hive-mind-dind:${HIVE_MIND_VERSION}
  'Dockerfile.formal-ai': { from: /^FROM konard\/hive-mind-dind:/m, parent: 'Dockerfile.dind' },
  // FROM ${E2E_TASK_IMAGE}, built from Dockerfile.formal-ai (see its header).
  'Dockerfile.e2e': { from: /^FROM \$\{E2E_TASK_IMAGE\}$/m, parent: 'Dockerfile.formal-ai' },
};

const discoverDockerfiles = () => {
  const rootFiles = fs.readdirSync(repoRoot).filter(name => /^Dockerfile(\..+)?$/.test(name));
  const coolifyFiles = fs
    .readdirSync(path.join(repoRoot, 'coolify'))
    .filter(name => /^Dockerfile(\..+)?$/.test(name))
    .map(name => `coolify/${name}`);
  return [...rootFiles, ...coolifyFiles].sort();
};

const finalStageBase = dockerfile => {
  const froms = [...read(dockerfile).matchAll(/^FROM\s+(\S+)/gm)].map(match => match[1]);
  return froms.at(-1);
};

test('every image Dockerfile is classified as Box-based or derived', () => {
  const known = new Set([...BOX_BASED_IMAGES, ...Object.keys(DERIVED_IMAGES)]);
  for (const dockerfile of discoverDockerfiles()) {
    assert.ok(known.has(dockerfile), `${dockerfile} is a new image; decide whether it installs ${UTILITIES.join(' and ')} or inherits them, and list it in this test`);
  }
});

for (const dockerfile of BOX_BASED_IMAGES) {
  test(`${dockerfile} starts from a Box base`, () => {
    assert.match(finalStageBase(dockerfile), /^ghcr\.io\/link-foundation\/box(-dind)?:/);
  });

  for (const utility of UTILITIES) {
    test(`${dockerfile} installs ${utility} when the Box base lacks it`, () => {
      const install = new RegExp(`^RUN command -v ${utility} >/dev/null \\|\\| HOMEBREW_NO_AUTO_UPDATE=1 brew install ${utility}$`, 'm');
      assert.match(read(dockerfile), install);
    });
  }
}

for (const [dockerfile, { from, parent }] of Object.entries(DERIVED_IMAGES)) {
  test(`${dockerfile} inherits the utilities from ${parent}`, () => {
    assert.match(read(dockerfile), from);
    let ancestor = parent;
    while (DERIVED_IMAGES[ancestor]) ancestor = DERIVED_IMAGES[ancestor].parent;
    assert.ok(BOX_BASED_IMAGES.includes(ancestor), `${dockerfile} resolves to ${ancestor}`);
  });
}

test('scripts/verify-docker-image.sh fails the image when jq or file is missing', () => {
  const verifyScript = read('scripts/verify-docker-image.sh');
  for (const utility of UTILITIES) {
    assert.match(verifyScript, new RegExp(`^check_tool "[^"]+"\\s+${utility}\\s+--version$`, 'm'), `${utility} is verified`);
  }
});

test('the solver still prints commands that need jq, so the image must keep it', () => {
  assert.match(read('src/claude.lib.mjs'), /\| jq -c \.\)`/);
});
