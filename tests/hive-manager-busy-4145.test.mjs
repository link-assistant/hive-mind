/**
 * @hive-mind-test-suite default,pr-essential
 *
 * Issue #4145: `hive-manager deploy apply|update` must not replace an instance
 * that is running tasks unless the operator passes --force, may wait for the
 * work to finish with --wait, and can skip keeping NAME.rollback.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../src/hive-manager/cli.sh', import.meta.url));
const task = '41450000-0000-4000-a000-000000000001';
const execution = {
  uuid: task,
  status: 'executing',
  startTime: '2026-11-25T10:00:00Z',
  command: 'solve https://github.com/example/project/issues/1',
  options: { isolated: 'docker' },
};
const finished = { ...execution, uuid: '41450000-0000-4000-a000-000000000002', status: 'executed' };

// A Docker CLI double that keeps containers in a JSON file. `exec` runs the
// real task check with node: a fake start-command `$` answers each listing from
// `listings` (one entry per call, the last entry repeats) and the check reads
// a fake /proc directory instead of the host's.
const fakeDocker = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
const state = JSON.parse(fs.readFileSync('docker.json', 'utf8'));
fs.appendFileSync('docker.log', args.slice(0, 2).join(' ') + '\\n');
const save = () => fs.writeFileSync('docker.json', JSON.stringify(state));
const find = key => state.containers.find(c => c.id === key || c.name === key);
const last = args.at(-1);
const [command, sub] = args;
if (command === 'container' && sub === 'inspect') {
  const format = args[args.indexOf('--format') + 1];
  const c = find(last);
  if (!c) process.exit(1);
  if (format === '{{.Id}}') console.log(c.id);
  else if (format === '{{.State.Running}}') console.log(String(c.running));
  else if (format === '{{.Image}}') console.log(c.image);
  else if (format.includes('hive-manager.instance')) console.log(c.owner);
  else if (format.includes('.State.Health')) console.log(c.running ? 'running' : 'exited');
  else console.log('');
} else if (command === 'image' && sub === 'inspect') console.log('sha256:new');
else if (command === 'image' && sub === 'rm') {
  if (state.containers.some(c => c.image === last)) process.exit(1);
  state.removedImages.push(last);
  save();
} else if (command === 'pull' || command === 'run') {
} else if (command === 'create') {
  const name = args[args.indexOf('--name') + 1];
  const c = { id: 'id-' + state.containers.length + '-' + name, name, running: false, owner: 'hive-mind', image: 'sha256:new' };
  state.containers.push(c);
  save();
  console.log(c.id);
} else if (command === 'stop' || command === 'start') {
  find(last).running = command === 'start';
  save();
} else if (command === 'rename') {
  find(args[1]).name = args[2];
  save();
} else if (command === 'rm') {
  state.containers = state.containers.filter(c => c !== find(last));
  save();
} else if (command === 'exec') {
  if (fs.existsSync('exec-fails')) process.exit(126);
  const node = args.indexOf('node');
  const script = args[node + 2].replaceAll('/proc', path.resolve('proc'));
  const result = spawnSync(process.execPath, ['-e', script], {
    env: { ...process.env, PATH: path.resolve('bin') + ':' + process.env.PATH },
    stdio: 'inherit',
  });
  process.exit(result.status ?? 1);
} else process.exit(88);
`;

// start-command's `$ --list --output-format json`, answered from `listings`.
const fakeStart = `#!${process.execPath}
const fs = require('node:fs');
const calls = Number(fs.existsSync('list-calls') ? fs.readFileSync('list-calls', 'utf8') : 0);
fs.writeFileSync('list-calls', String(calls + 1));
const listings = JSON.parse(fs.readFileSync('listings', 'utf8'));
const executions = listings[Math.min(calls, listings.length - 1)];
console.log(JSON.stringify({ count: executions.length, executions }));
`;

function fixture(t, { listings = [[]], processes = {}, rollback = false } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'hive-manager-4145-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  mkdirSync(join(cwd, 'runtime'), { mode: 0o700 });
  mkdirSync(join(cwd, 'bin'));
  writeFileSync(join(cwd, 'docker'), fakeDocker, { mode: 0o700 });
  writeFileSync(join(cwd, 'bin', '$'), fakeStart, { mode: 0o700 });
  mkdirSync(join(cwd, 'proc'));
  for (const [pid, argv] of Object.entries({ 1: ['tini', '--', 'node', '/home/box/.bun/bin/hive-telegram-bot'], ...processes })) {
    mkdirSync(join(cwd, 'proc', pid));
    writeFileSync(join(cwd, 'proc', pid, 'cmdline'), argv.join('\0') + '\0');
  }
  const containers = [{ id: 'id-old', name: 'hive-mind', running: true, owner: 'hive-mind', image: 'sha256:old' }];
  if (rollback) containers.push({ id: 'id-prior', name: 'hive-mind.rollback', running: false, owner: 'hive-mind', image: 'sha256:prior' });
  writeFileSync(join(cwd, 'docker.json'), JSON.stringify({ containers, removedImages: [] }));
  writeFileSync(join(cwd, 'listings'), JSON.stringify(listings));
  const run = (args, timeout = 20000) =>
    spawnSync('bash', [script, 'deploy', '--state-dir', join(cwd, 'state'), '--setup', ...args], {
      cwd,
      env: { ...process.env, PATH: `${cwd}:${process.env.PATH}`, XDG_RUNTIME_DIR: join(cwd, 'runtime') },
      encoding: 'utf8',
      timeout,
    });
  const docker = () => JSON.parse(readFileSync(join(cwd, 'docker.json'), 'utf8'));
  const calls = () => readFileSync(join(cwd, 'docker.log'), 'utf8');
  const names = () =>
    docker()
      .containers.map(c => `${c.name}=${c.id}:${c.running ? 'running' : 'stopped'}`)
      .sort();
  return { cwd, run, docker, calls, names };
}

test('apply refuses to replace an instance that runs tracked tasks and prints them', t => {
  const { run, calls, names } = fixture(t, { listings: [[execution, finished]] });
  const result = run(['apply']);
  assert.equal(result.status, 75, result.stderr);
  assert.match(result.stderr, /hive-mind is running tasks:\n {2}task 41450000-0000-4000-a000-000000000001 running \(docker\)/);
  assert.match(result.stderr, /--wait SECONDS, or pass --force/);
  assert.doesNotMatch(result.stderr, /000000000002/, 'finished executions are not listed');
  assert.doesNotMatch(result.stdout, /Deployed/);
  // Refused before downloading or creating anything; the old bot keeps running.
  assert.doesNotMatch(calls(), /^(pull|create|stop|rename)/m);
  assert.deepEqual(names(), ['hive-mind=id-old:running']);
});

test('update also refuses while a task runs without isolation inside the bot', t => {
  const processes = {
    202: ['node', '/home/box/.bun/bin/solve', 'https://github.com/example/project/issues/2'],
    303: ['SCREEN', '-dmS', 'solve-example', 'bash', '-c', 'solve https://github.com/example/project/issues/3; exec bash'],
  };
  const { run, names } = fixture(t, { processes });
  const result = run(['update']);
  assert.equal(result.status, 75, result.stderr);
  assert.match(result.stderr, /process 202: node \/home\/box\/.bun\/bin\/solve https:\/\/github.com\/example\/project\/issues\/2/);
  assert.doesNotMatch(result.stderr, /process (1|303)\b/);
  assert.deepEqual(names(), ['hive-mind=id-old:running']);
});

test('apply refuses when it cannot tell whether tasks run', t => {
  const { cwd, run, names } = fixture(t);
  writeFileSync(join(cwd, 'exec-fails'), '');
  const result = run(['apply']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Could not check hive-mind for running tasks. Pass --force/);
  assert.deepEqual(names(), ['hive-mind=id-old:running']);
});

test('--force replaces a busy instance, reports the interrupted work and keeps a rollback', t => {
  const { run, names } = fixture(t, { listings: [[execution, finished]] });
  const result = run(['--force', 'apply']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /replacing hive-mind while it runs tasks \(--force\):\n {2}task 41450000/);
  assert.match(result.stdout, /Deployed hive-mind/);
  assert.deepEqual(names(), ['hive-mind.rollback=id-old:stopped', 'hive-mind=id-1-hive-mind.candidate:running']);
});

test('--wait replaces the instance once its tasks finish', t => {
  const { run, names } = fixture(t, { listings: [[execution], []] });
  const result = run(['--wait', '5', 'apply']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /waiting up to \d+ seconds for tasks in hive-mind to finish:\n {2}task 41450000/);
  assert.match(result.stdout, /Deployed hive-mind/);
  assert.deepEqual(names(), ['hive-mind.rollback=id-old:stopped', 'hive-mind=id-1-hive-mind.candidate:running']);
});

test('--wait gives up with exit 75 when tasks keep running', t => {
  const { run, calls, names } = fixture(t, { listings: [[execution, finished]] });
  const result = run(['--wait', '1', 'apply']);
  assert.equal(result.status, 75, result.stderr);
  assert.match(result.stderr, /tasks still running after 1 seconds/);
  assert.doesNotMatch(calls(), /^(create|stop|rename)/m);
  assert.deepEqual(names(), ['hive-mind=id-old:running']);
});

test('an idle instance is replaced and --no-rollback reclaims the old containers and unused images', t => {
  const { run, names, docker } = fixture(t, { rollback: true });
  const result = run(['--no-rollback', 'apply']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Removed replaced container id-prior\nRemoved unused image sha256:prior\n/);
  assert.match(result.stdout, /Removed replaced container id-old\nRemoved unused image sha256:old\nDeployed hive-mind/);
  assert.deepEqual(names(), ['hive-mind=id-2-hive-mind.candidate:running']);
  assert.deepEqual(docker().removedImages, ['sha256:prior', 'sha256:old']);
});

test('an idle instance keeps one rollback by default', t => {
  const { run, names } = fixture(t, { rollback: true });
  const result = run(['apply']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(names(), ['hive-mind.rollback=id-old:stopped', 'hive-mind=id-2-hive-mind.candidate:running']);
});

test('task and rollback options are validated and shown in the dry run, including the profile setting', t => {
  const { cwd, run } = fixture(t);
  assert.match(run(['--force', 'status']).stderr, /--force is available for deploy apply and update/);
  assert.match(run(['--no-rollback', 'rollback']).stderr, /--no-rollback is available for deploy apply and update/);
  assert.match(run(['--force', '--wait', '5', 'apply']).stderr, /Choose --force or --wait/);
  assert.match(run(['--wait', 'soon', 'apply']).stderr, /--wait requires a number of seconds/);
  writeFileSync(join(cwd, 'profile'), 'keep-rollback=false\n');
  const preview = run(['--profile', 'profile', '--wait', '600', '--dry-run', 'apply']);
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /Running tasks: wait up to 600 seconds, then refuse\nRollback: remove the replaced container\n$/);
  assert.match(run(['--profile', 'profile', '--keep-rollback', '--dry-run', 'apply']).stdout, /Running tasks: refuse\nRollback: keep hive-mind.rollback\n$/);
  // A profile setting does not restrict other actions.
  assert.doesNotMatch(run(['--profile', 'profile', 'status']).stderr, /available for deploy apply/);
});
