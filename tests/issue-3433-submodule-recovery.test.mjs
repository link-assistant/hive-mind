/**
 * @hive-mind-test-suite default
 * Kill and critical-error recovery preserve the work inside git submodules (#3433).
 *
 * Real git in temp dirs: bare remotes for the parent, a submodule (`modules/sub`)
 * and a nested submodule (`modules/sub/lib/nested`), cloned with
 * `--recurse-submodules`. Covered:
 *
 * - dirty submodule work is committed on `recovery/<branch>` inside the
 *   submodule and pushed to the submodule's remote before the parent records
 *   (and pushes) the pointer;
 * - nested submodules are handled innermost first;
 * - a submodule whose remote refuses the push gets no pointer in the parent,
 *   and the log and the result say so;
 * - the ready check refuses a gitlink its `.gitmodules` URL cannot serve,
 *   publishes it (also via a fork and a pull request) and keeps the pull
 *   request a draft when that fails;
 * - the kill/interrupt auto-commit wrapper pushes inside the submodule first;
 * - without submodules nothing changes and no submodule command runs.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3433
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { $ as realDollar } from 'command-stream';

import { commitUncommittedChangesOnCriticalError, describePreservedWork } from '../src/critical-error-commit.lib.mjs';
import { checkForUncommittedChanges as claudeCheck } from '../src/claude.uncommitted-changes.lib.mjs';
import { submoduleStatusLines } from '../src/git-submodules.lib.mjs';
import { getPullRequestLeftInDraft, resetWorkingSessionDrafts, restoreDeliberateDraftsAtRunEnd } from '../src/pr-draft-state.lib.mjs';
import { SUBMODULE_PRS_MARKER, UNREACHABLE_SUBMODULE_POINTER_DRAFT_KIND, findUnreachableSubmodulePointers, vetoUnreachableSubmodulePointers, withSubmodulePullRequestLinks } from '../src/submodule-pointers.lib.mjs';
import { withSubmoduleWork } from '../src/submodule-uncommitted.lib.mjs';
import { buildDeliberateDraftFeedback } from '../src/solve.auto-merge-guards.lib.mjs';
import { buildUnreachableSubmoduleComment } from '../src/submodule-pointers.lib.mjs';
import { isToolGeneratedComment } from '../src/tool-comments.lib.mjs';

const BRANCH = 'issue-1-abc';
const RECOVERY = `recovery/${BRANCH}`;
const PR = { owner: 'o', repo: 'r', prNumber: 7 };

// One global git config for the whole file: identity, `main`, and local file submodules.
const configRoot = await mkdtemp(join(tmpdir(), 'hive-3433-config-'));
const globalConfig = join(configRoot, 'gitconfig');
const BASE_CONFIG = ['[user]', '\tname = Hive Mind Test', '\temail = hive-mind-test@example.invalid', '[init]', '\tdefaultBranch = main', '[protocol "file"]', '\tallow = always', '[advice]', '\tdetachedHead = false', ''].join('\n');
await writeFile(globalConfig, BASE_CONFIG);
process.env.GIT_CONFIG_GLOBAL = globalConfig;
process.env.GIT_CONFIG_NOSYSTEM = '1';
test.after(() => rm(configRoot, { recursive: true, force: true }));

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const refOf = (bare, ref) => {
  try {
    return git(bare, 'rev-parse', '--verify', '-q', ref);
  } catch {
    return null;
  }
};

/** A pre-receive hook that refuses every push: an unwritable remote. */
const blockPushes = async bare => {
  const hook = join(bare, 'hooks', 'pre-receive');
  await writeFile(hook, '#!/bin/sh\necho "pushes are disabled" >&2\nexit 1\n');
  chmodSync(hook, 0o755);
};

const createLog = () => {
  const lines = [];
  const log = async message => {
    lines.push(String(message));
  };
  log.lines = lines;
  log.text = () => lines.join('\n');
  return log;
};

/**
 * A command-stream `$` that records every command (with its cwd), answers `gh`
 * commands from `gh` and runs everything else for real.
 */
const createDollar = ({ gh = null } = {}) => {
  const calls = [];
  const run = (options, strings, values) => {
    const command = strings.reduce((text, part, index) => text + part + (index < values.length ? (Array.isArray(values[index]) ? values[index].join(' ') : String(values[index])) : ''), '');
    calls.push({ cwd: options.cwd || null, command });
    if (/^gh\s/.test(command.trim())) {
      if (!gh) throw new Error(`unexpected gh command: ${command}`);
      return Promise.resolve({ code: 0, stdout: '', stderr: '', ...gh({ command, values, options }) });
    }
    return realDollar({ ...options, mirror: false })(strings, ...values);
  };
  const dollar = (first, ...rest) => (Array.isArray(first) && first.raw ? run({}, first, rest) : (strings, ...values) => run(first || {}, strings, values));
  dollar.calls = calls;
  dollar.indexOf = predicate => calls.findIndex(predicate);
  return dollar;
};

/**
 * parent.git (README.md, modules/sub) -> sub.git (sub.txt, lib/nested) -> nested.git (nested.txt).
 * `work` is a `--recurse-submodules` clone on the PR branch, pushed.
 */
const createFixture = async ({ subUrl = null, configure = null } = {}) => {
  const root = await mkdtemp(join(tmpdir(), 'hive-3433-'));
  const remotes = { nested: join(root, 'nested.git'), sub: join(root, 'sub.git'), parent: join(root, 'parent.git'), forkSub: join(root, 'fork-sub.git') };
  for (const bare of Object.values(remotes)) git(root, 'init', '-q', '--bare', bare);
  if (configure) await configure(remotes);
  const seed = async (name, files, submodules = []) => {
    const dir = join(root, `seed-${name}`);
    git(root, 'init', '-q', dir);
    for (const [file, content] of Object.entries(files)) await writeFile(join(dir, file), content);
    git(dir, 'add', '-A');
    for (const [url, path] of submodules) git(dir, 'submodule', '--quiet', 'add', url, path);
    git(dir, 'commit', '-qm', `${name}: initial`);
    git(dir, 'push', '-q', remotes[name], 'main');
  };
  await seed('nested', { 'nested.txt': 'nested\n' });
  await seed('sub', { 'sub.txt': 'sub\n' }, [[remotes.nested, 'lib/nested']]);
  await seed('parent', { 'README.md': '# parent\n' }, [[subUrl || remotes.sub, 'modules/sub']]);
  const work = join(root, 'work');
  git(root, 'clone', '-q', '--recurse-submodules', remotes.parent, work);
  git(work, 'checkout', '-q', '-b', BRANCH);
  git(work, 'push', '-q', '-u', 'origin', BRANCH);
  const sub = join(work, 'modules', 'sub');
  const nested = join(sub, 'lib', 'nested');
  return { root, remotes, work, sub, nested, head: git(work, 'rev-parse', 'HEAD'), main: git(work, 'rev-parse', 'origin/main'), pointer: git(work, 'rev-parse', 'HEAD:modules/sub'), nestedPointer: git(sub, 'rev-parse', 'HEAD:lib/nested') };
};

/** A commit inside `dir` that exists in that clone only. */
const localCommit = async (dir, file, content) => {
  await writeFile(join(dir, file), content);
  git(dir, 'add', file);
  git(dir, 'commit', '-qm', `local ${file}`);
  return git(dir, 'rev-parse', 'HEAD');
};

const pushedFrom = cwd => call => call.cwd === cwd && /\bpush\b/.test(call.command) && call.command.includes('git');

test('dirty submodule work is pushed to the submodule remote before the parent records the pointer', async () => {
  const f = await createFixture();
  try {
    await writeFile(join(f.sub, 'sub.txt'), 'sub, edited by the AI\n');
    await writeFile(join(f.sub, 'new.txt'), 'new work inside the submodule\n');
    const $ = createDollar();
    const log = createLog();
    const outcome = await commitUncommittedChangesOnCriticalError({ tempDir: f.work, branchName: BRANCH, $, log, reason: 'stopped after two identical AI sessions' });

    const subRecovery = refOf(f.remotes.sub, `refs/heads/${RECOVERY}`);
    assert.ok(subRecovery, 'the submodule work is on recovery/<branch> in the submodule remote');
    assert.equal(git(f.remotes.sub, 'show', `${subRecovery}:new.txt`), 'new work inside the submodule');
    assert.equal(git(f.remotes.sub, 'show', `${subRecovery}:sub.txt`), 'sub, edited by the AI');
    assert.equal(git(f.remotes.sub, 'rev-parse', `${subRecovery}^`), f.pointer, 'the snapshot sits on the recorded submodule commit');

    assert.equal(outcome.committed, true);
    assert.equal(outcome.pushed, true);
    assert.equal(git(f.remotes.parent, 'rev-parse', `${RECOVERY}:modules/sub`), subRecovery, 'the parent recovery commit points to the pushed submodule commit');
    assert.deepEqual(outcome.submodulesFailed, []);
    assert.equal(outcome.submodules.length, 1);
    assert.equal(outcome.submodules[0].pushed, true);

    const subPush = $.indexOf(pushedFrom(f.sub));
    const parentPush = $.indexOf(pushedFrom(f.work));
    assert.ok(subPush >= 0 && parentPush > subPush, `the submodule push (${subPush}) runs before the parent push (${parentPush})`);

    assert.equal(refOf(f.remotes.parent, `refs/heads/${BRANCH}`), f.head, 'the PR branch is unchanged');
    assert.equal(git(f.work, 'rev-parse', 'HEAD'), f.head);
    assert.equal(git(f.sub, 'rev-parse', 'HEAD'), f.pointer, 'the submodule HEAD is unchanged');
    assert.equal(await readFile(join(f.sub, 'new.txt'), 'utf8'), 'new work inside the submodule\n', 'the work stays in the workspace');
    assert.match(describePreservedWork(outcome), /submodule\(s\) was pushed to `recovery\/issue-1-abc`/);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('nested submodules are preserved innermost first, each pointer recorded after its push', async () => {
  const f = await createFixture();
  try {
    await writeFile(join(f.nested, 'nested.txt'), 'nested, edited\n');
    await writeFile(join(f.sub, 'sub.txt'), 'sub, edited\n');
    const $ = createDollar();
    const outcome = await commitUncommittedChangesOnCriticalError({ tempDir: f.work, branchName: BRANCH, $, log: createLog(), reason: 'test' });

    const nestedRecovery = refOf(f.remotes.nested, `refs/heads/${RECOVERY}`);
    const subRecovery = refOf(f.remotes.sub, `refs/heads/${RECOVERY}`);
    assert.ok(nestedRecovery && subRecovery);
    assert.equal(git(f.remotes.nested, 'show', `${nestedRecovery}:nested.txt`), 'nested, edited');
    assert.equal(git(f.remotes.sub, 'rev-parse', `${subRecovery}:lib/nested`), nestedRecovery, 'the submodule snapshot points to the pushed nested commit');
    assert.equal(git(f.remotes.parent, 'rev-parse', `${RECOVERY}:modules/sub`), subRecovery);
    assert.deepEqual(
      outcome.submodules.map(entry => entry.path),
      ['modules/sub/lib/nested', 'modules/sub']
    );

    const nestedPush = $.indexOf(pushedFrom(f.nested));
    const subPush = $.indexOf(pushedFrom(f.sub));
    const parentPush = $.indexOf(pushedFrom(f.work));
    assert.ok(nestedPush >= 0 && subPush > nestedPush && parentPush > subPush, `pushes run innermost first (${nestedPush} < ${subPush} < ${parentPush})`);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('a submodule whose remote refuses the push gets no pointer in the parent, loudly', async () => {
  const f = await createFixture();
  try {
    await blockPushes(f.remotes.sub);
    const unpushed = await localCommit(f.sub, 'committed.txt', 'a commit on no remote\n');
    await writeFile(join(f.sub, 'dirty.txt'), 'uncommitted\n');
    await writeFile(join(f.work, 'README.md'), '# parent, edited\n');
    const log = createLog();
    const outcome = await commitUncommittedChangesOnCriticalError({ tempDir: f.work, branchName: BRANCH, $: createDollar(), log, reason: 'test' });

    assert.equal(refOf(f.remotes.sub, `refs/heads/${RECOVERY}`), null, 'nothing reached the submodule remote');
    assert.equal(outcome.submodulesFailed.length, 1);
    assert.equal(outcome.submodulesFailed[0].path, 'modules/sub');
    assert.equal(outcome.committed, true, 'the parent work is still preserved');
    assert.equal(git(f.remotes.parent, 'show', `${RECOVERY}:README.md`), '# parent, edited');
    assert.equal(git(f.remotes.parent, 'rev-parse', `${RECOVERY}:modules/sub`), f.pointer, 'the parent keeps the old, fetchable pointer');
    assert.notEqual(git(f.remotes.parent, 'rev-parse', `${RECOVERY}:modules/sub`), unpushed);
    assert.match(log.text(), /❌ Submodule modules\/sub: could not push/);
    assert.match(log.text(), /does not record a pointer/);
    assert.match(describePreservedWork(outcome), /reached no remote/);
    assert.equal(git(f.sub, 'rev-parse', 'HEAD'), unpushed, 'the local work is left in place');
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('an unpushable nested submodule keeps the old nested pointer in the pushed submodule snapshot', async () => {
  const f = await createFixture();
  try {
    await blockPushes(f.remotes.nested);
    await localCommit(f.nested, 'nested-local.txt', 'nested work on no remote\n');
    await writeFile(join(f.sub, 'sub.txt'), 'sub, edited\n');
    const outcome = await commitUncommittedChangesOnCriticalError({ tempDir: f.work, branchName: BRANCH, $: createDollar(), log: createLog(), reason: 'test' });

    const subRecovery = refOf(f.remotes.sub, `refs/heads/${RECOVERY}`);
    assert.ok(subRecovery, 'the submodule work itself is pushed');
    assert.equal(git(f.remotes.sub, 'rev-parse', `${subRecovery}:lib/nested`), f.nestedPointer, 'the submodule snapshot keeps the old nested pointer');
    assert.equal(git(f.remotes.parent, 'rev-parse', `${RECOVERY}:modules/sub`), subRecovery);
    assert.deepEqual(
      outcome.submodulesFailed.map(entry => entry.path),
      ['modules/sub/lib/nested']
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('the ready check finds pointers the .gitmodules URL cannot serve', async () => {
  const f = await createFixture();
  try {
    const $ = createDollar();
    assert.deepEqual(await findUnreachableSubmodulePointers({ $, cwd: f.work, baseRef: 'origin/main' }), [], 'unchanged pointers pass');
    const sha = await localCommit(f.sub, 'feature.txt', 'feature\n');
    git(f.work, 'add', 'modules/sub');
    git(f.work, 'commit', '-qm', 'bump modules/sub');
    const unreachable = await findUnreachableSubmodulePointers({ $, cwd: f.work, baseRef: 'origin/main' });
    assert.deepEqual(
      unreachable.map(entry => [entry.path, entry.sha]),
      [['modules/sub', sha]]
    );
    git(f.sub, 'push', '-q', 'origin', `${sha}:refs/heads/feature`);
    assert.deepEqual(await findUnreachableSubmodulePointers({ $, cwd: f.work, baseRef: 'origin/main' }), [], 'a pushed commit passes');

    // An ancestor of a remote branch is reachable too, not only a tip.
    const older = sha;
    await localCommit(f.sub, 'more.txt', 'more\n');
    git(f.sub, 'push', '-q', 'origin', 'HEAD:refs/heads/feature');
    assert.deepEqual(await findUnreachableSubmodulePointers({ $, cwd: f.work, baseRef: 'origin/main' }), [], `ancestor ${older} of a branch tip passes`);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

/** The `gh` side of verifyResults for PR #7 of o/r. */
const createGh = (f, extra = () => null) => {
  const seen = { comments: [], ready: 0, patchedBody: null };
  const gh = ({ command, values }) => {
    const answer = extra(command, values);
    if (answer) return answer;
    if (command.includes('--json baseRefName,baseRefOid')) return { stdout: JSON.stringify({ baseRefName: 'main', baseRefOid: f.main }) };
    if (/issues\/7\/comments/.test(command)) {
      seen.comments.push(command);
      return { stdout: JSON.stringify({ id: 101, html_url: 'https://github.com/o/r/pull/7#issuecomment-101' }) };
    }
    if (/gh pr ready/.test(command)) {
      seen.ready++;
      return { stdout: '' };
    }
    return { code: 1, stderr: `fake gh: unhandled ${command}` };
  };
  return { gh, seen };
};

test('the readiness veto keeps a pull request with an unpublishable pointer a draft', async () => {
  const f = await createFixture();
  resetWorkingSessionDrafts();
  try {
    await blockPushes(f.remotes.sub);
    const sha = await localCommit(f.sub, 'feature.txt', 'feature\n');
    git(f.work, 'add', 'modules/sub');
    git(f.work, 'commit', '-qm', 'bump modules/sub');
    git(f.work, 'push', '-q', 'origin', BRANCH);
    const { gh, seen } = createGh(f);
    const $ = createDollar({ gh });
    const log = createLog();
    const veto = await vetoUnreachableSubmodulePointers({ tempDir: f.work, ...PR, branchName: BRANCH, $, log, sleep: async () => {} });

    assert.equal(veto.keepsDraft, true);
    assert.deepEqual(
      veto.unreachable.map(entry => [entry.path, entry.sha]),
      [['modules/sub', sha]]
    );
    assert.equal(getPullRequestLeftInDraft(PR).kind, UNREACHABLE_SUBMODULE_POINTER_DRAFT_KIND);
    assert.equal(seen.comments.length, 1, 'a comment explains why the PR stays a draft');
    assert.match(log.text(), /❌ PR #7 is not marked ready: 1 submodule pointer\(s\) cannot be fetched/);

    const restored = await restoreDeliberateDraftsAtRunEnd({ $, log });
    assert.equal(restored[0].reason, 'unreachable_submodule_pointer');
    assert.equal(seen.ready, 0, 'the run end does not mark it ready either');
    assert.match(buildDeliberateDraftFeedback(getPullRequestLeftInDraft(PR)).feedbackLines.join('\n'), /not reachable from the URLs in `.gitmodules`/);
  } finally {
    resetWorkingSessionDrafts();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('the readiness veto publishes an unpushed submodule commit and lets the pull request go ready', async () => {
  const f = await createFixture();
  resetWorkingSessionDrafts();
  try {
    const sha = await localCommit(f.sub, 'feature.txt', 'feature\n');
    git(f.work, 'add', 'modules/sub');
    git(f.work, 'commit', '-qm', 'bump modules/sub');
    git(f.work, 'push', '-q', 'origin', BRANCH);
    const { gh, seen } = createGh(f);
    const veto = await vetoUnreachableSubmodulePointers({ tempDir: f.work, ...PR, branchName: BRANCH, $: createDollar({ gh }), log: createLog(), sleep: async () => {} });

    assert.equal(veto.keepsDraft, false);
    assert.equal(refOf(f.remotes.sub, `refs/heads/${BRANCH}`), sha, 'the submodule commit is published as the PR branch name');
    assert.equal(getPullRequestLeftInDraft(PR), null);
    assert.equal(seen.comments.length, 0);
  } finally {
    resetWorkingSessionDrafts();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('fork mode: an unwritable submodule remote gets a fork push and a pull request, linked from the parent', async () => {
  const configure = async remotes => {
    await writeFile(globalConfig, `${BASE_CONFIG}[url "${remotes.sub}"]\n\tinsteadOf = https://github.com/up/sub.git\n[url "${remotes.forkSub}"]\n\tinsteadOf = https://github.com/me/sub.git\n`);
  };
  const f = await createFixture({ subUrl: 'https://github.com/up/sub.git', configure });
  resetWorkingSessionDrafts();
  try {
    await blockPushes(f.remotes.sub);
    const sha = await localCommit(f.sub, 'feature.txt', 'feature\n');
    git(f.work, 'add', 'modules/sub');
    git(f.work, 'commit', '-qm', 'bump modules/sub');
    git(f.work, 'push', '-q', 'origin', BRANCH);
    const forkCalls = [];
    const { gh, seen } = createGh(f, (command, values) => {
      if (command.startsWith('gh repo fork')) {
        forkCalls.push(command);
        return { stdout: '✓ Created fork me/sub\n' };
      }
      if (command.startsWith('gh pr create')) {
        assert.match(command, /--repo up\/sub --head me:issue-1-abc/);
        // GitHub creates refs/pull/<n>/head in the upstream repository.
        execFileSync('git', ['--git-dir', f.remotes.sub, 'fetch', '-q', f.remotes.forkSub, `+refs/heads/${BRANCH}:refs/pull/1/head`]);
        return { stdout: 'https://github.com/up/sub/pull/1\n' };
      }
      if (command.includes('--json body')) return { stdout: 'Fixes #1\n' };
      if (command.includes('-X PATCH')) {
        seen.patchedBody = values.find(value => String(value).startsWith('body=')).slice('body='.length);
        return { stdout: '{}' };
      }
      return null;
    });
    const veto = await vetoUnreachableSubmodulePointers({ tempDir: f.work, ...PR, branchName: BRANCH, $: createDollar({ gh }), log: createLog(), sleep: async () => {} });

    assert.equal(forkCalls.length, 1);
    assert.equal(refOf(f.remotes.forkSub, `refs/heads/${BRANCH}`), sha, 'the commit is pushed to the fork');
    assert.equal(refOf(f.remotes.sub, 'refs/pull/1/head'), sha);
    assert.equal(veto.keepsDraft, false, 'the pull request ref makes the pointer fetchable');
    assert.deepEqual(veto.pullRequests, [{ path: 'modules/sub', url: 'https://github.com/up/sub/pull/1' }]);
    assert.ok(seen.patchedBody.startsWith('Fixes #1'), 'the parent description is kept');
    assert.ok(seen.patchedBody.includes(SUBMODULE_PRS_MARKER));
    assert.ok(seen.patchedBody.includes('`modules/sub` → https://github.com/up/sub/pull/1'));
  } finally {
    await writeFile(globalConfig, BASE_CONFIG);
    resetWorkingSessionDrafts();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('the submodule pull request section of the parent description is replaced, not duplicated', () => {
  const once = withSubmodulePullRequestLinks('Body', [{ path: 'a', url: 'https://github.com/x/a/pull/1' }]);
  const twice = withSubmodulePullRequestLinks(once, [{ path: 'a', url: 'https://github.com/x/a/pull/2' }]);
  assert.equal(twice.split(SUBMODULE_PRS_MARKER).length, 2);
  assert.ok(twice.includes('/pull/2') && !twice.includes('/pull/1'));
  assert.ok(twice.startsWith('Body\n\n'));
});

test('kill/interrupt auto-commit pushes inside the submodule before the parent commits the pointer', async () => {
  const f = await createFixture();
  try {
    await writeFile(join(f.sub, 'work.txt'), 'interrupted work\n');
    const $ = createDollar();
    const check = withSubmoduleWork(claudeCheck, { tool: 'Claude' });
    await check(f.work, 'o', 'r', BRANCH, $, createLog(), true, true);

    const subRecovery = refOf(f.remotes.sub, `refs/heads/${RECOVERY}`);
    assert.ok(subRecovery);
    assert.equal(git(f.sub, 'rev-parse', 'HEAD'), subRecovery, 'the submodule HEAD is the pushed commit');
    assert.equal(git(f.sub, 'status', '--porcelain'), '', 'the submodule is clean');
    const branchTip = refOf(f.remotes.parent, `refs/heads/${BRANCH}`);
    assert.notEqual(branchTip, f.head, 'the parent committed and pushed');
    assert.equal(git(f.remotes.parent, 'rev-parse', `${branchTip}:modules/sub`), subRecovery);
    assert.ok($.indexOf(pushedFrom(f.sub)) < $.indexOf(pushedFrom(f.work)));
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('kill/interrupt auto-commit leaves out the pointer of a submodule that could not be pushed', async () => {
  const f = await createFixture();
  try {
    await blockPushes(f.remotes.sub);
    await localCommit(f.sub, 'local.txt', 'on no remote\n');
    await writeFile(join(f.work, 'README.md'), '# parent, edited\n');
    const log = createLog();
    const restart = await withSubmoduleWork(claudeCheck)(f.work, 'o', 'r', BRANCH, createDollar(), log, true, true);

    assert.equal(restart, false);
    const branchTip = refOf(f.remotes.parent, `refs/heads/${BRANCH}`);
    assert.notEqual(branchTip, f.head);
    assert.equal(git(f.remotes.parent, 'show', `${branchTip}:README.md`), '# parent, edited');
    assert.equal(git(f.remotes.parent, 'rev-parse', `${branchTip}:modules/sub`), f.pointer, 'the unpushed pointer is not committed');
    assert.match(log.text(), /❌ Not recording the pointers of 1 submodule/);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('without auto-commit, a submodule commit on no remote asks for a restart even when the parent is clean', async () => {
  const f = await createFixture();
  try {
    await localCommit(f.sub, 'local.txt', 'on no remote\n');
    git(f.work, 'add', 'modules/sub');
    git(f.work, 'commit', '-qm', 'bump modules/sub');
    assert.equal(git(f.work, 'status', '--porcelain'), '');
    assert.equal(await claudeCheck(f.work, 'o', 'r', BRANCH, createDollar(), createLog(), false, true), false, 'the top-level check sees nothing');
    const lines = await submoduleStatusLines({ $: createDollar(), cwd: f.work });
    assert.match(lines[0], /^## modules\/sub: 1 commit\(s\) on no remote$/);
    assert.equal(await withSubmoduleWork(claudeCheck)(f.work, 'o', 'r', BRANCH, createDollar(), createLog(), false, true), true);
    assert.equal(await withSubmoduleWork(claudeCheck)(f.work, 'o', 'r', BRANCH, createDollar(), createLog(), false, false), false, 'no restart when auto-restart is off');
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('without submodules everything behaves as before and no submodule command runs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hive-3433-plain-'));
  try {
    const remote = join(root, 'remote.git');
    const work = join(root, 'work');
    git(root, 'init', '-q', '--bare', remote);
    git(root, 'init', '-q', work);
    await writeFile(join(work, 'README.md'), '# plain\n');
    git(work, 'add', 'README.md');
    git(work, 'commit', '-qm', 'initial');
    git(work, 'checkout', '-q', '-b', BRANCH);
    git(work, 'remote', 'add', 'origin', remote);
    git(work, 'push', '-q', '-u', 'origin', BRANCH);
    const head = git(work, 'rev-parse', 'HEAD');
    await writeFile(join(work, 'README.md'), '# plain, edited\n');
    await writeFile(join(work, 'notes.txt'), 'notes\n');

    const $ = createDollar();
    const outcome = await commitUncommittedChangesOnCriticalError({ tempDir: work, branchName: BRANCH, $, log: createLog(), reason: 'test' });
    assert.equal(outcome.committed, true);
    assert.equal(outcome.pushed, true);
    assert.ok(!('submodules' in outcome) && !('submodulesFailed' in outcome), 'the result has its pre-#3433 shape');
    assert.equal(git(remote, 'show', `${RECOVERY}:notes.txt`), 'notes');
    assert.equal(refOf(remote, `refs/heads/${BRANCH}`), head);
    assert.deepEqual(
      $.calls.filter(call => /submodule|ls-remote/.test(call.command)),
      []
    );

    const throwing = () => {
      throw new Error('no command may run without .gitmodules');
    };
    assert.deepEqual(await vetoUnreachableSubmodulePointers({ tempDir: work, ...PR, branchName: BRANCH, $: throwing }), { keepsDraft: false, unreachable: [] });
    assert.deepEqual(await submoduleStatusLines({ $: throwing, cwd: work }), []);
    assert.deepEqual(await findUnreachableSubmodulePointers({ $: throwing, cwd: work }), []);

    const received = [];
    const check = async (...args) => {
      received.push(args);
      return 'tool verdict';
    };
    const args = [work, 'o', 'r', BRANCH, throwing, createLog(), true, false];
    assert.equal(await withSubmoduleWork(check)(...args), 'tool verdict');
    assert.deepEqual(received, [args], 'the tool check gets the same arguments');
    assert.ok(existsSync(join(work, 'notes.txt')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('wiring: the readiness veto runs before the PR is marked ready, and its comment is a tool comment', async () => {
  const results = await readFile(new URL('../src/solve.results.lib.mjs', import.meta.url), 'utf8');
  const veto = results.indexOf('vetoUnreachableSubmodulePointers({');
  const ready = results.indexOf("reason: 'solution draft verified'");
  assert.ok(veto > 0 && ready > veto, 'the veto is checked before ensurePullRequestIsReady');
  assert.match(results, /if \(!sessionOutcome\.keepsDraft && !submoduleVeto\.keepsDraft\)/);
  const comment = buildUnreachableSubmoduleComment([{ path: 'modules/sub', sha: 'a'.repeat(40), url: 'https://example.invalid/sub.git', error: 'not our ref' }]);
  assert.ok(isToolGeneratedComment(comment), 'never read back as human feedback');
  const solve = await readFile(new URL('../src/solve.mjs', import.meta.url), 'utf8');
  assert.match(solve, /resolveUncommittedChangesToolWithSubmodules/, 'the session-end check recurses into submodules');
});
