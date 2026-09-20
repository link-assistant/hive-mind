#!/usr/bin/env bun

/**
 * Custom changeset version script that ensures package-lock.json is synchronized
 * with package.json after version bumps.
 *
 * This script:
 * 1. Detects the JavaScript package root (supports both single-language and multi-language repos)
 * 2. Runs `changeset version` to update package versions
 * 3. Runs `npm install` to synchronize package-lock.json with the new versions
 *
 * Configuration:
 * - CLI: --js-root <path> to explicitly set JavaScript root
 * - Environment: JS_ROOT=<path>
 *
 * Uses link-foundation libraries:
 * - use-m: Dynamic package loading without package.json dependencies
 * - command-stream: Modern shell command execution with streaming support
 *
 * Addresses issues documented in:
 * - Issue #21: Supporting both single and multi-language repository structures
 * - Reference: link-assistant/agent PR #112 (--legacy-peer-deps fix)
 * - Reference: link-assistant/agent PR #114 (configurable package root)
 */

import { getJsRoot, needsCd, parseJsRootConfig } from './js-paths.mjs';

// Load use-m dynamically
const { use } = eval(
  await (await fetch('https://unpkg.com/use-m/use.js')).text()
);

// Import command-stream for shell command execution
const { $ } = await use('command-stream');

// Store the original working directory to restore after cd commands
// IMPORTANT: command-stream's cd is a virtual command that calls process.chdir()
const originalCwd = process.cwd();

try {
  // Get JavaScript package root (auto-detect or use explicit config)
  const jsRootConfig = parseJsRootConfig();
  const jsRoot = getJsRoot({ jsRoot: jsRootConfig, verbose: true });

  console.log('Running changeset version...');

  // IMPORTANT: cd is a virtual command that calls process.chdir(), so we restore after
  if (needsCd({ jsRoot })) {
    await $`cd ${jsRoot} && npx changeset version`;
    process.chdir(originalCwd);
  } else {
    await $`npx changeset version`;
  }

  console.log('\nSynchronizing package-lock.json...');

  // Use --legacy-peer-deps to handle peer dependency conflicts
  // This addresses npm ERESOLVE errors documented in issue #111 / PR #112
  if (needsCd({ jsRoot })) {
    await $`cd ${jsRoot} && npm install --package-lock-only --legacy-peer-deps`;
    process.chdir(originalCwd);
  } else {
    await $`npm install --package-lock-only --legacy-peer-deps`;
  }

  console.log('\n✅ Version bump complete with synchronized package-lock.json');
} catch (error) {
  // Restore cwd on error
  process.chdir(originalCwd);
  console.error('Error during version bump:', error.message);
  if (process.env.DEBUG) {
    console.error('Stack trace:', error.stack);
  }
  process.exit(1);
}
