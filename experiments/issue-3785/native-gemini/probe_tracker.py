#!/usr/bin/env python3
"""Bounded actual native TrackerService persistence and refusal controls."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from native_process_group import stop_process_group

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('package', type=Path)
parser.add_argument('--diagnostics', type=Path, required=True)
attacks = ('symlink', 'hardlink', 'unsafe-mode', 'malformed', 'invalid-utf8', 'oversized',
           'missing', 'parent-replacement', 'root-replacement', 'task-schema', 'task-schema-submit', 'scope-schema')
scenarios = ('lifetime', 'peer', 'concurrent', 'generations', 'dependencies', 'session-separation',
             'project-separation', 'unnamed-session', 'long-session', 'read-file', 'foreign-file',
             'changed-selector', 'stale-save', 'stale-update', 'dependency-race', 'cycle-race', 'id-collision', 'write-failure', 'invalid-task', 'legacy') + tuple('unsafe-' + attack for attack in attacks)
parser.add_argument('--scenario', choices=scenarios)
args = parser.parse_args()
package = args.package.resolve(strict=True)
assert json.loads((package / 'package.json').read_text())['version'] == '0.65.0'
module = package / 'bundle/chunk-DKZARV6U.js'
manager_pin = hashlib.sha256(module.read_bytes()).hexdigest()
assert manager_pin in ('439a87bb21b7c5f172d959f99629d74637cf847a4ddb9a684dbffa280b7cc68b', '3442803794891386eed95dc0fdf32a41aad77e7212180205e2470d49c4c10413', 'b1b2ad9594865d2b60aee3d1b6cbf1a8d2bb2e7d72946124f9a25bc3c2808608', '9e5df4a69c98a27919561e63ebc5d9338256e399f27c4f5171ff2564cedb9b55', 'a88db8a10a742aa697d71f2e33b9061d2082f6e9b4330b3d9bbefa54fa9616f3', 'ace42576cb7d8f0f2ef710e148cbfb81311929f42f5c3a50851e27cb5e744a07')
assert (package / 'bundle/hive-gemini-history.mjs').read_bytes() == (Path(__file__).parent / 'history.mjs').read_bytes()
if manager_pin in ('9e5df4a69c98a27919561e63ebc5d9338256e399f27c4f5171ff2564cedb9b55', 'a88db8a10a742aa697d71f2e33b9061d2082f6e9b4330b3d9bbefa54fa9616f3', 'ace42576cb7d8f0f2ef710e148cbfb81311929f42f5c3a50851e27cb5e744a07'):
    assert hashlib.sha256((package / 'bundle/hive-gemini-tracker-history.mjs').read_bytes()).hexdigest() == '11e56b631ab984ad8bb7992586a9e6e8b0030fba5e47c1e9b0f2c4fb9497b2c1'
    assert (package / 'bundle/hive-gemini-tracker-transactions.mjs').read_bytes() == (Path(__file__).parent / 'tracker_transactions.mjs').read_bytes()
elif manager_pin != '439a87bb21b7c5f172d959f99629d74637cf847a4ddb9a684dbffa280b7cc68b':
    assert (package / 'bundle/hive-gemini-tracker-history.mjs').read_bytes() == (Path(__file__).parent / 'tracker_history.mjs').read_bytes()
root = Path(tempfile.mkdtemp(prefix='hive-3785-gemini-tracker-'))
root.chmod(0o700)
children = []
safe_cleanup = False
args.diagnostics.parent.mkdir(parents=True, exist_ok=True)
try:
    worker = root / 'worker.mjs'
    worker.write_text(r'''
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
const { Storage, TrackerService, TrackerTaskSchema, Logger, TaskType, TaskStatus } = await import(process.env.NATIVE_MODULE);
const root = process.env.FIXTURE_ROOT;
const scenario = process.argv[2];
const phase = process.argv[3];
const session = scenario === 'unnamed-session' ? undefined : scenario === 'long-session' ? 'S'.repeat(200) : 'SYNTHETIC_SESSION-3785';
const storage = new Storage(path.join(root, 'workspace'), session);
await storage.initialize();
const directory = storage.getProjectTempTrackerDir();
const service = new TrackerService(directory);
const handoff = path.join(root, 'task-handoff.json');
const refusal = /Gemini canonical conversation history is unavailable or unsafe[.]/u;
const data = title => ({ title, description: 'SYNTHETIC native task\nwith multiple lines',
  type: TaskType.TASK, status: TaskStatus.OPEN, dependencies: [] });
function auditFile() {
  const relative = fs.readdirSync(process.env.GEMINI_HISTORY_HOME, { recursive: true }).find(name => name.endsWith('/prompt-history.json'));
  assert.ok(relative, 'Selected tracker tasks must have a canonical audit.');
  return path.join(process.env.GEMINI_HISTORY_HOME, relative);
}
function fingerprint(file) {
  const info = fs.statSync(file);
  const fd = fs.openSync(file, 'r');
  const hash = createHash('sha256');
  const bytes = Buffer.alloc(65536);
  try {
    for (let count; (count = fs.readSync(fd, bytes, 0, bytes.length, null)) !== 0;) hash.update(bytes.subarray(0, count));
  } finally { fs.closeSync(fd); }
  return [info.dev, info.ino, info.mode, info.nlink, info.size, hash.digest('hex')];
}
async function wait(file) {
  const deadline = Date.now() + 10000;
  while (!fs.existsSync(file)) { assert.ok(Date.now() < deadline, 'Finite native tracker barrier exceeded.'); await setTimeout(10); }
}
if (phase.startsWith('writer-')) {
  await service.ensureInitialized();
  fs.writeFileSync(path.join(root, phase + '.ready'), 'ready');
  await wait(path.join(root, 'go'));
  for (let index = 0; index < 10; index++) {
    const task = await service.createTask(data(phase + '-' + index));
    assert.deepEqual(await service.getTask(task.id), task);
  }
  console.log('PASS: actual native tracker ' + phase + ' persisted ten independent tasks.');
  process.exit(0);
}
if (phase === 'verify') {
  const tasks = await service.listTasks();
  assert.equal(tasks.length, 40);
  assert.equal(new Set(tasks.map(task => task.id)).size, 40);
  for (let writer = 0; writer < 4; writer++) for (let index = 0; index < 10; index++) assert.ok(tasks.some(task => task.title === 'writer-' + writer + '-' + index));
  const records = JSON.parse(fs.readFileSync(auditFile(), 'utf8')).filter(entry => entry.type === 'tracker-task');
  assert.equal(records.length, 40);
  assert.equal(new Set(records.map(entry => entry.messageId)).size, 40);
  console.log('PASS: fresh actual native tracker discovers all forty tasks and audit events from four private writers.');
  process.exit(0);
}
if (phase === 'peer' || phase === 'peer-writer') {
  const expected = JSON.parse(fs.readFileSync(handoff, 'utf8'));
  assert.deepEqual(await service.getTask(expected.id), expected,
    'Native tracker tasks must survive private-home disposal.');
  assert.deepEqual(await service.listTasks(), [expected]);
  if (phase === 'peer-writer') {
    const updated = await service.updateTask(expected.id, { title: 'SYNTHETIC-PEER', status: TaskStatus.CLOSED });
    fs.writeFileSync(handoff, JSON.stringify(updated));
    fs.writeFileSync(path.join(root, 'peer.done'), 'done');
  }
  console.log('PASS: fresh actual native tracker discovers the updated task after private-home disposal.');
  process.exit(0);
}
const task = await service.createTask(data('SYNTHETIC 東京 café 🐝'));
const updated = await service.updateTask(task.id, { status: TaskStatus.IN_PROGRESS,
  metadata: { synthetic: true, counter: 2 } });
assert.deepEqual(await service.getTask(task.id), updated);
assert.deepEqual(await service.listTasks(), [updated]);
fs.writeFileSync(handoff, JSON.stringify(updated), { mode: 0o600 });
if (scenario === 'lifetime' || scenario === 'unnamed-session' || scenario === 'long-session' || scenario === 'legacy') {
  if (scenario === 'legacy') {
    assert.deepEqual(fs.readdirSync(path.join(root, 'canonical')), []);
    assert.ok(fs.existsSync(path.join(directory, task.id + '.json')));
  }
  console.log('PASS: healthy actual native tracker creates, updates, lists and reads its task.');
  process.exit(0);
}
if (scenario === 'peer') {
  fs.writeFileSync(path.join(root, 'owner.ready'), 'ready');
  await wait(path.join(root, 'peer.done'));
  const expected = JSON.parse(fs.readFileSync(handoff, 'utf8'));
  assert.deepEqual(await service.getTask(task.id), expected);
  assert.deepEqual(await service.listTasks(), [expected]);
  console.log('PASS: retained native tracker observes an independent private peer on its next read.');
  process.exit(0);
}
if (scenario === 'generations') {
  await service.updateTask(task.id, { status: TaskStatus.CLOSED });
  await service.updateTask(task.id, { status: TaskStatus.OPEN });
  const records = JSON.parse(fs.readFileSync(auditFile(), 'utf8')).filter(entry => entry.type === 'tracker-task');
  assert.deepEqual(records.map(entry => JSON.parse(entry.message).status), [TaskStatus.OPEN, TaskStatus.IN_PROGRESS, TaskStatus.CLOSED, TaskStatus.OPEN]);
  assert.equal((await service.getTask(task.id)).status, TaskStatus.OPEN);
  console.log('PASS: native tracker retains all four create/update/close/reopen audit generations.');
  process.exit(0);
}
if (scenario === 'dependencies') {
  const parent = await service.createTask({ ...data('SYNTHETIC-PARENT'), type: TaskType.EPIC });
  const child = await service.createTask({ ...data('SYNTHETIC-CHILD'), parentId: parent.id, dependencies: [task.id] });
  await assert.rejects(service.updateTask(child.id, { status: TaskStatus.CLOSED }), /Cannot close task/u);
  await service.updateTask(task.id, { status: TaskStatus.CLOSED });
  await service.updateTask(child.id, { status: TaskStatus.CLOSED });
  await service.updateTask(child.id, { dependencies: [] });
  await service.updateTask(task.id, { dependencies: [child.id] });
  const protectedFile = auditFile();
  const original = fingerprint(protectedFile);
  await assert.rejects(service.updateTask(child.id, { dependencies: [task.id] }), /Circular dependency/u);
  await assert.rejects(service.createTask({ ...data('SYNTHETIC-INVALID-PARENT'), parentId: 'absent' }), /Parent task/u);
  assert.deepEqual(fingerprint(protectedFile), original);
  assert.equal((await service.getTask(child.id)).parentId, parent.id);
  console.log('PASS: actual native tracker preserves parent, dependency, closure and cycle behavior without rejected writes.');
  process.exit(0);
}
if (scenario === 'session-separation' || scenario === 'project-separation') {
  const project = path.join(root, scenario === 'project-separation' ? 'workspace-other' : 'workspace');
  fs.mkdirSync(project, { recursive: true, mode: 0o700 });
  const otherStorage = new Storage(project, scenario === 'session-separation' ? 'OTHER_NATIVE_SESSION' : session);
  await otherStorage.initialize();
  const other = new TrackerService(otherStorage.getProjectTempTrackerDir());
  assert.equal(await other.getTask(task.id), null);
  const second = await other.createTask(data('SYNTHETIC-SEPARATE'));
  assert.equal(await service.getTask(second.id), null);
  assert.deepEqual(await service.listTasks(), [updated]);
  const logger = new Logger('SYNTHETIC-LOGGER', storage);
  await logger.initialize();
  assert.deepEqual(await logger.getPreviousUserMessages(), []);
  await logger.logMessage('user', 'SYNTHETIC-PROMPT');
  assert.deepEqual(await logger.getPreviousUserMessages(), ['SYNTHETIC-PROMPT']);
  assert.deepEqual(await service.listTasks(), [updated]);
  console.log('PASS: actual native tracker preserves ' + scenario + ' and native prompt navigation.');
  process.exit(0);
}
if (scenario === 'read-file') {
  assert.deepEqual(await service.readJsonFile(path.join(directory, task.id + '.json'), TrackerTaskSchema), updated);
  console.log('PASS: the actual native JSON reader selects the canonical tracker record.');
  process.exit(0);
}
let protectedFile = auditFile();
if (scenario === 'foreign-file') {
  const outside = path.join(root, 'protected-foreign.json');
  fs.writeFileSync(outside, JSON.stringify(updated));
  const original = fingerprint(outside);
  await assert.rejects(service.readJsonFile(outside, TrackerTaskSchema), refusal);
  assert.deepEqual(fingerprint(outside), original);
  console.log('PASS: native tracker refuses a foreign JSON path without a private fallback.');
  process.exit(0);
}
if (scenario === 'changed-selector') {
  const otherStorage = new Storage(path.join(root, 'workspace'), 'OTHER_NATIVE_SESSION');
  await otherStorage.initialize();
  const other = new TrackerService(otherStorage.getProjectTempTrackerDir());
  await other.ensureInitialized();
  const original = fingerprint(protectedFile);
  service.tasksDir = other.tasksDir;
  service.trackerDir = other.trackerDir;
  await assert.rejects(service.listTasks(), refusal);
  assert.deepEqual(fingerprint(protectedFile), original);
  console.log('PASS: actual native tracker refuses selector changes even to another registered session.');
  process.exit(0);
}
if (scenario === 'stale-save' || scenario === 'stale-update') {
  const other = new TrackerService(directory);
  let original;
  if (scenario === 'stale-save') {
    const stale = await service.getTask(task.id);
    await other.updateTask(task.id, { title: 'SYNTHETIC-FRESH-PEER' });
    original = fingerprint(protectedFile);
    await assert.rejects(service.saveTask({ ...stale, title: 'SYNTHETIC-STALE' }, stale), refusal);
  } else {
    const validate = service.validateCanClose.bind(service);
    service.validateCanClose = async candidate => {
      await validate(candidate);
      await other.updateTask(task.id, { title: 'SYNTHETIC-FRESH-PEER' });
      original = fingerprint(protectedFile);
    };
    await assert.rejects(service.updateTask(task.id, { status: TaskStatus.CLOSED }), refusal);
  }
  assert.deepEqual(fingerprint(protectedFile), original);
  console.log('PASS: actual native tracker refuses ' + scenario + ' after an independent committed generation.');
  process.exit(0);
}
if (scenario === 'id-collision') {
  service.generateId = () => task.id;
  const original = fingerprint(protectedFile);
  await assert.rejects(service.createTask(data('SYNTHETIC-COLLISION')), refusal);
  assert.deepEqual(fingerprint(protectedFile), original);
  console.log('PASS: actual native tracker refuses a generated task-ID collision before publication.');
  process.exit(0);
}
if (scenario === 'dependency-race' || scenario === 'cycle-race') {
  const other = new TrackerService(directory);
  const dependency = await other.createTask(data('SYNTHETIC-DEPENDENCY'));
  let original;
  if (scenario === 'dependency-race') {
    await other.updateTask(dependency.id, { status: TaskStatus.CLOSED });
    await service.updateTask(task.id, { dependencies: [dependency.id] });
    const validate = service.validateCanClose.bind(service);
    service.validateCanClose = async candidate => {
      await validate(candidate);
      await other.updateTask(dependency.id, { status: TaskStatus.OPEN });
      original = fingerprint(protectedFile);
    };
    await assert.rejects(service.updateTask(task.id, { status: TaskStatus.CLOSED }), refusal,
      'Native tracker must refuse a dependency changed after closure validation.');
  } else {
    const validate = service.validateNoCircularDependencies.bind(service);
    service.validateNoCircularDependencies = async candidate => {
      await validate(candidate);
      await other.updateTask(dependency.id, { dependencies: [task.id] });
      original = fingerprint(protectedFile);
    };
    await assert.rejects(service.updateTask(task.id, { dependencies: [dependency.id] }), refusal,
      'Native tracker must refuse a dependency changed after cycle validation.');
  }
  assert.deepEqual(fingerprint(protectedFile), original);
  console.log('PASS: actual native tracker refuses ' + scenario + ' inside the publication transaction.');
  process.exit(0);
}
if (scenario === 'write-failure' || scenario === 'invalid-task') {
  const original = fingerprint(protectedFile);
  if (scenario === 'write-failure') {
    const write = fs.writeFileSync;
    fs.writeFileSync = (...arguments_) => {
      if (typeof arguments_[0] === 'number') throw new Error('SYNTHETIC-TRACKER-IO-FAILURE');
      return write(...arguments_);
    };
    await assert.rejects(service.updateTask(task.id, { title: 'SYNTHETIC-REFUSED' }), refusal);
  } else await assert.rejects(service.saveTask({ ...updated, status: 'SYNTHETIC-INVALID' }), refusal);
  assert.deepEqual(fingerprint(protectedFile), original);
  console.log('PASS: actual native tracker refuses ' + scenario + ' without changing committed audit data.');
  process.exit(0);
}
if (scenario.startsWith('unsafe-')) {
  const attack = scenario.slice(7);
  const target = protectedFile;
  if (['symlink', 'hardlink', 'missing'].includes(attack)) {
    protectedFile = path.join(root, 'protected-tracker-audit');
    fs.renameSync(target, protectedFile);
    if (attack === 'symlink') fs.symlinkSync(protectedFile, target);
    if (attack === 'hardlink') fs.linkSync(protectedFile, target);
  } else if (attack === 'unsafe-mode') fs.chmodSync(target, 0o644);
  else if (attack === 'malformed') fs.writeFileSync(target, '{');
  else if (attack === 'invalid-utf8') fs.writeFileSync(target, Buffer.from([0xff]));
  else if (attack === 'oversized') fs.truncateSync(target, 32 * 1024 * 1024 + 1);
  else if (attack.startsWith('task-schema') || attack === 'scope-schema') {
    const records = JSON.parse(fs.readFileSync(target, 'utf8'));
    const entry = records.find(entry => entry.type === 'tracker-task');
    if (attack === 'scope-schema') entry.sessionId = 'SYNTHETIC-INVALID-SCOPE';
    else entry.message = JSON.stringify({ ...JSON.parse(entry.message), status: 'SYNTHETIC-INVALID' });
    fs.writeFileSync(target, JSON.stringify(records));
  } else if (attack === 'parent-replacement' || attack === 'root-replacement') {
    const parent = attack === 'root-replacement' ? process.env.GEMINI_HISTORY_HOME : path.dirname(target);
    fs.renameSync(parent, parent + '-protected');
    fs.mkdirSync(parent, { mode: 0o700 });
    protectedFile = path.join(parent + '-protected', path.relative(parent, target));
  } else throw new Error('Unknown finite native tracker attack.');
  const original = fingerprint(protectedFile);
  if (attack === 'task-schema-submit') await assert.rejects(service.saveTask({ ...updated, title: 'SYNTHETIC-REFUSED' }), refusal);
  await assert.rejects(service.getTask(task.id), refusal);
  await assert.rejects(service.listTasks(), refusal);
  await assert.rejects(service.saveTask({ ...updated, title: 'SYNTHETIC-REFUSED' }), refusal);
  assert.deepEqual(fingerprint(protectedFile), original);
  console.log('PASS: actual native tracker refuses ' + attack + ' without changing protected evidence.');
  process.exit(0);
}
throw new Error('Unknown finite native tracker scenario.');
''')

    def start(fixture, scenario, phase):
        private = fixture / ('private-' + phase)
        private.mkdir(mode=0o700)
        diagnostic = args.diagnostics.with_name(args.diagnostics.stem + '-' + scenario + '-' + phase + '.log')
        output = diagnostic.open('wb')
        diagnostic.chmod(0o600)
        env = {'PATH': os.environ['PATH'], 'HOME': str(private), 'GEMINI_CLI_HOME': str(private),
               'FIXTURE_ROOT': str(fixture), 'NATIVE_MODULE': module.as_uri(), 'NODE_ENV': 'production'}
        if scenario != 'legacy':
            env['GEMINI_HISTORY_HOME'] = str(fixture / 'canonical')
        child = subprocess.Popen(['prlimit', '--data=2147483648', '--stack=16777216', '--core=0',
                                  '--', shutil.which('node'), '--max-old-space-size=256',
                                  str(worker), scenario, phase], env=env, stdin=subprocess.DEVNULL,
                                 stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
        children.append(child)
        return child, output, diagnostic, time.monotonic() + 25

    def finish(running):
        child, output, diagnostic, deadline = running
        try:
            while child.poll() is None:
                assert time.monotonic() < deadline and os.fstat(output.fileno()).st_size <= 65536
                time.sleep(0.02)
            assert child.returncode == 0, 'Inspect bounded native tracker diagnostics: ' + str(diagnostic)
        finally:
            stop_process_group(child)
            output.close()
        print(diagnostic.read_text().strip())

    for scenario in scenarios:
        if args.scenario and args.scenario != scenario:
            continue
        fixture = root / scenario
        fixture.mkdir(mode=0o700)
        for name in ('canonical', 'workspace'):
            (fixture / name).mkdir(mode=0o700)
        if scenario == 'concurrent':
            writers = [start(fixture, scenario, 'writer-' + str(index)) for index in range(4)]
            deadline = time.monotonic() + 15
            while len(tuple(fixture.glob('writer-*.ready'))) < 4:
                assert time.monotonic() < deadline and all(child.poll() is None for child, *_ in writers)
                time.sleep(0.02)
            (fixture / 'go').write_text('go')
            for writer in writers:
                finish(writer)
            for index in range(4):
                shutil.rmtree(fixture / ('private-writer-' + str(index)))
            finish(start(fixture, scenario, 'verify'))
        elif scenario == 'peer':
            owner = start(fixture, scenario, 'owner')
            deadline = time.monotonic() + 15
            while not (fixture / 'owner.ready').exists():
                assert time.monotonic() < deadline and owner[0].poll() is None
                time.sleep(0.02)
            finish(start(fixture, scenario, 'peer-writer'))
            finish(owner)
        else:
            finish(start(fixture, scenario, 'owner'))
            if scenario in ('lifetime', 'unnamed-session', 'long-session'):
                shutil.rmtree(fixture / 'private-owner')
                finish(start(fixture, scenario, 'peer'))
        if scenario != 'legacy' and manager_pin != '439a87bb21b7c5f172d959f99629d74637cf847a4ddb9a684dbffa280b7cc68b':
            assert not list(fixture.glob('private-*/**/tracker/*.json')), 'Selected native tracker must never write a private task file.'
    safe_cleanup = True
finally:
    try:
        for child in children:
            stop_process_group(child)
    except BaseException:
        safe_cleanup = False
        raise
    finally:
        if safe_cleanup:
            shutil.rmtree(root)
        else:
            print('Synthetic native tracker evidence retained in', root)
