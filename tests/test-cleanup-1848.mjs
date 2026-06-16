#!/usr/bin/env node
/**
 * Unit tests for the `hive-cleanup` command core logic (issue #1848).
 *
 * These tests exercise the pure, offline-safe classification/parsing helpers in
 * src/cleanup.lib.mjs — no network, no real filesystem, no /proc. They reproduce
 * the manual workflow the maintainer used to free disk space:
 *   - keep the clone that belongs to the active solve task (matched by branch),
 *   - keep protected paths such as /tmp/start-command,
 *   - delete the rest of the hive-mind temp artifacts.
 *
 * Run with: node tests/test-cleanup-1848.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1848
 */

import assert from 'node:assert/strict';

import { parseTaskUrl, extractTaskRefsFromCommand, parseRemoteUrl, buildActiveMatchers, folderMatchesActiveTask, matchHiveMindPattern, classifyEntry, classifyEntries, formatBytes, summarize, describeReason, formatEntryContext, formatTaskSummary, DEFAULT_PROTECTED_NAMES } from '../src/cleanup.lib.mjs';

let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    testsPassed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}`);
    testsFailed++;
  }
}

console.log('\n📋 hive-cleanup command (#1848) Tests\n');

// ---------------------------------------------------------------------------
// URL / command parsing
// ---------------------------------------------------------------------------
test('parseTaskUrl parses a PR URL', () => {
  assert.deepEqual(parseTaskUrl('https://github.com/link-assistant/formal-ai/pull/387'), {
    owner: 'link-assistant',
    repo: 'formal-ai',
    type: 'pull',
    number: 387,
  });
});

test('parseTaskUrl parses an issue URL', () => {
  assert.deepEqual(parseTaskUrl('https://github.com/link-assistant/hive-mind/issues/1848'), {
    owner: 'link-assistant',
    repo: 'hive-mind',
    type: 'issue',
    number: 1848,
  });
});

test('parseTaskUrl tolerates a trailing .git and ssh form', () => {
  assert.deepEqual(parseTaskUrl('git@github.com:owner/repo.git/pull/12'), {
    owner: 'owner',
    repo: 'repo',
    type: 'pull',
    number: 12,
  });
});

test('parseTaskUrl returns null for non-GitHub strings', () => {
  assert.equal(parseTaskUrl('just some text'), null);
  assert.equal(parseTaskUrl(''), null);
  assert.equal(parseTaskUrl(null), null);
});

test('extractTaskRefsFromCommand extracts the URL from a solve command (issue gist)', () => {
  const command = 'solve https://github.com/link-assistant/formal-ai/pull/387 --model opus --think max --tool claude --attach-logs --verbose';
  const refs = extractTaskRefsFromCommand(command);
  assert.equal(refs.length, 1);
  assert.deepEqual(refs[0], { owner: 'link-assistant', repo: 'formal-ai', type: 'pull', number: 387 });
});

test('extractTaskRefsFromCommand dedupes repeated references', () => {
  const command = 'solve https://github.com/o/r/issues/5 ... https://github.com/o/r/issues/5';
  assert.equal(extractTaskRefsFromCommand(command).length, 1);
});

test('parseRemoteUrl handles https and ssh remotes', () => {
  assert.deepEqual(parseRemoteUrl('https://github.com/link-assistant/formal-ai.git'), { owner: 'link-assistant', repo: 'formal-ai' });
  assert.deepEqual(parseRemoteUrl('git@github.com:konard/test-for-test.git'), { owner: 'konard', repo: 'test-for-test' });
});

// ---------------------------------------------------------------------------
// Active-task matching (the core requirement)
// ---------------------------------------------------------------------------
test('folderMatchesActiveTask matches a PR head branch exactly', () => {
  // Active task is PR 387 whose head branch resolves to issue-386-<hex>.
  const matchers = buildActiveMatchers([{ owner: 'link-assistant', repo: 'formal-ai', type: 'pull', number: 387, branch: 'issue-386-0f7c7e8a730c' }]);
  const gitInfo = { branch: 'issue-386-0f7c7e8a730c', remotes: [{ owner: 'link-assistant', repo: 'formal-ai' }], dirty: false };
  assert.ok(folderMatchesActiveTask(gitInfo, matchers));
});

test('folderMatchesActiveTask matches an issue task by issue-prefix + repo', () => {
  const matchers = buildActiveMatchers([{ owner: 'o', repo: 'r', type: 'issue', number: 42 }]);
  const gitInfo = { branch: 'issue-42-abcdef012345', remotes: [{ owner: 'o', repo: 'r' }], dirty: false };
  assert.ok(folderMatchesActiveTask(gitInfo, matchers));
});

test('folderMatchesActiveTask does NOT match a different issue number', () => {
  const matchers = buildActiveMatchers([{ owner: 'o', repo: 'r', type: 'issue', number: 42 }]);
  const gitInfo = { branch: 'issue-99-abcdef012345', remotes: [{ owner: 'o', repo: 'r' }], dirty: false };
  assert.equal(folderMatchesActiveTask(gitInfo, matchers), null);
});

test('folderMatchesActiveTask does NOT match issue branch in a different repo', () => {
  const matchers = buildActiveMatchers([{ owner: 'o', repo: 'r', type: 'issue', number: 42 }]);
  const gitInfo = { branch: 'issue-42-abcdef012345', remotes: [{ owner: 'someone', repo: 'else' }], dirty: false };
  assert.equal(folderMatchesActiveTask(gitInfo, matchers), null);
});

test('folderMatchesActiveTask returns null for non-git folders', () => {
  const matchers = buildActiveMatchers([{ owner: 'o', repo: 'r', type: 'issue', number: 42 }]);
  assert.equal(folderMatchesActiveTask(null, matchers), null);
});

// ---------------------------------------------------------------------------
// Hive-mind pattern recognition
// ---------------------------------------------------------------------------
test('matchHiveMindPattern recognises solve workspace clones', () => {
  assert.ok(matchHiveMindPattern('gh-issue-solver-1780391173130'));
  assert.ok(matchHiveMindPattern('gh-issue-solver-resume-123-1780391173130'));
  assert.ok(matchHiveMindPattern('hive-mind-solve-gh-konard'));
  assert.ok(matchHiveMindPattern('claude-mcp-no-useless-1780391132829-3571.json'));
  assert.ok(matchHiveMindPattern('log-tmp-solution-draft-log-pr-1780407010440.txt-1780407013300'));
});

test('matchHiveMindPattern ignores unrelated names', () => {
  assert.equal(matchHiveMindPattern('android-sdk'), null);
  assert.equal(matchHiveMindPattern('flutter'), null);
  assert.equal(matchHiveMindPattern('start-command'), null);
});

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------
function entry(name) {
  return { name, path: `/tmp/${name}`, isDirectory: true };
}

test('classifyEntry keeps the protected start-command folder by default', () => {
  const r = classifyEntry(entry('start-command'), { protectedNames: DEFAULT_PROTECTED_NAMES });
  assert.deepEqual(r, { action: 'keep', reason: 'protected' });
});

test('classifyEntry removes start-command when forced', () => {
  const r = classifyEntry(entry('start-command'), { protectedNames: DEFAULT_PROTECTED_NAMES, forceStartCommand: true });
  assert.equal(r.action, 'remove');
  assert.equal(r.reason, 'forced-start-command');
});

test('classifyEntry keeps system-owned temp by default', () => {
  const r = classifyEntry(entry('.X11-unix'), {});
  assert.equal(r.action, 'keep');
  assert.equal(r.reason, 'system-protected');
  const r2 = classifyEntry(entry('systemd-private-abcdef'), {});
  assert.equal(r2.reason, 'system-protected');
});

test('classifyEntry keeps the cleanup process own clone (self)', () => {
  const selfPaths = new Set(['/tmp/gh-issue-solver-9999999999999']);
  const e = entry('gh-issue-solver-9999999999999');
  const r = classifyEntry(e, { selfPaths });
  assert.deepEqual(r, { action: 'keep', reason: 'self' });
});

test('classifyEntry keeps a process-held folder', () => {
  const heldPaths = new Set(['/tmp/gh-issue-solver-1111111111111']);
  const r = classifyEntry(entry('gh-issue-solver-1111111111111'), { heldPaths });
  assert.deepEqual(r, { action: 'keep', reason: 'active-process' });
});

test('classifyEntry keeps a folder matching an active task branch', () => {
  const matchers = buildActiveMatchers([{ owner: 'o', repo: 'r', type: 'issue', number: 42 }]);
  const gitInfoByPath = new Map([['/tmp/gh-issue-solver-2222222222222', { branch: 'issue-42-abcdef012345', remotes: [{ owner: 'o', repo: 'r' }], dirty: false }]]);
  const r = classifyEntry(entry('gh-issue-solver-2222222222222'), { matchers, gitInfoByPath });
  assert.deepEqual(r, { action: 'keep', reason: 'active-task' });
});

test('classifyEntry keeps a dirty clone by default and removes it with keepDirty=false', () => {
  const gitInfoByPath = new Map([['/tmp/gh-issue-solver-3333333333333', { branch: 'issue-1-aaaaaaaaaaaa', remotes: [{ owner: 'o', repo: 'r' }], dirty: true }]]);
  const e = entry('gh-issue-solver-3333333333333');
  assert.equal(classifyEntry(e, { gitInfoByPath, keepDirty: true }).reason, 'dirty-worktree');
  assert.equal(classifyEntry(e, { gitInfoByPath, keepDirty: false }).action, 'remove');
});

test('classifyEntry removes an inactive hive-mind clone', () => {
  const r = classifyEntry(entry('gh-issue-solver-4444444444444'), {});
  assert.deepEqual(r, { action: 'remove', reason: 'hive-mind-temp' });
});

test('classifyEntry keeps unrecognised entries unless --all', () => {
  assert.equal(classifyEntry(entry('android-sdk'), {}).action, 'keep');
  assert.equal(classifyEntry(entry('android-sdk'), {}).reason, 'unrecognized');
  assert.equal(classifyEntry(entry('android-sdk'), { includeAll: true }).action, 'remove');
});

test('classifyEntry: --all still keeps protected, system and active entries', () => {
  assert.equal(classifyEntry(entry('start-command'), { protectedNames: DEFAULT_PROTECTED_NAMES, includeAll: true }).action, 'keep');
  assert.equal(classifyEntry(entry('.X11-unix'), { includeAll: true }).action, 'keep');
  const heldPaths = new Set(['/tmp/android-sdk']);
  assert.equal(classifyEntry(entry('android-sdk'), { includeAll: true, heldPaths }).action, 'keep');
});

// End-to-end scenario reproducing the gist: many clones, one active.
test('classifyEntries reproduces the issue gist scenario', () => {
  const entries = [
    { name: 'start-command', path: '/tmp/start-command', isDirectory: true },
    { name: 'gh-issue-solver-1780391173130', path: '/tmp/gh-issue-solver-1780391173130', isDirectory: true }, // active
    { name: 'gh-issue-solver-1780421766903', path: '/tmp/gh-issue-solver-1780421766903', isDirectory: true }, // stale
    { name: 'claude-mcp-no-useless-1780391132829-3571.json', path: '/tmp/claude-mcp-no-useless-1780391132829-3571.json', isDirectory: false }, // stale
    { name: 'android-sdk', path: '/tmp/android-sdk', isDirectory: true }, // unrecognised, kept by default
  ];
  const matchers = buildActiveMatchers([{ owner: 'link-assistant', repo: 'formal-ai', type: 'pull', number: 387, branch: 'issue-386-0f7c7e8a730c' }]);
  const gitInfoByPath = new Map([
    ['/tmp/gh-issue-solver-1780391173130', { branch: 'issue-386-0f7c7e8a730c', remotes: [{ owner: 'link-assistant', repo: 'formal-ai' }], dirty: false }],
    ['/tmp/gh-issue-solver-1780421766903', { branch: 'issue-999-ffffffffffff', remotes: [{ owner: 'konard', repo: 'test-for-test' }], dirty: false }],
  ]);
  const { keep, remove } = classifyEntries(entries, { protectedNames: DEFAULT_PROTECTED_NAMES, matchers, gitInfoByPath });

  const keepNames = keep.map(k => k.name).sort();
  const removeNames = remove.map(r => r.name).sort();
  assert.deepEqual(keepNames, ['android-sdk', 'gh-issue-solver-1780391173130', 'start-command'].sort());
  assert.deepEqual(removeNames, ['claude-mcp-no-useless-1780391132829-3571.json', 'gh-issue-solver-1780421766903'].sort());
});

// ---------------------------------------------------------------------------
// Formatting / summary
// ---------------------------------------------------------------------------
test('formatBytes formats sizes like du -h', () => {
  assert.equal(formatBytes(0), '0B');
  assert.equal(formatBytes(512), '512B');
  assert.equal(formatBytes(1024), '1K');
  assert.equal(formatBytes(1536), '1.5K');
  assert.equal(formatBytes(3 * 1024 * 1024 * 1024), '3G');
  assert.equal(formatBytes(null), '?');
});

test('summarize aggregates counts and bytes', () => {
  const classified = {
    keep: [{ size: 100 }, { size: 200 }],
    remove: [{ size: 1000 }, { size: null }],
  };
  const s = summarize(classified);
  assert.equal(s.keepCount, 2);
  assert.equal(s.removeCount, 2);
  assert.equal(s.keepBytes, 300);
  assert.equal(s.removeBytes, 1000);
});

test('formatTaskSummary includes PR and session context', () => {
  const summary = formatTaskSummary({
    owner: 'link-assistant',
    repo: 'hive-mind',
    type: 'pull',
    number: 1934,
    branch: 'issue-1930-79b41127892b',
    sessionId: 'session-123',
    status: 'executing',
    workspace: '/tmp/gh-issue-solver-1781543261323',
  });
  assert.equal(summary, 'link-assistant/hive-mind PR #1934, branch issue-1930-79b41127892b, session session-123, status executing, workspace /tmp/gh-issue-solver-1781543261323');
});

test('formatEntryContext includes active task and git context', () => {
  const item = {
    activeTask: {
      owner: 'link-assistant',
      repo: 'hive-mind',
      type: 'pull',
      number: 1934,
      branch: 'issue-1930-79b41127892b',
      sessionId: 'session-123',
    },
    gitInfo: {
      branch: 'issue-1930-79b41127892b',
      remotes: [{ owner: 'link-assistant', repo: 'hive-mind' }],
      dirty: true,
    },
  };
  assert.equal(formatEntryContext(item), ' (task link-assistant/hive-mind PR #1934, branch issue-1930-79b41127892b, session session-123; repo link-assistant/hive-mind, branch issue-1930-79b41127892b, dirty/unpushed)');
});

test('describeReason returns human-readable labels', () => {
  assert.equal(describeReason('active-task'), 'belongs to an active task');
  assert.equal(describeReason('protected'), 'protected path');
  assert.equal(describeReason('unknown-code'), 'unknown-code');
});

// ============================================================================
// Summary
// ============================================================================
console.log('\n' + '='.repeat(60));
console.log(`\n📊 Results: ${testsPassed} passed, ${testsFailed} failed, ${testsPassed + testsFailed} total\n`);

if (testsFailed > 0) {
  process.exit(1);
}
