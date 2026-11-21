#!/usr/bin/env node
import { ensureUseM } from './use-m-bootstrap.lib.mjs';

// Resolve the log destination before startup diagnostics and strict parsing.
// Leave validation to yargs; never consume the next option as a directory.
export function resolveStartupLogDirectory(args) {
  let directory = null;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--') break;
    if (arg.startsWith('--log-dir=') || arg.startsWith('-l=')) directory = arg.slice(arg.indexOf('=') + 1) || null;
    else if (arg === '--log-dir' || arg === '-l') {
      const next = args[index + 1];
      if (next && !next.startsWith('-')) directory = args[++index];
    }
  }
  return directory;
}

/**
 * Handle lightweight early-exit paths before solve loads its full dependency graph.
 *
 * @param {string[]} earlyArgs - Raw CLI args without the node/script prefix
 * @returns {Promise<void>}
 */
export async function handleSolveEarlyExit(earlyArgs) {
  if (earlyArgs.includes('--version')) {
    const { getVersion } = await import('./version.lib.mjs');
    try {
      console.log(await getVersion());
    } catch {
      console.error('Error: Unable to determine version');
      process.exit(1);
    }
    process.exit(0);
  }

  if (earlyArgs.includes('--help') || earlyArgs.includes('-h')) {
    // Load minimal modules needed for help output.
    const use = await ensureUseM();
    globalThis.use = use;
    const { initializeConfig, createYargsConfig } = await import('./solve.config.lib.mjs');
    const { yargs, hideBin } = await initializeConfig(use);
    const rawArgs = hideBin(process.argv);
    const argsWithoutHelp = rawArgs.filter(arg => arg !== '--help' && arg !== '-h');
    createYargsConfig(yargs(argsWithoutHelp)).showHelp();
    process.exit(0);
  }

  if (earlyArgs.length === 0) {
    console.error('Usage: solve.mjs <issue-url> [options]');
    console.error('\nError: Missing required github issue or pull request URL');
    console.error('\nRun "solve.mjs --help" for more information');
    process.exit(1);
  }
}
