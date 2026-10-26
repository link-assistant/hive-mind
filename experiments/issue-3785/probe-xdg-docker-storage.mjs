// Run the production directory-mount gate locally with disposable state.
// This exercises real Docker mounts, not native CLI refresh/history semantics.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-xdg-docker-'));
try {
  const home = path.join(root, 'home');
  await fs.mkdir(home);
  const result = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('../../scripts/verify-mounted-tool-data.mjs', import.meta.url)), fileURLToPath(new URL('../../src/hive.mjs', import.meta.url))], {
    env: { PATH: process.env.PATH, HIVE_MOUNT_TEST_FIXTURE: root, HIVE_MOUNT_TEST_EXPECTED_HOME: home, HIVE_MOUNT_TEST_IMAGE: 'node:24-alpine' },
    maxBuffer: 256 * 1024,
  });
  process.stdout.write(result.stdout);
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
