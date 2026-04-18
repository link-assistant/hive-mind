#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();

const read = file => fs.readFile(path.join(root, file), 'utf-8');

const dockerfiles = ['Dockerfile', 'coolify/Dockerfile'];

for (const file of dockerfiles) {
  const content = await read(file);

  assert.ok(content.includes('ARG HIVE_MIND_VERSION=latest'), `${file} should accept the exact published hive-mind version as a build arg`);
  assert.ok(content.includes('bun install -g "@link-assistant/hive-mind@${HIVE_MIND_VERSION}"'), `${file} should install the published hive-mind package version`);
  assert.ok(content.includes('test "$(hive --version)" = "${HIVE_MIND_VERSION}"'), `${file} should verify the installed hive-mind version when a release version is supplied`);
  assert.ok(content.includes('configure-claude --settings-path /workspace/.claude/settings.json'), `${file} should apply the published configure-claude bin`);
  assert.ok(content.includes('configure-claude --settings-path /workspace/.claude/settings.json --verify'), `${file} should verify the Docker baseline after applying configure-claude`);
  assert.ok(!content.includes('/workspace/.hive-mind-bake'), `${file} should not copy repo source into a bake directory`);
  assert.ok(!content.includes('scripts/configure-claude-quiet-defaults.mjs'), `${file} should not invoke the old repo-local wrapper script`);
  assert.ok(!content.includes('src/claude-quiet-config.lib.mjs'), `${file} should rely on the published package instead of copying source libs`);
}

const releaseYml = await read('.github/workflows/release.yml');
const dockerPrStart = releaseYml.indexOf('  docker-pr-check:');
const helmPrStart = releaseYml.indexOf('  # === HELM PR CHECK', dockerPrStart);
const dockerPrSection = releaseYml.slice(dockerPrStart, helmPrStart);

assert.ok(dockerPrSection.includes('node tests/test-docker-release-order.mjs'), 'docker-pr-check should run this static release-order contract test');
assert.ok(!dockerPrSection.includes('docker build --progress=plain'), 'docker-pr-check should not build Docker images before npm publish');

assert.ok(releaseYml.includes('docker-publish:\n    name: Docker Publish'), 'release workflow should keep the normal Docker publish job');
assert.ok(releaseYml.includes('needs: [release]'), 'docker-publish should depend on the npm release job');
assert.ok(releaseYml.includes('needs: [instant-release]'), 'instant Docker publish should depend on the instant npm release job');
assert.ok(releaseYml.includes('node scripts/wait-for-npm.mjs --release-version "${{ needs.release.outputs.published_version }}"'), 'release Docker job should wait for the published npm version');
assert.ok(releaseYml.includes('node scripts/wait-for-npm.mjs --release-version "${{ needs.instant-release.outputs.published_version }}"'), 'instant Docker job should wait for the published npm version');
assert.ok(!/Wait for NPM package availability[\s\S]{0,160}\n\s+if: matrix\.platform == 'linux\/amd64'/.test(releaseYml), 'every Docker matrix build should wait for npm availability');
assert.ok(releaseYml.includes('HIVE_MIND_VERSION=${{ needs.release.outputs.published_version }}'), 'release Docker build should pass the exact npm version into Docker');
assert.ok(releaseYml.includes('HIVE_MIND_VERSION=${{ needs.instant-release.outputs.published_version }}'), 'instant Docker build should pass the exact npm version into Docker');

console.log('Docker release-order contract tests passed');
