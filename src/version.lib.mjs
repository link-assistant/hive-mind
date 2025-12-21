#!/usr/bin/env node

import { readFile, access } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getGitVersion } from './git.lib.mjs';

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
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const packagePath = join(__dirname, '..', 'package.json');

  try {
    const packageJsonContent = await readFile(packagePath, 'utf8');
    const packageJson = JSON.parse(packageJsonContent);
    const currentVersion = packageJson.version;

    if (await isRunningAsScript()) {
      const version = await getGitVersion(undefined, currentVersion);
      return version;
    }

    return currentVersion;
  } catch {
    return 'unknown';
  }
}

export default { getVersion };
