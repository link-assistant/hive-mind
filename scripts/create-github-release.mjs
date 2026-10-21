#!/usr/bin/env node
import { ensureUseM } from '../src/use-m-bootstrap.lib.mjs';

/**
 * Create GitHub Release from CHANGELOG.md
 * Usage: node scripts/create-github-release.mjs --release-version <version> --repository <repository>
 *   release-version: Version number (e.g., 1.0.0)
 *   repository: GitHub repository (e.g., owner/repo)
 *
 * Uses link-foundation libraries:
 * - use-m: Dynamic package loading without package.json dependencies
 * - command-stream: Modern shell command execution with streaming support
 * - lino-arguments: Unified configuration from CLI args, env vars, and .lenv files
 */

import { readFileSync } from 'fs';
import { sanitizeForPublication } from '../src/token-sanitization.lib.mjs';
import { extractChangelogSection } from './format-release-notes.lib.mjs';

import { wrapDollarWithGhRetry } from '../src/github-rate-limit.lib.mjs';
// Load use-m dynamically
const use = await ensureUseM();

// Import link-foundation libraries
// Issue #3552: every gh call below is retried on transient GitHub faults.
const { $: rawDollar$ } = await use('command-stream');
const $ = wrapDollarWithGhRetry(rawDollar$);
const { makeConfig } = await use('lino-arguments');

// Parse CLI arguments using lino-arguments
// Note: Using --release-version instead of --version to avoid conflict with yargs' built-in --version flag
const config = makeConfig({
  yargs: ({ yargs, getenv }) =>
    yargs
      .option('release-version', {
        type: 'string',
        default: getenv('VERSION', ''),
        describe: 'Version number (e.g., 1.0.0)',
      })
      .option('repository', {
        type: 'string',
        default: getenv('REPOSITORY', ''),
        describe: 'GitHub repository (e.g., owner/repo)',
      }),
});

const { releaseVersion: version, repository } = config;

if (!version || !repository) {
  console.error('Error: Missing required arguments');
  console.error('Usage: node scripts/create-github-release.mjs --release-version <version> --repository <repository>');
  process.exit(1);
}

const tag = `v${version}`;

console.log(`Creating GitHub release for ${tag}...`);

try {
  // Read CHANGELOG.md
  const changelog = readFileSync('./CHANGELOG.md', 'utf8');

  // Extract changelog entry for this version: the lines between its `## x.y.z`
  // heading and the next `## ` heading. The heading must match the whole line,
  // so 2.3.1 never reads the section of 2.3.10 (issue #3445).
  let releaseNotes = extractChangelogSection(changelog, version);

  if (!releaseNotes) {
    releaseNotes = `Release ${version}`;
  }

  // Create release using GitHub API with JSON input
  // This avoids shell escaping issues that occur when passing text via command-line arguments
  // (Previously caused apostrophes like "didn't" to appear as "didn'''" in releases)
  const payload = JSON.stringify({
    tag_name: await sanitizeForPublication(tag),
    name: await sanitizeForPublication(version),
    body: await sanitizeForPublication(releaseNotes),
  });

  await $({ stdin: payload })`gh api repos/${repository}/releases -X POST --input -`;

  console.log(`Created GitHub release: ${tag}`);
} catch (error) {
  console.error('Error creating release:', error.message);
  process.exit(1);
}
