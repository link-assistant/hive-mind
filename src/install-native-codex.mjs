#!/usr/bin/env node
/** Activate this installed package's admitted native Codex executable. */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installNativeCodexCommand } from './native-codex-command.lib.mjs';

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    await installNativeCodexCommand();
    console.log('Installed and verified the pinned native Codex adapter.');
  } catch {
    console.error('Native Codex installation failed. Restore both pinned platform payloads and the upstream package-manager bin link.');
    process.exitCode = 1;
  }
}
