#!/usr/bin/env python3
"""Finite fresh-process controls for death during first canonical publication."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from native_process_group import stop_process_group

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('package', type=Path)
parser.add_argument('--diagnostics', type=Path, required=True)
parser.add_argument('--scenario', choices=('registry', 'prompt', 'checkpoint', 'artifact', 'blob'))
parser.add_argument('--point', choices=('before-link', 'after-link', 'after-unlink'))
attacks = ('journal-symlink', 'journal-hardlink', 'journal-mode', 'journal-malformed', 'journal-schema', 'journal-invalid-utf8', 'journal-oversized', 'journal-traversal', 'journal-inode', 'journal-digest', 'stage-symlink', 'stage-hardlink', 'stage-mode', 'stage-content', 'stage-missing', 'target-symlink', 'target-hardlink', 'target-mode', 'target-content', 'target-collision')
parser.add_argument('--attack', choices=attacks)
parser.add_argument('--before-control', action='store_true', help='Restore the exact preceding helper only in a disposable native package copy.')
parser.add_argument('--live-journal-replacement', action='store_true')
parser.add_argument('--atomic-proofs', action='store_true', help='Require the exact stage-27 source instead of the earlier publication stage.')
args = parser.parse_args()
if args.attack and (args.before_control or args.live_journal_replacement or args.scenario not in (None, 'registry') or args.point not in (None, 'after-link')):
    parser.error('Unsafe-evidence controls require the repaired registry after-link state.')
package = args.package.resolve(strict=True)
assert json.loads((package / 'package.json').read_text())['version'] == '0.65.0'
if args.atomic_proofs:
    assert not args.before_control, 'Earlier-stage reconstruction must retain its original exact source pins.'
    for name, pin in {'chunk-DKZARV6U.js': '80152a26cf924992ac283a92e1b9b2252326cf6a417edc1c4b147088ca154733',
                      'hive-gemini-history.mjs': 'd522f9e84bffe3d7c9323596f3aa8914bd2ce74e73ff2be3233e6aff6b8729da',
                      'hive-gemini-publication.mjs': '3b2b4dbc2296e6da81d314879e466f100f211579ebee13a63a74d9129bae28d8'}.items():
        assert hashlib.sha256((package / 'bundle' / name).read_bytes()).hexdigest() == pin, name
else:
    assert hashlib.sha256((package / 'bundle/chunk-DKZARV6U.js').read_bytes()).hexdigest() in ('439a87bb21b7c5f172d959f99629d74637cf847a4ddb9a684dbffa280b7cc68b', 'b1b2ad9594865d2b60aee3d1b6cbf1a8d2bb2e7d72946124f9a25bc3c2808608', '9e5df4a69c98a27919561e63ebc5d9338256e399f27c4f5171ff2564cedb9b55', 'a88db8a10a742aa697d71f2e33b9061d2082f6e9b4330b3d9bbefa54fa9616f3', 'ace42576cb7d8f0f2ef710e148cbfb81311929f42f5c3a50851e27cb5e744a07')
    assert (package / 'bundle/hive-gemini-history.mjs').read_bytes() == (Path(__file__).parent / 'history.mjs').read_bytes()
    assert (package / 'bundle/hive-gemini-publication.mjs').read_bytes() == (Path(__file__).parent / 'publication.mjs').read_bytes()
root = Path(tempfile.mkdtemp(prefix='hive-3785-gemini-publication-'))
root.chmod(0o700)
children = []
safe_cleanup = False
args.diagnostics.parent.mkdir(parents=True, exist_ok=True)
try:
    native = root / 'native'
    native.mkdir(mode=0o700)
    shutil.copyfile(package / 'package.json', native / 'package.json')
    shutil.copytree(package / 'bundle', native / 'bundle', symlinks=False)
    if args.before_control:
        helper = native / 'bundle/hive-gemini-history.mjs'
        original = helper.read_text()
        imports = "import { recoverNativeGeminiPublications, publishNativeGeminiExclusive } from './hive-gemini-publication.mjs';\n"
        recover = '    recoverNativeGeminiPublications(parent, current, refuse);\n'
        publish = '      publishNativeGeminiExclusive(parent, name, temporary, content, current, refuse);'
        cleanup = '  } finally {\n    if (fd !== undefined) fs.closeSync(fd);\n  }\n}\n\nexport function nativeGeminiChatsDirectory'
        append = 'export function appendNativeGeminiPromptHistory(temporary, entry, validateAdditional = () => {}) {'
        validate = '    validateAdditional(records);\n'
        for context in (imports, recover, publish, cleanup, append, validate):
            assert original.count(context) == 1
        previous = original.replace(imports, '').replace(recover, '').replace(publish, '      fs.linkSync(temporary, `${parent.anchor}/${name}`);\n      fs.unlinkSync(temporary);')
        previous = previous.replace(append, 'export function appendNativeGeminiPromptHistory(temporary, entry) {').replace(validate, '')
        previous = previous.replace(cleanup, '  } finally {\n    if (fd !== undefined) fs.closeSync(fd);\n    try {\n      fs.unlinkSync(temporary);\n    } catch (error) {\n      if (error.code !== \'ENOENT\') failed = true;\n    }\n  }\n}\n\nexport function nativeGeminiChatsDirectory')
        assert hashlib.sha256(previous.encode()).hexdigest() == 'b3d5662d58bec0036c7350bdb8b498f1edec892942131beaf7189eab3680a8ab'
        helper.write_text(previous)
    worker = native / 'bundle/hive-publication-worker.mjs'
    worker.write_text(r'''
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Logger, Storage } from './chunk-DKZARV6U.js';
import * as history from './hive-gemini-history.mjs';
const root = process.env.FIXTURE_ROOT;
const canonical = process.env.GEMINI_HISTORY_HOME;
const scenario = process.argv[2];
const phase = process.argv[3];
const point = process.argv[4];
const text = 'SYNTHETIC DURABLE HISTORY 東京 café 🐝';
const checkpoint = { history: [{ role: 'user', parts: [{ text }] }] };
const tag = 'synthetic-checkpoint';
if (phase === 'live') {
  let injected;
  const synchronize = fs.fsyncSync;
  fs.fsyncSync = fd => {
    synchronize(fd);
    let journal = fs.readlinkSync('/proc/self/fd/' + fd);
    if (process.env.SYNTHETIC_ATOMIC_PROOFS === '1') {
      const proof = /^\.history-([a-f0-9-]+)\.journal\.tmp(?: \(deleted\))?$/u.exec(path.basename(journal));
      if (proof) journal = path.join(path.dirname(journal), `.publish-${proof[1]}.json`);
      if (!fs.existsSync(journal)) return;
    }
    if (!injected && /^\.publish-.*\.json$/u.test(path.basename(journal))) {
      const original = fs.statSync(journal);
      const bytes = fs.readFileSync(journal);
      const stage = path.join(path.dirname(journal), fs.readdirSync(path.dirname(journal)).find(name => name.startsWith('.history-')));
      const staged = fs.statSync(stage);
      const content = fs.readFileSync(stage);
      fs.renameSync(journal, path.join(root, 'protected-journal'));
      fs.writeFileSync(journal, 'SYNTHETIC-PEER-JOURNAL', { mode: 0o600 });
      injected = { journal, original, bytes, stage, staged, content };
    }
  };
  const live = new Storage(path.join(root, 'workspace'));
  await live.initialize();
  assert.throws(() => live.getProjectTempDir(), /Gemini canonical conversation history is unavailable or unsafe[.]/u, 'A changed publication journal must refuse before linking canonical data.');
  assert.ok(injected);
  assert.equal(fs.readFileSync(injected.journal, 'utf8'), 'SYNTHETIC-PEER-JOURNAL');
  assert.deepEqual(fs.readFileSync(path.join(root, 'protected-journal')), injected.bytes);
  assert.equal(fs.statSync(path.join(root, 'protected-journal')).ino, injected.original.ino);
  assert.deepEqual(fs.readFileSync(injected.stage), injected.content);
  assert.equal(fs.statSync(injected.stage).ino, injected.staged.ino);
  assert.equal(fs.existsSync(path.join(canonical, 'projects.json')), false);
  console.log('PASS: native first publication refuses live journal replacement and retains original staging, protected intent and peer data.');
  process.exit(0);
}
const matches = name => scenario === 'registry' ? name === 'projects.json' : scenario === 'prompt' ? name === 'prompt-history.json' : scenario === 'checkpoint' ? name === 'checkpoint-history.json' : scenario === 'artifact' ? name.startsWith('artifact-') : name.startsWith('blob-');
if (phase === 'owner') {
  const die = (source, destination) => {
    const staged = fs.realpathSync(source);
    const file = path.join(path.dirname(staged), path.basename(destination));
    const info = fs.statSync(source);
    const digest = createHash('sha256').update(fs.readFileSync(source)).digest('hex');
    fs.writeFileSync(path.join(root, 'published.json'), JSON.stringify({ file, staged, ino: info.ino, dev: info.dev, digest }), { mode: 0o600 });
    process.kill(process.pid, 'SIGKILL');
    throw new Error('Unreachable after forced publication-owner death.');
  };
  let publication;
  const link = fs.linkSync;
  fs.linkSync = (source, destination) => {
    if (matches(path.basename(destination)) && point === 'before-link') die(source, destination);
    link(source, destination);
    if (matches(path.basename(destination))) {
      assert.equal(fs.statSync(source).nlink, 2);
      if (point === 'after-link') die(source, destination);
      publication = { source, destination };
    }
  };
  const unlink = fs.unlinkSync;
  fs.unlinkSync = source => {
    if (publication && source === publication.source && point === 'after-unlink') {
      const staged = fs.realpathSync(source);
      const file = path.join(path.dirname(staged), path.basename(publication.destination));
      unlink(source);
      die(file, publication.destination);
    }
    return unlink(source);
  };
}
const storage = new Storage(path.join(root, 'workspace'));
await storage.initialize();
const temporary = storage.getProjectTempDir();
const logger = new Logger('synthetic-session', storage);
await logger.initialize();
if (phase === 'owner') {
  if (scenario === 'prompt') await logger.logMessage('user', text);
  else if (scenario === 'checkpoint') await logger.saveCheckpoint(checkpoint, tag);
  else if (scenario === 'artifact') history.writeNativeGeminiToolOutput(temporary, text, 'synthetic-session');
  else if (scenario === 'blob') history.writeNativeGeminiBlob(temporary, Buffer.from(text).toString('base64'), 'text/plain', 'synthetic-session');
  throw new Error('The finite first-publication crash point was not reached.');
}
const saved = JSON.parse(fs.readFileSync(path.join(root, 'published.json'), 'utf8'));
if (scenario === 'registry') {
  const registry = JSON.parse(fs.readFileSync(saved.file, 'utf8'));
  assert.equal(typeof registry.projects[path.join(root, 'workspace')], 'string');
} else if (scenario === 'prompt') assert.deepEqual(await logger.getPreviousUserMessages(), [text]);
else if (scenario === 'checkpoint') assert.deepEqual(await logger.loadCheckpoint(tag), checkpoint);
else if (scenario === 'artifact') assert.equal(history.readNativeGeminiToolOutput(saved.file), text);
else if (scenario === 'blob') assert.deepEqual(history.readNativeGeminiBlob(saved.file), { bytes: Buffer.from(text), mimeType: 'text/plain' });
const info = fs.statSync(saved.file);
assert.equal(info.nlink, 1, 'Interrupted canonical publication must recover to one checked data link.');
assert.equal(info.ino, saved.ino);
assert.equal(info.dev, saved.dev);
assert.equal(createHash('sha256').update(fs.readFileSync(saved.file)).digest('hex'), saved.digest);
assert.equal(fs.readdirSync(path.dirname(saved.file)).some(name => name.startsWith('.publish-') || name.startsWith('.history-')), false);
console.log('PASS: fresh native ' + scenario + ' reads retain exact bytes/device/inode after first-publication owner death and private-home disposal.');
''')

    def run(fixture, scenario, phase, point):
        private = fixture / ('private-' + phase)
        private.mkdir(mode=0o700)
        diagnostic = args.diagnostics.with_name(args.diagnostics.stem + '-' + scenario + '-' + point + '-' + phase + '.log')
        with diagnostic.open('wb') as output:
            diagnostic.chmod(0o600)
            env = {'PATH': os.environ['PATH'], 'HOME': str(private), 'GEMINI_CLI_HOME': str(private), 'GEMINI_HISTORY_HOME': str(fixture / 'canonical'), 'FIXTURE_ROOT': str(fixture)}
            if args.atomic_proofs:
                env['SYNTHETIC_ATOMIC_PROOFS'] = '1'
            child = subprocess.Popen(['prlimit', '--data=2147483648', '--stack=16777216', '--core=0', '--', shutil.which('node'), '--max-old-space-size=192', str(worker), scenario, phase, point], env=env, stdin=subprocess.DEVNULL, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
            children.append(child)
            try:
                deadline = time.monotonic() + 20
                while child.poll() is None:
                    assert time.monotonic() < deadline and os.fstat(output.fileno()).st_size <= 65536
                    time.sleep(0.02)
                if phase == 'owner':
                    assert child.returncode == -signal.SIGKILL, 'Inspect bounded first-publication owner diagnostics.'
                elif args.attack:
                    assert child.returncode != 0 and 'Error: Gemini canonical conversation history is unavailable or unsafe.' in diagnostic.read_text(), 'Native recovery must refuse unsafe publication evidence.'
                else:
                    assert child.returncode == 0, 'Inspect bounded first-publication peer diagnostics.'
            finally:
                stop_process_group(child)
        if phase == 'owner':
            saved = json.loads((fixture / 'published.json').read_text())
            target = Path(saved['staged'] if point == 'before-link' else saved['file'])
            assert target.stat().st_nlink == (2 if point == 'after-link' else 1)
            assert hashlib.sha256(target.read_bytes()).hexdigest() == saved['digest']
            shutil.rmtree(private)
            print('REPRODUCED: native ' + scenario + ' owner dies at ' + point + ' with complete synchronized canonical publication data.')
        else:
            print('PASS: fresh native recovery refuses ' + args.attack + ' without mutation.' if args.attack else diagnostic.read_text().strip())

    def attack(fixture):
        canonical = fixture / 'canonical'
        journal, = canonical.rglob('.publish-*.json')
        saved = json.loads((fixture / 'published.json').read_text())
        target = Path(saved['file'])
        stage, = target.parent.glob('.history-*.tmp')
        selected = journal if args.attack.startswith('journal-') else stage if args.attack.startswith('stage-') else target
        operation = args.attack.split('-', 1)[1]
        if operation in ('symlink', 'hardlink', 'missing', 'collision'):
            protected = fixture / ('protected-' + args.attack)
            selected.rename(protected)
            if operation == 'symlink':
                selected.symlink_to(protected)
            elif operation == 'hardlink':
                selected.hardlink_to(protected)
            elif operation == 'collision':
                selected.write_text('SYNTHETIC-PEER-PUBLICATION')
                selected.chmod(0o600)
        elif operation == 'mode':
            selected.chmod(0o644)
        elif operation == 'malformed':
            selected.write_text('{')
        elif operation == 'schema':
            selected.write_text('{"version":2}')
        elif operation == 'invalid-utf8':
            selected.write_bytes(b'\xff')
        elif operation == 'oversized':
            with selected.open('r+b') as output:
                output.truncate(4097)
        elif operation in ('traversal', 'inode', 'digest'):
            record = json.loads(selected.read_text())
            record[{'traversal': 'name', 'inode': 'inode', 'digest': 'digest'}[operation]] = {'traversal': '../outside', 'inode': '0', 'digest': '0' * 64}[operation]
            selected.write_text(json.dumps(record))
        elif operation == 'content':
            selected.write_text('SYNTHETIC-CHANGED-PUBLICATION')
        else:
            raise AssertionError('Unknown finite publication attack.')

    def fingerprint(fixture):
        result = {}
        for file in tuple((fixture / 'canonical').rglob('*')) + tuple(fixture.glob('protected-*')):
            info = file.lstat()
            if file.is_symlink():
                content = os.readlink(file)
            elif file.is_file():
                assert info.st_size <= 65536
                content = hashlib.sha256(file.read_bytes()).hexdigest()
            else:
                continue
            result[str(file)] = (info.st_dev, info.st_ino, info.st_mode, info.st_nlink, info.st_size, content)
        return result

    for scenario in ('registry', 'prompt', 'checkpoint', 'artifact', 'blob'):
        if args.live_journal_replacement:
            if scenario == 'registry':
                fixture = root / 'live-journal-replacement'
                fixture.mkdir(mode=0o700)
                for name in ('canonical', 'workspace'):
                    (fixture / name).mkdir(mode=0o700)
                run(fixture, scenario, 'live', 'after-link')
            continue
        if args.scenario and args.scenario != scenario:
            continue
        if args.attack and scenario != 'registry':
            continue
        for point in ('before-link', 'after-link', 'after-unlink'):
            if (args.point and args.point != point) or (args.attack and point != 'after-link'):
                continue
            fixture = root / (scenario + '-' + point)
            fixture.mkdir(mode=0o700)
            for name in ('canonical', 'workspace'):
                (fixture / name).mkdir(mode=0o700)
            run(fixture, scenario, 'owner', point)
            if args.attack:
                attack(fixture)
                before = fingerprint(fixture)
            run(fixture, scenario, 'peer', point)
            if args.attack:
                assert fingerprint(fixture) == before, 'Refusal must preserve every publication and protected file.'
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
            print('Synthetic first-publication evidence retained in', root)
