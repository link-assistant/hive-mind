#!/usr/bin/env node
/** Install the bundled native adapter into the selected Gemini package. */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installNativeGeminiCommand } from './native-gemini-command.lib.mjs';

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    await installNativeGeminiCommand();
    console.log('Installed and verified the pinned native Gemini adapter.');
  } catch {
    console.error('Native Gemini installation failed. Restore the pinned upstream package and its package-manager bin link.');
    process.exitCode = 1;
  }
}
