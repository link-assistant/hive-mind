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
    // Issue #4050: the executable is the optional dependency alias, not part of this package.
    const platform = `${process.platform}-${process.arch}`;
    console.error(`Native Codex installation failed. Install the matching optional dependency @link-assistant/hive-mind-native-codex-${platform} (do not omit optional dependencies) and restore the upstream package-manager bin link. Set HIVE_MIND_NATIVE_CODEX_DEBUG=1 to see which admission phase refused.`);
    process.exitCode = 1;
  }
}
