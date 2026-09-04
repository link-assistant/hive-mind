#!/usr/bin/env node

/**
 * Wait for a package version to become available on npm.
 *
 * The Docker publish job runs after npm publishing, but npm registry visibility
 * can lag briefly. Waiting here keeps Docker tags tied to an installable npm
 * version.
 */

import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPackageMetadataUrl } from './npm-registry.mjs';
import { formatNpmPackageVersion, readPackageInfo } from './package-info.mjs';

const DEFAULT_MAX_ATTEMPTS = 30;
const NPM_REGISTRY_USER_AGENT =
  'js-ai-driven-development-pipeline-template wait-for-npm';
const DEFAULT_SLEEP_SECONDS = 10;
const USAGE =
  'Usage: node scripts/wait-for-npm.mjs --release-version <version> [--package-name <name>] [--max-attempts <count>] [--sleep-seconds <count>] [--js-root <path>]';

function parsePositiveInteger(value, optionName) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${optionName} must be a positive integer`);
  }
  return parsed;
}

function readCliOptions(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      continue;
    }

    const inlineValueIndex = arg.indexOf('=');
    if (inlineValueIndex !== -1) {
      options[arg.slice(2, inlineValueIndex)] = arg.slice(inlineValueIndex + 1);
      continue;
    }

    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for ${arg}`);
    }

    options[arg.slice(2)] = value;
    index++;
  }

  return options;
}

export function parseArgs(argv, env = process.env) {
  const cliOptions = readCliOptions(argv);

  const config = {
    jsRoot: cliOptions['js-root'] ?? env.JS_ROOT ?? '',
    maxAttempts: parsePositiveInteger(
      cliOptions['max-attempts'] ||
        env.MAX_ATTEMPTS ||
        String(DEFAULT_MAX_ATTEMPTS),
      '--max-attempts'
    ),
    packageName: cliOptions['package-name'] ?? env.PACKAGE_NAME ?? '',
    releaseVersion: cliOptions['release-version'] ?? env.VERSION ?? '',
    sleepSeconds: parsePositiveInteger(
      cliOptions['sleep-seconds'] ||
        env.SLEEP_SECONDS ||
        String(DEFAULT_SLEEP_SECONDS),
      '--sleep-seconds'
    ),
  };

  return config;
}

/**
 * Build the registry URL for a single package version document.
 * @param {string} packageName
 * @param {string} version
 * @param {string} [registryUrl]
 * @returns {string}
 */
export function buildPackageVersionUrl(packageName, version, registryUrl) {
  return `${buildPackageMetadataUrl(packageName, registryUrl)}/${encodeURIComponent(version)}`;
}

/**
 * Normalize a check result so callers always see the same shape.
 * A boolean from an injected `checkAvailability` is also accepted.
 * @param {boolean|object} result
 * @returns {{available: boolean, status: string, error?: string, url?: string, httpStatus?: number}}
 */
export function normalizeCheckResult(result) {
  if (typeof result === 'boolean') {
    return { available: result, status: result ? 'ok' : 'not-published' };
  }

  return {
    available: Boolean(result?.available),
    status: result?.status ?? 'unknown',
    ...(result?.error === undefined ? {} : { error: result.error }),
    ...(result?.url === undefined ? {} : { url: result.url }),
    ...(result?.httpStatus === undefined
      ? {}
      : { httpStatus: result.httpStatus }),
  };
}

/**
 * Describe a check result for a per-attempt log line.
 * @param {{status: string, httpStatus?: number, error?: string}} result
 * @returns {string}
 */
export function describeCheckResult(result) {
  const httpStatus =
    result.httpStatus === undefined ? '' : `HTTP ${result.httpStatus}`;

  if (result.status === 'ok') {
    return result.available
      ? `available${httpStatus ? ` (${httpStatus})` : ''}`
      : `version mismatch${httpStatus ? ` (${httpStatus})` : ''}`;
  }

  if (result.status === 'not-published') {
    return `not published yet${httpStatus ? ` (${httpStatus})` : ''}`;
  }

  return `check failed: ${[httpStatus, result.error].filter(Boolean).join(' ')}`;
}

/**
 * Ask the npm registry whether a package version exists.
 *
 * Queries the registry over HTTP so the real status code is available: a
 * genuine "not published" (404) is reported separately from "we could not get
 * an answer" (5xx, rate limits, DNS, proxy errors), which says nothing about
 * whether the publish succeeded.
 *
 * @param {string} packageName
 * @param {string} version
 * @param {object} [options]
 * @param {Function} [options.fetchFn]
 * @param {string} [options.registryUrl]
 * @returns {Promise<{available: boolean, status: 'ok'|'not-published'|'unknown', httpStatus?: number, url: string, error?: string}>}
 */
export async function checkNpmVersion(
  packageName,
  version,
  { fetchFn = fetch, registryUrl } = {}
) {
  let url;
  try {
    url = buildPackageVersionUrl(packageName, version, registryUrl);
  } catch (error) {
    return { available: false, status: 'unknown', error: error.message };
  }

  try {
    const response = await fetchFn(url, {
      headers: {
        accept: 'application/json',
        // Some registries reject requests without a User-Agent with 403.
        'user-agent': NPM_REGISTRY_USER_AGENT,
      },
    });

    if (response.status === 404) {
      return {
        available: false,
        status: 'not-published',
        httpStatus: 404,
        url,
      };
    }

    if (!response.ok) {
      return {
        available: false,
        status: 'unknown',
        httpStatus: response.status,
        url,
        error: `${response.status} ${response.statusText ?? ''}`.trim(),
      };
    }

    const metadata = await response.json();
    return {
      available: metadata?.version === version,
      status: 'ok',
      httpStatus: response.status,
      url,
    };
  } catch (error) {
    // `fetch` reports transport failures as a bare "fetch failed"; the cause
    // holds the actual reason (ECONNREFUSED, EAI_AGAIN, certificate errors).
    const cause = error?.cause?.message;
    const message = error?.message ?? String(error);

    return {
      available: false,
      status: 'unknown',
      url,
      error: cause && cause !== message ? `${message}: ${cause}` : message,
    };
  }
}

function sleep(seconds) {
  return new Promise((resolve) =>
    globalThis.setTimeout(resolve, seconds * 1000)
  );
}

function readGithubOutputPath() {
  try {
    return process.env.GITHUB_OUTPUT || '';
  } catch {
    // Runtimes with restricted environment access (Deno without --allow-env)
    // throw here; step outputs are simply unavailable then.
    return '';
  }
}

function setOutput(name, value) {
  const outputFile = readGithubOutputPath();
  if (outputFile) {
    appendFileSync(outputFile, `${name}=${value}\n`);
  }
  console.log(`Output: ${name}=${value}`);
}

/**
 * Poll the registry until the version shows up or attempts run out.
 * @returns {Promise<{available: boolean, status: string, error?: string, url?: string, httpStatus?: number, attempts: number}>}
 */
export async function waitForNpmVersion({
  checkAvailability = checkNpmVersion,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  packageName,
  registryUrl,
  sleepFn = sleep,
  sleepSeconds = DEFAULT_SLEEP_SECONDS,
  stdout = console.log,
  version,
}) {
  let lastResult = {
    available: false,
    status: 'unknown',
    error: 'no attempts were made',
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    lastResult = normalizeCheckResult(
      await checkAvailability(packageName, version, { registryUrl })
    );

    stdout(
      `Checking npm for ${formatNpmPackageVersion(packageName, version)} ` +
        `(attempt ${attempt}/${maxAttempts}): ${describeCheckResult(lastResult)}`
    );

    if (lastResult.available) {
      return { ...lastResult, attempts: attempt };
    }

    if (attempt < maxAttempts) {
      await sleepFn(sleepSeconds);
    }
  }

  return { ...lastResult, attempts: maxAttempts };
}

/**
 * Build the failure message for an exhausted wait.
 * @param {string} packageSpecifier
 * @param {{status: string, error?: string, url?: string}} result
 * @param {number} maxAttempts
 * @returns {string}
 */
export function formatFailureMessage(packageSpecifier, result, maxAttempts) {
  if (result.status !== 'unknown') {
    return `${packageSpecifier} did not become available on npm`;
  }

  const reason = result.error ? ` The last error was: ${result.error}.` : '';
  const where = result.url ? ` Check ${result.url} directly.` : '';

  return (
    `Could not determine whether ${packageSpecifier} is on npm: ` +
    `all ${maxAttempts} attempts failed to reach the registry.${reason} ` +
    `This does NOT mean the publish failed.${where}`
  );
}

function isCliEntryPoint() {
  return (
    typeof process !== 'undefined' &&
    process.argv?.[1] &&
    fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  );
}

export async function main({
  argv = process.argv.slice(2),
  env = process.env,
  stderr = console.error,
  stdout = console.log,
} = {}) {
  try {
    const config = parseArgs(argv, env);
    if (!config.releaseVersion) {
      stderr('Error: Missing required --release-version');
      stderr(USAGE);
      return 1;
    }

    const packageInfo = config.packageName
      ? { name: config.packageName }
      : readPackageInfo({ jsRoot: config.jsRoot || undefined });

    const result = await waitForNpmVersion({
      maxAttempts: config.maxAttempts,
      packageName: packageInfo.name,
      registryUrl:
        env.NPM_CONFIG_REGISTRY || env.npm_config_registry || undefined,
      sleepSeconds: config.sleepSeconds,
      stdout,
      version: config.releaseVersion,
    });

    const packageSpecifier = formatNpmPackageVersion(
      packageInfo.name,
      config.releaseVersion
    );

    setOutput('npm_available', result.available ? 'true' : 'false');
    setOutput('npm_check_status', result.status);

    if (!result.available) {
      stderr(
        formatFailureMessage(packageSpecifier, result, config.maxAttempts)
      );
      return 1;
    }

    stdout(`${packageSpecifier} is available on npm`);
    return 0;
  } catch (error) {
    stderr(`Error: ${error.message}`);
    return 1;
  }
}

if (isCliEntryPoint()) {
  process.exitCode = await main();
}
