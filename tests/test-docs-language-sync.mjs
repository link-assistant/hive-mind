#!/usr/bin/env node

// Ensures root README and top-level docs language variants are updated together.
// This guards against changing only one language copy of a translated document.

import { execFileSync } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import path from 'path';

const LANGUAGES = ['en', 'zh', 'hi', 'ru'];
const LANGUAGE_SUFFIX = {
  en: '',
  zh: '.zh',
  hi: '.hi',
  ru: '.ru',
};

let testsPassed = 0;
let testsFailed = 0;

function runTest(name, fn) {
  process.stdout.write(`Testing ${name}... `);
  try {
    fn();
    console.log('✅ PASSED');
    testsPassed++;
  } catch (error) {
    console.log(`❌ FAILED: ${error.message}`);
    testsFailed++;
  }
}

function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

function refExists(ref) {
  return git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]) !== null;
}

function fetchRemoteRef(ref) {
  if (!ref) return false;
  git(['fetch', 'origin', `${ref}:refs/remotes/origin/${ref}`]);
  return refExists(`origin/${ref}`);
}

function diffNameOnly(refspec) {
  const output = git(['diff', '--name-only', refspec]);
  return output ? output.split('\n').filter(Boolean) : [];
}

function addWorkingTreeChanges(files) {
  const changed = new Set(files);
  for (const args of [
    ['diff', '--name-only'],
    ['diff', '--cached', '--name-only'],
  ]) {
    const output = git(args);
    if (!output) continue;
    for (const filePath of output.split('\n').filter(Boolean)) changed.add(filePath);
  }
  return [...changed];
}

function getChangedFilesFromGit() {
  if (process.env.DOCS_LANGUAGE_SYNC_CHANGED_FILES !== undefined) {
    return process.env.DOCS_LANGUAGE_SYNC_CHANGED_FILES.split(/\r?\n|,/)
      .map(file => file.trim())
      .filter(Boolean);
  }

  const eventName = process.env.GITHUB_EVENT_NAME || '';
  if (eventName === 'pull_request') {
    const baseSha = process.env.GITHUB_BASE_SHA;
    const headSha = process.env.GITHUB_HEAD_SHA || 'HEAD';
    if (baseSha && refExists(baseSha) && refExists(headSha)) return addWorkingTreeChanges(diffNameOnly(`${baseSha}...${headSha}`));

    const baseRef = process.env.GITHUB_BASE_REF;
    if (baseRef && (refExists(`origin/${baseRef}`) || fetchRemoteRef(baseRef))) return addWorkingTreeChanges(diffNameOnly(`origin/${baseRef}...HEAD`));
  }

  if (eventName === 'push') {
    const beforeSha = process.env.GITHUB_BEFORE_SHA;
    const afterSha = process.env.GITHUB_AFTER_SHA || process.env.GITHUB_SHA || 'HEAD';
    if (beforeSha && refExists(beforeSha) && refExists(afterSha)) return addWorkingTreeChanges(diffNameOnly(`${beforeSha}..${afterSha}`));
  }

  for (const baseRef of ['main', 'origin/main', 'master', 'origin/master']) {
    if (refExists(baseRef)) return addWorkingTreeChanges(diffNameOnly(`${baseRef}...HEAD`));
  }

  if (refExists('HEAD^')) return addWorkingTreeChanges(diffNameOnly('HEAD^..HEAD'));
  return null;
}

function parseLanguageDocPath(filePath) {
  if (filePath === 'README.md') return { key: 'README', directory: '.', baseName: 'README', language: 'en' };
  const rootReadme = filePath.match(/^README\.(zh|hi|ru)\.md$/);
  if (rootReadme) return { key: 'README', directory: '.', baseName: 'README', language: rootReadme[1] };

  const docsFile = filePath.match(/^docs\/([^/]+?)(?:\.(zh|hi|ru))?\.md$/);
  if (!docsFile) return null;
  return {
    key: `docs/${docsFile[1]}`,
    directory: 'docs',
    baseName: docsFile[1],
    language: docsFile[2] || 'en',
  };
}

function buildExpectedPaths(group) {
  return LANGUAGES.map(language => {
    const filename = `${group.baseName}${LANGUAGE_SUFFIX[language]}.md`;
    return group.directory === '.' ? filename : path.posix.join(group.directory, filename);
  });
}

function discoverLanguageGroups() {
  const groups = new Map();
  const add = filePath => {
    const parsed = parseLanguageDocPath(filePath);
    if (parsed) groups.set(parsed.key, parsed);
  };

  for (const filePath of ['README.md', 'README.zh.md', 'README.hi.md', 'README.ru.md']) {
    if (existsSync(filePath)) add(filePath);
  }

  if (existsSync('docs')) {
    for (const filename of readdirSync('docs')) {
      const filePath = path.posix.join('docs', filename);
      if (filename.endsWith('.md')) add(filePath);
    }
  }

  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function checkAllLanguageSiblingsExist(groups) {
  const missing = [];
  for (const group of groups) {
    for (const filePath of buildExpectedPaths(group)) {
      if (!existsSync(filePath)) missing.push(filePath);
    }
  }

  if (missing.length > 0) throw new Error(`Missing language sibling docs:\n${missing.map(file => `  ${file}`).join('\n')}`);
}

function checkChangedLanguageGroups(groups) {
  const changedFiles = getChangedFilesFromGit();
  if (changedFiles === null) {
    console.log('\n  Could not determine changed files from git; skipping changed-file parity check.');
    return;
  }

  const changedSet = new Set(changedFiles);
  const partialGroups = [];
  for (const group of groups) {
    const expected = buildExpectedPaths(group);
    const changed = expected.filter(filePath => changedSet.has(filePath));
    if (changed.length > 0 && changed.length < expected.length) {
      partialGroups.push({ group, changed, missing: expected.filter(filePath => !changedSet.has(filePath)) });
    }
  }

  if (partialGroups.length === 0) return;

  throw new Error(partialGroups.map(({ group, changed, missing }) => `${group.key} changed only ${changed.join(', ')}; also update ${missing.join(', ')}`).join('\n'));
}

console.log('Testing documentation language synchronization...\n');

const groups = discoverLanguageGroups();

runTest('root README and top-level docs have all language siblings', () => {
  checkAllLanguageSiblingsExist(groups);
});

runTest('changed language docs update every sibling in the same PR', () => {
  checkChangedLanguageGroups(groups);
});

console.log(`\n=== Test Summary ===`);
console.log(`Total: ${testsPassed + testsFailed} | ✅ Passed: ${testsPassed} | ❌ Failed: ${testsFailed}`);

if (testsFailed > 0) process.exit(1);
console.log('\n🎉 Documentation language sync checks passed!');
