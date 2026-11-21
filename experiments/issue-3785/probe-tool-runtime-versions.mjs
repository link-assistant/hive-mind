// Real pinned data-layout versions, disposable state and finite process limits.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import console from 'node:console';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { verifyToolDataRuntimeVersions } from '../../src/verify-agent-runtime.mjs';

const execute = promisify(execFile);
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-3785-runtime-versions-'));
try {
  const homeDir = path.join(root, 'home');
  const cwd = path.join(root, 'project');
  await fs.mkdir(homeDir);
  await fs.mkdir(cwd);
  const commands = {};
  for (const name of ['agent', 'opencode', 'gemini', 'qwen', 'rg']) {
    // Resolve the actual installed command before entering disposable state.
    const { stdout } = await execute('/bin/sh', ['-c', 'command -v "$1"', 'resolve-version-command', name], { env: { PATH: process.env.PATH } });
    const command = stdout.trim();
    assert.ok(path.isAbsolute(command));
    const wrapper = path.join(root, `${name}-bounded`);
    const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
    await fs.writeFile(wrapper, `#!/bin/sh\nexport NODE_OPTIONS=--max-old-space-size=128\nexec /usr/bin/prlimit --data=1610612736 --stack=16777216 --core=0 -- ${quote(command)} "$@"\n`, { mode: 0o700 });
    commands[`${name}Command`] = wrapper;
  }
  await verifyToolDataRuntimeVersions({ homeDir, cwd, ...commands });
  console.log('Verified: actual Agent 0.27.0, OpenCode 1.19.4, Gemini 0.65.0, Qwen 0.26.1 and working search runtime in disposable state.');
  console.log('Limit: version admission alone does not verify canonical storage, refresh or conversation lifecycle.');
} catch {
  console.error('Pinned native version probe failed; native output is withheld.');
  process.exitCode = 1;
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
