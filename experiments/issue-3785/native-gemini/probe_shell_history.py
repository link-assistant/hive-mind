#!/usr/bin/env python3
"""Bounded controls exercising the actual native interactive shell-history hook."""
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
attacks = ('symlink', 'hardlink', 'unsafe-mode', 'malformed', 'invalid-utf8', 'oversized', 'command-schema', 'command-schema-submit', 'missing', 'parent-replacement', 'root-replacement')
scenarios = ('lifetime', 'peer', 'write-failure', 'concurrent', 'retention', 'legacy', 'multiline', 'prompt-separation', 'early-submit', 'load-failure', 'invalid-command') + tuple('unsafe-' + attack for attack in attacks)
parser.add_argument('--scenario', choices=scenarios)
args = parser.parse_args()
package = args.package.resolve(strict=True)
assert json.loads((package / 'package.json').read_text())['version'] == '0.65.0'
assert hashlib.sha256((package / 'bundle/chunk-DKZARV6U.js').read_bytes()).hexdigest() in ('439a87bb21b7c5f172d959f99629d74637cf847a4ddb9a684dbffa280b7cc68b', 'b1b2ad9594865d2b60aee3d1b6cbf1a8d2bb2e7d72946124f9a25bc3c2808608', '9e5df4a69c98a27919561e63ebc5d9338256e399f27c4f5171ff2564cedb9b55', 'a88db8a10a742aa697d71f2e33b9061d2082f6e9b4330b3d9bbefa54fa9616f3', 'ace42576cb7d8f0f2ef710e148cbfb81311929f42f5c3a50851e27cb5e744a07', '13f2fce9a55408b50001683d440f791a1d21cdcc3c22799f8832edad4a1ef769', '91ce4040ae4296cfa2b82238f2b9a2291bbbf86086a85c1c9b341d08272eae28', '80152a26cf924992ac283a92e1b9b2252326cf6a417edc1c4b147088ca154733')
history = (package / 'bundle/hive-gemini-history.mjs').read_bytes()
if hashlib.sha256((package / 'bundle/chunk-DKZARV6U.js').read_bytes()).hexdigest() in ('13f2fce9a55408b50001683d440f791a1d21cdcc3c22799f8832edad4a1ef769', '91ce4040ae4296cfa2b82238f2b9a2291bbbf86086a85c1c9b341d08272eae28', '80152a26cf924992ac283a92e1b9b2252326cf6a417edc1c4b147088ca154733'):
    assert hashlib.sha256(history).hexdigest() in ('216f492a7687f3126f8cd060976656c232fcbaa057a90e3bc042c9054c8933ed', '4072ef64f7258b229a63a64fb3834c28c4f54477482eaeca44cbbb409a5e1cbd', '316d864e6ba63b15c6685b7da7f86f831652eedfbc0c1c62ed01edc619a31688')
else:
    assert history == (Path(__file__).parent / 'history.mjs').read_bytes()
ui_pin = hashlib.sha256((package / 'bundle/interactiveCli-AVD3AKNJ.js').read_bytes()).hexdigest()
assert ui_pin in ('286a6aa958fe8a99dcb87a3ffe094c8ef889449fb298fc18f54065c7cab3a749', 'a1f578e876bbdfd04e4140a8a2dfeb6750ab569db2d4d24aadd72e3dd4304422', '5aac5d78adb500c820779bac8deec422a5c30d2436d746e946848c71b95c2c64', '1092664e6803b78047a74c8115d8f432c48ef459f121b57ac33c5543efe81a40', '80b096b4fbbe0c92bb3dff50b84dfd54a133a2443cc05b721f76d6acdaf99a1c')
if ui_pin != '286a6aa958fe8a99dcb87a3ffe094c8ef889449fb298fc18f54065c7cab3a749':
    assert (package / 'bundle/hive-gemini-shell-history.mjs').read_bytes() == (Path(__file__).parent / 'shell_history.mjs').read_bytes()
root = Path(tempfile.mkdtemp(prefix='hive-3785-gemini-shell-history-'))
root.chmod(0o700)
children = []
safe_cleanup = False
args.diagnostics.parent.mkdir(parents=True, exist_ok=True)
try:
    native = root / 'native'
    native.mkdir(mode=0o700)
    shutil.copyfile(package / 'package.json', native / 'package.json')
    shutil.copytree(package / 'bundle', native / 'bundle', symlinks=False)
    ui = native / 'bundle/interactiveCli-AVD3AKNJ.js'
    source = ui.read_text()
    export = 'export {\n  startInteractiveUI\n};'
    assert source.count(export) == 1
    ui.write_text(source.replace(export, 'export {\n  startInteractiveUI,\n  useShellHistory as hiveUseShellHistory,\n  getHistoryFilePath as hiveGetHistoryFilePath,\n  readHistoryFile as hiveReadHistoryFile,\n  require_react as hiveGetReact\n};'))
    worker = native / 'bundle/hive-shell-history-worker.mjs'
    worker.write_text(r'''
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { Logger, Storage } from './chunk-DKZARV6U.js';
import { createHash } from 'node:crypto';
import { hiveUseShellHistory, hiveGetHistoryFilePath, hiveReadHistoryFile, hiveGetReact } from './interactiveCli-AVD3AKNJ.js';
const root = process.env.FIXTURE_ROOT;
const scenario = process.argv[2];
const phase = process.argv[3];
const command = scenario === 'multiline' ? 'printf "SYNTHETIC SHELL 東京 café 🐝"\nprintf "literal \\\\ suffix"' : 'printf "SYNTHETIC SHELL 東京 café 🐝"';
const storage = new Storage(path.join(root, 'workspace'));
await storage.initialize();
const file = await hiveGetHistoryFilePath(path.join(root, 'workspace'), storage);
const internals = hiveGetReact().__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
const refusal = /Gemini canonical conversation history is unavailable or unsafe[.]/u;
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
function canonicalFile() {
  const name = fs.readdirSync(process.env.GEMINI_HISTORY_HOME, { recursive: true }).find(name => name.endsWith('/prompt-history.json'));
  assert.ok(name, 'Selected native shell commands must have a canonical audit.');
  return path.join(process.env.GEMINI_HISTORY_HOME, name);
}
// The native hook body executes unchanged. This finite dispatcher only supplies
// React state/effect callbacks; no TUI rendering or command execution is mocked.
function instance() {
  const values = [];
  let cursor = 0;
  let loaded = false;
  let hook;
  const effects = [];
  const dispatcher = {
    useState(initial) {
      const slot = cursor++;
      if (!(slot in values)) values[slot] = typeof initial === 'function' ? initial() : initial;
      return [values[slot], value => {
        values[slot] = typeof value === 'function' ? value(values[slot]) : value;
        if (slot === 0) loaded = true;
      }];
    },
    useEffect(effect, dependencies) {
      const slot = cursor++;
      if (!(slot in values) || dependencies.some((value, index) => value !== values[slot][index])) effects.push(effect);
      values[slot] = dependencies;
    },
    useCallback(callback, dependencies) {
      const slot = cursor++;
      if (!(slot in values) || dependencies.some((value, index) => value !== values[slot].dependencies[index])) values[slot] = { callback, dependencies };
      return values[slot].callback;
    }
  };
  const render = () => {
    cursor = 0;
    const previous = internals.H;
    internals.H = dispatcher;
    try { hook = hiveUseShellHistory(path.join(root, 'workspace'), storage); }
    finally { internals.H = previous; }
    for (const effect of effects.splice(0)) effect();
    return hook;
  };
  return { render, ready: async () => {
    render();
    const deadline = Date.now() + 5000;
    while (!loaded) { assert.ok(Date.now() < deadline, 'Native shell history must initialize within its finite fixture deadline.'); await setTimeout(10); }
    return render();
  } };
}
async function contains(expected) {
  const deadline = Date.now() + 5000;
  while (!(await hiveReadHistoryFile(file)).includes(expected)) {
    assert.ok(Date.now() < deadline, 'Healthy native shell write must be readable before disposal.');
    await setTimeout(10);
  }
}
if (phase === 'verify' || phase === 'peer') {
  const hook = await instance().ready();
  if (phase === 'peer') assert.ok(hook.history.includes(command), 'Native interactive shell history must survive private-home disposal.');
  else {
    assert.equal(hook.history.length, 40);
    assert.equal(new Set(hook.history).size, 40);
    for (let writer = 0; writer < 4; writer++) for (let index = 0; index < 10; index++) assert.ok(hook.history.includes('SYNTHETIC-WRITER-' + writer + '-' + index));
  }
  console.log('PASS: fresh actual native shell hook reads ' + phase + ' commands.');
  process.exit(0);
}
const current = instance();
if (scenario === 'early-submit') {
  const pending = current.render();
  assert.throws(() => pending.addCommandToHistory(command), refusal, 'Selected native shell submit must refuse before its history selector is ready.');
  console.log('PASS: actual native shell hook refuses submit before history initialization.');
  process.exit(0);
}
let hook = await current.ready();
if (phase.startsWith('writer-')) {
  fs.writeFileSync(path.join(root, phase + '.ready'), 'ready');
  const deadline = Date.now() + 10000;
  while (!fs.existsSync(path.join(root, 'go'))) { assert.ok(Date.now() < deadline); await setTimeout(10); }
  const writer = phase.slice(7);
  for (let index = 0; index < 10; index++) {
    const next = 'SYNTHETIC-WRITER-' + writer + '-' + index;
    hook.addCommandToHistory(next);
    await contains(next);
    hook = current.render();
  }
  console.log('PASS: actual native shell hook ' + phase + ' persisted ten commands.');
  process.exit(0);
}
if (scenario === 'peer') {
  const other = instance();
  const peer = await other.ready();
  peer.addCommandToHistory(command);
  await contains(command);
  assert.equal(hook.getPreviousCommand(), command, 'Native shell navigation must observe the latest peer command.');
  console.log('PASS: cached native shell navigation observes the latest peer command.');
  process.exit(0);
}
hook.addCommandToHistory(command);
await contains(command);
hook = current.render();
assert.ok(hook.history.includes(command));
if (scenario === 'lifetime' || scenario === 'legacy' || scenario === 'multiline') {
  if (scenario === 'legacy') {
    assert.deepEqual(fs.readdirSync(path.join(root, 'canonical')), []);
    assert.ok(fs.existsSync(file));
  }
  console.log('PASS: healthy actual native shell hook writes and reads its command.');
  process.exit(0);
}
if (scenario === 'write-failure') {
  const selected = process.env.GEMINI_HISTORY_HOME && fs.readdirSync(process.env.GEMINI_HISTORY_HOME, { recursive: true }).find(name => name.endsWith('/prompt-history.json'));
  const protectedFile = selected ? path.join(process.env.GEMINI_HISTORY_HOME, selected) : file;
  const original = fingerprint(protectedFile);
  const write = fs.writeFileSync;
  fs.writeFileSync = (...arguments_) => {
    if (typeof arguments_[0] === 'number') throw new Error('SYNTHETIC-SHELL-IO-FAILURE');
    return write(...arguments_);
  };
  fsPromises.writeFile = async () => { throw new Error('SYNTHETIC-SHELL-IO-FAILURE'); };
  assert.throws(() => hook.addCommandToHistory('SYNTHETIC-FAILED-WRITE'), /Gemini canonical conversation history is unavailable or unsafe[.]/u, 'Native shell submit must refuse a failed history write synchronously.');
  assert.deepEqual(fingerprint(protectedFile), original);
  console.log('PASS: actual native shell hook propagates failed persistence before returning to submit.');
  process.exit(0);
}
if (scenario === 'prompt-separation') {
  const logger = new Logger('synthetic-native-session', storage);
  await logger.initialize();
  assert.deepEqual(await logger.getPreviousUserMessages(), []);
  await logger.logMessage('user', 'SYNTHETIC-USER-PROMPT');
  assert.deepEqual(await logger.getPreviousUserMessages(), ['SYNTHETIC-USER-PROMPT']);
  assert.deepEqual(await hiveReadHistoryFile(file), [command]);
  console.log('PASS: actual native Logger prompt navigation and shell commands retain separate record types.');
  process.exit(0);
}
if (scenario === 'invalid-command') {
  const protectedFile = canonicalFile();
  const original = fingerprint(protectedFile);
  assert.throws(() => hook.addCommandToHistory('SYNTHETIC\0INVALID'), refusal);
  assert.deepEqual(fingerprint(protectedFile), original);
  console.log('PASS: native shell hook refuses invalid command data without changing the audit.');
  process.exit(0);
}
if (scenario === 'load-failure') {
  const protectedFile = canonicalFile();
  fs.writeFileSync(protectedFile, '{');
  const original = fingerprint(protectedFile);
  const next = instance();
  next.render();
  const deadline = Date.now() + 5000;
  let rejected = false;
  while (!rejected) {
    await setTimeout(10);
    try { next.render(); }
    catch (error) { assert.match(error.message, refusal); rejected = true; }
    assert.ok(Date.now() < deadline, 'Selected native hook initialization failures must reach render admission.');
  }
  assert.deepEqual(fingerprint(protectedFile), original);
  console.log('PASS: actual native hook propagates asynchronous initialization refusal into its next render.');
  process.exit(0);
}
if (scenario.startsWith('unsafe-')) {
  const attack = scenario.slice(7);
  const target = canonicalFile();
  let protectedFile = target;
  if (['symlink', 'hardlink', 'missing'].includes(attack)) {
    protectedFile = path.join(root, 'protected-shell-audit');
    fs.renameSync(target, protectedFile);
    if (attack === 'symlink') fs.symlinkSync(protectedFile, target);
    if (attack === 'hardlink') fs.linkSync(protectedFile, target);
  } else if (attack === 'unsafe-mode') fs.chmodSync(target, 0o644);
  else if (attack === 'malformed') fs.writeFileSync(target, '{');
  else if (attack === 'invalid-utf8') fs.writeFileSync(target, Buffer.from([0xff]));
  else if (attack === 'oversized') fs.truncateSync(target, 32 * 1024 * 1024 + 1);
  else if (attack.startsWith('command-schema')) {
    const records = JSON.parse(fs.readFileSync(target, 'utf8'));
    records.find(entry => entry.type === 'shell-command').message = 'SYNTHETIC\0INVALID';
    fs.writeFileSync(target, JSON.stringify(records));
  }
  else if (attack === 'parent-replacement' || attack === 'root-replacement') {
    const parent = attack === 'root-replacement' ? process.env.GEMINI_HISTORY_HOME : path.dirname(target);
    fs.renameSync(parent, parent + '-protected');
    fs.mkdirSync(parent, { mode: 0o700 });
    protectedFile = path.join(parent + '-protected', path.relative(parent, target));
  } else throw new Error('Unknown finite native shell attack.');
  const original = fingerprint(protectedFile);
  if (attack === 'command-schema-submit') assert.throws(() => hook.addCommandToHistory('SYNTHETIC-REFUSED-COMMAND'), refusal, 'Native shell submit must validate existing command records before publishing.');
  assert.throws(() => hook.getPreviousCommand(), refusal);
  assert.throws(() => hook.addCommandToHistory('SYNTHETIC-REFUSED-COMMAND'), refusal);
  assert.deepEqual(fingerprint(protectedFile), original);
  assert.equal(fs.existsSync(file), false);
  console.log('PASS: actual native shell navigation/submit refuses ' + attack + ' and preserves protected audit data.');
  process.exit(0);
}
if (scenario === 'retention') {
  for (let index = 0; index < 120; index++) {
    hook.addCommandToHistory('SYNTHETIC-RETENTION-' + index);
    hook = current.render();
  }
  hook.addCommandToHistory(command);
  hook = current.render();
  assert.equal(hook.history.length, 100);
  assert.equal(hook.history[0], command);
  assert.equal(new Set(hook.history).size, 100);
  const file = fs.readdirSync(process.env.GEMINI_HISTORY_HOME, { recursive: true }).find(name => name.endsWith('/prompt-history.json'));
  assert.ok(file, 'Native shell command audit must be canonical.');
  const audit = JSON.parse(fs.readFileSync(path.join(process.env.GEMINI_HISTORY_HOME, file), 'utf8')).filter(entry => entry.type === 'shell-command');
  assert.equal(audit.length, 122, 'The 100-command navigation cap must retain the complete command audit.');
  assert.equal(audit[0].message, command);
  assert.equal(audit.at(-1).message, command);
  console.log('PASS: native shell navigation retains its deduplicated 100-command cap and all 122 audit events.');
}
''')

    def start(fixture, scenario, phase):
        private = fixture / ('private-' + phase)
        private.mkdir(mode=0o700)
        diagnostic = args.diagnostics.with_name(args.diagnostics.stem + '-' + scenario + '-' + phase + '.log')
        output = diagnostic.open('wb')
        diagnostic.chmod(0o600)
        env = {'PATH': os.environ['PATH'], 'HOME': str(private), 'GEMINI_CLI_HOME': str(private), 'FIXTURE_ROOT': str(fixture), 'NODE_ENV': 'production'}
        if scenario != 'legacy':
            env['GEMINI_HISTORY_HOME'] = str(fixture / 'canonical')
        child = subprocess.Popen(['prlimit', '--data=2147483648', '--stack=16777216', '--core=0', '--', shutil.which('node'), '--max-old-space-size=256', str(worker), scenario, phase], env=env, stdin=subprocess.DEVNULL, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
        children.append(child)
        return child, output, diagnostic, time.monotonic() + 25

    def finish(running):
        child, output, diagnostic, deadline = running
        try:
            while child.poll() is None:
                assert time.monotonic() < deadline and os.fstat(output.fileno()).st_size <= 65536
                time.sleep(0.02)
            assert child.returncode == 0, 'Inspect bounded native shell hook diagnostics: ' + str(diagnostic)
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
        else:
            finish(start(fixture, scenario, 'owner'))
            if scenario != 'legacy' and ui_pin != '286a6aa958fe8a99dcb87a3ffe094c8ef889449fb298fc18f54065c7cab3a749':
                assert not list(fixture.glob('private-*/**/shell_history')), 'Selected native shell history must never write the private file.'
            if scenario in ('lifetime', 'multiline'):
                shutil.rmtree(fixture / 'private-owner')
                finish(start(fixture, scenario, 'peer'))
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
            print('Synthetic native shell hook evidence retained in', root)
