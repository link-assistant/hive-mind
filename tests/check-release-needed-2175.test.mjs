/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for issue #2175 (false negative in the release gate).
 *
 * The release job decided everything from one inline shell question — "does
 * .changeset contain any *.md?" — which conflates two very different states:
 *
 *   - nothing to do, and
 *   - a version bump already landed on main but was never published.
 *
 * The second state is exactly what run 32589574378 produced: 2.13.5 was
 * committed locally, the push to main was rejected, and the changesets were
 * consumed. Any later push to main sees zero changesets and skips the release
 * silently, so package.json says 2.13.5 while npm's latest stays 2.13.4 — a
 * false negative with no failing check anywhere.
 *
 * These tests pin the self-healing decision: the registry, not the changeset
 * folder, is the source of truth for "is this version released?".
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2175
 */

import assert from 'node:assert/strict';

import { countChangesets, decideRelease, emitDecision, readPackageInfo } from '../scripts/check-release-needed.lib.mjs';

const silent = { log() {} };

const decide = ({ changesetCount, version = '2.13.5', published }) => decideRelease({ changesetCount, version, isPublished: async candidate => published.includes(candidate), logger: silent });

// --- 1. Changesets pending: bump, then publish ----------------------------

{
  const decision = await decide({ changesetCount: 2, published: [] });
  assert.equal(decision.shouldRelease, true);
  assert.equal(decision.hasChangesets, true);
  assert.equal(decision.skipBump, false, 'pending changesets always require a version bump first');
}

{
  let asked = false;
  const decision = await decideRelease({
    changesetCount: 1,
    version: '2.13.5',
    isPublished: async () => {
      asked = true;
      return true;
    },
    logger: silent,
  });
  assert.equal(decision.shouldRelease, true);
  assert.equal(asked, false, 'with changesets pending the registry is irrelevant — the new version does not exist yet');
}

// --- 2. No changesets, version already on npm: nothing to do --------------

{
  const decision = await decide({ changesetCount: 0, version: '2.13.4', published: ['2.13.4'] });
  assert.equal(decision.shouldRelease, false, 'a published version with no changesets means there is genuinely nothing to release');
  assert.equal(decision.skipBump, false);
}

// --- 3. No changesets, version NOT on npm: self-heal ----------------------

{
  const decision = await decide({ changesetCount: 0, version: '2.13.5', published: ['2.13.4'] });
  assert.equal(decision.shouldRelease, true, 'the repository is ahead of the registry — this is the state issue #2175 left main in, and it must not be reported as "nothing to do"');
  assert.equal(decision.skipBump, true, 'there is nothing to bump: the existing version must be published as-is');
  assert.equal(decision.hasChangesets, false);
}

// --- 4. Outputs ----------------------------------------------------------

{
  const outputs = {};
  emitDecision(await decide({ changesetCount: 0, version: '2.13.5', published: [] }), (key, value) => (outputs[key] = value));
  assert.deepEqual(outputs, { has_changesets: 'false', changeset_count: '0', should_release: 'true', skip_bump: 'true' }, 'outputs are the strings GitHub Actions `if:` expressions compare against');
}

// --- 5. Counting and reading ---------------------------------------------

{
  const reader = () => ['README.md', 'brave-pans-shave.md', 'config.json', 'nested'];
  assert.equal(countChangesets({ reader }), 1, "the changesets tool's own README.md and config.json are not changesets");
  assert.equal(
    countChangesets({
      reader: () => {
        throw new Error('ENOENT');
      },
    }),
    0,
    'a missing .changeset folder means zero changesets, not a crash'
  );

  const info = readPackageInfo();
  assert.ok(/^\d+\.\d+\.\d+/.test(info.version), `the real package.json version is readable (got ${info.version})`);
  assert.equal(info.name, '@link-assistant/hive-mind');
}

console.log('check-release-needed-2175.test.mjs: all assertions passed');
