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
parser.add_argument('--scenario', choices=('create-append-race', 'restore-publish-race', 'read-invalid-utf8', 'archive-invalid-utf8', 'import-invalid-utf8', 'unicode-healthy'))
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
if (name === 'lease-owner') {
  h.claimNativeGeminiConversation(file);
  h.appendNativeGeminiConversation(file, '{"lease":true}\n');
  fs.writeFileSync(path.join(root, 'ready'), 'ready');
  const deadline = Date.now() + 10000;
  while (true) {
    assert.ok(Date.now() < deadline);
    await setTimeout(10);
  }
} else if (name === 'lease-peer') {
  const before = h.readNativeGeminiConversation(file);
  assert.equal(h.archiveNativeGeminiConversation(file), 'busy');
  h.assertNativeGeminiHistoryCurrent();
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  const independent = path.join(chats, 'session-independent.jsonl');
  h.claimNativeGeminiConversation(independent);
  h.appendNativeGeminiConversation(independent, '{"independent":true}\n');
  assert.throws(() => h.claimNativeGeminiConversation(file), refused);
} else if (name === 'lease-recover') {
  h.claimNativeGeminiConversation(file);
  const before = h.readNativeGeminiConversation(file);
  assert.equal(before, '{"lease":true}\n');
  assert.equal(h.archiveNativeGeminiConversation(file), true);
  assert.equal(fs.existsSync(file), false);
} else if (name.startsWith('append-')) {
  for (let index = 0; index < 10; index++) h.appendNativeGeminiConversation(file, JSON.stringify({ name, index }) + '\n');
} else if (name === 'stale-rewrite' || name === 'stale-archive') {
  const before = h.readNativeGeminiConversation(file);
  assert.ok(before);
  fs.writeFileSync(path.join(root, 'ready'), 'ready');
  const deadline = Date.now() + 10000;
  while (!fs.existsSync(path.join(root, 'go'))) {
    assert.ok(Date.now() < deadline);
    await setTimeout(10);
  }
  assert.throws(() => name === 'stale-rewrite' ? h.rewriteNativeGeminiConversation(file, before) : h.archiveNativeGeminiConversation(file), refused);
} else {
  assert.equal(h.readNativeGeminiConversation(file), null);
  h.appendNativeGeminiConversation(file, '{"initial":true}\n');
  assert.equal(h.readNativeGeminiConversation(file), '{"initial":true}\n');
  const saved = fs.readFileSync(file);
  const named = fs.realpathSync(file);
  if (name.endsWith('-invalid-utf8')) {
    const source = name.startsWith('import-') ? path.join(root, 'export.jsonl') : file;
    const bytes = Buffer.concat([Buffer.from('{"message":"'), Buffer.from([0xff]), Buffer.from('"}\n')]);
    fs.writeFileSync(source, bytes, { mode: 0o600 });
    const original = fs.statSync(source);
    assert.throws(() => {
      h.readNativeGeminiConversation(source, name.startsWith('import-'));
      if (name.startsWith('archive-')) h.archiveNativeGeminiConversation(source);
    }, refused);
    assert.deepEqual(fs.readFileSync(source), bytes);
    assert.equal(fs.statSync(source).ino, original.ino);
  } else if (name === 'unicode-healthy') {
    const record = JSON.stringify({ message: '日本語 — café 🐝 \uFFFD' }) + '\n';
    h.rewriteNativeGeminiConversation(file, record);
    assert.equal(h.readNativeGeminiConversation(file), record);
    assert.equal(h.archiveNativeGeminiConversation(file), true);
    const archive = h.listNativeGeminiArchivedConversations(chats);
    assert.equal(archive.length, 1);
    assert.equal(h.readNativeGeminiConversation(archive[0]), record);
    const source = path.join(root, 'unicode-export.jsonl');
    fs.writeFileSync(source, record, { mode: 0o600 });
    assert.equal(h.readNativeGeminiConversation(source, true), record);
  } else if (name.startsWith('import-')) {
    const imports = path.join(root, 'imports');
    fs.mkdirSync(imports, { mode: 0o700 });
    const source = path.join(imports, 'export.jsonl');
    const record = { sessionId: 'SYNTHETIC_NATIVE_SESSION-3785', projectHash: '0'.repeat(64), messages: [] };
    const bytes = JSON.stringify(record) + '\n';
    fs.writeFileSync(source, bytes, { mode: 0o600 });
    const original = fs.statSync(source);
    assert.equal(h.readNativeGeminiConversation(source, true), bytes);
    if (name === 'import-healthy') {
      assert.deepEqual(h.admitNativeGeminiConversation(source, record, true), record);
      assert.equal(fs.readFileSync(source, 'utf8'), bytes);
      assert.equal(fs.statSync(source).ino, original.ino);
    } else if (name === 'import-changed') {
      fs.appendFileSync(source, '{"$set":{"summary":"peer"}}\n');
      const changed = fs.readFileSync(source);
      assert.throws(() => h.admitNativeGeminiConversation(source, record, true), refused);
      assert.deepEqual(fs.readFileSync(source), changed);
    } else if (name === 'import-replaced') {
      fs.renameSync(source, source + '-protected');
      fs.writeFileSync(source, bytes, { mode: 0o600 });
      assert.throws(() => h.admitNativeGeminiConversation(source, record, true), refused);
      assert.equal(fs.readFileSync(source, 'utf8'), bytes);
      assert.equal(fs.statSync(source + '-protected').ino, original.ino);
    } else if (name === 'import-parent-replaced') {
      fs.renameSync(imports, imports + '-protected');
      fs.mkdirSync(imports, { mode: 0o700 });
      fs.writeFileSync(source, bytes, { mode: 0o600 });
      assert.throws(() => h.admitNativeGeminiConversation(source, record, true), refused);
      assert.equal(fs.readFileSync(path.join(imports + '-protected', 'export.jsonl'), 'utf8'), bytes);
      assert.equal(fs.statSync(path.join(imports + '-protected', 'export.jsonl')).ino, original.ino);
    } else throw new Error('Unknown bounded native import scenario.');
    assert.deepEqual(fs.readFileSync(file), saved);
  } else if (name === 'create-append-race') {
    const target = path.join(chats, 'session-new.jsonl');
    const open = fs.openSync;
    let injected = false;
    fs.openSync = (filename, flags, ...options) => {
      if (!injected && filename === target && (flags & fs.constants.O_WRONLY) !== 0) {
        injected = true;
        fs.writeFileSync(target, '{"peerCreated":true}\n', { mode: 0o600 });
      }
      return open(filename, flags, ...options);
    };
    assert.throws(() => h.appendNativeGeminiConversation(target, '{"unexpectedAppend":true}\n'), refused);
    assert.equal(injected, true);
    assert.equal(fs.readFileSync(target, 'utf8'), '{"peerCreated":true}\n');
  } else if (name.startsWith('restore-')) {
    const record = { sessionId: '00000000-0000-4000-8000-000000000000', projectHash: path.basename(path.dirname(path.dirname(named))), messages: [] };
    h.rewriteNativeGeminiConversation(file, JSON.stringify(record) + '\n');
    const bytes = fs.readFileSync(file);
    h.archiveNativeGeminiConversation(file);
    const candidates = h.listNativeGeminiArchivedConversations(chats);
    assert.equal(candidates.length, 1);
    const archived = candidates[0];
    assert.equal(h.readNativeGeminiConversation(archived), bytes.toString());
    const original = fs.statSync(archived);
    if (name === 'restore-healthy') {
      assert.equal(h.restoreNativeGeminiConversation(chats, archived, record), file);
      assert.deepEqual(fs.readFileSync(file), bytes);
      assert.notEqual(fs.statSync(file).ino, original.ino);
      h.claimNativeGeminiConversation(file);
      h.appendNativeGeminiConversation(file, '{"$set":{"summary":"restored"}}\n');
      assert.deepEqual(fs.readFileSync(archived), bytes);
      assert.equal(fs.statSync(archived).ino, original.ino);
    } else if (name === 'restore-publish-race') {
      let injected = false;
      let protectedInode;
      const collision = destination => {
        if (!injected && destination === file) {
          injected = true;
          fs.writeFileSync(file, '{"peerCreated":true}\n', { mode: 0o600 });
          protectedInode = fs.statSync(file).ino;
        }
      };
      const rename = fs.renameSync;
      const link = fs.linkSync;
      fs.renameSync = (source, destination) => { collision(destination); return rename(source, destination); };
      fs.linkSync = (source, destination) => { collision(destination); return link(source, destination); };
      assert.throws(() => h.restoreNativeGeminiConversation(chats, archived, record), refused);
      assert.equal(injected, true);
      assert.equal(fs.readFileSync(file, 'utf8'), '{"peerCreated":true}\n');
      assert.equal(fs.statSync(file).ino, protectedInode);
      assert.deepEqual(fs.readFileSync(archived), bytes);
    } else if (name === 'restore-existing') {
      fs.writeFileSync(file, '{"protectedActive":true}\n', { mode: 0o600 });
      const active = fs.statSync(file);
      assert.throws(() => h.restoreNativeGeminiConversation(chats, archived, record), refused);
      assert.equal(fs.readFileSync(file, 'utf8'), '{"protectedActive":true}\n');
      assert.equal(fs.statSync(file).ino, active.ino);
      assert.deepEqual(fs.readFileSync(archived), bytes);
    } else if (name === 'restore-stale' || name === 'restore-malformed') {
      const changed = name === 'restore-stale' ? bytes.toString() + '{"$set":{"summary":"peer"}}\n' : '{malformed-archive\n';
      fs.writeFileSync(archived, changed);
      assert.throws(() => h.restoreNativeGeminiConversation(chats, archived, record), refused);
      assert.equal(fs.readFileSync(archived, 'utf8'), changed);
      assert.equal(fs.existsSync(file), false);
    } else if (name === 'restore-symlink' || name === 'restore-hardlink') {
      const outside = path.join(root, 'protected-archive');
      fs.renameSync(archived, outside);
      if (name === 'restore-symlink') fs.symlinkSync(outside, archived);
      else fs.linkSync(outside, archived);
      assert.throws(() => h.restoreNativeGeminiConversation(chats, archived, record), refused);
      assert.deepEqual(fs.readFileSync(outside), bytes);
      assert.equal(fs.statSync(outside).ino, original.ino);
      assert.equal(fs.existsSync(file), false);
    } else if (name === 'restore-directory-replacement') {
      const archiveDirectory = path.join(chats, '.archive');
      fs.renameSync(archiveDirectory, archiveDirectory + '-retired');
      fs.mkdirSync(archiveDirectory, { mode: 0o700 });
      assert.throws(() => h.restoreNativeGeminiConversation(chats, archived, record), refused);
      assert.equal(fs.existsSync(file), false);
      assert.deepEqual(fs.readFileSync(path.join(archiveDirectory + '-retired', path.basename(archived))), bytes);
    } else if (name === 'restore-foreign-project' || name === 'restore-subagent') {
      const invalid = name === 'restore-foreign-project' ? { ...record, projectHash: '0'.repeat(64) } : { ...record, kind: 'subagent' };
      assert.throws(() => h.restoreNativeGeminiConversation(chats, archived, invalid), refused);
      assert.deepEqual(fs.readFileSync(archived), bytes);
      assert.equal(fs.existsSync(file), false);
    } else if (name === 'restore-list-overflow') {
      for (let index = 0; index < 1024; index++) {
        const suffix = index.toString(16).padStart(12, '0');
        fs.writeFileSync(path.join(chats, '.archive', `session-archive-00000000-0000-0000-0000-${suffix}-session-extra.jsonl`), '{}\n', { mode: 0o600 });
      }
      assert.throws(() => h.listNativeGeminiArchivedConversations(chats), refused);
      assert.deepEqual(fs.readFileSync(archived), bytes);
      assert.equal(fs.existsSync(file), false);
    } else throw new Error('Unknown bounded archive-restore scenario.');
  } else if (name === 'archive-healthy') {
    const original = fs.statSync(file);
    assert.equal(h.archiveNativeGeminiConversation(file), true);
    assert.equal(fs.existsSync(file), false);
    const archive = path.join(chats, '.archive');
    const files = fs.readdirSync(archive);
    assert.equal(files.length, 1);
    const retired = path.join(archive, files[0]);
    assert.deepEqual(fs.readFileSync(retired), saved);
    assert.equal(fs.statSync(retired).ino, original.ino);
    assert.equal(h.readNativeGeminiConversation(retired), saved.toString());
    assert.equal(h.archiveNativeGeminiConversation(file), true);
    assert.equal(fs.readdirSync(archive).length, 2); // The read adds a stable lock.
    assert.throws(() => h.appendNativeGeminiConversation(file, '{}\n'), refused);
    assert.equal(fs.existsSync(file), false);
  } else if (name.startsWith('lease-')) {
    h.claimNativeGeminiConversation(file);
    const lease = fs.readdirSync(path.dirname(named)).find(value => value.startsWith('.writer-'));
    assert.ok(lease);
    const target = path.join(chats, lease);
    fs.unlinkSync(target);
    if (name === 'lease-symlink') fs.symlinkSync(file, target);
    else if (name === 'lease-hardlink') {
      const protectedFile = path.join(root, 'protected-lease');
      fs.writeFileSync(protectedFile, '', { mode: 0o600 });
      fs.linkSync(protectedFile, target);
    } else if (name === 'lease-replacement') fs.writeFileSync(target, '', { mode: 0o600 });
    else throw new Error('Unknown bounded lease scenario.');
    assert.throws(() => h.appendNativeGeminiConversation(file, '{}\n'), refused);
    assert.deepEqual(fs.readFileSync(file), saved);
  } else if (name === 'archive-malformed') {
    fs.writeFileSync(file, '{malformed-conversation\n');
    assert.throws(() => h.archiveNativeGeminiConversation(file), refused);
    assert.equal(fs.readFileSync(file, 'utf8'), '{malformed-conversation\n');
  } else if (name === 'archive-directory-symlink') {
    const outside = path.join(root, 'outside');
    fs.mkdirSync(outside, { mode: 0o700 });
    fs.symlinkSync(outside, path.join(chats, '.archive'));
    assert.throws(() => h.archiveNativeGeminiConversation(file), refused);
    assert.deepEqual(fs.readFileSync(file), saved);
    assert.deepEqual(fs.readdirSync(outside), []);
  } else if (name === 'healthy') {
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
  } else if (['symlink', 'hardlink', 'archive-symlink', 'archive-hardlink'].includes(name)) {
    const protectedFile = path.join(root, 'protected');
    fs.renameSync(file, protectedFile);
    const original = fs.statSync(protectedFile);
    if (name.endsWith('symlink')) fs.symlinkSync(protectedFile, file);
    else fs.linkSync(protectedFile, file);
    assert.throws(() => name.startsWith('archive-') ? h.archiveNativeGeminiConversation(file) : h.readNativeGeminiConversation(file), refused);
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
                     'truncated', 'scalar', 'empty', 'invalid-append', 'invalid-rewrite',
                     'archive-healthy', 'archive-malformed', 'archive-directory-symlink',
                     'archive-symlink', 'archive-hardlink', 'lease-symlink',
                     'lease-hardlink', 'lease-replacement', 'restore-healthy',
                     'restore-existing', 'restore-stale', 'restore-malformed',
                     'restore-symlink', 'restore-hardlink', 'restore-directory-replacement',
                     'restore-foreign-project', 'restore-subagent', 'restore-list-overflow',
                     'create-append-race', 'restore-publish-race', 'import-healthy',
                     'import-changed', 'import-replaced', 'import-parent-replaced',
                     'read-invalid-utf8', 'archive-invalid-utf8', 'import-invalid-utf8',
                     'unicode-healthy'):
        if args.scenario and scenario != args.scenario:
            continue
        finish([launch(fixture(scenario), scenario)])
        print('PASS: native history storage ' + scenario)
    if args.scenario:
        safe_cleanup = True
        raise SystemExit(0)
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
    (concurrent / 'ready').unlink()
    (concurrent / 'go').unlink()
    stale = launch(concurrent, 'stale-archive')
    deadline = time.monotonic() + 5
    while not (concurrent / 'ready').exists():
        assert time.monotonic() < deadline and stale[0].poll() is None
        time.sleep(0.01)
    finish([launch(concurrent, 'append-archive-peer')])
    (concurrent / 'go').write_text('go')
    finish([stale])
    assert len(records[0].read_text().splitlines()) == 60
    assert not (records[0].parent / '.archive').exists()
    assert (lock.stat().st_dev, lock.stat().st_ino) == lock_identity
    print('PASS: stale archive refuses without losing all 60 records; lock inode remains stable')
    leases = fixture('leases')
    owner = launch(leases, 'lease-owner')
    deadline = time.monotonic() + 5
    while not (leases / 'ready').exists():
        assert time.monotonic() < deadline and owner[0].poll() is None
        time.sleep(0.01)
    finish([launch(leases, 'lease-peer')])
    stop_process_group(owner[0])
    owner[1].close()
    finish([launch(leases, 'lease-recover')])
    print('PASS: writer lease excludes a peer, permits independent history and releases after owner death')
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
