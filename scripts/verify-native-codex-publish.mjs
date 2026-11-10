#!/usr/bin/env node
/** Verify the real npm allowlist immediately before changeset publication. */
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-native-codex-publish-'));
try {
  const { stdout } = await execute('npm', ['pack', '--ignore-scripts', '--silent', '--pack-destination', temporary], { maxBuffer: 65536 });
  const filename = stdout.trim();
  if (!filename.endsWith('.tgz') || path.basename(filename) !== filename) throw new Error('Unexpected npm archive name.');
  await execute('python3', ['scripts/build-native-codex.py', 'verify-package', path.join(temporary, filename)], { maxBuffer: 65536 });
  console.log('Verified both pinned native Codex platforms in the actual npm publication artifact.');
} catch {
  console.error('Native Codex publication refused: rebuild and assemble both pinned platform artifacts before publishing.');
  process.exitCode = 1;
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
