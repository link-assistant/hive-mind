import { readFileSync } from 'node:fs';

import { getPackageJsonPath } from './js-paths.mjs';

/**
 * Parse package metadata from a package.json file body.
 * @param {string} packageJsonContent
 * @param {string} packageJsonPath
 * @returns {{name: string, version: string}}
 */
export function parsePackageInfo(
  packageJsonContent,
  packageJsonPath = 'package.json'
) {
  let packageJson;
  try {
    packageJson = JSON.parse(packageJsonContent);
  } catch (error) {
    throw new Error(`Could not parse ${packageJsonPath}: ${error.message}`);
  }

  if (typeof packageJson.name !== 'string' || packageJson.name.trim() === '') {
    throw new Error(`Package name is missing in ${packageJsonPath}`);
  }

  if (
    typeof packageJson.version !== 'string' ||
    packageJson.version.trim() === ''
  ) {
    throw new Error(`Package version is missing in ${packageJsonPath}`);
  }

  return {
    name: packageJson.name,
    version: packageJson.version,
  };
}

/**
 * Read package name and version from the detected JavaScript package root.
 * @param {Object} options - Configuration options (passed to getPackageJsonPath)
 * @returns {{name: string, version: string}}
 */
export function readPackageInfo(options = {}) {
  const packageJsonPath = getPackageJsonPath(options);
  return parsePackageInfo(
    readFileSync(packageJsonPath, 'utf8'),
    packageJsonPath
  );
}

/**
 * Escape a string for safe use inside a regular expression.
 * @param {string} value
 * @returns {string}
 */
export function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a regex that matches the package bump line in a changeset.
 * @param {string} packageName
 * @param {Object} options
 * @param {boolean} [options.requireQuotes=true]
 * @returns {RegExp}
 */
export function getChangesetVersionTypeRegex(
  packageName,
  { requireQuotes = true } = {}
) {
  const quotePattern = requireQuotes ? '[\'"]' : '[\'"]?';
  return new RegExp(
    `^${quotePattern}${escapeRegExp(packageName)}${quotePattern}:\\s+(major|minor|patch)\\s*$`,
    'm'
  );
}

/**
 * Format a changeset package bump header line.
 * @param {string} packageName
 * @param {string} bumpType
 * @returns {string}
 */
export function formatChangesetHeader(packageName, bumpType) {
  return `'${packageName}': ${bumpType}`;
}

/**
 * Format an npm package@version specifier.
 * @param {string} packageName
 * @param {string} version
 * @returns {string}
 */
export function formatNpmPackageVersion(packageName, version) {
  return `${packageName}@${version}`;
}
