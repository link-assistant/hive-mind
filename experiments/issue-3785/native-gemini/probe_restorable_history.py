#!/usr/bin/env python3
"""Bounded actual native restore metadata writers, readers and restore actions."""
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
           'missing', 'parent-replacement', 'root-replacement', 'envelope', 'name',
           'content', 'schema', 'history-schema', 'foreign-session', 'unknown-commit', 'foreign-head')
scenarios = ('lifetime', 'generations', 'peer', 'concurrent', 'project-separation',
             'foreign-restore', 'missing-git', 'changed-storage', 'changed-selector') + tuple('unsafe-' + attack for attack in attacks)
parser.add_argument('--scenario', choices=scenarios)
args = parser.parse_args()
package = args.package.resolve(strict=True)
assert json.loads((package / 'package.json').read_text())['version'] == '0.65.0'
module = package / 'bundle/chunk-DKZARV6U.js'
assert hashlib.sha256(module.read_bytes()).hexdigest() in (
    '901d8eb78bafdb235420b6aa931afdadab3efc5574d53a49224739730fa0ecc4',
    'ace42576cb7d8f0f2ef710e148cbfb81311929f42f5c3a50851e27cb5e744a07',
    '91ce4040ae4296cfa2b82238f2b9a2291bbbf86086a85c1c9b341d08272eae28', '80152a26cf924992ac283a92e1b9b2252326cf6a417edc1c4b147088ca154733',
    '13f2fce9a55408b50001683d440f791a1d21cdcc3c22799f8832edad4a1ef769')
helper = package / 'bundle/hive-gemini-restorable-history.mjs'
assert helper.read_bytes() == (Path(__file__).parent / 'restorable_history.mjs').read_bytes()
suite_root = Path(tempfile.mkdtemp(prefix='hive-3785-gemini-restorable-'))
suite_root.chmod(0o700)
children = []
safe_cleanup = False
args.diagnostics.parent.mkdir(parents=True, exist_ok=True)
try:
    worker = suite_root / 'worker.mjs'
    worker.write_text(r'''
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
const { Storage, GitService, processRestorableToolCalls, getToolCallDataSchema, performRestore } = await import(process.env.NATIVE_MODULE);
const { readNativeGeminiRestorableHistory, saveNativeGeminiRestorableHistory } = await import(process.env.NATIVE_HELPER);
const root = process.env.FIXTURE_ROOT;
const scenario = process.env.NATIVE_SCENARIO;
const phase = process.argv[2];
const workspace = path.join(root, 'workspace');
const file = path.join(workspace, 'synthetic.txt');
const schema = getToolCallDataSchema();
const refusal = /Gemini canonical conversation history is unavailable or unsafe[.]/u;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const before = 'SYNTHETIC BEFORE 東京\n';
const after = 'SYNTHETIC AFTER café\n';
const storage = new Storage(workspace, 'SYNTHETIC_RESTORABLE_SESSION');
const service = new GitService(workspace, storage);
await service.initialize();
const project = digest(workspace);
const journal = path.join(root, 'canonical/projects', project, 'message-history/prompt-history.json');
const records = () => JSON.parse(fs.readFileSync(journal, 'utf8'));
const read = () => readNativeGeminiRestorableHistory(storage, schema);
const fingerprint = directory => fs.readdirSync(directory).sort().flatMap(name => {
  const file = path.join(directory, name);
  const info = fs.lstatSync(file, { bigint: true });
  return info.isDirectory() ? fingerprint(file) : [[file, String(info.dev), String(info.ino),
    String(info.mode), String(info.nlink), String(info.size),
    info.isFile() && info.size < 33554432n ? digest(fs.readFileSync(file)) : info.isSymbolicLink() ? fs.readlinkSync(file) : null]];
});
async function wait(file) {
  const deadline = Date.now() + 10000;
  while (!fs.existsSync(file)) {
    assert.ok(Date.now() < deadline, 'Finite native restorable barrier exceeded.');
    await setTimeout(10);
  }
}
async function save(label, target = file) {
  const request = { callId: 'synthetic-' + label, prompt_id: 'synthetic-prompt-' + label,
    name: 'write_file', args: { file_path: target, content: after } };
  const history = [{ type: 'user', id: 123, text: 'SYNTHETIC ' + label + ' 東京' }];
  const clientHistory = [{ role: 'user', parts: [{ text: 'SYNTHETIC ' + label + ' café' }] }];
  const result = await processRestorableToolCalls([request], service, { getHistory: () => clientHistory }, history);
  assert.deepEqual(result.errors, [], 'Healthy actual native metadata writer must complete.');
  assert.equal(result.checkpointsToWrite.size, 1);
  const [name, content] = [...result.checkpointsToWrite][0];
  assert.equal(result.toolCallToCheckpointMap.get(request.callId), name.slice(0, -5));
  const saved = read().get(name);
  assert.equal(saved.content, content);
  assert.deepEqual(saved.data.history, history);
  assert.deepEqual(saved.data.clientHistory, clientHistory);
  assert.deepEqual(saved.data.toolCall, { name: request.name, args: request.args });
  assert.equal(saved.data.messageId, request.prompt_id);
  return { name, content, data: saved.data };
}
async function restore(data, git = service) {
  const actions = [];
  for await (const action of performRestore(data, git)) actions.push(action);
  return actions;
}
if (phase.startsWith('writer-')) {
  fs.writeFileSync(path.join(root, phase + '.ready'), 'ready');
  await wait(path.join(root, 'go'));
  for (let index = 0; index < 3; index++) {
    const target = path.join(workspace, phase + '-' + index + '.txt');
    fs.writeFileSync(target, before);
    await save(phase + '-' + index, target);
  }
  console.log('PASS: native metadata ' + phase + ' acknowledges three complete checkpoints.');
  process.exit(0);
}
if (phase === 'verify') {
  const all = read();
  assert.equal(all.size, 6);
  assert.equal(records().filter(record => record.type === 'restorable-tool').length, 6);
  for (let writer = 0; writer < 2; writer++) for (let index = 0; index < 3; index++) {
    const label = 'writer-' + writer + '-' + index;
    assert.ok([...all.values()].some(value => value.data.messageId === 'synthetic-prompt-' + label));
  }
  console.log('PASS: fresh native metadata reader retains all six independent writer generations.');
  process.exit(0);
}
if (phase === 'peer-writer') {
  const target = path.join(workspace, 'synthetic-peer.txt');
  fs.writeFileSync(target, before);
  await save('peer', target);
  fs.writeFileSync(path.join(root, 'peer.done'), 'done');
  console.log('PASS: independent native metadata peer appends its full restorable checkpoint.');
  process.exit(0);
}
if (phase === 'peer') {
  const original = JSON.parse(fs.readFileSync(path.join(root, 'handoff.json'), 'utf8'));
  assert.deepEqual(read().get(original.name), { content: original.content, data: original.data });
  assert.equal(fs.existsSync(storage.getProjectTempCheckpointsDir()), false);
  const previous = records();
  const actions = await restore(original.data);
  assert.equal(actions[0].type, 'load_history');
  assert.deepEqual(actions[0].history, original.data.history);
  assert.deepEqual(actions[0].clientHistory, original.data.clientHistory);
  assert.equal(actions[1].content, 'Restored project to the state before the tool call.');
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.deepEqual(records(), previous);
  console.log('PASS: fresh actual native restore recovers the original project/conversation without another audit generation or private metadata.');
  process.exit(0);
}
fs.writeFileSync(file, before);
const initial = await save('initial');
fs.writeFileSync(file, after);
fs.writeFileSync(path.join(root, 'handoff.json'), JSON.stringify(initial));
assert.equal(fs.existsSync(storage.getProjectTempCheckpointsDir()), false);
console.log('PASS: actual native writer retains its full pre-edit Git/conversation/tool checkpoint in canonical history.');
if (scenario === 'generations') {
  const second = await save('second');
  assert.notEqual(initial.data.commitHash, second.data.commitHash);
  const changed = { ...second.data, messageId: 'SYNTHETIC REPLACEMENT GENERATION' };
  saveNativeGeminiRestorableHistory(storage, second.name, JSON.stringify(changed), schema);
  assert.equal(read().size, 2);
  assert.deepEqual(read().get(second.name).data, changed);
  assert.equal(records().filter(record => record.type === 'restorable-tool').length, 3);
  assert.equal(JSON.parse(JSON.parse(records().filter(record => record.type === 'restorable-tool')[1].message).content).messageId, second.data.messageId);
  console.log('PASS: native restore metadata retains every replacement generation while deriving the current filename view.');
}
if (scenario === 'peer') {
  fs.writeFileSync(path.join(root, 'owner.ready'), 'ready');
  await wait(path.join(root, 'peer.done'));
  assert.equal(read().size, 2);
  assert.ok([...read().values()].some(value => value.data.messageId === 'synthetic-prompt-peer'));
  console.log('PASS: retained native metadata readers observe independent peer writes on their next operation.');
}
if (scenario === 'project-separation') {
  const other = path.join(root, 'workspace-other');
  fs.mkdirSync(other, { mode: 0o700 });
  const otherStorage = new Storage(other, 'SYNTHETIC_RESTORABLE_SESSION');
  const otherGit = new GitService(other, otherStorage);
  await otherGit.initialize();
  assert.equal(readNativeGeminiRestorableHistory(otherStorage, schema).size, 0);
  assert.equal(read().size, 1);
  await assert.rejects(restore(initial.data, otherGit), refusal);
  assert.equal(fs.readFileSync(file, 'utf8'), after);
  console.log('PASS: actual native restore metadata and restore authority remain project-specific.');
}
if (scenario === 'foreign-restore' || scenario === 'missing-git') {
  const previous = records();
  const data = { ...initial.data, messageId: 'SYNTHETIC UNACKNOWLEDGED DATA' };
  let actions = 0;
  await assert.rejects(async () => {
    for await (const _action of performRestore(scenario === 'missing-git' ? initial.data : data,
      scenario === 'missing-git' ? undefined : service)) actions++;
  }, refusal);
  assert.equal(actions, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), after);
  assert.deepEqual(records(), previous);
  console.log('PASS: native restore refuses ' + scenario + ' before project or UI-history changes.');
}
if (scenario === 'changed-storage' || scenario === 'changed-selector') {
  const previous = fingerprint(path.join(root, 'canonical'));
  if (scenario === 'changed-storage') storage.getProjectTempDir = () => path.join(root, 'unexpected');
  else process.env.GEMINI_HISTORY_HOME = path.join(root, 'unexpected');
  assert.throws(read, refusal);
  assert.deepEqual(fingerprint(path.join(root, 'canonical')), previous);
  console.log('PASS: native metadata reader refuses ' + scenario + ' without changing canonical data.');
}
if (scenario.startsWith('unsafe-')) {
  const attack = scenario.slice(7);
  if (['envelope', 'name', 'content', 'schema', 'history-schema', 'foreign-session', 'unknown-commit', 'foreign-head'].includes(attack)) {
    const all = records();
    const row = all.find(record => record.type === 'restorable-tool');
    const saved = JSON.parse(row.message);
    const data = JSON.parse(saved.content);
    if (attack === 'envelope') saved.extra = true;
    if (attack === 'name') saved.name = '../' + saved.name;
    if (attack === 'content') saved.content = '{';
    if (attack === 'schema') data.toolCall.args = [];
    if (attack === 'history-schema') data.history[0].id = 'SYNTHETIC INVALID ID';
    if (attack === 'foreign-session') row.sessionId = 'SYNTHETIC FOREIGN';
    if (attack === 'unknown-commit') data.commitHash = '0'.repeat(40);
    if (attack === 'foreign-head') all.find(record => record.type === 'git-checkpoint').sessionId = 'SYNTHETIC FOREIGN';
    if (['schema', 'history-schema', 'unknown-commit'].includes(attack)) saved.content = JSON.stringify(data);
    row.message = JSON.stringify(saved);
    fs.writeFileSync(journal, JSON.stringify(all));
  }
  if (attack === 'symlink') { fs.renameSync(journal, journal + '.protected'); fs.symlinkSync(journal + '.protected', journal); }
  if (attack === 'hardlink') fs.linkSync(journal, path.join(root, 'protected-journal'));
  if (attack === 'unsafe-mode') fs.chmodSync(journal, 0o644);
  if (attack === 'malformed') fs.writeFileSync(journal, '{');
  if (attack === 'invalid-utf8') fs.writeFileSync(journal, Buffer.from([255]));
  if (attack === 'oversized') fs.truncateSync(journal, 32 * 1024 * 1024 + 1);
  if (attack === 'missing') fs.unlinkSync(journal);
  if (attack === 'parent-replacement' || attack === 'root-replacement') {
    const directory = attack === 'parent-replacement' ? path.dirname(journal) : path.join(root, 'canonical');
    fs.renameSync(directory, directory + '.protected'); fs.mkdirSync(directory, { mode: 0o700 });
  }
  const previous = fingerprint(path.join(root, 'canonical'));
  assert.throws(read, refusal, 'Unsafe native metadata must refuse checked reads.');
  assert.deepEqual(fingerprint(path.join(root, 'canonical')), previous);
  assert.equal(fs.readFileSync(file, 'utf8'), after);
  console.log('PASS: actual native metadata refuses ' + attack + ' without changing canonical data or the workspace.');
}
''')

    def start(phase):
        private = root / ('private-' + phase)
        private.mkdir(mode=0o700)
        diagnostic = args.diagnostics.with_name(args.diagnostics.stem + '-' + scenario + '-' + phase + '.log')
        env = {'PATH': os.environ['PATH'], 'HOME': str(private), 'GEMINI_CLI_HOME': str(private),
               'GEMINI_HISTORY_HOME': str(root / 'canonical'), 'FIXTURE_ROOT': str(root),
               'NATIVE_MODULE': module.as_uri(), 'NATIVE_HELPER': helper.as_uri(),
               'NATIVE_SCENARIO': scenario, 'NODE_ENV': 'production'}
        if os.environ.get('GEMINI_HISTORY_DEBUG') == '1':
            env['GEMINI_HISTORY_DEBUG'] = '1'
        output = diagnostic.open('wb')
        diagnostic.chmod(0o600)
        try:
            child = subprocess.Popen(['prlimit', '--data=2147483648', '--stack=16777216', '--core=0',
                                      '--', shutil.which('node'), '--max-old-space-size=256', str(worker), phase],
                                     env=env, stdin=subprocess.DEVNULL, stdout=output,
                                     stderr=subprocess.STDOUT, start_new_session=True)
            children.append(child)
            return child, output, diagnostic, time.monotonic() + 25
        except BaseException:
            output.close()
            raise

    def finish(running):
        child, output, diagnostic, deadline = running
        try:
            while child.poll() is None:
                assert time.monotonic() < deadline and os.fstat(output.fileno()).st_size <= 65536
                time.sleep(0.02)
            assert child.returncode == 0, 'Inspect bounded native metadata diagnostics: ' + str(diagnostic)
        finally:
            stop_process_group(child)
            output.close()
        print(diagnostic.read_text().strip(), flush=True)

    for scenario in scenarios:
        if args.scenario and args.scenario != scenario:
            continue
        root = suite_root / scenario
        root.mkdir(mode=0o700)
        for name in ('workspace', 'canonical'):
            (root / name).mkdir(mode=0o700)
        if scenario == 'concurrent':
            writers = [start('writer-' + str(index)) for index in range(2)]
            deadline = time.monotonic() + 15
            while len(tuple(root.glob('writer-*.ready'))) < 2:
                assert time.monotonic() < deadline and all(child.poll() is None for child, *_ in writers)
                time.sleep(0.02)
            (root / 'go').write_text('go')
            for writer in writers:
                finish(writer)
            for index in range(2):
                shutil.rmtree(root / ('private-writer-' + str(index)))
            finish(start('verify'))
        elif scenario == 'peer':
            owner = start('owner')
            deadline = time.monotonic() + 15
            while not (root / 'owner.ready').exists():
                assert time.monotonic() < deadline and owner[0].poll() is None
                time.sleep(0.02)
            finish(start('peer-writer'))
            finish(owner)
        else:
            finish(start('owner'))
            if scenario == 'lifetime':
                shutil.rmtree(root / 'private-owner')
                finish(start('peer'))
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
            shutil.rmtree(suite_root)
        else:
            print('Synthetic native restorable metadata evidence retained in', suite_root)
