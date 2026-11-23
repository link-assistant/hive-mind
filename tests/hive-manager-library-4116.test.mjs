/**
 * @hive-mind-test-suite default,pr-essential
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { HiveManagerError, collectTaskEvidence, groupTaskFailures, inspectTasks, inspectTaskWindow, previewTaskRecordRepair } from '../src/hive-manager/index.mjs';

const manager = new URL('../src/hive-manager/index.mjs', import.meta.url);
const cli = fileURLToPath(new URL('../src/hive-manager/cli.sh', import.meta.url));
const uuid = '41160000-0000-4000-abcd-000000000001';
const startedAt = '2026-11-20T08:00:00.000Z';
const finishedAt = '2026-11-20T08:15:00.000Z';

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'hive-manager-library-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const env = { ...process.env, HOME: cwd, PATH: `${cwd}:${process.env.PATH}`, START_APP_FOLDER: join(cwd, 'state'), HIVE_MIND_STATE_DIR: join(cwd, 'locks') };
  const run = (command, args, overrides = {}) => {
    const result = spawnSync(command, args, { cwd, env: { ...env, ...overrides }, timeout: 10000, encoding: 'utf8' });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    return result;
  };
  return { cwd, env, run, cli: args => run('bash', [cli, 'tasks', ...args]) };
}

function jsonOutput(result) {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  return JSON.parse(result.stdout);
}

test('task inspection shares report summaries, attempt windows and bounded evidence with the CLI', { timeout: 15000 }, async t => {
  const { cwd, cli } = fixture(t);
  const logPath = join(cwd, 'attempt.log');
  writeFileSync(logPath, 'no rollout found for thread id (private detail)\n');
  const tasks = [{ uuid, status: 'executed', options: { isolated: 'docker' }, startTime: startedAt, endTime: finishedAt, exitCode: 137, logPath }];
  writeFileSync(join(cwd, 'tasks.json'), JSON.stringify({ executions: tasks }));
  writeFileSync(join(cwd, '$'), '#!/bin/bash\nif [[ "$*" == "--list --output-format json" ]]; then cat tasks.json; else exit 91; fi\n', { mode: 0o700 });

  const summary = inspectTasks(tasks);
  assert.deepEqual(summary.counts, { running: 0, paused: 0, succeeded: 0, failed: 1, unknown: 0 });
  assert.deepEqual(jsonOutput(cli(['report'])), summary);
  const grouped = groupTaskFailures(tasks, { limit: 1 });
  assert.equal(grouped.groups[0].backend, 'docker');
  assert.deepEqual(jsonOutput(cli(['report', '--group', '--limit', '1'])), grouped);

  const window = inspectTaskWindow(tasks, { uuid });
  assert.deepEqual(window, { startedAt, finishedAt });
  const cliWindow = cli(['report', '--window', uuid]);
  assert.equal(cliWindow.status, 0, cliWindow.stderr);
  assert.equal(cliWindow.stdout, `${window.startedAt}\t${window.finishedAt}\n`);
  const evidence = await collectTaskEvidence(tasks, { uuid });
  assert.equal(evidence.evidence.signature, 'codex-no-rollout');
  assert.deepEqual(jsonOutput(cli(['report', '--collect', uuid])), JSON.parse(JSON.stringify(evidence)));
  assert.doesNotMatch(JSON.stringify(evidence), /private detail|attempt\.log/);

  await assert.rejects(collectTaskEvidence(tasks, { uuid, attempt: 2 }), { code: 'ATTEMPT_NOT_FOUND' });
  const missing = cli(['report', '--collect', uuid, '--attempt', '2']);
  assert.equal(missing.status, 1);
  assert.equal(missing.stderr, 'hive-manager: No recorded attempt has the selected number.\n');
  assert.throws(() => inspectTaskWindow([], { uuid }), { code: 'TASK_NOT_FOUND' });
  assert.throws(() => inspectTasks(tasks, { limit: 0 }), HiveManagerError);
});

function mockStartCommand(cwd, appFolder) {
  const start = join(cwd, 'start-command');
  const lib = join(start, 'src', 'lib');
  mkdirSync(lib, { recursive: true });
  mkdirSync(join(start, 'src', 'bin'));
  mkdirSync(join(start, 'node_modules', 'lino-objects-codec'), { recursive: true });
  writeFileSync(join(start, 'package.json'), JSON.stringify({ name: 'start-command', version: '0.44.0' }));
  const executable = join(start, 'src', 'bin', 'cli.js');
  writeFileSync(executable, '#!/bin/bash\nexit 92\n', { mode: 0o700 });
  symlinkSync(executable, join(cwd, '$'));
  writeFileSync(join(start, 'node_modules', 'lino-objects-codec', 'index.js'), 'exports.decode = ({ notation }) => JSON.parse(notation);');
  writeFileSync(
    join(lib, 'execution-store.js'),
    `
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');
const DEFAULT_APP_FOLDER = ${JSON.stringify(appFolder)};
class ExecutionRecord {
  constructor(record) { Object.assign(this, record); }
  static fromObject(record) { return new ExecutionRecord(record); }
}
class ExecutionStore {
  constructor({ appFolder }) {
    mkdirSync(appFolder, { recursive: true });
    this.file = join(appFolder, 'executions.lino');
  }
  getAll() {
    writeFileSync(this.file + '.cache', 'decoded');
    return JSON.parse(readFileSync(this.file, 'utf8'));
  }
  get(uuid) { return this.getAll().find(record => record.uuid === uuid); }
  reserveLaunch(updated) { writeFileSync(this.file, JSON.stringify([updated])); }
}
module.exports = { ExecutionStore, ExecutionRecord, DEFAULT_APP_FOLDER, LINO_DB_FILE: 'executions.lino' };
`
  );
  writeFileSync(
    join(lib, 'execution-resume.js'),
    `
exports.buildResumedSessionName = (name, count) => name + '-resume-' + count;
exports.buildSnapshotImageName = (name, count) => 'fixture/' + name + ':' + count;
exports.applyResumeToRecord = (record, plan, id, attempt) => ({ ...record, status: 'executing', attempt, options: { ...record.options, containerId: id } });
`
  );
  writeFileSync(join(lib, 'execution-attempt.js'), 'exports.createAttempt = () => ({ number: 2 }); exports.patchAttempt = () => {};');
  writeFileSync(join(lib, 'docker-cleanup.js'), 'exports.startDetachedDockerCompletionWatcher = () => true; exports.getDockerContainerCleanupPolicy = () => "keep";');
  writeFileSync(join(lib, 'docker-command-handoff.js'), 'exports.buildCommandHandoffArgs = (args, path) => [path, ...args]; exports.commandHandoffPath = name => "/" + name;');
  writeFileSync(join(lib, 'launch-owner.js'), 'exports.hasActiveLaunch = record => Boolean(record.options.launchPending);');
}

test('repair uses the same eligible and ambiguous outcomes in JavaScript and Bash without writing the task store', { timeout: 15000 }, async t => {
  const { cwd, env, run, cli } = fixture(t);
  mockStartCommand(cwd, env.START_APP_FOLDER);
  mkdirSync(env.START_APP_FOLDER);
  const store = join(env.START_APP_FOLDER, 'executions.lino');
  const command = 'fixture command';
  const stored = JSON.stringify([{ uuid, status: 'executed', endTime: finishedAt, command, options: { isolated: 'docker', isolationMode: 'detached', sessionName: 'task' } }]);
  writeFileSync(store, stored);
  const id = 'a'.repeat(64);
  const other = 'b'.repeat(64);
  const container = {
    Id: id,
    Name: '/task-resume-1',
    State: { Running: true, StartedAt: '2026-11-20T08:16:00.000Z' },
    Config: {
      Image: 'fixture/task:1',
      Cmd: ['/task-resume-1', 'sh', '-c', command],
      Labels: { 'start-command.uuid': uuid, 'start-command.root-session': 'task', 'start-command.session': 'task-resume-1', 'start-command.resume-count': '1', 'start-command.snapshot-image': 'fixture/task:1' },
    },
  };
  const inventory = join(cwd, 'containers.json');
  writeFileSync(
    join(cwd, 'docker'),
    `#!/usr/bin/env node
const containers = JSON.parse(require('node:fs').readFileSync(${JSON.stringify(inventory)}));
const args = process.argv.slice(2);
if (args[0] === 'ps' && containers !== null) console.log(Object.keys(containers).join('\\n'));
else if (args[0] === 'inspect' && args[1] in containers) console.log(JSON.stringify([containers[args[1]]]));
else process.exitCode = 93;
`,
    { mode: 0o700 }
  );
  const library = uuids =>
    run(process.execPath, [
      '--input-type=module',
      '--eval',
      `
    import { previewTaskRecordRepair } from ${JSON.stringify(manager.href)};
    try {
      console.log(JSON.stringify(await previewTaskRecordRepair({ uuids: ${JSON.stringify(uuids)}, appFolder: ${JSON.stringify(env.START_APP_FOLDER)} })));
    } catch (error) {
      console.log(JSON.stringify({ code: error.code, message: error.message }));
    }
  `,
    ]);
  const preview = (...uuids) => {
    const expected = jsonOutput(library(uuids));
    assert.deepEqual(jsonOutput(cli(['repair-records', ...uuids])), expected);
    assert.equal(readFileSync(store, 'utf8'), stored);
    assert.deepEqual(readdirSync(env.START_APP_FOLDER), ['executions.lino']);
    return expected;
  };

  writeFileSync(inventory, JSON.stringify({ [id]: container, [other]: { ...container, Id: other } }));
  assert.deepEqual(preview(uuid), { mode: 'preview', outcomes: [{ uuid, state: 'ambiguous' }] });
  writeFileSync(inventory, JSON.stringify({ [id]: { ...container, State: { ...container.State, Paused: true } } }));
  assert.deepEqual(preview(uuid), { mode: 'preview', outcomes: [] });
  writeFileSync(inventory, JSON.stringify({ [id]: container }));
  assert.deepEqual(preview(uuid.toUpperCase()), { mode: 'preview', outcomes: [{ uuid, container: 'task-resume-1', state: 'eligible' }] });
  writeFileSync(join(cwd, 'start-command', 'package.json'), JSON.stringify({ name: 'start-command', version: '0.45.0' }));
  assert.deepEqual(preview(uuid), { mode: 'preview', outcomes: [{ uuid, container: 'task-resume-1', state: 'eligible' }] });
  const applied = jsonOutput(cli(['repair-records', '--apply', uuid]));
  assert.deepEqual(applied, { mode: 'apply', outcomes: [{ uuid, container: 'task-resume-1', state: 'repaired' }] });
  assert.equal(JSON.parse(readFileSync(store, 'utf8'))[0].status, 'executing');

  for (const [record, containers, code] of [
    [stored, 'null', 'DOCKER_INSPECTION_FAILED'],
    [stored, JSON.stringify({ [id]: null }), 'DOCKER_INSPECTION_FAILED'],
    ['bad task data', '{}', 'TASK_RECORDS_UNAVAILABLE'],
  ]) {
    writeFileSync(store, record);
    writeFileSync(inventory, containers);
    const failure = jsonOutput(library([uuid]));
    assert.equal(failure.code, code);
    const result = cli(['repair-records', uuid]);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, `hive-manager: ${failure.message}\n`);
  }
  await assert.rejects(previewTaskRecordRepair({ uuids: ['wrong'] }), { name: 'HiveManagerError', code: 'INVALID_INPUT' });
});
