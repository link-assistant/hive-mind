#!/usr/bin/env python3
"""Bounded independent-process checks of the native Gemini history adapter."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

from native_process_group import stop_process_group

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('package', type=Path)
parser.add_argument('--diagnostics', type=Path, required=True)
args = parser.parse_args()
package = args.package.resolve(strict=True)
assert json.loads((package / 'package.json').read_text())['version'] == '0.65.0'
helper = package / 'bundle/hive-gemini-history.mjs'
source = Path(__file__).parent / 'native-gemini/history.mjs'
assert hashlib.sha256(helper.read_bytes()).digest() == hashlib.sha256(source.read_bytes()).digest()
root = Path(tempfile.mkdtemp(prefix='hive-3785-gemini-history-storage-'))
root.chmod(0o700)
children = []
safe_cleanup = False
worker = root / 'worker.mjs'
worker.write_text(r'''
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
const h = await import(pathToFileURL(process.argv[2]).href);
const name = process.argv[3];
const root = process.env.FIXTURE_ROOT;
const canonical = process.env.GEMINI_HISTORY_HOME;
const chats = h.nativeGeminiChatsDirectory(path.join(root, 'private'), path.join(root, 'workspace'));
const file = path.join(chats, 'session-storage.jsonl');
const refused = /Gemini canonical conversation history is unavailable or unsafe[.]/;
if (name.startsWith('append-')) {
  for (let index = 0; index < 10; index++) h.appendNativeGeminiConversation(file, JSON.stringify({ name, index }) + '\n');
} else if (name === 'stale-rewrite') {
  const before = h.readNativeGeminiConversation(file);
  assert.ok(before);
  fs.writeFileSync(path.join(root, 'ready'), 'ready');
  const deadline = Date.now() + 10000;
  while (!fs.existsSync(path.join(root, 'go'))) {
    assert.ok(Date.now() < deadline);
    await setTimeout(10);
  }
  assert.throws(() => h.rewriteNativeGeminiConversation(file, before), refused);
} else {
  assert.equal(h.readNativeGeminiConversation(file), null);
  h.appendNativeGeminiConversation(file, '{"initial":true}\n');
  assert.equal(h.readNativeGeminiConversation(file), '{"initial":true}\n');
  const saved = fs.readFileSync(file);
  const named = fs.realpathSync(file);
  if (name === 'healthy') {
    h.rewriteNativeGeminiConversation(file, '{"rewritten":true}\n');
    assert.equal(h.readNativeGeminiConversation(file), '{"rewritten":true}\n');
    assert.ok(fs.readdirSync(path.dirname(named)).some(value => value.startsWith('session-storage.jsonl.preserved-')));
  } else if (name === 'selector-change') {
    process.env.GEMINI_HISTORY_HOME = root;
    assert.throws(h.assertNativeGeminiHistoryCurrent, refused);
  } else if (name === 'selector-unset') {
    delete process.env.GEMINI_HISTORY_HOME;
    assert.throws(h.assertNativeGeminiHistoryCurrent, refused);
  } else if (name === 'root-replacement') {
    fs.renameSync(canonical, canonical + '-retired');
    fs.mkdirSync(canonical, { mode: 0o700 });
    assert.throws(h.assertNativeGeminiHistoryCurrent, refused);
  } else if (name === 'directory-replacement') {
    fs.renameSync(path.dirname(named), path.dirname(named) + '-retired');
    fs.mkdirSync(path.dirname(named), { mode: 0o700 });
    assert.throws(h.assertNativeGeminiHistoryCurrent, refused);
  } else if (name === 'symlink' || name === 'hardlink') {
    const protectedFile = path.join(root, 'protected');
    fs.renameSync(file, protectedFile);
    const original = fs.statSync(protectedFile);
    if (name === 'symlink') fs.symlinkSync(protectedFile, file);
    else fs.linkSync(protectedFile, file);
    assert.throws(() => h.readNativeGeminiConversation(file), refused);
    assert.deepEqual(fs.readFileSync(protectedFile), saved);
    assert.equal(fs.statSync(protectedFile).ino, original.ino);
  } else if (name === 'unsafe-mode') {
    fs.chmodSync(file, 0o644);
    assert.throws(() => h.readNativeGeminiConversation(file), refused);
  } else if (name === 'oversized') {
    fs.truncateSync(file, 32 * 1024 * 1024 + 1);
    assert.throws(() => h.readNativeGeminiConversation(file), refused);
  } else if (['malformed', 'truncated', 'scalar', 'empty'].includes(name)) {
    const content = { malformed: '{malformed-conversation\n', truncated: saved.toString() + '{"$set":', scalar: 'null\n', empty: '' }[name];
    fs.writeFileSync(file, content, { mode: 0o600 });
    assert.throws(() => h.readNativeGeminiConversation(file), refused);
    assert.equal(fs.readFileSync(file, 'utf8'), content);
  } else if (name === 'invalid-append' || name === 'invalid-rewrite') {
    const operation = name === 'invalid-append' ? h.appendNativeGeminiConversation : h.rewriteNativeGeminiConversation;
    assert.throws(() => operation(file, '{invalid-writer\n'), refused);
    assert.deepEqual(fs.readFileSync(file), saved);
  } else if (name === 'traversal') {
    assert.throws(() => h.readNativeGeminiConversation(path.join(chats, '../session-storage.jsonl')), refused);
  } else if (name === 'lock-symlink') {
    const lock = path.join(chats, '.history.lock');
    fs.unlinkSync(lock);
    fs.symlinkSync(file, lock);
    assert.throws(() => h.appendNativeGeminiConversation(file, '{}\n'), refused);
    assert.deepEqual(fs.readFileSync(file), saved);
  } else throw new Error('Unknown bounded storage scenario.');
}
console.log('PASS: ' + name);
''')
worker.chmod(0o600)
args.diagnostics.parent.mkdir(parents=True, exist_ok=True)


def fixture(name):
    directory = root / name
    directory.mkdir(mode=0o700)
    for child in ('canonical', 'private', 'workspace'):
        (directory / child).mkdir(mode=0o700)
    return directory


def launch(directory, scenario):
    diagnostic = args.diagnostics.with_name(args.diagnostics.stem + '-' + directory.name + '-' + scenario + '.log')
    output = diagnostic.open('wb')
    diagnostic.chmod(0o600)
    env = {'PATH': os.environ['PATH'], 'HOME': str(directory / 'private'),
           'FIXTURE_ROOT': str(directory), 'GEMINI_HISTORY_HOME': str(directory / 'canonical')}
    child = subprocess.Popen(['prlimit', '--data=2147483648', '--stack=16777216', '--core=0', '--',
                              shutil.which('node'), '--max-old-space-size=128', str(worker), str(helper), scenario],
                             env=env, stdin=subprocess.DEVNULL, stdout=output,
                             stderr=subprocess.STDOUT, start_new_session=True)
    children.append((child, output))
    return child, output


def finish(group):
    deadline = time.monotonic() + 20
    try:
        while any(child.poll() is None for child, _ in group):
            assert time.monotonic() < deadline, 'Finite history storage deadline exceeded.'
            assert all(os.fstat(output.fileno()).st_size <= 65536 for _, output in group)
            time.sleep(0.02)
        assert all(child.returncode == 0 for child, _ in group), 'Inspect bounded storage diagnostics.'
    finally:
        for child, output in group:
            stop_process_group(child)
            output.close()


try:
    for scenario in ('healthy', 'selector-change', 'selector-unset', 'root-replacement',
                     'directory-replacement', 'symlink', 'hardlink', 'unsafe-mode',
                     'oversized', 'traversal', 'lock-symlink', 'malformed',
                     'truncated', 'scalar', 'empty', 'invalid-append', 'invalid-rewrite'):
        finish([launch(fixture(scenario), scenario)])
        print('PASS: native history storage ' + scenario)
    concurrent = fixture('concurrent')
    finish([launch(concurrent, 'append-' + str(index)) for index in range(4)])
    records = list((concurrent / 'canonical').rglob('session-storage.jsonl'))
    assert len(records) == 1
    lines = [json.loads(line) for line in records[0].read_text().splitlines()]
    assert len(lines) == 40 and len({(row['name'], row['index']) for row in lines}) == 40
    registry = json.loads((concurrent / 'canonical/projects.json').read_text())
    assert len(registry['projects']) == 1
    lock = records[0].parent / '.history.lock'
    lock_identity = (lock.stat().st_dev, lock.stat().st_ino)
    print('PASS: four independent writers preserve all 40 records and one project mapping')
    stale = launch(concurrent, 'stale-rewrite')
    deadline = time.monotonic() + 5
    while not (concurrent / 'ready').exists():
        assert time.monotonic() < deadline and stale[0].poll() is None
        time.sleep(0.01)
    finish([launch(concurrent, 'append-peer')])
    (concurrent / 'go').write_text('go')
    finish([stale])
    assert len(records[0].read_text().splitlines()) == 50
    assert (lock.stat().st_dev, lock.stat().st_ino) == lock_identity
    print('PASS: stale rewrite refuses without losing a concurrent generation; lock inode remains stable')
    safe_cleanup = True
finally:
    try:
        for child, output in children:
            stop_process_group(child)
            output.close()
    except BaseException:
        safe_cleanup = False
        raise
    finally:
        if safe_cleanup:
            shutil.rmtree(root)
        else:
            print('Synthetic history storage evidence retained in', root)
