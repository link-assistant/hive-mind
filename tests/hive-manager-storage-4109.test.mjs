/**
 * @hive-mind-test-suite default,pr-essential
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http2';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readCleanupStatus, scopedCleanup } from '../src/hive-manager/storage/cleanup.mjs';
import { snapshotUpper } from '../src/hive-manager/storage/lib/containerd.mjs';
import { openTree, planFiles, removeApproved } from '../src/hive-manager/storage/lib/files.mjs';
import { MemoryPressure, memoryGuard, output, run } from '../src/hive-manager/storage/lib/process.mjs';
import { cleanupPreserved, preserveLayer } from '../src/hive-manager/storage/preserve.mjs';
import { diskReport } from '../src/hive-manager/storage/report.mjs';

const linux = process.platform === 'linux';
const uuid = '41090000-0000-4000-a000-000000000001';
const id = 'b'.repeat(64);
const pausedId = 'c'.repeat(64);
const stoppedId = 'd'.repeat(64);
const command = 'solve https://github.com/link-assistant/hive-mind/issues/4109';
const cli = fileURLToPath(new URL('../src/hive-manager/cli.sh', import.meta.url));

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'hive-storage-test-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const root = join(cwd, 'docker-root');
  const upper = join(root, 'upper');
  const state = join(cwd, 'state');
  const log = join(root, 'task.log');
  const mount = join(cwd, 'mounted');
  for (const dir of [upper, state, mount]) mkdirSync(dir, { recursive: true });
  writeFileSync(log, 'daemon log');
  const row = (id, name, status) => ({
    id,
    name: `/${name}`,
    image: 'sha256:test',
    execution: '',
    executionEnv: [],
    session: '',
    state: { Status: status, Pid: status === 'exited' ? 0 : process.pid, Running: status !== 'exited', Paused: status === 'paused', ExitCode: status === 'exited' ? 27 : 0, StartedAt: 'now', FinishedAt: 'later' },
    driver: 'overlay2',
    graph: { UpperDir: upper },
    mounts: [],
    logPath: log,
    logDriver: 'json-file',
  });
  return { cwd, root, upper, state, log, mount, row };
}

test('deploy disk and cleanup expose the bounded report and scoped preview through the CLI', () => {
  for (const [args, pattern] of [
    [['deploy', 'disk', '--help'], /bounded, read-only/],
    [['deploy', 'cleanup', '--help'], /cleanup --scoped/],
    [['deploy', 'cleanup', '--scoped', '--help'], /--status/],
    [['deploy', 'tasks', 'preserve-layer', '--help'], /writable layer/],
    [['tasks', 'backup-container', '--help'], /flattened filesystem/],
  ]) {
    const result = spawnSync('bash', [cli, ...args], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, pattern);
  }
});

test('reads writable snapshot metadata without activating a containerd mount', { skip: !linux, timeout: 5000 }, async t => {
  const { cwd } = fixture(t);
  const socket = join(cwd, 'containerd.sock');
  const field = (number, value) => Buffer.concat([Buffer.from([(number << 3) | 2, value.length]), Buffer.from(value)]);
  const mount = Buffer.concat([field(1, 'overlay'), field(4, 'lowerdir=/image'), field(4, 'upperdir=/var/lib/containerd/task fs'), field(4, 'workdir=/work')]);
  const response = field(1, mount);
  const frame = Buffer.alloc(5);
  frame.writeUInt32BE(response.length, 1);
  const server = createServer();
  t.after(() => server.close());
  const seen = [];
  server.on('stream', async (stream, headers) => {
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    seen.push({ headers, request: Buffer.concat(chunks).subarray(5) });
    stream.respond({ 'content-type': 'application/grpc' }, { waitForTrailers: true });
    stream.once('wantTrailers', () => stream.sendTrailers({ 'grpc-status': '0' }));
    stream.end(Buffer.concat([frame, response]));
  });
  server.listen(socket);
  await once(server, 'listening');
  assert.equal(await snapshotUpper(socket, id), '/var/lib/containerd/task fs');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].headers[':path'], '/containerd.services.snapshots.v1.Snapshots/Mounts');
  assert.equal(seen[0].headers['containerd-namespace'], 'moby');
  assert.deepEqual(seen[0].request, Buffer.concat([field(1, 'overlayfs'), field(2, id)]));
});

test('reports running, paused and stopped layers and reads historical execution records without mutating the store', { skip: !linux }, async t => {
  const { root, upper, mount, row, log, state } = fixture(t);
  writeFileSync(join(upper, 'writable'), 'written above the image');
  const rows = {
    [id]: { ...row(id, 'running', 'running'), executionEnv: [`START_EXECUTION_ID=${uuid}`, 'START_SESSION_NAME=running'] },
    [pausedId]: { ...row(pausedId, 'paused', 'paused'), execution: uuid, mounts: [{ Source: mount, Destination: '/data' }] },
    [stoppedId]: { ...row(stoppedId, 'failed', 'exited'), graph: {}, driver: 'unmeasurable', logPath: join(root, 'missing') },
  };
  const tasks = [{ uuid, command, options: { isolated: 'docker', containerId: id }, attemptHistory: [{ containerId: stoppedId }] }];
  const store = join(state, 'executions.lino');
  const notation = `fixture\n${JSON.stringify(tasks)}`;
  writeFileSync(store, notation);
  chmodSync(store, 0o400);
  const bin = join(state, 'bin with spaces');
  const install = join(state, 'start-command');
  const codec = join(install, 'node_modules', 'lino-objects-codec');
  mkdirSync(bin);
  mkdirSync(codec, { recursive: true });
  writeFileSync(join(install, 'cli.mjs'), 'throw new Error("The CLI must not run");', { mode: 0o700 });
  symlinkSync(join(install, 'cli.mjs'), join(bin, '$'));
  writeFileSync(join(codec, 'index.js'), 'exports.decode = ({ notation }) => JSON.parse(notation.slice(8));');
  const docker = async (args, options) => {
    assert.ok(!args.some(arg => ['--size', 'diff', 'system', '--list', '--status'].includes(arg)), args);
    switch (args.slice(0, 2).join(' ')) {
      case 'info --format':
        return root;
      case 'container ls':
        return Object.keys(rows).join('\n');
      case 'container inspect':
        return args
          .slice(args.indexOf('--') + 1)
          .map(id => JSON.stringify(rows[id]))
          .join('\n');
      case 'exec --user':
        assert.equal(args[4], 'node');
        return output('env', [`PATH=${bin}:${process.env.PATH}`, `START_APP_FOLDER=${state}`, ...args.slice(4)], options);
      case 'image ls':
        return '{"ID":"sha256:test","Repository":"test","Tag":"fixture","Size":"8MB"}';
      case 'volume ls':
        return 'fixture';
      case 'volume inspect':
        return JSON.stringify({ Driver: 'local', Mountpoint: mount });
      default:
        assert.fail(args.join(' '));
    }
  };
  const report = await diskReport(docker, 'hive-mind', 1);
  assert.deepEqual(
    report.containers.map(({ state, execution, target, recordMatched }) => [state, execution, target, recordMatched]),
    [
      ['running', uuid, command.slice(6), true],
      ['paused', uuid, command.slice(6), true],
      ['exited', uuid, command.slice(6), true],
    ]
  );
  assert.ok(report.containers[1].writableBytes > 0);
  assert.equal(report.containers[0].logBytes, statSync(log).blocks * 512);
  assert.equal(report.containers[2].writableBytes, null);
  assert.equal(report.complete, false);
  assert.ok(report.issues.some(issue => issue.startsWith('failed writable layer:')));
  assert.deepEqual(report.images[0].tags, ['test:fixture']);
  assert.ok(report.volumes[0].bytes >= 0);
  assert.equal(readFileSync(store, 'utf8'), notation);
  assert.deepEqual(readdirSync(state).sort(), ['bin with spaces', 'executions.lino', 'start-command']);
});

test('scoped preview skips paused and stopped tasks and protects host bind sources', { skip: !linux }, async t => {
  const { cwd, root, row, state, mount } = fixture(t);
  const hidden = join(mount, 'untouched');
  const eligible = join(cwd, 'cache');
  writeFileSync(hidden, 'protected by paused task');
  writeFileSync(eligible, 'remove after approval only');
  const rows = {
    [pausedId]: { ...row(pausedId, 'paused', 'paused'), mounts: [{ Source: mount, Destination: '/data' }] },
    [stoppedId]: row(stoppedId, 'failed', 'exited'),
  };
  const docker = async args => {
    switch (args.slice(0, 2).join(' ')) {
      case 'info --format':
        return root;
      case 'container ls':
        return Object.keys(rows).join('\n');
      case 'container inspect':
        return args
          .slice(args.indexOf('--') + 1)
          .map(id => JSON.stringify(rows[id]))
          .join('\n');
      default:
        assert.fail(args.join(' '));
    }
  };
  const reports = [];
  const scan = async (excludes, _docker, container) => {
    assert.equal(container, undefined);
    assert.ok(excludes.includes(mount));
    assert.ok(excludes.includes(root));
    return [eligible, hidden, join(root, 'task.log')];
  };
  const options = { docker, directory: state, stateDir: state, check() {}, scan, progress: report => reports.push(report) };
  const approved = await scopedCleanup(options);
  assert.deepEqual(
    approved.plans[0].files.map(({ path }) => path),
    [eligible]
  );
  assert.deepEqual(
    reports.slice(1).map(({ skipped }) => skipped),
    ['container state is paused', 'container state is exited']
  );
  assert.equal(readFileSync(eligible, 'utf8'), 'remove after approval only');
  await scopedCleanup({ ...options, approved });
  assert.equal(existsSync(eligible), false);
  assert.equal(readFileSync(hidden, 'utf8'), 'protected by paused task');
  assert.equal(existsSync(join(root, 'task.log')), true);
});

test('layer cleaning unlinks only approved, unchanged files proven in the writable layer', { skip: !linux }, t => {
  const { cwd, upper } = fixture(t);
  const root = join(cwd, 'merged');
  for (const base of [root, upper]) {
    mkdirSync(join(base, 'cache'), { recursive: true });
    for (const name of ['eligible', 'active', 'changed']) {
      const file = join(base, 'cache', name);
      writeFileSync(file, 'cache data');
      utimesSync(file, 86400, 86400);
    }
  }
  writeFileSync(join(root, 'cache', 'image-only'), 'discarding this would create a whiteout');
  symlinkSync(join(root, 'cache', 'active'), join(upper, 'cache', 'link'));
  const view = openTree(root);
  const layer = openTree(upper);
  t.after(() => {
    view.close();
    layer.close();
  });
  const approved = planFiles(view, layer, ['/cache'], [], () => {});
  assert.deepEqual(approved.map(file => file.path).sort(), ['/cache/active', '/cache/changed', '/cache/eligible']);
  const fresh = planFiles(view, layer, ['/cache/eligible', '/cache/changed'], [], () => {});
  writeFileSync(join(root, 'cache', 'changed'), 'changed after preview');
  assert.equal(
    removeApproved(
      view,
      layer,
      approved.find(file => file.path === '/cache/changed'),
      fresh[1],
      () => {}
    ),
    false
  );
  assert.equal(
    removeApproved(
      view,
      layer,
      approved.find(file => file.path === '/cache/eligible'),
      fresh[0],
      () => {}
    ),
    true
  );
  assert.equal(existsSync(join(root, 'cache', 'image-only')), true);
  assert.equal(existsSync(join(root, 'cache', 'active')), true);
  assert.equal(existsSync(join(root, 'cache', 'eligible')), false);
  assert.equal(existsSync(join(root, 'cache')), true);
});

test('memory pressure stops a running scan process group and blocks subsequent work', { skip: !linux, timeout: 5000 }, async t => {
  const { cwd } = fixture(t);
  const marker = join(cwd, 'should-not-exist');
  let checks = 0;
  await assert.rejects(
    run('bash', ['-c', 'sleep 2 && touch "$1" & wait', 'test', marker], {
      ms: 4000,
      check() {
        if (++checks > 1) throw new MemoryPressure('synthetic daemon pressure');
      },
    }),
    /synthetic daemon pressure/
  );
  assert.equal(existsSync(marker), false);
  const { root, state } = fixture(t);
  const calls = [];
  await assert.rejects(
    scopedCleanup({
      docker: async args => {
        calls.push(args.join(' '));
        return args[0] === 'info' ? root : '';
      },
      directory: state,
      stateDir: state,
      check() {},
      scan: async () => {
        throw new MemoryPressure('stop the entire job');
      },
      progress: () => assert.fail('no scope may complete after memory pressure'),
    }),
    /stop the entire job/
  );
  assert.deepEqual(calls, ['info --format {{.DockerRootDir}}', 'container ls -aq --no-trunc']);
});

test('the memory guard accepts the cgroup root without a limit and checks bounded ancestors', async () => {
  const files = new Map([
    ['/proc/meminfo', 'MemAvailable: 5000000 kB\n'],
    ['/proc/self/cgroup', '0::/system.slice/worker.service\n'],
    ['/proc/123/cgroup', '0::/system.slice/docker.service\n'],
    ['/proc/123/status', 'Name:\tdockerd\nVmRSS:\t243000 kB\n'],
    ['/sys/fs/cgroup/cgroup.controllers', 'memory cpu\n'],
    ['/sys/fs/cgroup/system.slice/cgroup.controllers', 'memory cpu\n'],
    ['/sys/fs/cgroup/system.slice/worker.service/cgroup.controllers', 'cpu\n'],
    ['/sys/fs/cgroup/system.slice/docker.service/memory.max', 'max\n'],
  ]);
  const read = path => {
    if (!files.has(path)) throw Object.assign(new Error(path), { code: 'ENOENT' });
    return files.get(path);
  };
  assert.doesNotThrow(await memoryGuard({ read, dockerPids: ['123'] }));
  files.set('/sys/fs/cgroup/system.slice/memory.max', '1073741824\n');
  files.set('/sys/fs/cgroup/system.slice/memory.current', '1000000000\n');
  const check = await memoryGuard({ read, dockerPids: ['123'] });
  assert.throws(check, /cgroup has less than 256 MiB/);
  assert.throws(check, MemoryPressure);
});

test('a disconnected launcher leaves one observable worker, and a stale running record is detected', { skip: !linux, timeout: 10_000 }, async t => {
  const { cwd } = fixture(t);
  const module = new URL('../src/hive-manager/storage/cleanup.mjs', import.meta.url).href;
  const worker = `
    import { renameSync, writeFileSync } from 'node:fs';
    import { setTimeout as delay } from 'node:timers/promises';
    const [directory] = process.argv.slice(1);
    const update = status => {
      writeFileSync(directory + '/next', JSON.stringify({ id: 'fixture', status }));
      renameSync(directory + '/next', directory + '/status.json');
    };
    update('running');
    await delay(2500);
    update('completed');
  `;
  const launcher = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { launchLocked } from ${JSON.stringify(module)};
    await launchLocked(process.argv[1], 'fixture', [process.execPath, '--input-type=module', '-e', ${JSON.stringify(worker)}, process.argv[1]]);
    console.log('ready');
    setInterval(() => {}, 1000);`,
      cwd,
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] }
  );
  const ended = once(launcher, 'exit');
  t.after(() => launcher.kill('SIGKILL'));
  assert.match(String((await once(launcher.stdout, 'data'))[0]), /ready/);
  launcher.kill('SIGKILL');
  await ended;
  assert.equal((await readCleanupStatus(cwd)).status, 'running');
  const competitor = await run('flock', ['-n', '-E', '75', join(cwd, 'lock'), 'true']);
  assert.equal(competitor.code, 75);
  assert.equal((await run('flock', ['-w', '5', join(cwd, 'lock'), 'true'], { ms: 6_000 })).code, 0);
  assert.equal((await readCleanupStatus(cwd)).status, 'completed');
  writeFileSync(join(cwd, 'status.json'), '{"id":"interrupted","status":"running"}');
  assert.equal((await readCleanupStatus(cwd)).status, 'interrupted');
});

test('stopped-layer receipt verifies ownership, execution and logs before exact container removal', { skip: !linux, timeout: 10_000 }, async t => {
  const { cwd, root, upper, mount, row, state } = fixture(t);
  const layerPath = join(upper, 'evidence');
  const taskLog = join(mount, 'task.log');
  writeFileSync(layerPath, 'writable bytes', { mode: 0o640 });
  chmodSync(layerPath, 0o640);
  writeFileSync(taskLog, 'start-command log');
  const stopped = { ...row(stoppedId, 'failed', 'exited'), execution: uuid, mounts: [{ Source: mount, Destination: '/mounted' }] };
  const record = { uuid, command, status: 'executed', exitCode: 27, logPath: '/persistent/task.log', options: { isolated: 'docker', containerId: stoppedId, sessionName: 'failed' } };
  writeFileSync(join(state, 'executions.lino'), JSON.stringify([record]));
  let removed = false;
  const docker = async (args, options) => {
    switch (args.slice(0, 2).join(' ')) {
      case 'container inspect':
        return JSON.stringify(args.at(-1) === 'bot' ? { ...row(id, 'bot', 'running'), mounts: [{ Source: mount, Destination: '/persistent' }] } : stopped);
      case 'info --format':
        return root;
      case 'exec --user':
        return output('env', [`START_APP_FOLDER=${state}`, ...args.slice(4)], options);
      case 'logs --timestamps':
        writeFileSync(options.stdio[1], 'Docker stdout');
        writeFileSync(options.stdio[2], 'Docker stderr');
        return '';
      case 'container rm':
        assert.deepEqual(args, ['container', 'rm', '--', stoppedId]);
        removed = true;
        return '';
      default:
        assert.fail(args.join(' '));
    }
  };
  const evidence = join(cwd, 'receipt');
  await preserveLayer(docker, 'bot', stoppedId, evidence);
  assert.equal(readFileSync(join(evidence, 'task.log'), 'utf8'), 'start-command log');
  assert.equal(readFileSync(join(evidence, 'docker.stderr.log'), 'utf8'), 'Docker stderr');
  assert.deepEqual(JSON.parse(readFileSync(join(evidence, 'execution.json'), 'utf8')), record);
  const listing = await run('tar', ['--numeric-owner', '-tvzf', join(evidence, 'layer.tar.gz')]);
  assert.equal(listing.code, 0);
  assert.match(listing.stdout, new RegExp(`-rw-r-----\\s+${process.getuid()}/${process.getgid()}.*\\./evidence`));
  assert.doesNotMatch(listing.stdout, /task\.log/);
  const checked = await cleanupPreserved(docker, evidence);
  assert.equal(removed, false);
  writeFileSync(join(evidence, 'task.log'), 'different data');
  await assert.rejects(cleanupPreserved(docker, evidence, checked.approval), /failed verification: task.log/);
  writeFileSync(join(evidence, 'task.log'), 'start-command log');
  stopped.state.Paused = true;
  await assert.rejects(cleanupPreserved(docker, evidence, checked.approval), /requires a stopped task/);
  stopped.state.Paused = false;
  assert.equal((await cleanupPreserved(docker, evidence, checked.approval)).mode, 'removed');
  assert.equal(removed, true);
});
