#!/usr/bin/env python3
"""Exercise the native multimodal degradation writer with finite input."""
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
scenarios = ('healthy', 'uppercase-mime', 'unpadded-base64', 'text-payload', 'svg-payload', 'utf16-payload', 'audio-text-payload', 'legacy', 'unsafe-directory', 'invalid-base64', 'invalid-padding', 'invalid-mime', 'non-ascii-mime',
             'symlink', 'hardlink', 'unsafe-mode', 'content-change', 'missing',
             'parent-replacement', 'oversized', 'foreign-project', 'traversal',
             'collision', 'external-reference')
parser.add_argument('--scenario', choices=scenarios)
args = parser.parse_args()
package = args.package.resolve(strict=True)
assert json.loads((package / 'package.json').read_text())['version'] == '0.65.0'
manager = (package / 'bundle/chunk-DKZARV6U.js').read_bytes()
assert hashlib.sha256(manager).hexdigest() in ('ce32eec6ab27f4d9fbf1449a5bdc70ad9b06fde0aff84b560ac1540a9106a9fa', '236c3faf39cbe2a022409be5ee3ee3147ac1686d146336d0126f6e23f0b465b2')
assert (package / 'bundle/hive-gemini-history.mjs').read_bytes() == (Path(__file__).parent / 'history.mjs').read_bytes()
root = Path(tempfile.mkdtemp(prefix='hive-3785-gemini-blobs-'))
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
    probe.write_bytes(manager + b'\nexport { createBlobDegradationProcessor as hiveBlobProcessor, processSingleFileContent as hiveReadFile };\n')
    worker = native / 'bundle/hive-blob-worker.mjs'
    worker.write_text(r'''
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { hiveBlobProcessor, hiveReadFile } from './hive-artifact-probe.mjs';
import * as h from './hive-gemini-history.mjs';
const root = process.env.FIXTURE_ROOT;
const scenario = process.argv[2];
const selected = scenario !== 'legacy';
const temporary = path.join(root, 'private', 'tmp');
const canonical = process.env.GEMINI_HISTORY_HOME;
const workspace = path.join(root, 'workspace');
h.registerNativeGeminiProjectTemp(path.join(root, 'private'), workspace, temporary);
const kind = scenario.replace(/^peer-/, '');
const textPayload = kind === 'svg-payload' ? '<svg xmlns="http://www.w3.org/2000/svg"><title>SYNTHETIC-SVG</title></svg>\n' : '{"message":"SYNTHETIC-JSON-東京-café-😀"}\n';
const textCase = kind.endsWith('-payload');
const textBytes = kind === 'utf16-payload' ? Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(textPayload, 'utf16le')]) : Buffer.from(textPayload);
const data = textCase ? textBytes.toString('base64') : 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6HVkAAAAASUVORK5CYII=';
function verifyRead(result) {
  if (textCase) assert.equal(result.llmContent, textPayload, 'Native text blob reads must preserve their original text behavior.');
  else {
    assert.equal(result.llmContent.inlineData.mimeType, 'image/png');
    assert.deepEqual(Buffer.from(result.llmContent.inlineData.data, 'base64'), Buffer.from(data, 'base64'));
  }
}
if (scenario.startsWith('peer-')) {
  const retained = JSON.parse(fs.readFileSync(path.join(root, 'retained.json'), 'utf8'));
  const result = await hiveReadFile(retained.file, workspace, {});
  verifyRead(result);
  assert.equal(fs.statSync(retained.file).ino, retained.inode);
  assert.equal(fs.statSync(retained.file).dev, retained.device);
  assert.equal(fs.existsSync(path.join(temporary, 'degraded-blobs')), false);
  console.log('PASS: fresh native process reads retained blob with ' + scenario.slice(5) + '.');
  process.exit(0);
}
const processor = hiveBlobProcessor('synthetic-blob', { projectTempDir: temporary, sessionId: 'synthetic-session', tokenCalculator: { estimateTokensForParts: parts => parts[0].inlineData || parts[0].fileData ? 100000 : 1 } });
const refused = /Gemini canonical conversation history is unavailable or unsafe[.]/;
const payload = { inlineData: { data, mimeType: 'image/png' } };
if (textCase) payload.inlineData.mimeType = 'application/json';
if (kind === 'svg-payload') payload.inlineData.mimeType = 'image/svg+xml';
if (kind === 'audio-text-payload') payload.inlineData.mimeType = 'audio/mpeg';
if (scenario === 'uppercase-mime') payload.inlineData.mimeType = 'IMAGE/PNG';
if (scenario === 'unpadded-base64') payload.inlineData.data = data.replace(/=+$/, '');
if (scenario === 'invalid-base64') payload.inlineData.data = '!!!!';
if (scenario === 'invalid-padding') payload.inlineData.data = '==';
if (scenario === 'invalid-mime') payload.inlineData.mimeType = 'image/../../escape';
if (scenario === 'non-ascii-mime') payload.inlineData.mimeType = 'image/ſynthetic';
if (scenario === 'external-reference') {
  const input = [{ id: 'synthetic-reference', payload: { fileData: { mimeType: 'image/png', fileUri: 'https://synthetic.invalid/retained' } } }];
  const result = await processor.process({ targets: input });
  assert.ok(result[0].payload.text.startsWith('[File Reference (image/png)'));
  assert.ok(result[0].payload.text.includes('https://synthetic.invalid/retained'));
  assert.equal(result[0].replacesId, 'synthetic-reference');
  assert.equal(fs.readdirSync(canonical, { recursive: true }).some(name => name.includes('degraded-blobs')), false);
  console.log('PASS: native external blob reference retains its URI without local copying.');
  process.exit(0);
}
if (scenario === 'unsafe-directory') {
  const project = path.dirname(fs.realpathSync(h.nativeGeminiChatsDirectory(path.join(root, 'private'), workspace)));
  fs.symlinkSync(path.join(root, 'protected'), path.join(project, 'degraded-blobs'));
}
let collision;
if (scenario === 'collision') {
  const link = fs.linkSync;
  fs.linkSync = (source, target) => {
    if (path.basename(target).startsWith('blob-')) {
      collision = target;
      fs.writeFileSync(target, 'SYNTHETIC-PEER', { mode: 0o600 });
    }
    return link(source, target);
  };
}
const write = () => processor.process({ targets: [{ id: 'synthetic-node', type: 'MULTIMODAL_BLOB', payload, turnId: 'synthetic-turn' }] });
if (['unsafe-directory', 'invalid-base64', 'invalid-padding', 'invalid-mime', 'non-ascii-mime', 'collision'].includes(scenario)) {
  await assert.rejects(write, refused);
  assert.deepEqual(fs.readdirSync(path.join(root, 'protected')), []);
  if (scenario === 'collision') {
    assert.ok(collision);
    assert.equal(fs.readFileSync(collision, 'utf8'), 'SYNTHETIC-PEER');
  }
  assert.equal(fs.existsSync(path.join(temporary, 'degraded-blobs')), false);
  console.log('PASS: actual native blob writer refuses ' + scenario + ' without fallback.');
  process.exit(0);
}
const result = await write();
assert.equal(result.length, 1);
const reference = /Saved to: (.+)\]$/.exec(result[0].payload.text);
assert.ok(reference, 'The actual native processor must first offload the blob.');
const file = reference[1];
const bytes = fs.readFileSync(file);
assert.deepEqual(bytes, Buffer.from(data, 'base64'));
const before = fs.statSync(file);
const read = await hiveReadFile(file, workspace, {});
verifyRead(read);
if (!['healthy', 'uppercase-mime', 'unpadded-base64', 'legacy'].includes(scenario) && !textCase) {
  let input = file;
  let protectedFile = file;
  if (['symlink', 'hardlink', 'missing'].includes(scenario)) {
    protectedFile = path.join(root, 'protected', 'blob');
    fs.renameSync(file, protectedFile);
    if (scenario === 'symlink') fs.symlinkSync(protectedFile, file);
    if (scenario === 'hardlink') fs.linkSync(protectedFile, file);
  } else if (scenario === 'unsafe-mode') fs.chmodSync(file, 0o644);
  else if (scenario === 'content-change') fs.writeFileSync(file, 'SYNTHETIC-CHANGED');
  else if (scenario === 'oversized') fs.truncateSync(file, 32 * 1024 * 1024 + 1);
  else if (scenario === 'parent-replacement') {
    const parent = path.dirname(file);
    fs.renameSync(parent, parent + '-retained');
    fs.mkdirSync(parent, { mode: 0o700 });
    protectedFile = path.join(parent + '-retained', path.basename(file));
  } else if (scenario === 'foreign-project') {
    input = file.replace(path.basename(path.dirname(path.dirname(path.dirname(file)))), '0'.repeat(64));
  } else if (scenario === 'traversal') {
    input = path.dirname(file) + '/../' + path.basename(path.dirname(file)) + '/' + path.basename(file);
  } else throw new Error('Unknown bounded native blob scenario.');
  const original = fs.statSync(protectedFile);
  const saved = scenario === 'oversized' ? undefined : fs.readFileSync(protectedFile);
  await assert.rejects(() => hiveReadFile(input, workspace, {}), refused);
  assert.equal(fs.statSync(protectedFile).ino, original.ino);
  assert.equal(fs.statSync(protectedFile).size, original.size);
  if (saved) assert.deepEqual(fs.readFileSync(protectedFile), saved);
  console.log('PASS: actual native blob reader refuses ' + scenario + ' without changing protected data.');
  process.exit(0);
}
fs.rmSync(path.join(root, 'private'), { recursive: true });
if (!selected) {
  assert.equal(fs.existsSync(file), false);
  assert.deepEqual(fs.readdirSync(path.join(root, 'canonical')), []);
  console.log('PASS: unselected native degraded blob keeps original private storage behavior.');
  process.exit(0);
}
assert.ok(fs.existsSync(file), 'Native degraded blob history must survive private-home disposal.');
assert.ok(file.startsWith(canonical + '/'));
assert.deepEqual(fs.readFileSync(file), bytes);
assert.equal(fs.statSync(file).ino, before.ino);
const resumed = await hiveReadFile(file, workspace, {});
assert.deepEqual(resumed.llmContent, read.llmContent);
assert.equal(before.mode & 0o777, 0o600);
assert.equal(before.nlink, 1);
fs.writeFileSync(path.join(root, 'retained.json'), JSON.stringify({ file, inode: before.ino, device: before.dev }), { mode: 0o600 });
console.log('PASS: actual native degraded blob/image read survives private-home disposal with ' + scenario + '.');
''')
    for scenario in scenarios:
        if args.scenario and scenario != args.scenario:
            continue
        fixture = root / scenario
        fixture.mkdir(mode=0o700)
        for name in ('private', 'workspace', 'canonical', 'protected'):
            (fixture / name).mkdir(mode=0o700)
        operations = (scenario, 'peer-' + scenario) if scenario in ('healthy', 'uppercase-mime', 'unpadded-base64') or scenario.endswith('-payload') else (scenario,)
        for operation in operations:
            if operation.startswith('peer-'):
                (fixture / 'private').mkdir(mode=0o700)
            diagnostic = args.diagnostics.with_name(args.diagnostics.stem + '-' + operation + '.log')
            with diagnostic.open('wb') as output:
                diagnostic.chmod(0o600)
                env = {'PATH': os.environ['PATH'], 'HOME': str(fixture / 'private'), 'FIXTURE_ROOT': str(fixture)}
                if scenario != 'legacy':
                    env['GEMINI_HISTORY_HOME'] = str(fixture / 'canonical')
                child = subprocess.Popen(['prlimit', '--data=2147483648', '--stack=16777216', '--core=0', '--',
                                          shutil.which('node'), '--max-old-space-size=256', str(worker), operation],
                                         env=env, stdin=subprocess.DEVNULL, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
                children.append(child)
                deadline = time.monotonic() + 20
                try:
                    while child.poll() is None:
                        assert time.monotonic() < deadline, 'Finite native blob deadline exceeded.'
                        assert os.fstat(output.fileno()).st_size <= 65536
                        time.sleep(0.02)
                    assert child.returncode == 0, 'Inspect bounded native blob diagnostics.'
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
            print('Synthetic native blob evidence retained in', root)
