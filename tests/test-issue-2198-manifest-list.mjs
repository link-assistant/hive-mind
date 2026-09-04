#!/usr/bin/env node

/**
 * Issue #2198: the multi-platform manifest push, extracted and made checkable.
 *
 * Four jobs in release.yml carried the same six inlined lines:
 *
 *   docker buildx imagetools create $(jq -cr '.tags | map("-t " + .) | join(" ")' <<< "$DOCKER_METADATA_OUTPUT_JSON") \
 *     $(printf '<image>@sha256:%s ' *)
 *
 * The word splitting was deliberate, but shellcheck flags it (SC2046) and
 * cannot be told otherwise per-copy, so `.github/workflows/release.yml` could
 * not pass actionlint — which is why this repository had no actionlint gate at
 * all while the template it is derived from does.
 *
 * `scripts/create-manifest-list.sh` builds the same argument list through an
 * explicit array. This test pins the resulting command line, because the only
 * place it would otherwise be observed is a release that has already published
 * to npm.
 *
 * @hive-mind-test-suite default
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2198
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assert, printSummary, getFailCount } from './test-helpers.mjs';

console.log('=== Issue #2198 — manifest list arguments ===\n');

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const script = join(repoRoot, 'scripts', 'create-manifest-list.sh');

/**
 * Run the script in dry-run mode against a throwaway digests directory.
 *
 * @param {object} input
 * @param {string[]} input.digests Digest files to create, named as uploaded.
 * @param {object} input.metadata The docker/metadata-action output object.
 * @param {string} [input.imageName]
 * @returns {{ code: number, stdout: string, stderr: string }}
 */
function run({ digests, metadata, imageName = 'konard/hive-mind' }) {
  const digestsDir = mkdtempSync(join(tmpdir(), 'hive-mind-digests-'));
  try {
    for (const digest of digests) {
      writeFileSync(join(digestsDir, digest), '');
    }

    try {
      const stdout = execFileSync('bash', [script], {
        encoding: 'utf8',
        env: {
          ...process.env,
          IMAGE_NAME: imageName,
          DIGESTS_DIR: digestsDir,
          DOCKER_METADATA_OUTPUT_JSON: JSON.stringify(metadata),
          DRY_RUN: 'true',
        },
      });
      return { code: 0, stdout, stderr: '' };
    } catch (error) {
      return { code: error.status ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
    }
  } finally {
    rmSync(digestsDir, { recursive: true, force: true });
  }
}

console.log('1. The command a release actually runs\n');

const released = run({
  digests: ['aaaa1111', 'bbbb2222'],
  metadata: { tags: ['konard/hive-mind:2.17.0', 'konard/hive-mind:latest'] },
});

const command = released.stdout.trim().split('\n').at(-1);

assert(released.code === 0, 'a normal two-platform release succeeds');
assert(command === 'docker buildx imagetools create -t konard/hive-mind:2.17.0 -t konard/hive-mind:latest konard/hive-mind@sha256:aaaa1111 konard/hive-mind@sha256:bbbb2222', `every tag becomes its own -t and every digest file becomes one source reference (got: ${command})`);

console.log('\n2. Arguments stay separate when a tag is not a bare word\n');

const awkward = run({
  digests: ['aaaa1111'],
  metadata: { tags: ['konard/hive-mind:2.17.0', 'konard/hive-mind:tag with space'] },
});
assert(awkward.stdout.includes('-t konard/hive-mind:tag with space'), 'a tag containing a space is passed as a single argument instead of being split — the failure mode the old unquoted $(...) had');

console.log('\n3. An empty merge is refused instead of pushing something wrong\n');

const noDigests = run({ digests: [], metadata: { tags: ['konard/hive-mind:2.17.0'] } });
assert(noDigests.code !== 0, 'no digest files fails the job');
assert(noDigests.stderr.includes('::error::') || noDigests.stdout.includes('::error::'), 'the empty-digests failure is annotated for the run summary');

const noTags = run({ digests: ['aaaa1111'], metadata: { tags: [] } });
assert(noTags.code !== 0, 'no tags fails the job rather than creating an untagged manifest list');

console.log('\n4. release.yml uses the script instead of re-inlining it\n');

const { readFileSync } = await import('node:fs');
const workflow = readFileSync(join(repoRoot, '.github', 'workflows', 'release.yml'), 'utf8');
const usages = workflow.split('bash scripts/create-manifest-list.sh').length - 1;

assert(usages === 4, `all four manifest-merge jobs call the shared script (found ${usages})`);
assert(!workflow.includes('docker buildx imagetools create $('), 'no copy of the unquoted command substitution is left behind');

printSummary('Issue #2198 — manifest list arguments');
process.exit(getFailCount() > 0 ? 1 : 0);
