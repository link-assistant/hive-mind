#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 * Regression coverage for issue #2846 (and #2687 before it).
 *
 * `konard/hive-mind-dind:2.34.0` had no jq, so AI tools' `… | jq -r …` and the
 * solver's own printed "Raw command" (`… | jq -c .`) exited 127 with
 * `jq: command not found`. Box's runtime does not guarantee jq or file, so
 * every hive-mind image installs them itself and the image verification step
 * fails the build if either one is missing.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relativePath => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

const DOCKERFILES = ['Dockerfile', 'Dockerfile.dind', 'coolify/Dockerfile'];
const UTILITIES = ['file', 'jq'];

for (const dockerfile of DOCKERFILES) {
  for (const utility of UTILITIES) {
    test(`${dockerfile} installs ${utility} when the Box base lacks it`, () => {
      const install = new RegExp(`^RUN command -v ${utility} >/dev/null \\|\\| HOMEBREW_NO_AUTO_UPDATE=1 brew install ${utility}$`, 'm');
      assert.match(read(dockerfile), install);
    });
  }
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
