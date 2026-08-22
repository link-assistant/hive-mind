#!/usr/bin/env node

import { readFile, access } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getGitVersion } from './git.lib.mjs';

// Cache for version (immutable after first read)
// This ensures the version remains consistent even if package.json changes during runtime
// See issue #1318: version should be cached in RAM at startup
let cachedVersion = null;

async function isRunningAsScript() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const gitDir = join(__dirname, '..', '.git');
  try {
    await access(gitDir);
    return true;
  } catch {
    return false;
  }
}

export async function getVersion() {
  // Return cached version if already computed (immutable after first read)
  if (cachedVersion !== null) {
    return cachedVersion;
  }

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const packagePath = join(__dirname, '..', 'package.json');

  try {
    const packageJsonContent = await readFile(packagePath, 'utf8');
    const packageJson = JSON.parse(packageJsonContent);
    const currentVersion = packageJson.version;

    if (await isRunningAsScript()) {
      cachedVersion = await getGitVersion(undefined, currentVersion);
    } else {
      cachedVersion = currentVersion;
    }

    return cachedVersion;
  } catch {
    cachedVersion = 'unknown';
    return cachedVersion;
  }
}

export default { getVersion };
