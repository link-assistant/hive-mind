/** @hive-mind-test-suite default */
// Issue #4055 (F11): "Reproduce retired native usage responses" failed in runs
// 43513683924 (logout) and 43527335157 (malformed) with "Expected the actual G0
// usage snapshot". With CODEX_PROBE_DIAGNOSTICS=1 the CI-built binary answered
// `failed to fetch codex rate limits: application network permission was
// revoked` in 2 of 12 local runs: the pinned upstream revokes an in-flight
// request when a reload sees the owner change before the fixture responds
// (login/src/auth/manager.rs set_cached_auth_locked → invalidate()). That is a
// lost race, so the probe reports it as inconclusive (exit 3) and the workflow
// repeats it instead of failing.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const probe = readFileSync(new URL('../experiments/issue-3785/probe-codex-native-limits-generation.py', import.meta.url), 'utf8');
const workflow = readFileSync(new URL('../.github/workflows/native-codex-auth-experiment.yml', import.meta.url), 'utf8');
const step = workflow.slice(workflow.indexOf('- name: Reproduce retired native usage responses'), workflow.indexOf('- name: Reproduce native operations continuing in retired SQLite storage'));
const helper = step.slice(step.indexOf('probe() {'), step.indexOf('\n          }\n') + 12).replace(/^ {10}/gm, '');

test('the probe treats only the upstream revocation of logout or malformed as inconclusive', () => {
  assert.match(probe, /UPSTREAM_REVOCATION = 'failed to fetch codex rate limits: application network permission was revoked'/);
  assert.match(probe, /args\.mutation in \('logout', 'malformed'\)\s+and result\.get\('error', \{\}\)\.get\('message'\) == UPSTREAM_REVOCATION/);
  assert.match(probe, /sys\.exit\(INCONCLUSIVE\)/);
  // The response is printed only when diagnostics are requested.
  assert.match(probe, /if os\.environ\.get\('CODEX_PROBE_DIAGNOSTICS'\) == '1':\n\s+# .*\n\s+print\(f'DIAGNOSTIC: native usage/);
});

test('both runs before the repair repeat inconclusive probes; the repaired run does not', () => {
  assert.match(step, /probe "\$RUNNER_TEMP\/native-limits-\$mutation-before\.log" --mutation "\$mutation" --expect-retired-response/);
  assert.match(step, /if probe "\$RUNNER_TEMP\/native-limits-\$mutation-regression\.log" --mutation "\$mutation"; then/);
  const after = workflow.slice(workflow.indexOf('- name: Verify native usage publication rejects retired authentication'));
  assert.doesNotMatch(after.slice(0, after.indexOf('\n      - name:', 10)), /probe\(\)|probe "/, 'after the repair exit 3 must fail');
});

function run(fails, final) {
  const dir = mkdtempSync(join(tmpdir(), 'hive-4055-f11-'));
  writeFileSync(join(dir, 'count'), '0');
  const fake = 'python3() { n=$(($(cat "$RUNNER_TEMP/count")+1)); echo $n > "$RUNNER_TEMP/count"; if [ "$n" -le "$FAILS" ]; then echo "INCONCLUSIVE: fake"; return 3; fi; echo PASS; return "$FINAL"; }';
  const result = spawnSync('bash', ['-e', '-c', `${fake}\n${helper}\nprobe "$RUNNER_TEMP/x.log" --mutation logout`], {
    env: { PATH: process.env.PATH, RUNNER_TEMP: dir, NATIVE_SOURCE: dir, FAILS: String(fails), FINAL: String(final) },
    encoding: 'utf8',
    timeout: 10000,
  });
  return { status: result.status, calls: Number(readFileSync(join(dir, 'count'), 'utf8')) };
}

test('the workflow helper repeats lost races, gives up after five, and keeps real outcomes', () => {
  assert.deepEqual(run(2, 0), { status: 0, calls: 3 });
  assert.deepEqual(run(5, 0), { status: 3, calls: 5 });
  assert.deepEqual(run(0, 1), { status: 1, calls: 1 }, 'a real failure is not repeated');
  assert.deepEqual(run(1, 1), { status: 1, calls: 2 });
});
