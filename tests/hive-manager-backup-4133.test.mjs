/**
 * @hive-mind-test-suite default,pr-essential
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

const manager = fileURLToPath(new URL('../src/hive-manager/cli.sh', import.meta.url));
const magic = Buffer.from('HIVE-MIND-PRIVATE-BACKUP 1\n');
const containerId = 'a'.repeat(64);

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'hive-backup-test-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const executable = (name, body) => writeFileSync(join(cwd, name), `#!/usr/bin/env bash\nset -eu\n${body}\n`, { mode: 0o700 });
  const state = join(cwd, 'state');
  const bind = join(cwd, 'containerfs', 'extra bind');
  const old = join(cwd, 'containerfs', 'legacy');
  const volume = join(cwd, 'containerfs', 'volume');
  for (const path of [join(state, 'claude'), join(state, 'codex'), join(state, 'hive'), bind, old, volume]) {
    mkdirSync(path, { recursive: true });
  }
  writeFileSync(join(state, 'claude', 'marker'), 'selected provider marker', { mode: 0o644 });
  writeFileSync(join(state, 'claude.json'), '{}');
  writeFileSync(join(state, 'codex', 'marker'), 'excluded provider marker');
  writeFileSync(join(state, 'hive', 'marker'), 'selected common state');
  writeFileSync(join(state, 'unknown'), 'unclassified state');
  writeFileSync(join(bind, 'marker'), 'selected bind marker', { mode: 0o755 });
  writeFileSync(join(old, 'marker'), 'selected legacy marker');
  writeFileSync(join(volume, 'marker'), 'selected volume marker');
  writeFileSync(join(cwd, 'extra.conf'), 'selected host file');
  symlinkSync(join(state, 'codex', 'marker'), join(state, 'claude', 'excluded-link'));

  const inspect = {
    id: containerId,
    name: '/example',
    state: { Status: 'exited', StartedAt: '2026-11-23T01:00:00Z', FinishedAt: '2026-11-23T01:01:00Z' },
    mounts: [
      { Type: 'bind', Source: bind, Destination: '/extra bind', RW: false },
      { Type: 'bind', Source: join(state, 'codex'), Destination: '/home/box/.codex', RW: true },
      { Type: 'volume', Name: 'example-volume', Source: volume, Destination: '/volume', RW: true },
    ],
  };
  const setInspect = data => writeFileSync(join(cwd, 'inspect.json'), JSON.stringify(data));
  setInspect(inspect);
  executable(
    'docker',
    `case "$1 $2" in
  'container ls') cat <<< '${containerId}' ;;
  'container inspect') [[ "${'${!#}'}" == example || "${'${!#}'}" == '${containerId}' ]]; cat inspect.json ;;
  'container diff') printf 'A /legacy\\nA /legacy/marker\\n' ;;
  'container cp') [[ "$4" == - ]]; tar -cf - -C containerfs "${'${3#*:/}'}" ;;
  *) exit 88 ;;
esac`
  );
  executable(
    'ssh',
    `[[ "$1 $2 $3" == '-T -- example-host' ]]
exec /bin/sh -c "$4"`
  );
  const managerBin = join(cwd, 'hive-manager');
  symlinkSync(manager, managerBin);
  const run = (args, { input, remote = false } = {}) =>
    spawnSync('bash', [manager, ...(remote ? ['--host', 'example-host'] : []), ...args], {
      cwd,
      input,
      env: { ...process.env, PATH: `${cwd}:${process.env.PATH}` },
      timeout: 10000,
    });
  const deploy = (stateDir, ...args) => ['deploy', '--name', 'example', '--state-dir', stateDir, ...args];
  const select = ['--state', '--provider', 'claude', '--mount', 'logs=/extra bind', '--mount', 'database=example:/volume', '--legacy', 'before=example:/legacy', '--path', `settings=${join(cwd, 'extra.conf')}`];
  return { cwd, state, run, deploy, select, inspect, setInspect };
}

function success(result) {
  assert.equal(result.status, 0, result.error?.message ?? result.stderr.toString());
  return result.stdout;
}

test('selected state, bind, volume, legacy path and explicit file round-trip privately over SSH streams', { timeout: 15000 }, t => {
  const { cwd, state, run, deploy, select } = fixture(t);
  const preview = deploy(state, 'backup', '--plan', ...select);
  const reviewed = success(run(preview, { remote: true }));
  const plan = JSON.parse(reviewed);
  assert.equal(plan.private, true);
  assert.doesNotMatch(reviewed.toString(), /provider marker|bind marker|legacy marker/);
  assert.match(plan.excluded['state/codex'], /outside selected scope/);
  assert.match(plan.excluded['state/unknown'], /outside selected scope/);
  assert.match(plan.excluded['mount:example:/home/box/.codex'], /outside selected scope/);
  assert.equal(plan.sources.find(source => source.destination === 'additional/logs').mount.Type, 'bind');
  assert.equal(plan.sources.find(source => source.destination === 'additional/database').mount.Name, 'example-volume');
  assert.equal(plan.sources.find(source => source.destination === 'additional/before').container, containerId);
  const claude = plan.sources.find(source => source.destination === 'state/claude');
  assert.equal(claude.root.ownership.uid, process.getuid());
  assert.equal(claude.root.ownership.gid, statSync(join(state, 'claude')).gid);

  const capture = deploy(state, 'backup', '--plan-file', '-');
  const archive = success(run([...capture, '--output', '-'], { input: reviewed, remote: true }));
  assert.ok(archive.subarray(0, magic.length).equals(magic));
  assert.ok(!gunzipSync(archive.subarray(magic.length)).includes('excluded provider marker'));
  success(run([...capture, '--output', 'offline.bundle'], { input: reviewed }));
  const offline = join(cwd, 'offline.bundle');
  assert.equal(statSync(offline).mode & 0o777, 0o600);
  assert.match(run([...capture, '--output', 'offline.bundle'], { input: reviewed }).stderr.toString(), /already exists/);
  assert.match(run([...capture, '--output', join(state, 'claude', 'recursive.bundle')], { input: reviewed }).stderr.toString(), /outside deployment state/);

  const target = join(cwd, 'restore');
  const restore = deploy(target, 'restore', '--bundle');
  success(run(restore, { input: archive, remote: true }));
  assert.equal(statSync(target).mode & 0o777, 0o700);
  assert.equal(statSync(join(target, 'state', 'claude')).mode & 0o777, 0o700);
  const markers = {
    'state/claude/marker': 'selected provider marker',
    'state/hive/marker': 'selected common state',
    'additional/logs/marker': 'selected bind marker',
    'additional/database/marker': 'selected volume marker',
    'additional/before/marker': 'selected legacy marker',
    'additional/settings': 'selected host file',
  };
  for (const [path, content] of Object.entries(markers)) {
    assert.equal(readFileSync(join(target, path), 'utf8'), content);
    assert.equal(statSync(join(target, path)).mode & 0o777, path === 'additional/logs/marker' ? 0o700 : 0o600);
  }
  for (const path of ['state/codex', 'state/unknown', 'state/claude/excluded-link']) {
    assert.equal(existsSync(join(target, path)), false);
  }
  const receiptPath = join(target, 'MANIFEST.json');
  assert.equal(statSync(receiptPath).mode & 0o777, 0o600);
  const receipt = JSON.parse(readFileSync(receiptPath));
  assert.deepEqual(receipt.plan, plan);
  assert.equal(receipt.private, true);
  assert.equal(receipt.entries['state/claude/marker'].mode, 0o644);
  assert.match(receipt.entries['state/claude/marker'].sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(receipt.skipped, [{ path: 'state/claude/excluded-link', reason: 'symbolic link or special file' }]);

  writeFileSync(join(target, 'state/claude/marker'), 'keep restored contents');
  assert.match(run(restore, { input: archive }).stderr.toString(), /requires a new directory/);
  assert.equal(readFileSync(join(target, 'state/claude/marker'), 'utf8'), 'keep restored contents');
  success(run(deploy(join(cwd, 'offline-restore'), 'restore', '--bundle', '--input', offline)));
  assert.notEqual(run(deploy(join(cwd, 'unchecked'), 'restore', '--input', offline)).status, 0);
});

test('a changed plan or corrupted stream cannot publish a private backup or restore', { timeout: 15000 }, t => {
  const { cwd, state, run, deploy, inspect, setInspect } = fixture(t);
  const preview = deploy(state, 'backup', '--plan', '--provider', 'claude');
  const reviewed = success(run(preview));
  assert.deepEqual(
    JSON.parse(reviewed).sources.map(source => source.destination),
    ['state/claude', 'state/claude.json']
  );
  const capture = deploy(state, 'backup', '--plan-file', '-');
  const archive = success(run(capture, { input: reviewed }));
  const raw = gunzipSync(archive.subarray(magic.length));

  const rewrap = data => Buffer.concat([magic, gzipSync(data)]);
  const changed = Buffer.from(raw);
  const marker = changed.indexOf('selected provider marker');
  assert.ok(marker > 0);
  changed[marker] ^= 1;
  const changedMetadata = Buffer.from(raw.toString().replace('"mode": 420', '"mode": 384'));
  assert.notDeepEqual(changedMetadata, raw);
  const cases = [
    [rewrap(changed), /checksums/],
    [rewrap(changedMetadata), /source permissions/],
    [archive.subarray(0, -6), /end-of-stream|end marker|end-of-file/],
  ];
  for (const [input, error] of cases) {
    const target = join(cwd, 'rejected');
    const restore = run(deploy(target, 'restore', '--bundle'), { input });
    assert.notEqual(restore.status, 0);
    assert.match(restore.stderr.toString(), error);
    assert.equal(existsSync(target), false);
  }
  assert.ok(!readdirSync(cwd).some(name => name.startsWith('.hive-restore-')));

  const exclusion = run(deploy(state, 'backup', '--plan', '--mount', 'bypass=/home/box/.codex'));
  assert.match(exclusion.stderr.toString(), /state or provider scope/);
  assert.match(run(deploy(state, 'backup', '--plan', '--legacy', 'bypass=example:/home/box/.codex')).stderr.toString(), /overlaps a Docker mount/);
  chmodSync(join(state, 'claude'), 0o711);
  const stale = run([...capture, '--output', 'stale.bundle'], { input: reviewed });
  assert.match(stale.stderr.toString(), /differ from the reviewed plan/);
  assert.equal(existsSync(join(cwd, 'stale.bundle')), false);

  setInspect({ ...inspect, state: { ...inspect.state, Status: 'running' } });
  assert.match(run(preview).stderr.toString(), /Stop container/);
});
