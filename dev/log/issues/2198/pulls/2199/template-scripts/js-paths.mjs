#!/usr/bin/env node

/**
 * JavaScript package path detection utility
 *
 * Automatically detects the JavaScript package root for both:
 * - Single-language repositories (package.json in root)
 * - Multi-language repositories (package.json in js/ subfolder)
 *
 * This utility addresses the issues documented in:
 * - Issue #21: Supporting both single and multi-language repository structures
 * - Reference: link-assistant/agent PR #114
 *
 * Usage:
 *   import { getJsRoot, getPackageJsonPath, getChangesetDir, needsCd } from './js-paths.mjs';
 *
 *   const jsRoot = getJsRoot();           // Returns 'js' or '.'
 *   const pkgPath = getPackageJsonPath(); // Returns 'js/package.json' or './package.json'
 *   const changesetDir = getChangesetDir(); // Returns 'js/.changeset' or './.changeset'
 *
 * Configuration:
 *   - CLI: --js-root <path>
 *   - Environment: JS_ROOT=<path>
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Cache for detected paths (computed once per process)
let cachedJsRoot = null;

/**
 * Detect JavaScript package root directory
 * Checks in order:
 * 1. ./package.json (single-language repo)
 * 2. ./js/package.json (multi-language repo)
 *
 * @param {Object} options - Configuration options
 * @param {string} [options.jsRoot] - Explicitly set JavaScript root (overrides auto-detection)
 * @param {boolean} [options.verbose=false] - Log detection details
 * @returns {string} The JavaScript root directory ('.' or 'js')
 * @throws {Error} If no package.json is found in expected locations
 */
export function getJsRoot(options = {}) {
  const { jsRoot: explicitRoot, verbose = false } = options;

  // If explicitly configured, use that
  if (explicitRoot !== undefined && explicitRoot !== '') {
    if (verbose) {
      console.log(
        `Using explicitly configured JavaScript root: ${explicitRoot}`
      );
    }
    return explicitRoot;
  }

  // Return cached value if already computed
  if (cachedJsRoot !== null) {
    return cachedJsRoot;
  }

  // Check for single-language repo (package.json in root)
  if (existsSync('./package.json')) {
    if (verbose) {
      console.log('Detected single-language repository (package.json in root)');
    }
    cachedJsRoot = '.';
    return cachedJsRoot;
  }

  // Check for multi-language repo (package.json in js/ subfolder)
  if (existsSync('./js/package.json')) {
    if (verbose) {
      console.log('Detected multi-language repository (package.json in js/)');
    }
    cachedJsRoot = 'js';
    return cachedJsRoot;
  }

  // No package.json found
  throw new Error(
    'Could not find package.json in expected locations.\n' +
      'Searched in:\n' +
      '  - ./package.json (single-language repository)\n' +
      '  - ./js/package.json (multi-language repository)\n\n' +
      'To fix this, either:\n' +
      '  1. Run the script from the repository root\n' +
      '  2. Explicitly configure the JavaScript root using --js-root option\n' +
      '  3. Set the JS_ROOT environment variable'
  );
}

/**
 * Get the path to package.json
 * @param {Object} options - Configuration options (passed to getJsRoot)
 * @returns {string} Path to package.json
 */
export function getPackageJsonPath(options = {}) {
  const jsRoot =
    options.jsRoot !== undefined ? options.jsRoot : getJsRoot(options);
  return jsRoot === '.' ? './package.json' : join(jsRoot, 'package.json');
}

/**
 * Get the path to package-lock.json
 * @param {Object} options - Configuration options (passed to getJsRoot)
 * @returns {string} Path to package-lock.json
 */
export function getPackageLockPath(options = {}) {
  const jsRoot =
    options.jsRoot !== undefined ? options.jsRoot : getJsRoot(options);
  return jsRoot === '.'
    ? './package-lock.json'
    : join(jsRoot, 'package-lock.json');
}

/**
 * Get the path to .changeset directory
 * @param {Object} options - Configuration options (passed to getJsRoot)
 * @returns {string} Path to .changeset directory
 */
export function getChangesetDir(options = {}) {
  const jsRoot =
    options.jsRoot !== undefined ? options.jsRoot : getJsRoot(options);
  return jsRoot === '.' ? './.changeset' : join(jsRoot, '.changeset');
}

/**
 * Get the cd command prefix for running npm commands
 * Returns empty string for single-language repos, 'cd js && ' for multi-language repos
 * @param {Object} options - Configuration options (passed to getJsRoot)
 * @returns {string} CD prefix for shell commands
 */
export function getCdPrefix(options = {}) {
  const jsRoot =
    options.jsRoot !== undefined ? options.jsRoot : getJsRoot(options);
  return jsRoot === '.' ? '' : `cd ${jsRoot} && `;
}

/**
 * Check if we need to change directory before running npm commands
 * @param {Object} options - Configuration options (passed to getJsRoot)
 * @returns {boolean} True if cd is needed
 */
export function needsCd(options = {}) {
  const jsRoot =
    options.jsRoot !== undefined ? options.jsRoot : getJsRoot(options);
  return jsRoot !== '.';
}

/**
 * Reset the cached JavaScript root (useful for testing)
 */
export function resetCache() {
  cachedJsRoot = null;
}

/**
 * Parse JavaScript root from CLI arguments or environment
 * Supports --js-root argument and JS_ROOT environment variable
 * @returns {string|undefined} Configured JavaScript root or undefined for auto-detection
 */
export function parseJsRootConfig() {
  // Check CLI arguments
  const args = process.argv.slice(2);
  const jsRootIndex = args.indexOf('--js-root');
  if (jsRootIndex >= 0 && args[jsRootIndex + 1]) {
    return args[jsRootIndex + 1];
  }

  // Check environment variable
  if (process.env.JS_ROOT) {
    return process.env.JS_ROOT;
  }

  return undefined;
}
