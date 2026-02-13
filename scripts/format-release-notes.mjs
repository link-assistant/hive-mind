#!/usr/bin/env node

/**
 * Script to format GitHub release notes with proper formatting:
 * - Fix special characters like \n
 * - Add links to ALL PRs that contain the release commits (if found)
 * - Add shields.io NPM version badge
 * - Format nicely with proper markdown
 *
 * PR Detection Logic (Issue #1271 fix):
 * 1. Extract ALL commit hashes from changelog entries (not just the first)
 * 2. Fall back to --commit-sha argument (passed from workflow)
 * 3. Look up PRs for EACH commit hash via GitHub API
 * 4. Collect all unique PR numbers and display them all
 * 5. If no PRs found, simply don't display any PR link (no guessing)
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
  console.error('Usage: format-release-notes.mjs --release-id <releaseId> --release-version <version> --repository <repository> [--commit-sha <sha>]');
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
  // This regex captures the ENTIRE content after "### Patch Changes"
  // We'll then extract ALL commit hashes from it (Issue #1271 fix)
  const patchChangesMatch = currentBody.match(/### Patch Changes\s*\n([\s\S]+?)(?=###|$)/);
  const minorChangesMatch = currentBody.match(/### Minor Changes\s*\n([\s\S]+?)(?=###|$)/);

  // Get raw description from either Patch Changes or Minor Changes
  let rawDescription = null;
  if (patchChangesMatch) {
    rawDescription = patchChangesMatch[1];
  } else if (minorChangesMatch) {
    rawDescription = minorChangesMatch[1];
  } else {
    console.log('Could not parse patch/minor changes from release notes');
    process.exit(0);
  }

  // Extract ALL commit hashes from the changelog entry (Issue #1271 fix)
  // Format: "- abc1234: Description" or "- abc1234f: Description"
  const commitHashRegex = /-\s+([a-f0-9]{7,40}):/g;
  const commitHashes = [...rawDescription.matchAll(commitHashRegex)].map(m => m[1]);
  console.log(`Found ${commitHashes.length} commit hash(es) in changelog: ${commitHashes.join(', ') || 'none'}`);

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
    .map(line => line.trim()) // Trim whitespace from each line
    .join('\n') // Rejoin with newlines
    .replace(/\n{3,}/g, '\n\n'); // Normalize excessive blank lines (3+ becomes 2)

  // Find ALL PRs that contain the release commits (Issue #1271 fix)
  // Uses commit hashes from changelog AND passed commit SHA from workflow
  const relatedPrNumbers = new Set();

  // Build list of all commit SHAs to look up
  const commitsToLookup = [...commitHashes];
  if (passedCommitSha && !commitsToLookup.includes(passedCommitSha)) {
    commitsToLookup.push(passedCommitSha);
  }

  if (commitsToLookup.length > 0) {
    console.log(`Looking up PRs for ${commitsToLookup.length} commit(s)...`);

    for (const sha of commitsToLookup) {
      const source = commitHashes.includes(sha) ? 'changelog' : 'workflow';
      console.log(`  Checking commit ${sha} (from ${source})...`);

      try {
        const prResult = await $`gh api "repos/${repository}/commits/${sha}/pulls"`.run({ capture: true });
        const prsData = JSON.parse(prResult.stdout);

        // Find PRs that are not version bump PRs (not "chore: version packages")
        const relevantPrs = prsData.filter(pr => !pr.title.includes('version packages'));

        for (const pr of relevantPrs) {
          relatedPrNumbers.add(pr.number);
          console.log(`    Found PR #${pr.number}: ${pr.title}`);
        }

        if (relevantPrs.length === 0 && prsData.length > 0) {
          console.log(`    Found ${prsData.length} PR(s) but all are version bump PRs`);
        } else if (prsData.length === 0) {
          console.log(`    No PR found for this commit`);
        }
      } catch (error) {
        console.log(`    Could not find PR for commit ${sha}: ${error.message}`);
        if (process.env.DEBUG) {
          console.error(error);
        }
      }
    }

    console.log(`Total related PRs found: ${relatedPrNumbers.size}`);
  } else {
    console.log('No commit SHAs available - not adding PR links');
  }

  // Convert Set to sorted array for consistent output
  const prNumbers = [...relatedPrNumbers].sort((a, b) => a - b);

  // Build formatted release notes
  const versionWithoutV = version.replace(/^v/, '');
  const encodedPackageName = encodeURIComponent(PACKAGE_NAME);
  const npmBadge = `[![npm version](https://img.shields.io/badge/npm-${versionWithoutV}-blue.svg)](https://www.npmjs.com/package/${encodedPackageName}/v/${versionWithoutV})`;

  let formattedBody = `${cleanDescription}`;

  // Add PR links if available (Issue #1271 fix: support multiple PRs)
  if (prNumbers.length > 0) {
    const prLabel = prNumbers.length === 1 ? 'Related Pull Request' : 'Related Pull Requests';
    const prLinks = prNumbers.map(n => `#${n}`).join(', ');
    formattedBody += `\n\n**${prLabel}:** ${prLinks}`;
  }

  formattedBody += `\n\n---\n\n${npmBadge}`;

  // Update the release using JSON input to properly handle special characters
  const updatePayload = JSON.stringify({ body: formattedBody });
  await $`gh api repos/${repository}/releases/${releaseId} -X PATCH --input -`.run({ stdin: updatePayload });

  console.log(`Formatted release notes for v${versionWithoutV}`);
  if (prNumbers.length > 0) {
    console.log(`   - Added link(s) to PR(s): ${prNumbers.map(n => `#${n}`).join(', ')}`);
  }
  console.log('   - Added shields.io npm badge');
  console.log('   - Cleaned up formatting');
} catch (error) {
  console.error('Error formatting release notes:', error.message);
  process.exit(1);
}
