import { createReadStream } from 'node:fs';
import { lstat, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { sanitizeLogFileToFileBounded } from './log-sanitize-worker.lib.mjs';

const args = process.argv.slice(2);
const usage = 'Usage: hive-manager archive-session FILE\nWrite a sanitized session file to stdout for review.\n';

if (args.length === 0 || (args.length === 1 && ['-h', '--help'].includes(args[0]))) {
  process.stdout.write(usage);
} else if (args.length !== 1) {
  process.stderr.write(usage);
  process.exitCode = 1;
} else {
  let privateDirectory;
  try {
    const [sourcePath] = args;
    if (!(await lstat(sourcePath)).isFile()) throw new Error();
    privateDirectory = await mkdtemp(join(tmpdir(), 'hive-session-archive-'));
    const destPath = join(privateDirectory, 'sanitized');
    await sanitizeLogFileToFileBounded({ sourcePath, destPath });
    await pipeline(createReadStream(destPath), process.stdout);
  } catch {
    process.stderr.write('hive-manager: Could not export the session file.\n');
    process.exitCode = 1;
  } finally {
    if (privateDirectory) await rm(privateDirectory, { recursive: true, force: true });
  }
}
