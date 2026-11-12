#!/usr/bin/env node
/**
 * Verify the real npm allowlist immediately before changeset publication.
 *
 * Since issue #4050 the main tarball carries the native Codex recipe but no
 * executable: it must pin both per-platform variant packages (published by
 * `scripts/native-codex-packages.mjs publish` just before this step) and fit
 * the npm publish budget, which the 249,485,829-byte 2.40.0 tarball did not.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { checkNpmTarballSizes } from './check-npm-tarball-size.mjs';

const execute = promisify(execFile);
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-native-codex-publish-'));
try {
  const { stdout } = await execute('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], { maxBuffer: 1 << 24 });
  const [entry] = JSON.parse(stdout);
  const filename = entry?.filename;
  if (!filename?.endsWith('.tgz') || path.basename(filename) !== filename) throw new Error('Unexpected npm archive name.');
  if (checkNpmTarballSizes([entry]) !== 0) throw new Error('The npm archive exceeds the publish budget.');
  await execute('python3', ['scripts/build-native-codex.py', 'verify-package', path.join(temporary, filename)], { maxBuffer: 65536 });
  console.log('Verified the npm publication artifact pins both native Codex variant packages and bundles neither.');
} catch (error) {
  console.error(`Native Codex publication refused: ${error.stderr?.trim() || error.message}`);
  console.error('Publish both variant packages first: node scripts/native-codex-packages.mjs publish (see docs/NATIVE-CODEX-PACKAGES.md).');
  process.exitCode = 1;
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
