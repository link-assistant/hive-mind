// Run the production directory-mount gate locally with disposable state.
// This exercises real Docker mounts, not native CLI refresh/history semantics.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, URL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { installImageRipgrep } from '../../scripts/install-image-ripgrep.mjs';

const execute = promisify(execFile);
const image = `hive-issue-3785-search:${randomUUID()}`;
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-xdg-docker-'));
try {
  await installImageRipgrep({ codexRoot: '/home/box/.bun/install/global/node_modules/@openai/codex', destination: path.join(root, 'rg') });
  await fs.writeFile(path.join(root, 'Dockerfile'), 'FROM node:24-alpine\nCOPY --chmod=755 rg /usr/local/bin/rg\n');
  const build = await execute('docker', ['build', '--network', 'none', '--pull=false', '--tag', image, root], { maxBuffer: 256 * 1024 });
  await fs.writeFile('/tmp/issue-3785-rg-docker-build.log', build.stdout + build.stderr, { mode: 0o600 });
  const home = path.join(root, 'home');
  await fs.mkdir(home);
  const result = await execute(process.execPath, [fileURLToPath(new URL('../../scripts/verify-mounted-tool-data.mjs', import.meta.url)), fileURLToPath(new URL('../../src/hive.mjs', import.meta.url))], {
    env: { PATH: process.env.PATH, HIVE_MOUNT_TEST_FIXTURE: root, HIVE_MOUNT_TEST_EXPECTED_HOME: home, HIVE_MOUNT_TEST_IMAGE: image },
    maxBuffer: 256 * 1024,
  });
  process.stdout.write(result.stdout);
} finally {
  await execute('docker', ['image', 'rm', '--force', image]).catch(() => {});
  await fs.rm(root, { recursive: true, force: true });
}
