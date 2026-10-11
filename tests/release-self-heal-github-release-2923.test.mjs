#!/usr/bin/env node
/**
 * Regression coverage for issue #2923: 2.34.1 and 2.35.1 reached npm, but the
 * release job timed out verifying them (runs 37723257263, 37983302098), so the
 * GitHub release, Docker images and Helm chart were never produced. The release
 * gate only asked npm, so every later push without a changeset printed
 * "already published. Nothing to release." and the gap stayed for good.
 * Same defect as link-foundation/js-ai-driven-development-pipeline-template#211.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/2923
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decideRelease, githubReleaseExists } from '../scripts/check-release-needed.lib.mjs';

const silent = { log() {}, warn() {} };
const decide = ({ releases, changesetCount = 0, version = '2.35.1' }) => decideRelease({ changesetCount, version, isPublished: async () => true, hasGithubRelease: async candidate => (releases === null ? null : releases.includes(candidate)), logger: silent });

test('a version on npm without a GitHub release is released again without a bump', async () => {
  const decision = await decide({ releases: ['2.35.0'] });
  assert.equal(decision.shouldRelease, true, 'the downstream artifacts of 2.35.1 must be produced');
  assert.equal(decision.skipBump, true, 'npm already has 2.35.1; nothing to bump');
});

test('a version on npm with a GitHub release has nothing to do', async () => {
  const decision = await decide({ releases: ['2.35.1'] });
  assert.equal(decision.shouldRelease, false);
});

test('an unknown GitHub release state never triggers a release', async () => {
  const warnings = [];
  const decision = await decideRelease({ changesetCount: 0, version: '2.35.1', isPublished: async () => true, hasGithubRelease: async () => null, logger: { log() {}, warn: line => warnings.push(line) } });
  assert.equal(decision.shouldRelease, false);
  assert.match(warnings.join('\n'), /could not check/i);
});

test('githubReleaseExists maps 200, 404 and other failures to true, false and null', async () => {
  const runner = code => async (command, args) => {
    assert.deepEqual([command, ...args], ['gh', 'api', 'repos/link-assistant/hive-mind/releases/tags/v2.35.1', '--jq', '.id']);
    return { code, stdout: code === 0 ? '123\n' : '', stderr: code === 0 ? '' : code === 1 ? 'gh: Not Found (HTTP 404)' : 'gh: Server Error (HTTP 502)' };
  };
  assert.equal(await githubReleaseExists({ runner: runner(0), repository: 'link-assistant/hive-mind', version: '2.35.1' }), true);
  assert.equal(await githubReleaseExists({ runner: runner(1), repository: 'link-assistant/hive-mind', version: '2.35.1' }), false);
  assert.equal(await githubReleaseExists({ runner: async () => ({ code: 1, stdout: '', stderr: 'gh: Server Error (HTTP 502)' }), repository: 'link-assistant/hive-mind', version: '2.35.1' }), null);
  assert.equal(await githubReleaseExists({ runner: runner(0), repository: '', version: '2.35.1' }), null, 'no repository means the state is unknown');
});
