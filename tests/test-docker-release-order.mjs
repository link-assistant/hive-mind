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
  assert.ok(content.includes('configure-claude --settings-path /home/box/.claude/settings.json'), `${file} should invoke the published configure-claude bin`);
  assert.ok(content.includes('configure-claude --settings-path /home/box/.claude/settings.json --verify'), `${file} should verify the Docker baseline after applying configure-claude`);
  // PR builds (HIVE_MIND_VERSION=latest) must tolerate a configure-claude that
  // has not been published yet; release builds (pinned version) must not.
  assert.ok(/if \[ "\$\{HIVE_MIND_VERSION\}" != "latest" \]/.test(content), `${file} should branch on HIVE_MIND_VERSION so release builds enforce configure-claude strictly`);
  assert.ok(content.includes('command -v configure-claude'), `${file} should gracefully skip configure-claude when the bin is not yet published (PR builds only)`);
  assert.ok(!content.includes('/workspace/.hive-mind-bake'), `${file} should not copy repo source into a bake directory`);
  assert.ok(!content.includes('scripts/configure-claude-quiet-defaults.mjs'), `${file} should not invoke the old repo-local wrapper script`);
  assert.ok(!content.includes('src/claude-quiet-config.lib.mjs'), `${file} should rely on the published package instead of copying source libs`);
}

const releaseYml = await read('.github/workflows/release.yml');
const dockerPrStart = releaseYml.indexOf('  docker-pr-check:');
const helmPrStart = releaseYml.indexOf('  # === HELM PR CHECK', dockerPrStart);
const dockerPrSection = releaseYml.slice(dockerPrStart, helmPrStart);

// PR docker-pr-check must (1) run the release-order contract test AND
// (2) actually build the Docker image using @link-assistant/hive-mind@latest
// and run the container verification script.
assert.ok(dockerPrSection.includes('node tests/test-docker-release-order.mjs'), 'docker-pr-check should run this static release-order contract test');
assert.ok(dockerPrSection.includes('docker build --progress=plain'), 'docker-pr-check should build the Docker image on PRs');
assert.ok(dockerPrSection.includes('bash /verify-docker-image.sh'), 'docker-pr-check should run verify-docker-image.sh inside the built image');

assert.ok(releaseYml.includes('docker-publish:\n    name: Docker Publish'), 'release workflow should keep the normal Docker publish job');
assert.ok(releaseYml.includes('needs: [release]'), 'docker-publish should depend on the npm release job');
assert.ok(releaseYml.includes('needs: [instant-release]'), 'instant Docker publish should depend on the instant npm release job');
assert.ok(releaseYml.includes('node scripts/wait-for-npm.mjs --release-version "${{ needs.release.outputs.published_version }}"'), 'release Docker job should wait for the published npm version');
assert.ok(releaseYml.includes('node scripts/wait-for-npm.mjs --release-version "${{ needs.instant-release.outputs.published_version }}"'), 'instant Docker job should wait for the published npm version');
assert.ok(!/Wait for NPM package availability[\s\S]{0,160}\n\s+if: matrix\.platform == 'linux\/amd64'/.test(releaseYml), 'every Docker matrix build should wait for npm availability');
assert.ok(releaseYml.includes('HIVE_MIND_VERSION=${{ needs.release.outputs.published_version }}'), 'release Docker build should pass the exact npm version into Docker');
assert.ok(releaseYml.includes('HIVE_MIND_VERSION=${{ needs.instant-release.outputs.published_version }}'), 'instant Docker build should pass the exact npm version into Docker');
assert.ok(!releaseYml.includes('pattern: digests-*'), 'normal Docker merge must not download DinD digest artifacts');
assert.ok(releaseYml.includes('name: hive-mind-digests-${{ matrix.platform =='), 'release Docker artifacts should use the normal image digest namespace');
assert.ok(releaseYml.includes('pattern: hive-mind-digests-*'), 'release Docker merge should download only normal image digests');
assert.ok(releaseYml.includes('name: hive-mind-instant-digests-${{ matrix.platform =='), 'instant Docker artifacts should use the normal image digest namespace');
assert.ok(releaseYml.includes('pattern: hive-mind-instant-digests-*'), 'instant Docker merge should download only normal image digests');
assert.ok(releaseYml.includes('name: hive-mind-dind-digests-${{ matrix.platform =='), 'release DinD artifacts should use a separate digest namespace');
assert.ok(releaseYml.includes('pattern: hive-mind-dind-digests-*'), 'release DinD merge should download only DinD digests');
assert.ok(releaseYml.includes('name: hive-mind-dind-instant-digests-${{ matrix.platform =='), 'instant DinD artifacts should use a separate digest namespace');
assert.ok(releaseYml.includes('pattern: hive-mind-dind-instant-digests-*'), 'instant DinD merge should download only DinD digests');

console.log('Docker release-order contract tests passed');
