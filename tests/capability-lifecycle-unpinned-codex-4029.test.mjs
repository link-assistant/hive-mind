/** @hive-mind-test-suite default */
// Issue #4029: `Checks and release` on main failed in docker-pr-check because
// the capability lifecycle gate (scripts/verify-capability-lifecycle.mjs, P3)
// assumed the idle updater's npm `latest` Codex is the image's pinned 0.164.0.
// Codex 0.167.0 (2026-11-06) ships different stock skills, so the production
// audit correctly refused launch with CodexStockBaselineError and the gate
// treated that typed fail-closed refusal as a regression. The gate must accept
// the refusal for any unpinned Codex, then restore the pinned stock runtime
// with the image's binaries before the later phases.
// Reproduction with the real binaries: experiments/issue-4029/codex-stock-skills-drift.sh
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { cliLabelVersion, codexStockRefusalExpected } from '../scripts/capability-lifecycle-state.lib.mjs';
import { CODEX_STOCK_SKILLS } from '../src/codex-stock-skills.lib.mjs';

const verifier = fs.readFileSync(new URL('../scripts/verify-capability-lifecycle.mjs', import.meta.url), 'utf8');
const pinned = CODEX_STOCK_SKILLS.cliVersion;

test('CLI version labels reduce to the bare release', () => {
  assert.equal(cliLabelVersion('codex-cli 0.164.0'), '0.164.0');
  assert.equal(cliLabelVersion('0.167.0'), '0.167.0');
  assert.equal(cliLabelVersion(' codex-cli 0.168.0-alpha.1 \n'), '0.168.0-alpha.1');
  assert.equal(cliLabelVersion(null), null);
  assert.equal(cliLabelVersion('codex-cli'), null);
});

test('a typed stock refusal is expected exactly for an unpinned Codex release', () => {
  assert.equal(cliLabelVersion(pinned), '0.164.0', 'the bundled baseline names the Dockerfile pin');
  for (const version of ['0.163.0', '0.165.0', '0.167.0', 'codex-cli 0.167.0']) assert.equal(codexStockRefusalExpected(version, pinned), true, version);
  // The pre-#4029 comparison (`'0.164.0' !== 'codex-cli 0.164.0'`) was true for
  // the pinned release too, so it would have hidden a pinned-baseline regression.
  for (const version of ['0.164.0', 'codex-cli 0.164.0', undefined, null, '']) assert.equal(codexStockRefusalExpected(version, pinned), false, String(version));
});

test('P3 tolerates the refusal after the updated Codex starts and restores the pinned runtime before P4', () => {
  const p3 = verifier.slice(verifier.indexOf('// ------------------------------------------------ P3 CLI updater'), verifier.indexOf('// ------------------------------------------------ P4 task completion'));
  assert.ok(p3.length > 0, 'P3 section not found');
  assert.match(p3, /checkpoint\('P3 first native start with the updated binaries', \{ unpinnedCodex: codexUpdatedTo \}\)/u);
  assert.match(p3, /codexUpdatedTo = updated\.updated\.find\(entry => entry\.id === 'codex'\)\?\.to/u);
  // The restore runs the image PATH (`env`), not the updater PATH, and ends with a strict checkpoint.
  assert.match(p3, /if \(codexStockRefusalExpected\(codexUpdatedTo, CODEX_STOCK_SKILLS\.cliVersion\)\) \{[\s\S]*?nativeStartup\('P3 restored pinned', home, env\);\s*await checkpoint\(`P3 pinned image binaries restored the stock runtime[^`]*`\);/u);
  assert.doesNotMatch(verifier, /unpinnedCodex !== CODEX_STOCK_SKILLS\.cliVersion/u, 'compare bare versions through codexStockRefusalExpected');
});
