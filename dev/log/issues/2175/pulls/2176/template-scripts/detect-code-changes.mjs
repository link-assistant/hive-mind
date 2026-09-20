#!/usr/bin/env node

// Detect code changes for CI/CD pipeline
//
// Detects what types of files changed in the latest commit and outputs
// results for use in GitHub Actions workflow conditions.
//
// For PRs: GitHub Actions checks out a synthetic merge commit, so we
// compare HEAD^2^ to HEAD^2 (the PR head's per-commit diff).
// For merge commits pushed to main: compares HEAD^1 to HEAD (the full
// first-parent merge diff).
// For non-merge pushes: compares HEAD^ to HEAD.
// This lets PR synchronize runs skip slow checks when the latest PR head
// commit is docs-only, while real merge pushes still evaluate the whole merge.
//
// Ignored for every change-gating output:
// - .changeset/ folder (changeset metadata)
// - docs/case-studies/ folder (research documents)
// - dev/log/ folder (development logs)
// - experiments/ folder (experimental scripts)
// - examples/ folder (example scripts)
//
// Additionally excluded from code changes (don't require changesets):
// - Markdown files in any folder
// - docs/ folder (documentation)
//
// Outputs (written to GITHUB_OUTPUT):
//   js-changed, docs-changed, any-code-changed

import { execFileSync } from 'child_process';
import { appendFileSync } from 'fs';

const ignoredPathPrefixes = [
  '.changeset/',
  'dev/log/',
  'docs/case-studies/',
  'examples/',
  'experiments/',
];

function execGit(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf-8' }).trim();
  } catch (error) {
    console.error(`Error executing command: git ${args.join(' ')}`);
    console.error(error.message);
    throw error;
  }
}

function splitChangedFiles(output) {
  return output ? output.split('\n').filter(Boolean) : [];
}

function setOutput(name, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    appendFileSync(outputFile, `${name}=${value}\n`);
  }
  console.log(`${name}=${value}`);
}

function isMergeCommit() {
  const parentCount = execGit(['cat-file', '-p', 'HEAD'])
    .split('\n')
    .filter((line) => line.startsWith('parent ')).length;
  return parentCount > 1;
}

function isPullRequestEvent() {
  return process.env.GITHUB_EVENT_NAME === 'pull_request';
}

function getChangedFiles() {
  const mergeCommit = isMergeCommit();

  // GitHub Actions checks out a synthetic merge commit for pull_request
  // events: HEAD is the merge commit, HEAD^ is the base branch, HEAD^2
  // is the actual PR head. For the PR head's per-commit diff,
  // compare HEAD^2^ with HEAD^2.
  // For push events, merge commits need the first-parent diff so the full
  // branch merge is evaluated, not only the PR head's final commit.
  if (mergeCommit && isPullRequestEvent()) {
    console.log('Merge commit detected (pull_request event)');
    console.log('Comparing HEAD^2^ to HEAD^2 (per-commit diff of PR head)');
    try {
      return splitChangedFiles(
        execGit(['diff', '--name-only', 'HEAD^2^', 'HEAD^2'])
      );
    } catch {
      console.log(
        'HEAD^2^ not available (first commit in PR), listing files in HEAD^2'
      );
      return splitChangedFiles(
        execGit(['diff', '--name-only', 'HEAD^', 'HEAD^2'])
      );
    }
  }

  if (mergeCommit) {
    console.log('Merge commit detected (push event)');
    console.log('Comparing HEAD^1 to HEAD (first-parent merge diff)');
    return splitChangedFiles(
      execGit(['diff', '--name-only', 'HEAD^1', 'HEAD'])
    );
  }

  console.log('Comparing HEAD^ to HEAD');
  try {
    return splitChangedFiles(execGit(['diff', '--name-only', 'HEAD^', 'HEAD']));
  } catch {
    console.log('HEAD^ not available, listing all files in HEAD');
    return splitChangedFiles(execGit(['ls-tree', '--name-only', '-r', 'HEAD']));
  }
}

function isExcludedFromCodeChanges(filePath) {
  if (filePath.endsWith('.md')) {
    return true;
  }

  return filePath.startsWith('docs/');
}

function detectChanges() {
  console.log('Detecting file changes for CI/CD...\n');

  const changedFiles = getChangedFiles();

  console.log('Changed files:');
  if (changedFiles.length === 0) {
    console.log('  (none)');
  } else {
    changedFiles.forEach((file) => console.log(`  ${file}`));
  }
  console.log('');

  const relevantChangedFiles = changedFiles.filter(
    (file) => !ignoredPathPrefixes.some((prefix) => file.startsWith(prefix))
  );

  const jsChanged = relevantChangedFiles.some((file) =>
    /\.(mjs|cjs|js)$/.test(file)
  );
  setOutput('js-changed', jsChanged ? 'true' : 'false');

  const docsChanged = relevantChangedFiles.some((file) => file.endsWith('.md'));
  setOutput('docs-changed', docsChanged ? 'true' : 'false');

  const codeChangedFiles = relevantChangedFiles.filter(
    (file) => !isExcludedFromCodeChanges(file)
  );

  console.log('\nFiles considered as code changes:');
  if (codeChangedFiles.length === 0) {
    console.log('  (none)');
  } else {
    codeChangedFiles.forEach((file) => console.log(`  ${file}`));
  }
  console.log('');

  const codePattern = /\.(mjs|cjs|js|json|yml|yaml)$|\.github\/workflows\//;
  const anyCodeChanged = codeChangedFiles.some((file) =>
    codePattern.test(file)
  );
  setOutput('any-code-changed', anyCodeChanged ? 'true' : 'false');

  console.log('\nChange detection completed.');
}

// Run the detection
detectChanges();
