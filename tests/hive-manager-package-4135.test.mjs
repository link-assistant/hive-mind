/**
 * @hive-mind-test-suite default,pr-essential
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../src/hive-manager/cli.sh', import.meta.url));
const packageName = '@link-assistant/hive-mind';
const pin = '2.48.0';

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'hive-manager-package-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const operator = join(cwd, 'operator');
  const target = join(cwd, 'target');
  const npm = join(cwd, 'npm cache');
  for (const path of [operator, target, npm]) mkdirSync(path);
  const entry = join(operator, 'hive-manager');
  copyFileSync(cli, entry);
  const executable = (path, body) => writeFileSync(path, `#!/bin/bash\nset -eu\n${body}\n`, { mode: 0o700 });
  executable(
    join(operator, 'ssh'),
    `[[ "$1 $2 $3" == '-T -- stage' ]]
export PATH="$FIXTURE_TARGET:$PATH"
unset HIVE_MANAGER_PACKAGE_VERSION HIVE_MANAGER_PACKAGE_DIAGNOSTICS
exec /bin/sh -c "$4"`
  );
  executable(
    join(target, 'npm'),
    `[[ "$1 $2 $3 $5" == 'exec --yes --package --' ]]
printf 'npm requested <%s>\\n' "$4" >&2
shift 5
export PATH="$FIXTURE_NPM:$PATH"
exec "$@"`
  );

  const install = (binDir, version, { bins = ['hive', 'hive-manager'], name = packageName, storage = true } = {}) => {
    const root = join(binDir, `${version} package`);
    const source = join(root, 'src');
    const manager = join(source, 'hive-manager');
    mkdirSync(join(manager, 'storage'), { recursive: true });
    mkdirSync(join(manager, 'lib'));
    mkdirSync(join(manager, 'maintenance'));
    mkdirSync(join(manager, 'backup'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name, version }));
    copyFileSync(cli, join(manager, 'cli.sh'));
    executable(join(source, 'hive.mjs'), 'printf "unexpected hive invocation\\n"; exit 98');
    writeFileSync(join(manager, 'lib', 'terminal.mjs'), 'globalThis.fixtureTerminalPreloaded = true;\n');
    const module = `import { readFileSync } from 'node:fs';
if (!globalThis.fixtureTerminalPreloaded) throw new Error('Missing terminal preload');
console.log(JSON.stringify({ version: ${JSON.stringify(version)}, args: process.argv.slice(2), input: readFileSync(0, 'utf8') }));
process.exitCode = 17;`;
    if (storage) writeFileSync(join(manager, 'storage', 'main.mjs'), module);
    writeFileSync(join(source, 'hive-models.mjs'), module, { mode: 0o700 });
    writeFileSync(join(manager, 'maintenance', 'global-tools.py'), `print('${version}')\n`);
    writeFileSync(join(manager, 'backup', 'main.py'), `import json, sys\nprint(json.dumps(sys.argv[1:]))\n`);
    for (const bin of bins) {
      symlinkSync(join(source, bin === 'hive-manager' ? 'hive-manager/cli.sh' : `${bin}.mjs`), join(binDir, bin));
    }
  };
  const run = (args, { version = pin, diagnostics = '1', input = '', localEntry } = {}) =>
    spawnSync('/bin/bash', localEntry ? [localEntry, ...args] : [entry, '--host', 'stage', ...args], {
      cwd,
      input,
      encoding: 'utf8',
      timeout: 10_000,
      env: {
        ...process.env,
        PATH: `${operator}:${dirname(process.execPath)}:/usr/bin:/bin`,
        FIXTURE_TARGET: target,
        FIXTURE_NPM: npm,
        HIVE_MANAGER_PACKAGE_VERSION: version,
        HIVE_MANAGER_PACKAGE_DIAGNOSTICS: diagnostics,
      },
    });
  return { install, run, target, npm };
}

const disk = ['deploy', '--name', 'stage', '--state-dir', '/stage data', '--docker-socket', '/docker socket', 'disk', '--help'];

test('SSH carries the explicit pin to npm and preserves storage arguments, stdin and status', t => {
  const { install, run, npm } = fixture(t);
  install(npm, pin);
  const arg = "spaces ' quotes $(exit 70)\nend";
  const result = run([...disk, arg, ''], { input: 'forwarded stdin\n' });
  assert.match(result.stderr, /npm requested <@link-assistant\/hive-mind@2\.48\.0>/);
  assert.match(result.stderr, /npm package @link-assistant\/hive-mind@2\.48\.0/);
  assert.equal(result.status, 17, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { version: pin, args: ['disk', '/docker socket', 'stage', '/stage data', '--help', arg, ''], input: 'forwarded stdin\n' });
});

test('SSH reuses the matching installed package and skips a mismatch even when its module exists', t => {
  const matching = fixture(t);
  matching.install(matching.target, pin, { bins: ['hive'] });
  const installed = matching.run(disk);
  assert.equal(installed.status, 17, installed.stderr);
  assert.equal(JSON.parse(installed.stdout).version, pin);
  assert.equal(installed.stderr, 'hive-manager: installed package @link-assistant/hive-mind@2.48.0\n');

  const mismatch = fixture(t);
  mismatch.install(mismatch.target, '2.49.0', { bins: ['hive-manager', 'hive-models'] });
  mismatch.install(mismatch.npm, pin);
  for (const args of [disk, ['models', '--help']]) {
    const fallback = mismatch.run(args);
    assert.equal(fallback.status, 17, fallback.stderr);
    assert.equal(JSON.parse(fallback.stdout).version, pin);
    assert.match(fallback.stderr, /skipping installed package @link-assistant\/hive-mind@2\.49\.0/);
    assert.match(fallback.stderr, /npm package @link-assistant\/hive-mind@2\.48\.0/);
  }
  const unpinned = mismatch.run(disk, { version: '', diagnostics: '' });
  assert.equal(unpinned.status, 17, unpinned.stderr);
  assert.equal(JSON.parse(unpinned.stdout).version, '2.49.0');
  assert.equal(unpinned.stderr, '');
});

test('a pin fails closed when npm does not provide a matching package', t => {
  const { install, run, target, npm } = fixture(t);
  install(target, '2.47.0');
  install(npm, pin, { name: '@fixture/other' });
  const result = run(disk);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /npm did not provide .*@2\.48\.0/);
  assert.equal(result.stdout, '');
});

test('package diagnostics distinguish a local installation from the unpinned npm fallback', t => {
  const { install, run, target, npm } = fixture(t);
  install(target, pin);
  const localEntry = join(target, 'hive-manager');
  assert.equal(run(['--version'], { localEntry }).stdout, `${pin}\n`);
  const local = run(disk, { localEntry, version: `v${pin}`, diagnostics: '' });
  assert.equal(local.status, 17, local.stderr);
  assert.equal(JSON.parse(local.stdout).version, pin);
  assert.equal(local.stderr, '');

  install(npm, '2.49.0');
  rmSync(localEntry);
  rmSync(join(target, 'hive'));
  const fallback = run(disk, { version: '' });
  assert.equal(fallback.status, 17, fallback.stderr);
  assert.equal(JSON.parse(fallback.stdout).version, '2.49.0');
  assert.match(fallback.stderr, /npm requested <@link-assistant\/hive-mind@latest>/);
  assert.match(fallback.stderr, /npm package @link-assistant\/hive-mind@2\.49\.0/);
});

test('installed-only host maintenance checks the pin and Docker exec uses the container environment', t => {
  const { install, run, target } = fixture(t);
  install(target, pin);
  const matched = run(['deploy', 'global-tools', '--help']);
  assert.equal(matched.status, 0, matched.stderr);
  assert.equal(matched.stdout, `${pin}\n`);
  const mismatched = run(['deploy', 'global-tools', '--help'], { version: '2.49.0' });
  assert.equal(mismatched.status, 1, mismatched.stderr);
  assert.match(mismatched.stderr, /Install @link-assistant\/hive-mind@2\.49\.0/);
  assert.doesNotMatch(mismatched.stderr, /npm requested/);

  const backupArgs = ['deploy', '--name', 'stage', '--state-dir', '/stage data', 'backup', '--help'];
  const backup = run(backupArgs);
  assert.equal(backup.status, 0, backup.stderr);
  assert.deepEqual(JSON.parse(backup.stdout), ['backup', 'stage', '/stage data', '--help']);
  const mismatchedBackup = run(backupArgs, { version: '2.49.0' });
  assert.equal(mismatchedBackup.status, 1, mismatchedBackup.stderr);
  assert.match(mismatchedBackup.stderr, /Install @link-assistant\/hive-mind@2\.49\.0 with backup\/main\.py/);
  assert.doesNotMatch(mismatchedBackup.stderr, /npm requested/);

  writeFileSync(join(target, 'docker'), '#!/bin/sh\nprintf "<%s>\\n" "$@"\n', { mode: 0o700 });
  const docker = run(['deploy', 'tasks', 'report', '--help'], { version: '2.49.0' });
  assert.equal(docker.status, 0, docker.stderr);
  assert.equal(docker.stdout, '<exec>\n<--user>\n<box>\n<-i>\n<hive-mind>\n<hive-manager>\n<tasks>\n<report>\n<--help>\n');
});
