// Run the production directory-mount gate locally with disposable state.
// This exercises real Docker mounts, not native CLI refresh/history semantics.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, URL } from 'node:url';
import { installImageRipgrep } from '../../scripts/install-image-ripgrep.mjs';

const execute = promisify(execFile);
const image = 'node:24-alpine';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-xdg-docker-'));
try {
  await installImageRipgrep({ codexRoot: '/home/box/.bun/install/global/node_modules/@openai/codex', destination: path.join(root, 'rg') });
  // This host's threaded cgroup requires an explicit daemon cgroup parent.
  // Keep that environment-specific workaround out of production gate arguments.
  await fs.mkdir(path.join(root, 'bin'));
  await fs.writeFile(path.join(root, 'bin/docker'), `#!${process.execPath}\nconst {spawnSync}=require('node:child_process');const args=process.argv.slice(2);if(args[0]==='run')args.splice(1,0,'--cgroup-parent','/');const result=spawnSync('/usr/bin/docker',args,{stdio:'inherit'});process.exit(result.status??1);\n`, { mode: 0o700 });
  const home = path.join(root, 'home');
  await fs.mkdir(home);
  const result = await execute(process.execPath, [fileURLToPath(new URL('../../scripts/verify-mounted-tool-data.mjs', import.meta.url)), fileURLToPath(new URL('../../src/hive.mjs', import.meta.url))], {
    env: { PATH: `${path.join(root, 'bin')}:${process.env.PATH}`, HIVE_MOUNT_TEST_FIXTURE: root, HIVE_MOUNT_TEST_EXPECTED_HOME: home, HIVE_MOUNT_TEST_IMAGE: image, HIVE_MOUNT_TEST_SEARCH_SOURCE: path.join(root, 'rg') },
    maxBuffer: 256 * 1024,
  });
  process.stdout.write(result.stdout);
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
