#!/usr/bin/env node
/**
 * Rebuild the notes of already published GitHub releases from CHANGELOG.md
 * with the structure-preserving formatter (issue #3445).
 *
 * Until issue #3445 the release formatter trimmed every line, which moved the
 * continuation paragraphs and nested lists of a changeset out of its list item
 * (v2.37.1 and hundreds of earlier releases); older formatter versions also
 * dropped list markers, whole change sections or everything after a `---`.
 * This script finds those releases and, with --apply, rewrites their body.
 *
 * Usage:
 *   node scripts/repair-release-notes.mjs [--repository owner/repo] [--tag v2.37.1 ...]
 *        [--releases-file releases.json] [--changelog CHANGELOG.md]
 *        [--lookup-prs] [--apply] [--backup-dir dir] [--verbose]
 *
 * Without --apply it only reports what it would change (dry run). With
 * --backup-dir every original body is saved as <tag>.md before it is replaced.
 *
 * Uses only Node built-ins and the gh CLI.
 */

import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { retryGitHubOperation } from '../src/github-operation-retry.lib.mjs';
import { sanitizeForPublication } from '../src/token-sanitization.lib.mjs';
import { planReleaseRepair } from './format-release-notes.lib.mjs';

const execFileAsync = promisify(execFile);
const GH_TIMEOUT_MS = 60_000;

function parseArgs(argv) {
  const options = { repository: process.env.GITHUB_REPOSITORY || 'link-assistant/hive-mind', tags: [], releasesFile: '', changelog: 'CHANGELOG.md', lookupPrs: false, apply: false, backupDir: '', verbose: false, delayMs: 1000 };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const next = () => argv[++index];
    if (arg === '--repository') options.repository = next();
    else if (arg === '--tag') options.tags.push(...next().split(',').filter(Boolean));
    else if (arg === '--releases-file') options.releasesFile = next();
    else if (arg === '--changelog') options.changelog = next();
    else if (arg === '--lookup-prs') options.lookupPrs = true;
    else if (arg === '--apply') options.apply = true;
    else if (arg === '--backup-dir') options.backupDir = next();
    else if (arg === '--delay-ms') options.delayMs = Number(next());
    else if (arg === '--verbose') options.verbose = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0]);
      process.exit(0);
    } else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

// Issue #3552: every gh call is retried on transient GitHub faults.
const gh = (args, input) =>
  retryGitHubOperation(
    async () => {
      const child = execFileAsync('gh', args, { timeout: GH_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
      if (input !== undefined) {
        child.child.stdin.end(input);
      }
      const { stdout } = await child;
      return stdout;
    },
    { label: `gh ${args.slice(0, 2).join(' ')}` }
  );

async function loadReleases(options) {
  if (options.releasesFile) return JSON.parse(readFileSync(options.releasesFile, 'utf8'));
  const stdout = await gh(['api', `repos/${options.repository}/releases?per_page=100`, '--paginate', '--jq', '.[] | {id, tag_name, body}']);
  return stdout
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

async function lookupPrNumbersFor(repository, commitHashes, verbose) {
  const numbers = new Set();
  for (const sha of commitHashes) {
    try {
      const prs = JSON.parse(await gh(['api', `repos/${repository}/commits/${sha}/pulls`]));
      for (const pr of prs.filter(pr => !pr.title.includes('version packages'))) numbers.add(pr.number);
    } catch (error) {
      if (verbose) console.log(`    Could not find PR for commit ${sha}: ${error.message}`);
    }
  }
  return [...numbers];
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const changelog = readFileSync(options.changelog, 'utf8');
  let releases = await loadReleases(options);
  if (options.tags.length > 0) releases = releases.filter(release => options.tags.includes(release.tag_name));
  if (options.backupDir) mkdirSync(options.backupDir, { recursive: true });

  const summary = { checked: 0, repair: 0, repaired: 0, failed: 0, skipped: {} };
  for (const release of releases) {
    summary.checked++;
    const plan = await planReleaseRepair({
      release,
      changelog,
      lookupPrNumbers: options.lookupPrs ? hashes => lookupPrNumbersFor(options.repository, hashes, options.verbose) : undefined,
      sanitize: text => sanitizeForPublication(text),
    });
    if (plan.action === 'skip') {
      summary.skipped[plan.reason] = (summary.skipped[plan.reason] || 0) + 1;
      if (options.verbose) console.log(`${release.tag_name}: skip (${plan.reason})`);
      continue;
    }
    summary.repair++;
    console.log(`${release.tag_name}: ${options.apply ? 'repairing' : 'would repair'} (${plan.reason})`);
    if (options.verbose) console.log(plan.body.replace(/^/gm, '    | '));
    if (!options.apply) continue;
    try {
      if (options.backupDir) writeFileSync(join(options.backupDir, `${release.tag_name}.md`), release.body || '');
      const id = release.id ?? JSON.parse(await gh(['api', `repos/${options.repository}/releases/tags/${release.tag_name}`])).id;
      await gh(['api', `repos/${options.repository}/releases/${id}`, '-X', 'PATCH', '--input', '-'], JSON.stringify({ body: plan.body }));
      summary.repaired++;
      await sleep(options.delayMs);
    } catch (error) {
      summary.failed++;
      console.error(`${release.tag_name}: repair failed: ${error.message}`);
    }
  }
  console.log(JSON.stringify(summary, null, 2));
  if (summary.failed > 0) process.exit(1);
}

await main();
