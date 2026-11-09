#!/usr/bin/env python3
"""Bounded actual native Git checkpoint persistence across private-home disposal."""
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
attacks = ('missing', 'missing-blob', 'symlink', 'hardlink', 'unsafe-mode', 'content-change',
           'oversized', 'alternates', 'pack', 'parent-replacement', 'root-replacement')
scenarios = ('lifetime', 'private-filter', 'same-private-filter', 'peer', 'concurrent', 'generations', 'project-separation',
             'same-storage-service', 'same-private-service',
             'changed-selector', 'changed-service', 'foreign-repository', 'legacy') + tuple('unsafe-' + attack for attack in attacks)
parser.add_argument('--scenario', choices=scenarios)
args = parser.parse_args()
package = args.package.resolve(strict=True)
assert json.loads((package / 'package.json').read_text())['version'] == '0.65.0'
module = package / 'bundle/chunk-DKZARV6U.js'
manager_pin = hashlib.sha256(module.read_bytes()).hexdigest()
assert manager_pin in ('9e5df4a69c98a27919561e63ebc5d9338256e399f27c4f5171ff2564cedb9b55', 'a88db8a10a742aa697d71f2e33b9061d2082f6e9b4330b3d9bbefa54fa9616f3', 'ace42576cb7d8f0f2ef710e148cbfb81311929f42f5c3a50851e27cb5e744a07')
if manager_pin != '9e5df4a69c98a27919561e63ebc5d9338256e399f27c4f5171ff2564cedb9b55':
    helper_pin = hashlib.sha256((package / 'bundle/hive-gemini-git-history.mjs').read_bytes()).hexdigest()
    assert helper_pin in ('7be869f6383b20eb21f944d9665268aa169e22ba6696f32337e9a21d52d94dcd',
                          'f0573a298e7ebf4ced71dba4b3a90a4d2eac1ddf5be011a525b793530cf39e61',
                          'bad099a4e348abaf08d6f1295af6febc709b2c97a830cd048664a59dbab55e83',
                          '83e535c8d162480a737306aac0f4caf7288d0c790e3473e2ba5dcfaf8b0bbb35')
    if helper_pin == '83e535c8d162480a737306aac0f4caf7288d0c790e3473e2ba5dcfaf8b0bbb35':
        assert hashlib.sha256((package / 'bundle/hive-gemini-git-configuration.mjs').read_bytes()).hexdigest() == '3be27b9f5d2aba8b4456397fea5b418cea13a8ed6f5d7a6816191091052272b1'
    elif helper_pin != '7be869f6383b20eb21f944d9665268aa169e22ba6696f32337e9a21d52d94dcd':
        assert (package / 'bundle/hive-gemini-git-configuration.mjs').read_bytes() == (Path(__file__).parent / 'git_configuration.mjs').read_bytes()
    if helper_pin in ('bad099a4e348abaf08d6f1295af6febc709b2c97a830cd048664a59dbab55e83', '83e535c8d162480a737306aac0f4caf7288d0c790e3473e2ba5dcfaf8b0bbb35'):
        assert (package / 'bundle/hive-gemini-git-objects.mjs').read_bytes() == (Path(__file__).parent / 'git_objects.mjs').read_bytes()
    assert hashlib.sha256((package / 'bundle/hive-gemini-git-lock.mjs').read_bytes()).hexdigest() == '6271784aa3773fc3a54056bf1ce8fd7b1f2da3a813e01537c47bcbc6d674c568'
suite_root = Path(tempfile.mkdtemp(prefix='hive-3785-gemini-git-'))
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
const { Storage, GitService } = await import(process.env.NATIVE_MODULE);
const scenario = process.env.NATIVE_SCENARIO;
const root = process.env.FIXTURE_ROOT;
const workspace = path.join(root, 'workspace');
const file = path.join(workspace, 'synthetic.txt');
const secondFile = path.join(workspace, 'synthetic-second.txt');
const refusal = /Gemini canonical conversation history is unavailable or unsafe[.]/u;
const digest = (value, algorithm = 'sha256') => createHash(algorithm).update(value).digest('hex');
const store = path.join(root, 'canonical', 'projects', digest(workspace), 'git-checkpoints');
const objectDirectory = path.join(store, 'objects');
function audit() {
  const found = fs.readdirSync(path.join(root, 'canonical'), { recursive: true })
    .find(name => name.startsWith('projects/' + digest(workspace) + '/') && name.endsWith('/prompt-history.json'));
  assert.ok(found, 'Selected native Git must maintain a canonical checkpoint audit.');
  return JSON.parse(fs.readFileSync(path.join(root, 'canonical', found), 'utf8'))
    .filter(record => record.type === 'git-checkpoint').map(record => record.message);
}
const fingerprint = directory => fs.readdirSync(directory).sort().flatMap(name => {
  const file = path.join(directory, name);
  const info = fs.lstatSync(file, { bigint: true });
  return info.isDirectory() ? fingerprint(file) :
    [[file, String(info.dev), String(info.ino), String(info.mode), String(info.nlink),
      info.isFile() ? digest(fs.readFileSync(file)) : fs.readlinkSync(file)]];
});
async function wait(file) {
  const deadline = Date.now() + 10000;
  while (!fs.existsSync(file)) {
    assert.ok(Date.now() < deadline, 'Finite native Git barrier exceeded.');
    await setTimeout(10);
  }
}
const service = new GitService(workspace, new Storage(workspace, 'SYNTHETIC_GIT_SESSION'));
await service.initialize();
const phase = process.argv[2];
if (phase.startsWith('writer-')) {
  fs.writeFileSync(path.join(root, phase + '.ready'), 'ready');
  await wait(path.join(root, 'go'));
  const commits = [];
  for (let index = 0; index < 3; index++) {
    fs.writeFileSync(path.join(workspace, phase + '-' + index + '.txt'), phase + '-' + index);
    commits.push(await service.createFileSnapshot('SYNTHETIC ' + phase + '-' + index));
  }
  fs.writeFileSync(path.join(root, phase + '.json'), JSON.stringify(commits));
  console.log('PASS: actual native Git ' + phase + ' completes three independent snapshots.');
  process.exit(0);
}
if (phase === 'verify') {
  const history = audit();
  assert.equal(new Set(history).size, history.length);
  for (let writer = 0; writer < 2; writer++) {
    const prefix = 'writer-' + writer;
    for (const commit of JSON.parse(fs.readFileSync(path.join(root, prefix + '.json'), 'utf8'))) assert.ok(history.includes(commit));
    for (let index = 0; index < 3; index++) assert.equal(fs.readFileSync(path.join(workspace, prefix + '-' + index + '.txt'), 'utf8'), prefix + '-' + index);
  }
  assert.equal(await service.getCurrentCommitHash(), history.at(-1));
  console.log('PASS: fresh native Git retains every acknowledged generation and all six files from two private writers.');
  process.exit(0);
}
if (phase === 'peer-writer') {
  const expected = JSON.parse(fs.readFileSync(path.join(root, 'handoff.json'), 'utf8'));
  assert.equal(await service.getCurrentCommitHash(), expected.second);
  fs.writeFileSync(secondFile, 'SYNTHETIC PEER THIRD\n');
  const third = await service.createFileSnapshot('SYNTHETIC peer third native checkpoint');
  assert.notEqual(third, expected.second);
  fs.writeFileSync(path.join(root, 'peer.json'), JSON.stringify({ third }));
  fs.writeFileSync(path.join(root, 'peer.done'), 'done');
  console.log('PASS: independent native Git peer rereads and extends the current canonical checkpoint.');
  process.exit(0);
}
if (process.argv[2] === 'owner') {
  fs.writeFileSync(file, 'SYNTHETIC FIRST 東京\n');
  const first = await service.createFileSnapshot('SYNTHETIC first native checkpoint');
  fs.writeFileSync(file, 'SYNTHETIC SECOND café\n');
  fs.writeFileSync(secondFile, 'SYNTHETIC second tracked file\n');
  const second = await service.createFileSnapshot('SYNTHETIC second native checkpoint');
  assert.notEqual(first, second);
  assert.equal(await service.getCurrentCommitHash(), second);
  assert.equal(await service.createFileSnapshot('SYNTHETIC unchanged checkpoint'), second);
  await service.restoreProjectFromSnapshot(first);
  assert.equal(fs.readFileSync(file, 'utf8'), 'SYNTHETIC FIRST 東京\n');
  assert.equal(fs.existsSync(secondFile), false);
  await service.restoreProjectFromSnapshot(second);
  assert.equal(fs.readFileSync(file, 'utf8'), 'SYNTHETIC SECOND café\n');
  assert.equal(fs.readFileSync(secondFile, 'utf8'), 'SYNTHETIC second tracked file\n');
  fs.writeFileSync(path.join(root, 'handoff.json'), JSON.stringify({ first, second }), { mode: 0o600 });
  console.log('PASS: actual native Git creates two checkpoints, retains an unchanged snapshot and restores both file generations.');
  if (scenario === 'legacy') {
    assert.deepEqual(fs.readdirSync(path.join(root, 'canonical')), []);
    assert.ok(fs.existsSync(path.join(service.getHistoryDir(), '.git', 'objects')));
    console.log('PASS: unselected native Git retains its original private storage behavior.');
  }
  if (scenario === 'generations') {
    const history = audit();
    assert.equal(history.length, 3, 'Initial and two changed snapshots must retain three audit generations.');
    assert.deepEqual(history.slice(1), [first, second]);
    console.log('PASS: native Git retains all acknowledged generations without journaling unchanged snapshots or restore.');
  }
  if (scenario === 'peer') {
    fs.writeFileSync(path.join(root, 'owner.ready'), 'ready');
    await wait(path.join(root, 'peer.done'));
    const { third } = JSON.parse(fs.readFileSync(path.join(root, 'peer.json'), 'utf8'));
    assert.equal(await service.getCurrentCommitHash(), third);
    await service.restoreProjectFromSnapshot(first);
    await service.restoreProjectFromSnapshot(third);
    assert.equal(fs.readFileSync(secondFile, 'utf8'), 'SYNTHETIC PEER THIRD\n');
    assert.deepEqual(audit().slice(1), [first, second, third]);
    console.log('PASS: retained native Git sees peer commits and restores old and new generations on its next operation.');
  }
  if (scenario === 'project-separation') {
    const other = path.join(root, 'workspace-other');
    fs.mkdirSync(other, { mode: 0o700 });
    fs.writeFileSync(path.join(other, 'synthetic-other.txt'), 'SYNTHETIC OTHER PROJECT\n');
    const secondService = new GitService(other, new Storage(other, 'SYNTHETIC_GIT_SESSION'));
    await secondService.initialize();
    const otherHead = await secondService.createFileSnapshot('SYNTHETIC other project');
    assert.notEqual(otherHead, second);
    assert.equal(await service.getCurrentCommitHash(), second);
    assert.equal(audit().at(-1), second);
    console.log('PASS: actual native Git separates canonical checkpoint history by real project root.');
  }
  if (scenario === 'same-storage-service' || scenario === 'same-private-service') {
    const storage = scenario === 'same-storage-service' ? service.storage : new Storage(workspace, 'SYNTHETIC_GIT_SESSION');
    if (storage !== service.storage) await storage.initialize();
    const peer = new GitService(workspace, storage);
    await assert.doesNotReject(peer.getCurrentCommitHash(),
      'A native UI GitService must reuse its already initialized private repository.');
    assert.equal(await peer.getCurrentCommitHash(), second,
      'A native UI GitService must reuse its already initialized private repository.');
    await peer.initialize();
    assert.equal(await peer.getCurrentCommitHash(), second);
    await peer.restoreProjectFromSnapshot(first);
    assert.equal(fs.readFileSync(file, 'utf8'), 'SYNTHETIC FIRST 東京\n');
    await peer.restoreProjectFromSnapshot(second);
    fs.writeFileSync(file, 'SYNTHETIC UI THIRD\n');
    const third = await peer.createFileSnapshot('SYNTHETIC UI third checkpoint');
    assert.notEqual(third, second);
    assert.equal(await service.getCurrentCommitHash(), third);
    assert.deepEqual(audit().slice(1), [first, second, third]);
    console.log('PASS: actual native UI GitService reuses the sealed private repository and extends its canonical history: ' + scenario);
  }
  if (scenario === 'changed-selector' || scenario === 'changed-service' || scenario === 'foreign-repository') {
    const protectedBefore = fingerprint(process.env.GEMINI_HISTORY_HOME);
    if (scenario === 'changed-selector') process.env.GEMINI_HISTORY_HOME = path.join(root, 'unexpected');
    if (scenario === 'changed-service') service.projectRoot = path.join(root, 'unexpected');
    if (scenario === 'foreign-repository') assert.throws(() => service.shadowGitRepository, refusal);
    else await assert.rejects(service.getCurrentCommitHash(), refusal);
    assert.deepEqual(fingerprint(path.join(root, 'canonical')), protectedBefore);
    console.log('PASS: native Git refuses ' + scenario + ' before changing canonical data.');
  }
  if (scenario.startsWith('unsafe-')) {
    const attack = scenario.slice(7);
    const object = path.join(objectDirectory, first.slice(0, 2), first.slice(2));
    if (attack === 'missing') fs.unlinkSync(object);
    if (attack === 'missing-blob') {
      const bytes = Buffer.from('SYNTHETIC FIRST 東京\n');
      const name = digest(Buffer.concat([Buffer.from('blob ' + bytes.length + '\0'), bytes]), 'sha1');
      fs.unlinkSync(path.join(objectDirectory, name.slice(0, 2), name.slice(2)));
    }
    if (attack === 'symlink') {
      fs.renameSync(object, object + '.protected');
      fs.symlinkSync(object + '.protected', object);
    }
    if (attack === 'hardlink') fs.linkSync(object, path.join(root, 'protected-object'));
    if (attack === 'unsafe-mode') fs.chmodSync(object, 0o666);
    if (attack === 'content-change') { fs.chmodSync(object, 0o600); fs.writeFileSync(object, 'SYNTHETIC CORRUPT OBJECT'); }
    if (attack === 'oversized') { fs.chmodSync(object, 0o600); fs.truncateSync(object, 32 * 1024 * 1024 + 1); }
    if (attack === 'alternates') fs.writeFileSync(path.join(objectDirectory, 'info', 'alternates'), root + '\n');
    if (attack === 'pack') fs.writeFileSync(path.join(objectDirectory, 'pack', 'synthetic.pack'), 'SYNTHETIC');
    if (attack === 'parent-replacement' || attack === 'root-replacement') {
      const replaced = attack === 'parent-replacement' ? objectDirectory : process.env.GEMINI_HISTORY_HOME;
      fs.renameSync(replaced, replaced + '.protected');
      fs.mkdirSync(replaced, { mode: 0o700 });
    }
    const protectedBefore = fingerprint(path.join(root, 'canonical'));
    await assert.rejects(service.getCurrentCommitHash(), refusal,
      'Native Git reads must refuse a missing earlier acknowledged commit object.');
    assert.deepEqual(fingerprint(path.join(root, 'canonical')), protectedBefore);
    console.log('PASS: actual native Git refuses ' + attack + ' without changing canonical data.');
  }
  if (scenario === 'private-filter' || scenario === 'same-private-filter') {
    const protectedBefore = fingerprint(process.env.GEMINI_HISTORY_HOME);
    const witness = path.join(root, 'filter-executed');
    const filter = path.join(root, 'synthetic-filter.sh');
    fs.writeFileSync(filter, '#!/bin/sh\nprintf invoked > ' + witness + '\ncat\n', { mode: 0o700 });
    fs.appendFileSync(service.getHistoryDir() + '/.git/config', '\n[filter "synthetic"]\n\tclean = ' + filter + '\n\trequired = true\n');
    fs.writeFileSync(path.join(workspace, '.gitattributes'), '* filter=synthetic\n');
    fs.writeFileSync(file, 'SYNTHETIC MUST REFUSE\n');
    const selected = scenario === 'same-private-filter' ? new GitService(workspace, service.storage) : service;
    await assert.rejects(selected.createFileSnapshot('SYNTHETIC unsafe private Git configuration'),
      /Gemini canonical conversation history is unavailable or unsafe[.]/u,
      'Native Git checkpoint must refuse changed executable configuration before invoking a filter.').catch(error => {
        if (fs.existsSync(witness)) console.log('REPRODUCED: the actual native Git child executed the synthetic private configuration filter.');
        throw error;
      });
    assert.equal(fs.existsSync(witness), false, 'No unapproved Git filter may execute.');
    assert.deepEqual(fingerprint(process.env.GEMINI_HISTORY_HOME), protectedBefore,
      'Refused private executable configuration must preserve canonical history identities and bytes.');
    console.log('PASS: actual native Git refuses changed executable configuration before invoking a filter: ' + scenario);
  }
} else {
  const { first, second } = JSON.parse(fs.readFileSync(path.join(root, 'handoff.json'), 'utf8'));
  assert.equal(await service.getCurrentCommitHash(), second,
    'Native Git checkpoint history must survive private-home disposal.');
  await service.restoreProjectFromSnapshot(first);
  assert.equal(fs.readFileSync(file, 'utf8'), 'SYNTHETIC FIRST 東京\n');
  assert.equal(fs.existsSync(secondFile), false);
  await service.restoreProjectFromSnapshot(second);
  assert.equal(fs.readFileSync(file, 'utf8'), 'SYNTHETIC SECOND café\n');
  assert.equal(fs.readFileSync(secondFile, 'utf8'), 'SYNTHETIC second tracked file\n');
  console.log('PASS: fresh actual native Git restores both canonical checkpoint generations after private-home disposal.');
}
''')

    def start(phase):
        private = root / ('private-' + phase)
        private.mkdir(mode=0o700)
        diagnostic = args.diagnostics.with_name(args.diagnostics.stem + '-' + scenario + '-' + phase + '.log')
        env = {'PATH': os.environ['PATH'], 'HOME': str(private), 'GEMINI_CLI_HOME': str(private),
               'GEMINI_HISTORY_HOME': str(root / 'canonical'), 'FIXTURE_ROOT': str(root),
               'NATIVE_MODULE': module.as_uri(), 'NODE_ENV': 'production'}
        if scenario == 'legacy':
            del env['GEMINI_HISTORY_HOME']
        env['NATIVE_SCENARIO'] = scenario
        if os.environ.get('GEMINI_HISTORY_DEBUG') == '1':
            env['GEMINI_HISTORY_DEBUG'] = '1'
        output = diagnostic.open('wb')
        try:
            diagnostic.chmod(0o600)
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
            assert child.returncode == 0, 'Inspect bounded native Git diagnostics: ' + str(diagnostic)
        finally:
            stop_process_group(child)
            output.close()
        print(diagnostic.read_text().strip())

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
            print('Synthetic native Git checkpoint evidence retained in', suite_root)
