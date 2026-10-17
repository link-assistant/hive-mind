#!/usr/bin/env node
import { sanitizeForPublication } from '../src/token-sanitization.lib.mjs';
import { ensureUseM } from '../src/use-m-bootstrap.lib.mjs';
import { wrapDollarWithGhRetry as _wrapDollarWithGhRetry } from '../src/github-rate-limit.lib.mjs'; // rate-limit marker (#1726): gh API calls flow through $ wrapped by caller
import { PACKAGE_NAME, buildReleaseBody, buildReleaseDescription, hasGeneratedFooter } from './format-release-notes.lib.mjs';

/**
 * Script to format GitHub release notes with proper formatting:
 * - Keep the changelog's Markdown structure (indented paragraphs and nested
 *   lists stay inside their list item, every change section is kept), see
 *   scripts/format-release-notes.lib.mjs and issue #3445
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

// Load use-m dynamically
const use = await ensureUseM();

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
      })
      .option('verbose', {
        type: 'boolean',
        default: getenv('VERBOSE', '') === 'true',
        describe: 'Print the formatted description (issue #3445)',
      }),
});

const releaseId = config.releaseId;
const version = config.releaseVersion;
const repository = config.repository;
const passedCommitSha = config.commitSha;
const verbose = Boolean(config.verbose);

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

  // Skip if already formatted (has the generated npm badge footer). A
  // shields.io image inside a changeset's own text does not count.
  if (hasGeneratedFooter(currentBody)) {
    console.log('Release notes already formatted');
    process.exit(0);
  }

  // Issue #3445: keep the Markdown structure exactly as changesets wrote it.
  // Continuation paragraphs and nested lists of a changeset are indented under
  // their list item; trimming every line (as before) moved them out of the
  // list. Every `### Major/Minor/Patch Changes` section is kept, and the notes
  // are no longer cut at the first `---` or `###` inside a changeset's text.
  const { description: cleanDescription, sections, commitHashes } = buildReleaseDescription(currentBody);
  if (!cleanDescription) {
    console.log('Release notes are empty, nothing to format');
    process.exit(0);
  }
  console.log(`Found ${sections.length} change section(s): ${sections.map(section => section.type).join(', ') || 'none'}`);
  console.log(`Found ${commitHashes.length} commit hash(es) in changelog: ${commitHashes.join(', ') || 'none'}`);
  if (verbose) {
    console.log('Formatted description:');
    console.log(cleanDescription);
  }

  // Find ALL PRs that contain the release commits (Issue #1271 fix, Issue #1452 enhancement)
  // Uses commit hashes from changelog, passed commit SHA, AND merge commits between version tags
  const relatedPrNumbers = new Set();

  // Build list of all commit SHAs to look up
  const commitsToLookup = [...commitHashes];
  if (passedCommitSha && !commitsToLookup.includes(passedCommitSha)) {
    commitsToLookup.push(passedCommitSha);
  }

  // Issue #1452: When changesets are merged or don't have commit hashes,
  // find all merge commits between the previous version tag and the current one.
  // This ensures we detect ALL related PRs even when multiple PRs merge before a release.
  try {
    const versionWithoutV = version.replace(/^v/, '');
    const currentTag = `v${versionWithoutV}`;

    // Find the previous version tag by listing tags sorted by version
    const tagsResult = await $`gh api "repos/${repository}/tags?per_page=100" --paginate --jq '.[].name'`.run({ capture: true });
    const tags = tagsResult.stdout
      .trim()
      .split('\n')
      .filter(t => t.startsWith('v'));

    const currentTagIndex = tags.indexOf(currentTag);
    const previousTag = currentTagIndex >= 0 && currentTagIndex + 1 < tags.length ? tags[currentTagIndex + 1] : null;

    if (previousTag) {
      console.log(`Finding merge commits between ${previousTag} and ${currentTag}...`);
      const mergeCommitsResult = await $`gh api "repos/${repository}/compare/${previousTag}...${currentTag}" --paginate --jq '.commits[] | select(.parents | length > 1) | .sha'`.run({ capture: true });
      const mergeCommits = mergeCommitsResult.stdout.trim().split('\n').filter(Boolean);

      console.log(`Found ${mergeCommits.length} merge commit(s) between tags`);
      for (const sha of mergeCommits) {
        if (!commitsToLookup.includes(sha)) {
          commitsToLookup.push(sha);
        }
      }
    } else {
      console.log(`Could not find previous tag before ${currentTag}`);
    }
  } catch (error) {
    console.log(`Could not find merge commits between tags: ${error.message}`);
    if (process.env.DEBUG) {
      console.error(error);
    }
  }

  if (commitsToLookup.length > 0) {
    console.log(`Looking up PRs for ${commitsToLookup.length} commit(s)...`);

    for (const sha of commitsToLookup) {
      const source = commitHashes.includes(sha) ? 'changelog' : sha === passedCommitSha ? 'workflow' : 'tag-range';
      console.log(`  Checking commit ${sha} (from ${source})...`);

      try {
        const prResult = await $`gh api "repos/${repository}/commits/${sha}/pulls" --paginate`.run({ capture: true });
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
  const formattedBody = buildReleaseBody({ description: cleanDescription, version: versionWithoutV, prNumbers, packageName: PACKAGE_NAME });

  // Update the release using JSON input to properly handle special characters
  const updatePayload = JSON.stringify({ body: await sanitizeForPublication(formattedBody) });
  await $({ stdin: updatePayload })`gh api repos/${repository}/releases/${releaseId} -X PATCH --input -`;

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
