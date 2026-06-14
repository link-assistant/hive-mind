#!/usr/bin/env node

/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for issue #1705: Hive Mind must publish a separate
 * Docker-in-Docker image so agents can run Docker-based project tests inside
 * the Hive Mind container without replacing the existing image.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();

const read = async filePath => fs.readFile(path.join(repoRoot, filePath), 'utf-8');

const assertIncludes = (content, expected, filePath) => {
  assert.ok(content.includes(expected), `${filePath} should include ${expected}`);
};

const assertExcludes = (content, unexpected, filePath) => {
  assert.ok(!content.includes(unexpected), `${filePath} should not include ${unexpected}`);
};

const assertFileExists = async filePath => {
  try {
    const stat = await fs.stat(path.join(repoRoot, filePath));
    assert.ok(stat.isFile(), `${filePath} should be a file`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      assert.fail(`${filePath} should exist`);
    }
    throw error;
  }
};

await assertFileExists('Dockerfile.dind');
await assertFileExists('scripts/verify-dind-exec-defaults.sh');

const dindDockerfile = await read('Dockerfile.dind');
const verifyDindExecDefaults = await read('scripts/verify-dind-exec-defaults.sh');

assertIncludes(dindDockerfile, 'FROM konard/box-dind:2.3.2', 'Dockerfile.dind');
assertIncludes(dindDockerfile, 'host-image passthrough allowlist', 'Dockerfile.dind');
assertIncludes(dindDockerfile, 'ARG HIVE_MIND_VERSION=latest', 'Dockerfile.dind');
assertIncludes(dindDockerfile, 'ENV HIVE_MIND_IMAGE_VARIANT=dind', 'Dockerfile.dind');
assertIncludes(dindDockerfile, 'ENV HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG="${HIVE_MIND_VERSION}"', 'Dockerfile.dind');
// Issue #1914 reopen: the nested daemon MUST default to a copy-on-write driver.
// `vfs` copies every layer in full, so the multi-GB images overflow the disk
// (`failed to register layer: no space left on device`). fuse-overlayfs is
// copy-on-write AND works overlay-on-overlay, the compatibility vfs was chosen
// for. Guard both directions so the regression cannot silently return.
assertIncludes(dindDockerfile, 'ENV DIND_STORAGE_DRIVER="fuse-overlayfs"', 'Dockerfile.dind');
assertExcludes(dindDockerfile, 'ENV DIND_STORAGE_DRIVER="vfs"', 'Dockerfile.dind');
assertIncludes(dindDockerfile, 'bun install -g "@link-assistant/hive-mind@${HIVE_MIND_VERSION}"', 'Dockerfile.dind');
assertIncludes(dindDockerfile, 'test "$(hive --version)" = "${HIVE_MIND_VERSION}"', 'Dockerfile.dind');
assertIncludes(dindDockerfile, 'configure-claude --settings-path /home/box/.claude/settings.json', 'Dockerfile.dind');
assertIncludes(dindDockerfile, 'configure-claude --settings-path /home/box/.claude/settings.json --verify', 'Dockerfile.dind');
assertExcludes(dindDockerfile, 'USER root', 'Dockerfile.dind');
assertExcludes(dindDockerfile, 'Keep the final image as root', 'Dockerfile.dind');

const detectCodeChanges = await read('scripts/detect-code-changes.mjs');
assertIncludes(detectCodeChanges, 'Dockerfile.dind', 'scripts/detect-code-changes.mjs');

const dockerDocs = await read('docs/DOCKER.md');
assertIncludes(dockerDocs, 'konard/hive-mind-dind:latest', 'docs/DOCKER.md');
assertIncludes(dockerDocs, 'DIND_STORAGE_DRIVER=fuse-overlayfs', 'docs/DOCKER.md');
assertIncludes(dockerDocs, '--privileged', 'docs/DOCKER.md');
assertIncludes(dockerDocs, '--runtime=sysbox-runc', 'docs/DOCKER.md');

const releaseYml = await read('.github/workflows/release.yml');

const dockerPrStart = releaseYml.indexOf('  docker-pr-check:');
const helmPrStart = releaseYml.indexOf('  # === HELM PR CHECK', dockerPrStart);
const dockerPrSection = releaseYml.slice(dockerPrStart, helmPrStart);

assertIncludes(dockerPrSection, 'DIND_IMAGE_NAME: konard/hive-mind-dind', '.github/workflows/release.yml');
assertIncludes(dockerPrSection, 'docker build --progress=plain -f Dockerfile.dind', '.github/workflows/release.yml');
assertIncludes(dockerPrSection, 'build-dind-output.log', '.github/workflows/release.yml');
assertIncludes(dockerPrSection, '${{ env.DIND_IMAGE_NAME }}:test', '.github/workflows/release.yml');
assertIncludes(dockerPrSection, 'docker run --rm --privileged', '.github/workflows/release.yml');
assertIncludes(dockerPrSection, 'bash scripts/verify-dind-exec-defaults.sh "${{ env.DIND_IMAGE_NAME }}:test"', '.github/workflows/release.yml');

assertIncludes(verifyDindExecDefaults, 'container_name="hive-mind-dind-verify"', 'scripts/verify-dind-exec-defaults.sh');
assertIncludes(verifyDindExecDefaults, 'docker exec "$container_name" whoami', 'scripts/verify-dind-exec-defaults.sh');
assertIncludes(verifyDindExecDefaults, 'docker exec "$container_name" bash -lc \'echo $HOME\'', 'scripts/verify-dind-exec-defaults.sh');
assertIncludes(verifyDindExecDefaults, 'docker exec "$container_name" docker ps', 'scripts/verify-dind-exec-defaults.sh');
assertIncludes(verifyDindExecDefaults, 'docker exec "$container_name" pgrep -x dockerd', 'scripts/verify-dind-exec-defaults.sh');
assertIncludes(verifyDindExecDefaults, 'docker run hello-world', 'scripts/verify-dind-exec-defaults.sh');

assertIncludes(releaseYml, 'docker-publish-dind:\n    name: Docker Publish DinD', '.github/workflows/release.yml');
assertIncludes(releaseYml, 'docker-publish-dind-merge:\n    name: Docker Publish DinD (Merge)', '.github/workflows/release.yml');
assertIncludes(releaseYml, 'docker-publish-dind-instant:\n    name: Docker Publish DinD Instant', '.github/workflows/release.yml');
assertIncludes(releaseYml, 'docker-publish-dind-instant-merge:\n    name: Docker Publish DinD Instant (Merge)', '.github/workflows/release.yml');
assertIncludes(releaseYml, 'IMAGE_NAME: konard/hive-mind-dind', '.github/workflows/release.yml');
assertIncludes(releaseYml, 'file: ./Dockerfile.dind', '.github/workflows/release.yml');
assertIncludes(releaseYml, 'hive-mind-dind-digests-${{ matrix.platform ==', '.github/workflows/release.yml');
assertIncludes(releaseYml, 'hive-mind-dind-instant-digests-${{ matrix.platform ==', '.github/workflows/release.yml');
assertIncludes(releaseYml, 'buildcache-dind-${{ matrix.cache_suffix }}', '.github/workflows/release.yml');
assertIncludes(releaseYml, 'HIVE_MIND_VERSION=${{ needs.release.outputs.published_version }}', '.github/workflows/release.yml');
assertIncludes(releaseYml, 'HIVE_MIND_VERSION=${{ needs.instant-release.outputs.published_version }}', '.github/workflows/release.yml');

console.log('Docker DinD variant checks passed');
