#!/usr/bin/env python3
"""Exercise all three inspected native tool-output writers with finite input."""
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
args = parser.parse_args()
package = args.package.resolve(strict=True)
assert json.loads((package / 'package.json').read_text())['version'] == '0.65.0'
manager = (package / 'bundle/chunk-DKZARV6U.js').read_bytes()
assert hashlib.sha256(manager).hexdigest() in ('ce32eec6ab27f4d9fbf1449a5bdc70ad9b06fde0aff84b560ac1540a9106a9fa', '236c3faf39cbe2a022409be5ee3ee3147ac1686d146336d0126f6e23f0b465b2', '439a87bb21b7c5f172d959f99629d74637cf847a4ddb9a684dbffa280b7cc68b', 'b1b2ad9594865d2b60aee3d1b6cbf1a8d2bb2e7d72946124f9a25bc3c2808608', '9e5df4a69c98a27919561e63ebc5d9338256e399f27c4f5171ff2564cedb9b55', 'a88db8a10a742aa697d71f2e33b9061d2082f6e9b4330b3d9bbefa54fa9616f3')
assert (package / 'bundle/hive-gemini-history.mjs').read_bytes() == (Path(__file__).parent / 'history.mjs').read_bytes()
root = Path(tempfile.mkdtemp(prefix='hive-3785-gemini-artifacts-'))
root.chmod(0o700)
children = []
safe_cleanup = False
args.diagnostics.parent.mkdir(parents=True, exist_ok=True)
try:
    native = root / 'native'
    native.mkdir(mode=0o700)
    shutil.copyfile(package / 'package.json', native / 'package.json')
    shutil.copytree(package / 'bundle', native / 'bundle', symlinks=False)
    probe = native / 'bundle/hive-artifact-probe.mjs'
    probe.write_bytes(manager + b'\nexport { saveTruncatedToolOutput as hiveSaveOutput, ToolOutputMaskingService as HiveMaskingService, createToolMaskingProcessor as hiveMaskingProcessor, processSingleFileContent as hiveReadFile };\n')
    worker = native / 'bundle/hive-artifact-worker.mjs'
    worker.write_text(r'''
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { hiveSaveOutput, HiveMaskingService, hiveMaskingProcessor, hiveReadFile } from './hive-artifact-probe.mjs';
import * as h from './hive-gemini-history.mjs';
const root = process.env.FIXTURE_ROOT;
const kind = process.argv[2];
const attack = process.argv[3] === 'unsafe';
const selected = process.argv[3] !== 'legacy';
const temporary = path.join(root, 'private', 'tmp');
const canonical = process.env.GEMINI_HISTORY_HOME ?? path.join(root, 'canonical');
const outputRoot = selected ? canonical : temporary;
const workspace = path.join(root, 'workspace');
h.registerNativeGeminiProjectTemp(path.join(root, 'private'), workspace, temporary);
const content = 'SYNTHETIC-NATIVE-ARTIFACT\n' + ('x'.repeat(96) + '\n').repeat(128) + '日本語';
const storage = { getProjectTempDir: () => temporary };
const config = { storage, getSessionId: () => 'synthetic-session', getUsageStatisticsEnabled: () => false,
  getToolOutputMaskingConfig: async () => ({ protectLatestTurn: false, protectionThresholdTokens: 0, minPrunableThresholdTokens: 0 }) };
if (attack) {
  const project = path.dirname(fs.realpathSync(h.nativeGeminiChatsDirectory(path.join(root, 'private'), workspace)));
  fs.symlinkSync(path.join(root, 'protected'), path.join(project, 'tool-outputs'));
}
const operation = async () => {
  if (kind === 'truncate') {
    const result = await hiveSaveOutput(content, 'run_shell_command', 'same-call', temporary, 'synthetic-session');
    assert.ok(result.outputFile.startsWith(outputRoot + '/'));
    assert.equal(selected ? h.readNativeGeminiToolOutput(result.outputFile) : fs.readFileSync(result.outputFile, 'utf8'), content);
  } else if (kind === 'mask-service') {
    const input = [{ role: 'user', parts: [{ functionResponse: { name: 'run_shell_command', id: 'same-call', response: { output: content } } }] }];
    const result = await new HiveMaskingService().mask(input, config);
    assert.equal(result.maskedCount, 1);
    assert.ok(JSON.stringify(result.newHistory).includes(outputRoot + '/'));
  } else if (kind === 'mask-processor') {
    const processor = hiveMaskingProcessor('synthetic-processor', { projectTempDir: temporary, sessionId: 'synthetic-session', tokenCalculator: { tokensToChars: () => 16 } }, { stringLengthThresholdTokens: 4 });
    const result = await processor.process({ targets: [{ id: 'synthetic-node', type: 'TOOL_EXECUTION', payload: { functionResponse: { name: 'run_shell_command', id: 'same-call', response: { output: content } } } }] });
    assert.ok(JSON.stringify(result).includes(outputRoot + '/'));
  } else throw new Error('Unknown native artifact writer.');
};
if (attack) {
  await assert.rejects(operation, /Gemini canonical conversation history is unavailable or unsafe[.]/);
  assert.deepEqual(fs.readdirSync(path.join(root, 'protected')), []);
} else {
  await operation();
  if (!selected) {
    assert.deepEqual(fs.readdirSync(canonical), []);
    assert.ok(fs.readdirSync(temporary, { recursive: true }).some(name => name.endsWith('.txt')));
    console.log('PASS: actual native ' + kind + ' preserves unselected private output behavior');
    process.exit(0);
  }
  const artifacts = fs.readdirSync(canonical, { recursive: true }).filter(name => path.basename(name).startsWith('artifact-'));
  assert.equal(artifacts.length, 1);
  const file = path.join(canonical, artifacts[0]);
  const saved = h.readNativeGeminiToolOutput(file);
  assert.equal(kind === 'mask-service' ? JSON.parse(saved).output : saved, content);
  const slice = await hiveReadFile(file, workspace, {}, 2, 3);
  const expectedLines = saved.split(/\r?\n/).slice(1, 3)
    .map(line => line.length > 2000 ? line.slice(0, 2000) + '... [truncated]' : line);
  assert.equal(slice.llmContent, expectedLines.join('\n'));
  assert.equal(slice.isTruncated, true);
  const ordinary = path.join(workspace, 'ordinary.txt');
  fs.writeFileSync(ordinary, '日本語\nordinary\n');
  assert.equal((await hiveReadFile(ordinary, workspace, {})).llmContent, '日本語\nordinary\n');
  const original = fs.statSync(file);
  assert.equal(original.nlink, 1);
  assert.equal(original.mode & 0o777, 0o600);
  fs.rmSync(path.join(root, 'private'), { recursive: true });
  assert.equal(h.readNativeGeminiToolOutput(file), saved);
  assert.equal(fs.statSync(file).ino, original.ino);
}
assert.equal(fs.existsSync(path.join(temporary, 'tool-outputs')), false);
console.log('PASS: actual native ' + kind + ' ' + (attack ? 'refuses unsafe storage without fallback' : 'preserves canonical output through private-home disposal'));
''')
    for kind in ('truncate', 'mask-service', 'mask-processor'):
        for attack in ('healthy', 'unsafe', 'legacy'):
            fixture = root / (kind + '-' + attack)
            fixture.mkdir(mode=0o700)
            for name in ('private', 'workspace', 'canonical', 'protected'):
                (fixture / name).mkdir(mode=0o700)
            diagnostic = args.diagnostics.with_name(args.diagnostics.stem + '-' + kind + '-' + attack + '.log')
            with diagnostic.open('wb') as output:
                diagnostic.chmod(0o600)
                env = {'PATH': os.environ['PATH'], 'HOME': str(fixture / 'private'),
                       'FIXTURE_ROOT': str(fixture)}
                if attack != 'legacy':
                    env['GEMINI_HISTORY_HOME'] = str(fixture / 'canonical')
                child = subprocess.Popen(['prlimit', '--data=2147483648', '--stack=16777216', '--core=0', '--',
                                          shutil.which('node'), '--max-old-space-size=256', str(worker), kind, attack],
                                         env=env,
                                         stdin=subprocess.DEVNULL, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
                children.append(child)
                deadline = time.monotonic() + 20
                try:
                    while child.poll() is None:
                        assert time.monotonic() < deadline, 'Finite native artifact writer deadline exceeded.'
                        assert os.fstat(output.fileno()).st_size <= 65536
                        time.sleep(0.02)
                    assert child.returncode == 0, 'Inspect bounded native artifact writer diagnostics.'
                finally:
                    stop_process_group(child)
            print(diagnostic.read_text().strip())
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
            print('Synthetic native artifact writer evidence retained in', root)
