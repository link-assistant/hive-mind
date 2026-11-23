/**
 * @hive-mind-test-suite default,pr-essential
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = fileURLToPath(new URL('..', import.meta.url));
const cli = join(root, 'src/hive-manager/cli.sh');

test('hive-manager advertises three independent maintenance actions', { timeout: 10_000 }, () => {
  const result = spawnSync('bash', [cli, 'deploy', '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  for (const action of ['update-dependencies', 'global-tools', 'tool-services']) assert.ok(result.stdout.includes(action), action);
});

test('deploy sends dependency updates to box in the selected container', { timeout: 10_000 }, async t => {
  const folder = await mkdtemp(join(tmpdir(), 'hive-4117-dispatch-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  await writeFile(join(folder, 'docker'), '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o700 });
  const result = spawnSync('bash', [cli, 'deploy', '--name', 'stage', 'update-dependencies', '--apply', '@fixture/tool'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${folder}:${process.env.PATH}` },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split('\n'), ['exec', '--user', 'box', '-i', 'stage', 'hive-manager', 'update-dependencies', '--apply', '@fixture/tool']);
});

test('deploy resolves the allowlist relative to the selected profile on the host', { timeout: 10_000 }, async t => {
  const folder = await mkdtemp(join(tmpdir(), 'hive-4117-profile-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const profile = join(folder, 'deployment');
  await writeFile(profile, 'name=stage-fixture\ntool-policy=stage-tools.json\n');
  await writeFile(join(folder, 'python3'), '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o700 });
  const result = spawnSync('bash', [cli, 'deploy', '--profile', profile, 'global-tools', '--apply'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${folder}:${process.env.PATH}` },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split('\n').slice(-5), ['--policy', join(folder, 'stage-tools.json'), '--apply', '--container', 'stage-fixture']);
});

test('Bun updates default to preview and preserve both lock formats on apply and failure', { timeout: 15_000 }, async t => {
  const folder = await mkdtemp(join(tmpdir(), 'hive-4117-dependencies-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const globalDir = join(folder, 'global');
  const dependency = '@fixture/selected';
  const manifest = { dependencies: { [dependency]: '1.0.0', unchanged: '1.0.0' } };
  const selectedManifest = join(globalDir, 'node_modules', dependency, 'package.json');
  await mkdir(dirname(selectedManifest), { recursive: true });
  await writeFile(selectedManifest, '{"version":"1.0.0"}');
  await writeFile(join(globalDir, 'package.json'), JSON.stringify(manifest));
  await writeFile(join(globalDir, 'bun.lock'), 'text rollback fixture');
  await writeFile(join(globalDir, 'bun.lockb'), 'binary rollback fixture');
  await writeFile(
    join(folder, 'bun'),
    `#!/bin/sh
case " $* " in
  *" --dry-run "*) printf 'preview selected update\\n'; exit 0 ;;
esac
test "$*" = 'update --global --latest @fixture/selected' || exit 2
printf '{"dependencies":{"@fixture/selected":"2.0.0","unchanged":"1.0.0"}}' > "$BUN_INSTALL_GLOBAL_DIR/package.json"
printf '{"version":"2.0.0"}' > "$BUN_INSTALL_GLOBAL_DIR/node_modules/@fixture/selected/package.json"
printf 'updated lock' > "$BUN_INSTALL_GLOBAL_DIR/bun.lock"
exit "${'${FIXTURE_EXIT:-0}'}"
`,
    { mode: 0o700 }
  );
  const invoke = (args, extra = {}) =>
    spawnSync('bash', [cli, 'update-dependencies', ...args], {
      encoding: 'utf8',
      env: { ...process.env, HOME: folder, PATH: `${folder}:${process.env.PATH}`, BUN_INSTALL_GLOBAL_DIR: globalDir, ...extra },
    });

  const invalid = invoke(['--all', dependency]);
  assert.equal(invalid.status, 1);
  const all = invoke(['--all', '--dry-run']);
  assert.equal(all.status, 0, all.stderr);
  assert.deepEqual(JSON.parse(all.stdout).selected, [dependency, 'unchanged']);
  const preview = invoke([dependency]);
  assert.equal(preview.status, 0, preview.stderr);
  const plan = JSON.parse(preview.stdout);
  assert.equal(plan.dryRun, true);
  assert.equal(plan.backup, null);
  assert.match(plan.output, /preview selected update/);
  assert.deepEqual(plan.checksums.before, plan.checksums.after);
  await assert.rejects(access(join(folder, '.hive-mind')), { code: 'ENOENT' });

  const failed = invoke(['--apply', dependency], { FIXTURE_EXIT: '5' });
  assert.equal(failed.status, 1, failed.stderr);
  const receipt = JSON.parse(failed.stdout);
  assert.equal(receipt.exitCode, 5);
  assert.deepEqual(receipt.selected, [dependency]);
  assert.deepEqual(receipt.changed, [dependency]);
  assert.deepEqual(receipt.before.unchanged, receipt.after.unchanged);
  assert.equal(receipt.after[dependency].installed, '2.0.0');
  assert.equal((await stat(receipt.backup)).mode & 0o777, 0o700);
  assert.deepEqual(JSON.parse(await readFile(join(receipt.backup, 'package.json'))), manifest);
  assert.equal(await readFile(join(receipt.backup, 'bun.lock'), 'utf8'), 'text rollback fixture');
  assert.equal(await readFile(join(receipt.backup, 'bun.lockb'), 'utf8'), 'binary rollback fixture');

  const retry = invoke(['--apply', dependency]);
  assert.equal(retry.status, 0, retry.stderr);
  assert.notEqual(JSON.parse(retry.stdout).backup, receipt.backup);
  assert.equal(await readFile(join(receipt.backup, 'bun.lock'), 'utf8'), 'text rollback fixture');
});

test('quarantine and pidfd safety with disposable fixtures', { timeout: 10_000, skip: process.platform !== 'linux' }, () => {
  const result = spawnSync('python3', ['-B', join(root, 'tests/fixtures/issue-4117/maintenance.py'), '-v'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.error?.message || result.stderr);
});
