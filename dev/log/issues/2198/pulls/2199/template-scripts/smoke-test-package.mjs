#!/usr/bin/env node

/**
 * Install-from-package smoke test for published npm artifacts.
 *
 * This runs after publishing and verifies the package as a consumer sees it:
 * from a clean temp project, installed from the npm registry, not from the
 * repository checkout.
 */

import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatNpmPackageVersion, readPackageInfo } from './package-info.mjs';

const DEFAULT_CLI_ARGS = ['--help'];
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_PREVIEW_LINES = 5;
const DEFAULT_SERVER_TIMEOUT_SECONDS = 15;
const DEFAULT_SLEEP_SECONDS = 10;
const BOOLEAN_OPTIONS = new Set(['skip-cli', 'skip-library']);
const USAGE =
  'Usage: node scripts/smoke-test-package.mjs --package-version <version> [--package-name <name>] [--js-root <path>] [--max-attempts <count>] [--sleep-seconds <count>] [--cli-args <args>] [--skip-cli] [--skip-library] [--server-bin <bin>] [--server-args <args>] [--server-health-url <url>]';

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

    const nextValue = argv[index + 1];
    const optionName = arg.slice(2);
    if (nextValue === undefined || nextValue.startsWith('--')) {
      if (!BOOLEAN_OPTIONS.has(optionName)) {
        throw new Error(`Missing value for ${arg}`);
      }
      options[optionName] = true;
      continue;
    }

    options[optionName] = nextValue;
    index++;
  }

  return options;
}

function parseBoolean(value) {
  return value === true || value === 'true' || value === '1';
}

function readOption(cliOptions, env, cliName, envNames, fallback = '') {
  if (Object.hasOwn(cliOptions, cliName)) {
    return cliOptions[cliName];
  }

  for (const envName of envNames) {
    if (env[envName] !== undefined && env[envName] !== '') {
      return env[envName];
    }
  }

  return fallback;
}

function readPositiveOption(cliOptions, env, cliName, envNames, fallback) {
  return parsePositiveInteger(
    readOption(cliOptions, env, cliName, envNames, String(fallback)),
    `--${cliName}`
  );
}

export function parseCommandArgs(value, fallback = []) {
  if (value === undefined || value === '') {
    return fallback;
  }

  if (Array.isArray(value)) {
    return value.map(String);
  }

  const trimmed = String(value).trim();
  if (!trimmed) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed.map(String);
    }
  } catch {
    // Fall back to simple whitespace splitting for CI env values.
  }

  return trimmed.split(/\s+/);
}

export function parseArgs(argv, env = process.env) {
  const cliOptions = readCliOptions(argv);
  const cliValue = (name, envNames, fallback) =>
    readOption(cliOptions, env, name, envNames, fallback);
  const positiveValue = (name, envNames, fallback) =>
    readPositiveOption(cliOptions, env, name, envNames, fallback);

  return {
    cliArgs: parseCommandArgs(
      cliValue('cli-args', ['SMOKE_TEST_CLI_ARGS']),
      DEFAULT_CLI_ARGS
    ),
    jsRoot: cliValue('js-root', ['JS_ROOT']),
    maxAttempts: positiveValue(
      'max-attempts',
      ['MAX_ATTEMPTS'],
      DEFAULT_MAX_ATTEMPTS
    ),
    packageName: cliValue('package-name', ['PACKAGE_NAME']),
    packageVersion: cliValue('package-version', ['PACKAGE_VERSION', 'VERSION']),
    serverArgs: parseCommandArgs(
      cliValue('server-args', ['SMOKE_TEST_SERVER_ARGS']),
      []
    ),
    serverBin: cliValue('server-bin', ['SMOKE_TEST_SERVER_BIN']),
    serverHealthUrl: cliValue('server-health-url', [
      'SMOKE_TEST_SERVER_HEALTH_URL',
    ]),
    serverTimeoutSeconds: positiveValue(
      'server-timeout-seconds',
      ['SMOKE_TEST_SERVER_TIMEOUT_SECONDS'],
      DEFAULT_SERVER_TIMEOUT_SECONDS
    ),
    skipCli: parseBoolean(cliValue('skip-cli', ['SMOKE_TEST_SKIP_CLI'])),
    skipLibrary: parseBoolean(
      cliValue('skip-library', ['SMOKE_TEST_SKIP_LIBRARY'])
    ),
    sleepSeconds: positiveValue(
      'sleep-seconds',
      ['SLEEP_SECONDS'],
      DEFAULT_SLEEP_SECONDS
    ),
  };
}

export function getInstalledPackageJsonPath(workspace, packageName) {
  return join(workspace, 'node_modules', packageName, 'package.json');
}

function readJsonFile(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

export function getBinEntries(packageJson, packageName) {
  if (!packageJson.bin) {
    return [];
  }

  if (typeof packageJson.bin === 'string') {
    return [
      {
        name: packageName.split('/').pop(),
        path: packageJson.bin,
      },
    ];
  }

  return Object.entries(packageJson.bin).map(([name, binPath]) => ({
    name,
    path: binPath,
  }));
}

export function hasLibraryEntryPoint(packageJson) {
  return Boolean(packageJson.exports || packageJson.main || packageJson.module);
}

export function resolveBinShim(
  workspace,
  binName,
  platform = process.platform
) {
  const shimPath = join(workspace, 'node_modules', '.bin', binName);
  return platform === 'win32' ? `${shimPath}.cmd` : shimPath;
}

export function formatOutputPreview(output, maxLines = DEFAULT_PREVIEW_LINES) {
  return String(output).trimEnd().split(/\r?\n/).slice(0, maxLines).join('\n');
}

export function buildLibraryCheckSource(packageName) {
  return [
    `import * as packageModule from ${JSON.stringify(packageName)};`,
    '',
    'const exportNames = Object.keys(packageModule);',
    'if (exportNames.length === 0) {',
    "  throw new Error('Package import resolved but exposed no exports');",
    '}',
    'console.log(`library OK: imported exports ${exportNames.join(", ")}`);',
    '',
  ].join('\n');
}

function runCommand(command, args, options) {
  return execFileSync(command, args, options);
}

function sleep(seconds) {
  return new Promise((resolve) =>
    globalThis.setTimeout(resolve, seconds * 1000)
  );
}

export async function installFromNpm({
  cwd,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  packageSpec,
  runCommandFn = runCommand,
  sleepFn = sleep,
  sleepSeconds = DEFAULT_SLEEP_SECONDS,
  stdout = console.log,
}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      stdout(
        `Installing ${packageSpec} from npm (attempt ${attempt}/${maxAttempts})`
      );
      runCommandFn(
        'npm',
        [
          'install',
          packageSpec,
          '--no-audit',
          '--no-fund',
          '--package-lock=false',
        ],
        { cwd, stdio: 'inherit' }
      );
      return;
    } catch (error) {
      if (attempt === maxAttempts) {
        throw new Error(
          `Failed to install ${packageSpec} after ${maxAttempts} attempts: ${error.message}`
        );
      }

      stdout(
        `Install failed; waiting ${sleepSeconds}s for npm registry propagation`
      );
      await sleepFn(sleepSeconds);
    }
  }
}

export function checkLibraryEntryPoint({
  packageName,
  runCommandFn = runCommand,
  workspace,
  writeFileFn = writeFileSync,
}) {
  const checkFile = join(workspace, 'check-library.mjs');
  writeFileFn(checkFile, buildLibraryCheckSource(packageName));
  runCommandFn(process.execPath, [checkFile], {
    cwd: workspace,
    stdio: 'inherit',
  });
}

export function checkCliEntryPoints({
  binEntries,
  cliArgs = DEFAULT_CLI_ARGS,
  runCommandFn = runCommand,
  stdout = console.log,
  workspace,
}) {
  for (const binEntry of binEntries) {
    const binPath = resolveBinShim(workspace, binEntry.name);
    stdout(`Checking CLI entry point: ${binEntry.name} ${cliArgs.join(' ')}`);
    const output = runCommandFn(binPath, cliArgs, {
      cwd: workspace,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (!String(output).trim()) {
      throw new Error(`CLI ${binEntry.name} produced no stdout`);
    }

    stdout(formatOutputPreview(output));
    stdout(`CLI OK: ${binEntry.name}`);
  }
}

export function checkConfiguredLibraryEntryPoint({
  installedPackageJson,
  packageName,
  runCommandFn = runCommand,
  skipLibrary = false,
  stdout = console.log,
  workspace,
}) {
  if (skipLibrary || !hasLibraryEntryPoint(installedPackageJson)) {
    stdout('No library smoke test configured; skipping');
    return;
  }

  stdout('Checking library entry point');
  checkLibraryEntryPoint({ packageName, runCommandFn, workspace });
}

export function checkConfiguredCliEntryPoints({
  cliArgs = DEFAULT_CLI_ARGS,
  installedPackageJson,
  packageName,
  runCommandFn = runCommand,
  skipCli = false,
  stdout = console.log,
  workspace,
}) {
  const binEntries = getBinEntries(installedPackageJson, packageName);
  if (skipCli || binEntries.length === 0) {
    stdout('No CLI smoke test configured; skipping');
    return;
  }

  checkCliEntryPoints({
    binEntries,
    cliArgs,
    runCommandFn,
    stdout,
    workspace,
  });
}

async function waitForHealth({
  fetchFn = fetch,
  sleepFn = sleep,
  timeoutSeconds = DEFAULT_SERVER_TIMEOUT_SECONDS,
  url,
}) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetchFn(url);
      if (response.ok) {
        return;
      }
      lastError = new Error(`${url} returned status ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await sleepFn(1);
  }

  throw lastError || new Error(`Timed out waiting for ${url}`);
}

export async function checkServerEntryPoint({
  runServerFn = spawn,
  serverArgs = [],
  serverBin,
  serverHealthUrl,
  serverTimeoutSeconds = DEFAULT_SERVER_TIMEOUT_SECONDS,
  stdout = console.log,
  workspace,
}) {
  if (!serverBin || !serverHealthUrl) {
    stdout('No HTTP server smoke test configured; skipping');
    return;
  }

  const binPath = resolveBinShim(workspace, serverBin);
  stdout(
    `Checking HTTP server entry point: ${serverBin} ${serverArgs.join(' ')}`
  );
  const child = runServerFn(binPath, serverArgs, {
    cwd: workspace,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr?.on('data', (chunk) => {
    stderr += String(chunk);
  });

  try {
    await waitForHealth({
      timeoutSeconds: serverTimeoutSeconds,
      url: serverHealthUrl,
    });
    stdout(`server OK: ${serverHealthUrl} responded`);
  } catch (error) {
    throw new Error(
      `HTTP server smoke test failed: ${error.message}\nServer stderr:\n${stderr}`
    );
  } finally {
    child.kill?.('SIGINT');
  }
}

export async function smokeTestPackage({
  cliArgs = DEFAULT_CLI_ARGS,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  packageName,
  packageVersion,
  runCommandFn = runCommand,
  serverArgs = [],
  serverBin = '',
  serverHealthUrl = '',
  serverTimeoutSeconds = DEFAULT_SERVER_TIMEOUT_SECONDS,
  skipCli = false,
  skipLibrary = false,
  sleepFn = sleep,
  sleepSeconds = DEFAULT_SLEEP_SECONDS,
  stdout = console.log,
  workspaceFactory = () => mkdtempSync(join(tmpdir(), 'npm-smoke-')),
} = {}) {
  const packageSpec = formatNpmPackageVersion(packageName, packageVersion);
  const workspace = workspaceFactory();
  stdout(`Smoke-testing installable package ${packageSpec}`);
  stdout(`Workspace: ${workspace}`);

  try {
    writeFileSync(
      join(workspace, 'package.json'),
      JSON.stringify(
        { name: 'npm-package-smoke-test', private: true, type: 'module' },
        null,
        2
      )
    );

    await installFromNpm({
      cwd: workspace,
      maxAttempts,
      packageSpec,
      runCommandFn,
      sleepFn,
      sleepSeconds,
      stdout,
    });

    const installedPackageJson = readJsonFile(
      getInstalledPackageJsonPath(workspace, packageName)
    );

    checkConfiguredLibraryEntryPoint({
      installedPackageJson,
      packageName,
      runCommandFn,
      skipLibrary,
      stdout,
      workspace,
    });

    checkConfiguredCliEntryPoints({
      cliArgs,
      installedPackageJson,
      packageName,
      runCommandFn,
      skipCli,
      stdout,
      workspace,
    });

    await checkServerEntryPoint({
      serverArgs,
      serverBin,
      serverHealthUrl,
      serverTimeoutSeconds,
      stdout,
      workspace,
    });

    stdout(`All configured entry points verified for ${packageSpec}`);
  } finally {
    rmSync(workspace, { force: true, recursive: true });
  }
}

function isCliEntryPoint() {
  return (
    typeof process !== 'undefined' &&
    process.argv?.[1] &&
    fileURLToPath(import.meta.url) === resolve(process.argv[1])
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
    if (!config.packageVersion) {
      stderr('Error: Missing required --package-version');
      stderr(USAGE);
      return 1;
    }

    const packageInfo = config.packageName
      ? { name: config.packageName }
      : readPackageInfo({ jsRoot: config.jsRoot || undefined });

    await smokeTestPackage({
      ...config,
      packageName: packageInfo.name,
      stdout: (message) => stdout(`[smoke-test] ${message}`),
    });
    return 0;
  } catch (error) {
    stderr(`[smoke-test] FAILED: ${error.message}`);
    return 1;
  }
}

if (isCliEntryPoint()) {
  process.exitCode = await main();
}
