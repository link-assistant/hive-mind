#!/usr/bin/env node

/**
 * Wait for a package version to become available on npm.
 *
 * The Docker publish job runs after npm publishing, but npm registry visibility
 * can lag briefly. Waiting here keeps Docker tags tied to an installable npm
 * version.
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatNpmPackageVersion, readPackageInfo } from './package-info.mjs';

const DEFAULT_MAX_ATTEMPTS = 30;
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

export function checkNpmVersion(packageName, version) {
  try {
    const publishedVersion = execFileSync(
      'npm',
      ['view', formatNpmPackageVersion(packageName, version), 'version'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    ).trim();

    return publishedVersion === version;
  } catch {
    return false;
  }
}

function sleep(seconds) {
  return new Promise((resolve) =>
    globalThis.setTimeout(resolve, seconds * 1000)
  );
}

function setOutput(name, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    appendFileSync(outputFile, `${name}=${value}\n`);
  }
  console.log(`Output: ${name}=${value}`);
}

export async function waitForNpmVersion({
  checkAvailability = checkNpmVersion,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  packageName,
  sleepFn = sleep,
  sleepSeconds = DEFAULT_SLEEP_SECONDS,
  stdout = console.log,
  version,
}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    stdout(
      `Checking npm for ${formatNpmPackageVersion(packageName, version)} (attempt ${attempt}/${maxAttempts})`
    );

    if (checkAvailability(packageName, version)) {
      return true;
    }

    if (attempt < maxAttempts) {
      await sleepFn(sleepSeconds);
    }
  }

  return false;
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

    const available = await waitForNpmVersion({
      maxAttempts: config.maxAttempts,
      packageName: packageInfo.name,
      sleepSeconds: config.sleepSeconds,
      stdout,
      version: config.releaseVersion,
    });

    setOutput('npm_available', available ? 'true' : 'false');

    if (!available) {
      stderr(
        `${formatNpmPackageVersion(packageInfo.name, config.releaseVersion)} did not become available on npm`
      );
      return 1;
    }

    stdout(
      `${formatNpmPackageVersion(packageInfo.name, config.releaseVersion)} is available on npm`
    );
    return 0;
  } catch (error) {
    stderr(`Error: ${error.message}`);
    return 1;
  }
}

if (isCliEntryPoint()) {
  process.exitCode = await main();
}
