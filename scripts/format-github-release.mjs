#!/usr/bin/env node

/**
 * Format GitHub release notes using the format-release-notes.mjs script
 * Usage: node scripts/format-github-release.mjs --release-version <version> --repository <repository> --commit-sha <commit_sha>
 *   release-version: Version number (e.g., 1.0.0)
 *   repository: GitHub repository (e.g., owner/repo)
 *   commit_sha: Commit SHA for PR detection
 *
 * Uses link-foundation libraries:
 * - use-m: Dynamic package loading without package.json dependencies
 * - command-stream: Modern shell command execution with streaming support
 * - lino-arguments: Unified configuration from CLI args, env vars, and .lenv files
 */

// Load use-m dynamically
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());

// Import link-foundation libraries
const { $ } = await use('command-stream');
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
      })
      .option('commit-sha', {
        type: 'string',
        default: getenv('COMMIT_SHA', ''),
        describe: 'Commit SHA for PR detection',
      }),
});

const { releaseVersion: version, repository, commitSha } = config;

if (!version || !repository || !commitSha) {
  console.error('Error: Missing required arguments');
  console.error('Usage: node scripts/format-github-release.mjs --release-version <version> --repository <repository> --commit-sha <commit_sha>');
  process.exit(1);
}

const tag = `v${version}`;

try {
  // Get the release ID for this version
  let releaseId = '';
  try {
    const result = await $`gh api "repos/${repository}/releases/tags/${tag}" --jq '.id'`.run({ capture: true });
    releaseId = result.stdout.trim();
  } catch {
    console.log(`Could not find release for ${tag}`);
    process.exit(0);
  }

  if (releaseId) {
    console.log(`Formatting release notes for ${tag}...`);
    // Pass the trigger commit SHA for PR detection
    // This allows proper PR lookup even if the changelog doesn't have a commit hash
    await $`node scripts/format-release-notes.mjs --release-id "${releaseId}" --release-version "${tag}" --repository "${repository}" --commit-sha "${commitSha}"`;
    console.log(`Formatted release notes for ${tag}`);
  }
} catch (error) {
  console.error('Error formatting release:', error.message);
  process.exit(1);
}
