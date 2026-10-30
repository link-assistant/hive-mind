#!/usr/bin/env python3
"""Bounded actual native Logger prompt/checkpoint storage controls."""
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
attacks = ('symlink', 'hardlink', 'unsafe-mode', 'malformed', 'schema', 'invalid-utf8',
           'oversized', 'missing', 'parent-replacement', 'root-replacement', 'file-replacement', 'write-failure')
scenarios = ('prompt-healthy', 'prompt-peer', 'prompt-concurrent', 'checkpoint-healthy',
             'checkpoint-generations', 'legacy') + tuple(kind + '-' + attack for kind in ('prompt', 'checkpoint') for attack in attacks)
parser.add_argument('--scenario', choices=scenarios)
args = parser.parse_args()
package = args.package.resolve(strict=True)
assert json.loads((package / 'package.json').read_text())['version'] == '0.65.0'
manager = (package / 'bundle/chunk-DKZARV6U.js').read_bytes()
assert hashlib.sha256(manager).hexdigest() in ('236c3faf39cbe2a022409be5ee3ee3147ac1686d146336d0126f6e23f0b465b2', '439a87bb21b7c5f172d959f99629d74637cf847a4ddb9a684dbffa280b7cc68b', 'b1b2ad9594865d2b60aee3d1b6cbf1a8d2bb2e7d72946124f9a25bc3c2808608', '9e5df4a69c98a27919561e63ebc5d9338256e399f27c4f5171ff2564cedb9b55')
assert (package / 'bundle/hive-gemini-history.mjs').read_bytes() == (Path(__file__).parent / 'history.mjs').read_bytes()
root = Path(tempfile.mkdtemp(prefix='hive-3785-gemini-logger-'))
root.chmod(0o700)
children = []
safe_cleanup = False
args.diagnostics.parent.mkdir(parents=True, exist_ok=True)
try:
    native = root / 'native'
    native.mkdir(mode=0o700)
    shutil.copyfile(package / 'package.json', native / 'package.json')
    shutil.copytree(package / 'bundle', native / 'bundle', symlinks=False)
    worker = native / 'bundle/hive-logger-worker.mjs'
    worker.write_text(r'''
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { Logger, Storage } from './chunk-DKZARV6U.js';
const root = process.env.FIXTURE_ROOT;
const canonical = path.join(root, 'canonical');
const scenario = process.argv[2];
const phase = process.argv[3];
const prompt = 'SYNTHETIC-PROMPT-東京-café-😀';
const tag = 'SYNTHETIC 東京 /../ #? checkpoint';
const checkpoint = { history: [{ role: 'user', parts: [{ text: prompt }] }], uiHistory: [{ text: prompt }], version: 1 };
const storage = new Storage(path.join(root, 'workspace'));
const logger = new Logger('synthetic-session', storage);
await logger.initialize();
assert.equal(logger.initialized, true);
const temporary = storage.getProjectTempDir();
if (phase === 'peer-prompt') {
  assert.ok((await logger.getPreviousUserMessages()).includes(prompt), 'Native prompt history must survive private-home disposal.');
  console.log('PASS: a fresh native Logger reads prompt history after private-home disposal.');
  process.exit(0);
}
if (phase === 'peer-checkpoint') {
  assert.equal(await logger.checkpointExists(tag), true, 'Native named checkpoints must survive private-home disposal.');
  assert.deepEqual(await logger.loadCheckpoint(tag), checkpoint);
  console.log('PASS: a fresh native Logger reads named checkpoints after private-home disposal.');
  process.exit(0);
}
if (phase === 'concurrent-verify') {
  const messages = await logger.getPreviousUserMessages();
  assert.equal(messages.length, 40);
  assert.equal(new Set(messages).size, 40);
  const file = fs.readdirSync(canonical, { recursive: true }).find(name => name.endsWith('/prompt-history.json'));
  const entries = JSON.parse(fs.readFileSync(path.join(canonical, file), 'utf8'));
  assert.deepEqual(entries.map(entry => entry.messageId).sort((a, b) => a - b), Array.from({ length: 40 }, (_, index) => index));
  console.log('PASS: four independent native Logger writers preserve all 40 prompts and unique session message IDs.');
  process.exit(0);
}
if (phase.startsWith('writer-')) {
  fs.writeFileSync(path.join(root, phase + '.ready'), 'ready');
  const deadline = Date.now() + 10000;
  while (!fs.existsSync(path.join(root, 'go'))) {
    assert.ok(Date.now() < deadline);
    await setTimeout(10);
  }
  for (let index = 0; index < 10; index++) await logger.logMessage('user', phase + '-' + index);
  console.log('PASS: bounded native Logger ' + phase + ' completed.');
  process.exit(0);
}
if (scenario.startsWith('checkpoint-')) {
  await logger.saveCheckpoint(checkpoint, tag);
  assert.equal(await logger.checkpointExists(tag), true);
  assert.deepEqual(await logger.loadCheckpoint(tag), checkpoint);
} else {
  await logger.logMessage('user', prompt);
  assert.deepEqual(await logger.getPreviousUserMessages(), [prompt]);
}
if (scenario === 'prompt-healthy' || scenario === 'checkpoint-healthy') {
  console.log('PASS: healthy native Logger first writes and reads ' + scenario + '.');
  process.exit(0);
}
if (scenario === 'legacy') {
  await logger.saveCheckpoint(checkpoint, 'ordinary');
  assert.deepEqual(await logger.loadCheckpoint('ordinary'), checkpoint);
  assert.equal(await logger.deleteCheckpoint('ordinary'), true);
  assert.equal(await logger.checkpointExists('ordinary'), false);
  assert.deepEqual(fs.readdirSync(canonical), []);
  assert.ok(fs.existsSync(logger.logFilePath));
  console.log('PASS: unselected native Logger preserves private prompt/checkpoint behavior.');
  process.exit(0);
}
if (scenario === 'prompt-peer') {
  const peer = new Logger('synthetic-peer', storage);
  await peer.initialize();
  await peer.logMessage('user', 'SYNTHETIC-PEER-PROMPT');
  assert.ok((await logger.getPreviousUserMessages()).includes('SYNTHETIC-PEER-PROMPT'), 'Native prompt reads must observe the latest peer generation.');
  console.log('PASS: an already initialized native Logger observes a peer prompt on its next read.');
  process.exit(0);
}
const suffix = scenario.startsWith('checkpoint-') ? '/checkpoint-history.json' : '/prompt-history.json';
const matches = fs.readdirSync(canonical, { recursive: true }).filter(name => name.endsWith(suffix));
assert.equal(matches.length, 1, 'The selected native Logger must publish canonical history.');
let file = path.join(canonical, matches[0]);
if (scenario === 'checkpoint-generations') {
  const next = { history: [{ role: 'model', parts: [{ text: 'SYNTHETIC-CHECKPOINT-SECOND' }] }] };
  await logger.saveCheckpoint(next, tag);
  assert.deepEqual(await logger.loadCheckpoint(tag), next);
  assert.equal(await logger.deleteCheckpoint(tag), true);
  assert.equal(await logger.checkpointExists(tag), false);
  assert.deepEqual(await logger.loadCheckpoint(tag), { history: [] });
  assert.equal(await logger.deleteCheckpoint(tag), false);
  let journal = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(journal.length, 3);
  assert.deepEqual(journal[0].checkpoint, checkpoint);
  assert.deepEqual(journal[1].checkpoint, next);
  assert.equal(journal[2].operation, 'delete');
  await logger.saveCheckpoint(checkpoint, tag);
  assert.deepEqual(await logger.loadCheckpoint(tag), checkpoint);
  journal = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(journal.length, 4);
  assert.deepEqual(journal[1].checkpoint, next);
  console.log('PASS: native named checkpoint replacement/deletion/recreation preserves all prior audit generations.');
  process.exit(0);
}
const attack = scenario.slice(scenario.indexOf('-') + 1);
let protectedFile = file;
let replacementInjected = false;
if (['symlink', 'hardlink', 'missing'].includes(attack)) {
  protectedFile = path.join(root, 'protected-history');
  fs.renameSync(file, protectedFile);
  if (attack === 'symlink') fs.symlinkSync(protectedFile, file);
  if (attack === 'hardlink') fs.linkSync(protectedFile, file);
} else if (attack === 'unsafe-mode') fs.chmodSync(file, 0o644);
else if (attack === 'malformed') fs.writeFileSync(file, '{');
else if (attack === 'schema') fs.writeFileSync(file, '[{"unexpected":true}]');
else if (attack === 'invalid-utf8') fs.writeFileSync(file, Buffer.from([0xff]));
else if (attack === 'oversized') fs.truncateSync(file, 32 * 1024 * 1024 + 1);
else if (attack === 'parent-replacement' || attack === 'root-replacement') {
  const parent = attack === 'root-replacement' ? canonical : path.dirname(file);
  fs.renameSync(parent, parent + '-protected');
  fs.mkdirSync(parent, { mode: 0o700 });
  protectedFile = path.join(parent + '-protected', path.relative(parent, file));
} else if (attack === 'file-replacement') {
  protectedFile = path.join(root, 'protected-history');
  const synchronize = fs.fsyncSync;
  fs.fsyncSync = fd => {
    synchronize(fd);
    if (!replacementInjected && fs.fstatSync(fd).isFile() && fs.fstatSync(fd).size > 0) {
      replacementInjected = true;
      fs.renameSync(file, protectedFile);
      fs.writeFileSync(file, 'SYNTHETIC-PEER-REPLACEMENT', { mode: 0o600 });
    }
  };
} else if (attack === 'write-failure') {
  const write = fs.writeFileSync;
  fs.writeFileSync = (...args) => {
    if (typeof args[0] === 'number') throw new Error('SYNTHETIC-IO-FAILURE');
    return write(...args);
  };
} else throw new Error('Unknown bounded native Logger attack.');
const beforeFile = attack === 'file-replacement' ? file : protectedFile;
const original = fs.statSync(beforeFile);
const bytes = attack === 'oversized' ? undefined : fs.readFileSync(beforeFile);
const refused = /Gemini canonical conversation history is unavailable or unsafe[.]/;
await assert.rejects(() => scenario.startsWith('checkpoint-') ? logger.saveCheckpoint(checkpoint, tag) : logger.logMessage('user', 'UNEXPECTED'), refused);
assert.equal(fs.statSync(protectedFile).ino, original.ino);
assert.equal(fs.statSync(protectedFile).size, original.size);
if (bytes) assert.deepEqual(fs.readFileSync(protectedFile), bytes);
if (attack === 'file-replacement') {
  assert.equal(replacementInjected, true);
  assert.equal(fs.readFileSync(file, 'utf8'), 'SYNTHETIC-PEER-REPLACEMENT');
}
assert.equal(fs.existsSync(path.join(temporary, 'logs.json')), false);
console.log('PASS: actual native Logger refuses ' + scenario + ', propagates the storage error and preserves protected data.');
''')

    def start(fixture, scenario, phase):
        private = fixture / ('private-' + phase)
        private.mkdir(mode=0o700)
        diagnostic = args.diagnostics.with_name(args.diagnostics.stem + '-' + scenario + '-' + phase + '.log')
        output = diagnostic.open('wb')
        diagnostic.chmod(0o600)
        env = {'PATH': os.environ['PATH'], 'HOME': str(private), 'GEMINI_CLI_HOME': str(private), 'FIXTURE_ROOT': str(fixture)}
        if scenario != 'legacy':
            env['GEMINI_HISTORY_HOME'] = str(fixture / 'canonical')
        child = subprocess.Popen(['prlimit', '--data=2147483648', '--stack=16777216', '--core=0', '--', shutil.which('node'), '--max-old-space-size=192', str(worker), scenario, phase], env=env, stdin=subprocess.DEVNULL, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
        children.append(child)
        return child, output, diagnostic, private, time.monotonic() + 20

    def finish(record):
        child, output, diagnostic, private, deadline = record
        try:
            while child.poll() is None:
                assert time.monotonic() < deadline, 'Finite native Logger deadline exceeded.'
                assert os.fstat(output.fileno()).st_size <= 65536
                time.sleep(0.02)
            assert child.returncode == 0, 'Inspect bounded native Logger diagnostics.'
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
        if scenario == 'prompt-concurrent':
            records = [start(fixture, scenario, 'writer-' + str(index)) for index in range(4)]
            deadline = time.monotonic() + 10
            while not all((fixture / ('writer-' + str(index) + '.ready')).exists() for index in range(4)):
                assert time.monotonic() < deadline and all(record[0].poll() is None for record in records), 'Native Logger writers failed before the bounded barrier.'
                time.sleep(0.02)
            (fixture / 'go').write_text('go')
            for record in records:
                finish(record)
            finish(start(fixture, scenario, 'concurrent-verify'))
        else:
            record = start(fixture, scenario, 'initial')
            finish(record)
            if scenario in ('prompt-healthy', 'checkpoint-healthy'):
                shutil.rmtree(record[3])
                finish(start(fixture, scenario, 'peer-' + scenario.split('-')[0]))
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
            print('Synthetic native Logger evidence retained in', root)
