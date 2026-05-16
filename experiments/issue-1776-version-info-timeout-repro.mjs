#!/usr/bin/env node

/**
 * Reproduction helper for issue #1776.
 *
 * It puts fake browser commands first on PATH so getVersionInfo() exercises a
 * primary command timeout followed by a fallback timeout. That is valid behavior
 * for the version collector, but it can exceed the old 10s unit-test limit.
 */

import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getVersionInfo } from '../src/version-info.lib.mjs';

const tempDir = await mkdtemp(join(tmpdir(), 'hive-mind-issue-1776-'));
const originalPath = process.env.PATH || '';

async function writeSlowCommand(name) {
  const commandPath = join(tempDir, name);
  await writeFile(commandPath, '#!/usr/bin/env bash\nsleep 6\n', 'utf8');
  await chmod(commandPath, 0o755);
}

try {
  await writeSlowCommand('chromium');
  await writeSlowCommand('chromium-browser');
  process.env.PATH = `${tempDir}:${originalPath}`;

  const startTime = Date.now();
  await getVersionInfo(false);
  const duration = Date.now() - startTime;

  console.log(`getVersionInfo duration with slow primary+fallback: ${duration}ms`);
  console.log(`Old 10000ms assertion would ${duration >= 10000 ? 'fail' : 'pass'} in this scenario.`);
} finally {
  process.env.PATH = originalPath;
  await rm(tempDir, { recursive: true, force: true });
}
