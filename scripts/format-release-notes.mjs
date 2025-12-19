#!/usr/bin/env node

/**
 * Script to format GitHub release notes with proper formatting:
 * - Fix special characters like \n
 * - Add link to PR that contains the release commit (if found)
 * - Add shields.io NPM version badge
 * - Format nicely with proper markdown
 *
 * PR Detection Logic:
 * 1. Extract commit hash from changelog entry (if present)
 * 2. Fall back to --commit-sha argument (passed from workflow)
 * 3. Look up PRs that contain the commit via GitHub API
 * 4. If no PR found, simply don't display any PR link (no guessing)
 *
 * Uses link-foundation libraries:
 * - use-m: Dynamic package loading without package.json dependencies
 * - command-stream: Modern shell command execution with streaming support
 * - lino-arguments: Unified configuration from CLI args, env vars, and .lenv files
 *
 * Note: Uses --release-version instead of --version to avoid conflict with yargs' built-in --version flag.
 */

const PACKAGE_NAME = '@link-assistant/hive-mind';

// Load use-m dynamically
const { use } = eval(
  await (await fetch('https://unpkg.com/use-m/use.js')).text()
);

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
        describe: 'Version number (e.g., v0.8.36)',
      })
      .option('release-id', {
        type: 'string',
        default: getenv('RELEASE_ID', ''),
        describe: 'GitHub release ID',
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

const releaseId = config.releaseId;
const version = config.releaseVersion;
const repository = config.repository;
const passedCommitSha = config.commitSha;

if (!releaseId || !version || !repository) {
  console.error(
    'Usage: format-release-notes.mjs --release-id <releaseId> --release-version <version> --repository <repository> [--commit-sha <sha>]'
  );
  process.exit(1);
}

try {
  // Get current release body
  const result = await $`gh api repos/${repository}/releases/${releaseId}`.run({
    capture: true,
  });
  const releaseData = JSON.parse(result.stdout);

  const currentBody = releaseData.body || '';

  // Skip if already formatted (has shields.io badge image)
  if (currentBody.includes('img.shields.io')) {
    console.log('Release notes already formatted');
    process.exit(0);
  }

  // Extract the patch changes section
  // This regex handles two formats:
  // 1. With commit hash: "- abc1234: Description"
  // 2. Without commit hash: "- Description"
  const patchChangesMatchWithHash = currentBody.match(
    /### Patch Changes\s*\n\s*-\s+([a-f0-9]+):\s+(.+?)$/s
  );
  const patchChangesMatchNoHash = currentBody.match(
    /### Patch Changes\s*\n\s*-\s+(.+?)$/s
  );

  let commitHash = null;
  let rawDescription = null;

  if (patchChangesMatchWithHash) {
    // Format: - abc1234: Description
    [, commitHash, rawDescription] = patchChangesMatchWithHash;
  } else if (patchChangesMatchNoHash) {
    // Format: - Description (no commit hash)
    [, rawDescription] = patchChangesMatchNoHash;
  } else {
    console.log('Could not parse patch changes from release notes');
    process.exit(0);
  }

  // Clean up the description:
  // 1. Convert literal \n sequences (escaped newlines from GitHub API) to actual newlines
  // 2. Remove leading/trailing quotes (including escaped quotes from command-stream shell escaping)
  // 3. Remove any trailing npm package links or markdown that might be there
  // 4. Normalize whitespace while preserving line breaks
  const cleanDescription = rawDescription
    .replace(/\\n/g, '\n') // Convert escaped \n to actual newlines
    .replace(/^(\\['"])+/g, '') // Remove leading escaped quotes (e.g., \', \", \'', \'')
    .replace(/(['"])+$/g, '') // Remove trailing unescaped quotes (e.g., ', ", '', '')
    .replace(/^(['"])+/g, '') // Remove leading unescaped quotes
    .replace(/📦.*$/s, '') // Remove any existing npm package info
    .replace(/---.*$/s, '') // Remove any existing separators and everything after
    .trim()
    .split('\n') // Split by lines
    .map((line) => line.trim()) // Trim whitespace from each line
    .join('\n') // Rejoin with newlines
    .replace(/\n{3,}/g, '\n\n'); // Normalize excessive blank lines (3+ becomes 2)

  // Find the PR that contains the release commit
  // Uses commit hash from changelog or passed commit SHA from workflow
  let prNumber = null;

  // Determine which commit SHA to use for PR lookup
  const commitShaToLookup = commitHash || passedCommitSha;

  if (commitShaToLookup) {
    const source = commitHash ? 'changelog' : 'workflow';
    console.log(
      `Looking up PR for commit ${commitShaToLookup} (from ${source})`
    );

    try {
      const prResult =
        await $`gh api "repos/${repository}/commits/${commitShaToLookup}/pulls"`.run(
          { capture: true }
        );
      const prsData = JSON.parse(prResult.stdout);

      // Find the PR that's not the version bump PR (not "chore: version packages")
      const relevantPr = prsData.find(
        (pr) => !pr.title.includes('version packages')
      );

      if (relevantPr) {
        prNumber = relevantPr.number;
        console.log(`Found PR #${prNumber} containing commit`);
      } else if (prsData.length > 0) {
        console.log('Found PRs but all are version bump PRs, not linking any');
      } else {
        console.log('No PR found containing this commit - not adding PR link');
      }
    } catch (error) {
      console.log('Could not find PR for commit', commitShaToLookup);
      console.log('   Error:', error.message);
      if (process.env.DEBUG) {
        console.error(error);
      }
    }
  } else {
    // No commit hash available from any source
    console.log('No commit SHA available - not adding PR link');
  }

  // Build formatted release notes
  const versionWithoutV = version.replace(/^v/, '');
  const encodedPackageName = encodeURIComponent(PACKAGE_NAME);
  const npmBadge = `[![npm version](https://img.shields.io/badge/npm-${versionWithoutV}-blue.svg)](https://www.npmjs.com/package/${encodedPackageName}/v/${versionWithoutV})`;

  let formattedBody = `${cleanDescription}`;

  // Add PR link if available
  if (prNumber) {
    formattedBody += `\n\n**Related Pull Request:** #${prNumber}`;
  }

  formattedBody += `\n\n---\n\n${npmBadge}`;

  // Update the release using JSON input to properly handle special characters
  const updatePayload = JSON.stringify({ body: formattedBody });
  await $`gh api repos/${repository}/releases/${releaseId} -X PATCH --input -`.run(
    { stdin: updatePayload }
  );

  console.log(`Formatted release notes for v${versionWithoutV}`);
  if (prNumber) {
    console.log(`   - Added link to PR #${prNumber}`);
  }
  console.log('   - Added shields.io npm badge');
  console.log('   - Cleaned up formatting');
} catch (error) {
  console.error('Error formatting release notes:', error.message);
  process.exit(1);
}
