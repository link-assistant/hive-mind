/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const repository = fileURLToPath(new URL('../', import.meta.url));

test('installed tool-data validation payload loads without the package filesystem', { timeout: 10000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-tool-payload-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const captured = path.join(root, 'payload.json');
  const home = path.join(root, 'home');
  await fs.mkdir(path.join(root, 'bin'));
  await fs.writeFile(
    path.join(root, 'bin/docker'),
    `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === 'image') console.log('sha256:synthetic');
if (args[0] === 'run') {
  const mounts=args.filter(arg=>arg.startsWith('type=bind,source=')).map(arg=>Object.fromEntries(arg.split(',').map(item=>item.split('='))));
  if(mounts[0]?.target.startsWith('/__hive_mount_probe/')) {
    console.log(JSON.stringify(mounts.map(mount=>{const info=fs.statSync(mount.source,{bigint:true});return info.dev+':'+info.ino+':'+(info.isDirectory()?'directory':'file');})));
  } else console.log('synthetic-container');
}
if (args[0] === 'exec') {
  fs.writeFileSync(${JSON.stringify(captured)}, JSON.stringify(args.at(-1)));
  process.exitCode = 42;
}
`,
    { mode: 0o700 }
  );
  // The intentional Docker refusal stops before any operation can read tool
  // state. Capture the exact payload assembled by the production image gate.
  await assert.rejects(execute(process.execPath, [path.join(repository, 'scripts/verify-mounted-tool-data.mjs'), path.join(repository, 'src/hive.mjs')], { env: { PATH: path.join(root, 'bin'), HIVE_MOUNT_TEST_IMAGE: 'synthetic:1', HIVE_MOUNT_TEST_EXPECTED_HOME: home, HIVE_MOUNT_TEST_FIXTURE: root }, maxBuffer: 64 * 1024 }));
  const payload = JSON.parse(await fs.readFile(captured, 'utf8'));
  const boundary = payload.indexOf('\nawait assertSharedToolData(');
  assert.ok(boundary > 0, 'capture the validator before its synthetic filesystem operation');
  const validator = payload.slice(0, boundary);
  // A disposable task has Node and mounted state, without the installed root
  // package tree. Evaluate the actual module in an empty working directory.
  await execute(process.execPath, ['--max-old-space-size=64', '--input-type=module', '-e', `${validator}\nawait assertSharedToolData({tool:'agent',env:{}});`], { cwd: root, env: {}, maxBuffer: 64 * 1024 });
});
