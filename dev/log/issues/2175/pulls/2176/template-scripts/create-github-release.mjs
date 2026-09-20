#!/usr/bin/env bun

/**
 * Create GitHub Release from CHANGELOG.md
 * Usage: node scripts/create-github-release.mjs --release-version <version> --repository <repository> [--tag-prefix <prefix>] [--language <language>] [--js-root <path>]
 *   release-version: Version number (e.g., 1.0.0)
 *   repository: GitHub repository (e.g., owner/repo)
 *   tag-prefix: Prefix for the git tag (default: auto-detect from layout)
 *   language: Human-readable language name for the release title (default: "JavaScript")
 *   js-root: JavaScript package root directory (auto-detected if not specified)
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getJsRoot } from './js-paths.mjs';
import { readPackageInfo } from './package-info.mjs';
import {
  buildReleaseTag,
  buildReleaseTitle,
  normalizeReleaseVersion,
} from './release-naming.mjs';

const USAGE =
  'Usage: node scripts/create-github-release.mjs --release-version <version> --repository <repository> [--tag-prefix <prefix>] [--language <language>] [--js-root <path>]';
const OPTION_CONFIG_KEYS = new Map([
  ['--release-version', 'releaseVersion'],
  ['--repository', 'repository'],
  ['--tag-prefix', 'tagPrefix'],
  ['--language', 'language'],
  ['--js-root', 'jsRoot'],
]);

// Keep comfortably below GitHub's observed 125000-character release body limit.
export const GITHUB_RELEASE_BODY_MAX_BYTES = 120_000;
const textEncoder = new globalThis.TextEncoder();

export function parseArgs(argv, env = process.env) {
  const config = {
    jsRoot: env.JS_ROOT ?? '',
    language: env.LANGUAGE ?? 'JavaScript',
    releaseVersion: env.VERSION ?? '',
    repository: env.REPOSITORY ?? '',
    tagPrefix: env.TAG_PREFIX,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const inlineValueIndex = arg.indexOf('=');

    if (inlineValueIndex !== -1) {
      assignOptionValue(
        config,
        arg.slice(0, inlineValueIndex),
        arg.slice(inlineValueIndex + 1)
      );
      continue;
    }

    if (OPTION_CONFIG_KEYS.has(arg)) {
      assignOptionValue(config, arg, readOptionValue(argv, index, arg));
      index++;
    }
  }

  return config;
}

function assignOptionValue(config, optionName, value) {
  const configKey = OPTION_CONFIG_KEYS.get(optionName);

  if (configKey) {
    config[configKey] = value;
  }
}

function readOptionValue(argv, index, optionName) {
  const value = argv[index + 1];

  if (value === undefined || value.startsWith('--')) {
    throw new Error(`Missing value for ${optionName}`);
  }

  return value;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function extractReleaseNotes(changelog, version) {
  // Read from CHANGELOG.md between this version header and the next version header.
  const versionHeaderRegex = new RegExp(
    `## ${escapeRegex(version)}(?=\\s|$)[\\s\\S]*?(?=## \\d|$)`
  );
  const match = changelog.match(versionHeaderRegex);

  if (!match) {
    return `Release ${version}`;
  }

  const releaseNotes = match[0].replace(`## ${version}`, '').trim();

  return releaseNotes || `Release ${version}`;
}

function getUtf8ByteLength(value) {
  return textEncoder.encode(value).byteLength;
}

function truncateToUtf8Bytes(value, maxBytes) {
  const chunks = [];
  let usedBytes = 0;

  for (const character of value) {
    const characterBytes = getUtf8ByteLength(character);

    if (usedBytes + characterBytes > maxBytes) {
      break;
    }

    chunks.push(character);
    usedBytes += characterBytes;
  }

  return chunks.join('');
}

function buildTaggedChangelogUrl(repository, tag) {
  return `https://github.com/${repository}/blob/${tag}/CHANGELOG.md`;
}

function buildTruncatedReleaseNotesNotice({ repository, tag }) {
  const changelogUrl = buildTaggedChangelogUrl(repository, tag);

  return `Release notes were shortened to fit GitHub's release body limit. See the full tagged CHANGELOG.md: ${changelogUrl}`;
}

export function limitReleaseNotesBytes({
  maxBytes = GITHUB_RELEASE_BODY_MAX_BYTES,
  releaseNotes,
  repository,
  tag,
}) {
  if (getUtf8ByteLength(releaseNotes) <= maxBytes) {
    return releaseNotes;
  }

  const suffix = `\n\n...\n\n${buildTruncatedReleaseNotesNotice({
    repository,
    tag,
  })}`;
  const suffixBytes = getUtf8ByteLength(suffix);
  const availableBytes = Math.max(0, maxBytes - suffixBytes);
  const shortenedNotes = truncateToUtf8Bytes(
    releaseNotes,
    availableBytes
  ).trimEnd();
  const limitedNotes = `${shortenedNotes}${suffix}`;

  if (getUtf8ByteLength(limitedNotes) <= maxBytes) {
    return limitedNotes;
  }

  return truncateToUtf8Bytes(limitedNotes, maxBytes);
}

export function buildReleasePayload({
  changelog,
  jsRoot = '.',
  language,
  packageName,
  repository,
  tag,
  version,
}) {
  const normalizedVersion = normalizeReleaseVersion(version);
  const releaseNotes = extractReleaseNotes(changelog, normalizedVersion);

  return JSON.stringify({
    tag_name: tag,
    name: buildReleaseTitle(tag, {
      jsRoot,
      language: language ?? 'JavaScript',
      packageName,
    }),
    body: limitReleaseNotesBytes({ releaseNotes, repository, tag }),
  });
}

function formatGhOutput(result) {
  return [result.stderr, result.stdout]
    .filter((output) => typeof output === 'string' && output.trim())
    .map((output) => output.trim())
    .join('\n');
}

function getGhExitDescription(result) {
  if (result.signal) {
    return `signal ${result.signal}`;
  }

  if (typeof result.status === 'number') {
    return `code ${result.status}`;
  }

  return 'unknown exit status';
}

export function createRelease({ payload, repository, spawn = spawnSync }) {
  const result = spawn(
    'gh',
    ['api', `repos/${repository}/releases`, '-X', 'POST', '--input', '-'],
    {
      encoding: 'utf8',
      input: payload,
    }
  );

  if (result.error) {
    throw new Error(`gh api failed to start: ${result.error.message}`);
  }

  if (result.status === 0) {
    return { alreadyExists: false };
  }

  const output = formatGhOutput(result);

  if (/already_exists/i.test(output)) {
    return { alreadyExists: true };
  }

  const details = output ? `:\n${output}` : '';
  throw new Error(
    `gh api failed with ${getGhExitDescription(result)}${details}`
  );
}

export function main({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  env = process.env,
  spawn = spawnSync,
  stderr = console.error,
  stdout = console.log,
} = {}) {
  try {
    const {
      language,
      jsRoot: configuredJsRoot,
      releaseVersion: version,
      repository,
      tagPrefix,
    } = parseArgs(argv, env);

    if (!version || !repository) {
      stderr('Error: Missing required arguments');
      stderr(USAGE);
      return 1;
    }

    const jsRoot = getJsRoot({ jsRoot: configuredJsRoot || undefined });
    const tag = buildReleaseTag(version, { jsRoot, tagPrefix });
    const normalizedVersion = normalizeReleaseVersion(version);
    const { name: packageName } = readPackageInfo({ jsRoot });

    stdout(`Creating GitHub release for ${tag}...`);

    const changelogPath =
      jsRoot === '.' ? 'CHANGELOG.md' : path.join(jsRoot, 'CHANGELOG.md');
    const changelog = readFileSync(path.join(cwd, changelogPath), 'utf8');
    const payload = buildReleasePayload({
      changelog,
      jsRoot,
      language,
      packageName,
      repository,
      tag,
      version: normalizedVersion,
    });
    const result = createRelease({ payload, repository, spawn });

    if (result.alreadyExists) {
      stdout(`GitHub release already exists: ${tag}. Skipping creation.`);
      return 0;
    }

    stdout(`\u2705 Created GitHub release: ${tag}`);
    return 0;
  } catch (error) {
    stderr(`Error creating release: ${error.message}`);
    return 1;
  }
}

function isCliEntryPoint() {
  return (
    typeof process !== 'undefined' &&
    process.argv?.[1] &&
    fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  );
}

if (isCliEntryPoint()) {
  process.exitCode = main();
}
