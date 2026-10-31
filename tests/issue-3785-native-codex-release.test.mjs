/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { isNativeCodexBuildInput } from '../scripts/detect-code-changes.mjs';

const read = name => fs.readFile(new URL(`../${name}`, import.meta.url), 'utf8');
const job = (workflow, name) => workflow.split(`\n  ${name}:\n`)[1]?.split(/\n {2}[\w-]+:\n/u)[0] || '';

test('native build and request inputs invalidate image evidence', { timeout: 10000 }, () => {
  for (const name of ['scripts/build-native-codex.py', 'scripts/verify-native-codex-publish.mjs', 'experiments/issue-3785/native-codex/canonical_auth.rs', 'experiments/issue-3785/test_native_codex_build.py', 'experiments/issue-3785/probe-cargo-executable-hardlink.py', 'experiments/issue-3785/probe_native_codex_preparation.py', 'experiments/issue-3785/probe_native_codex_package.py', 'experiments/issue-3785/probe-packaged-native-codex.mjs', 'experiments/issue-3785/probe-codex-native-request-auth.mjs', 'experiments/issue-3785/probe-codex-native-compression.py', 'experiments/issue-3785/probe-codex-native-tui-history.py', 'experiments/issue-3785/probe-codex-native-agent-identity.py', 'experiments/issue-3785/native_process_group.py', 'experiments/issue-3785/native_network_fixture.py', 'experiments/issue-3785/native-request-proxy.mjs']) assert.equal(isNativeCodexBuildInput(name), true, name);
  for (const name of ['docs/case-studies/issue-3785/README.md', 'experiments/unrelated.py', 'experiments/issue-3785/PRODUCTION_PLAN.md']) assert.equal(isNativeCodexBuildInput(name), false, name);
});

test('image and both npm release paths require the same verified native build', { timeout: 10000 }, async () => {
  const workflow = await read('.github/workflows/release.yml');
  const assemblyAction = await read('.github/actions/assemble-native-codex/action.yml');
  assert.match(assemblyAction, /pattern: native-codex-runtime-\*/u);
  assert.match(assemblyAction, /python3 scripts\/build-native-codex\.py assemble/u);
  const native = job(workflow, 'native-codex-build');
  assert.match(native, /uses: \.\/\.github\/workflows\/native-codex-build\.yml/u);
  for (const name of ['docker-pr-check', 'release', 'instant-release']) {
    const section = job(workflow, name);
    assert.match(section, /needs: \[[^\n]*native-codex-build/u, name);
    assert.ok(section.includes("needs.native-codex-build.result == 'success'"), name);
    assert.match(section, /uses: \.\/\.github\/actions\/assemble-native-codex/u, name);
    const assembly = section.indexOf('uses: ./.github/actions/assemble-native-codex');
    const consumer = section.indexOf(name === 'docker-pr-check' ? 'bash scripts/docker-pr-build.sh' : 'node scripts/publish-to-npm.mjs');
    assert.ok(assembly >= 0 && consumer > assembly, `${name} must assemble before consuming the package`);
  }
  assert.ok(job(workflow, 'pipeline-status').includes('      - native-codex-build'));
});

test('publication checks the actual npm artifact after any pull or version commit', { timeout: 10000 }, async () => {
  const pkg = JSON.parse(await read('package.json'));
  const command = pkg.scripts['changeset:publish'];
  assert.ok(command.includes('node scripts/verify-native-codex-publish.mjs'));
  assert.ok(command.indexOf('verify-native-codex-publish.mjs') < command.indexOf('changeset publish'));
  const check = await read('scripts/verify-native-codex-publish.mjs');
  assert.ok(check.includes("'pack', '--ignore-scripts', '--silent'"));
  assert.ok(check.includes("'verify-package'"));
  assert.ok(check.includes('finally'));
});

test('the reusable build has one PR caller and preserves both native installed controls', { timeout: 10000 }, async () => {
  const workflow = await read('.github/workflows/native-codex-build.yml');
  assert.ok(!workflow.includes('  pull_request:'));
  assert.ok(workflow.includes('  workflow_call:'));
  assert.ok(workflow.includes('native-codex-release-build-${{ github.workflow }}-${{ github.ref }}'));
  assert.ok(workflow.includes('probe-packaged-native-codex.mjs'));
  assert.ok(workflow.includes('runner: ubuntu-24.04-arm'));
});
