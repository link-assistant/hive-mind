/**
 * @hive-mind-test-suite default
 *
 * Issue #2220. Principle 10 ("Concurrency Control") told every main-writing
 * job to share one repository-scoped group with `cancel-in-progress: false`,
 * and stopped there. The advice is correct and it is not sufficient: the group
 * orders the writers, it does not re-point their working trees.
 * `actions/checkout` checks out `github.sha`, so the second writer in the queue
 * starts one or more commits behind the branch it is about to push to, and its
 * push is rejected as non-fast-forward.
 *
 * link-foundation/browser-commander followed the principle to the letter --
 * three language releases in three workflow files, zero overlap in the
 * timings -- and two of the three releases still died on
 * `! [rejected] main -> main (non-fast-forward)`. The Rust crate reached
 * 0.10.11 on crates.io while `Cargo.toml` on `main` still said 0.9.0; the
 * Python package was never published at all.
 *
 * This test pins the missing half of the principle in all four translations,
 * the same shape as tests/cicd-best-practices-concurrency-2128.test.mjs, and
 * checks that this repository still implements the recovery the guide now
 * prescribes.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2220
 * @see https://github.com/link-foundation/browser-commander/issues/85
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { isNonFastForward, pushWithRebaseRetry } from '../scripts/version-and-commit.lib.mjs';

const guidePaths = ['docs/CI-CD-BEST-PRACTICES.md', 'docs/CI-CD-BEST-PRACTICES.hi.md', 'docs/CI-CD-BEST-PRACTICES.ru.md', 'docs/CI-CD-BEST-PRACTICES.zh.md'];

// Git output, git flags, ruleset error codes and API names are not translated,
// so they anchor the same paragraph in every language file.
for (const guidePath of guidePaths) {
  const guide = readFileSync(guidePath, 'utf8');
  const concurrency = guide.match(/### 10\.[\s\S]*?\n### 11\./)?.[0];

  assert.ok(concurrency, `${guidePath} has a concurrency-control section, numbered 10`);
  assert.match(concurrency, /github\.sha/, `${guidePath} names the commit actions/checkout actually checks out`);
  assert.match(concurrency, /!\s\[rejected\]\s+main -> main \(non-fast-forward\)/, `${guidePath} shows the rejection a serialised writer still gets`);
  assert.match(concurrency, /ref: main/, `${guidePath} names the fix that must not be used`);
  assert.match(concurrency, /GH006/, `${guidePath} names the ruleset rejection that prints the same word`);
  assert.match(concurrency, /GH013/, `${guidePath} names both ruleset codes`);
  assert.match(concurrency, /git['"\s,\]]*.{0,12}pull.{0,12}--rebase/, `${guidePath} shows the recovery, not only the diagnosis`);
  assert.match(concurrency, /isBlockedByRepositoryRule/, `${guidePath} classifies the rejection before retrying`);
  assert.match(concurrency, /--force-with-lease/, `${guidePath} rules out the recovery that deletes the other writer's commit`);
  assert.match(concurrency, /version_committed=true/, `${guidePath} requires success to be reported only after the push landed`);
  assert.match(concurrency, /0\.10\.11/, `${guidePath} keeps the evidence: a crate version that matches no commit`);
}

const englishGuide = readFileSync(guidePaths[0], 'utf8');
const concurrency = englishGuide.match(/### 10\.[\s\S]*?\n### 11\./)?.[0];

assert.match(concurrency, /Serialisation orders writers; it does not rebase them/, 'the English guide states the gap as a rule, not as a footnote');
assert.match(concurrency, /Do not fix it with `ref: main` on the checkout/, 'it says the tempting fix is wrong');
assert.match(concurrency, /not the tree CI validated/i, 'it says why: it publishes an unvalidated tree');
assert.match(concurrency, /The rejection is the honest outcome/, 'it says the rejection itself is not the defect');
assert.match(concurrency, /classifies the rejection, then rebases and retries/, 'it requires classification before the retry');
assert.match(concurrency, /Recompute after the rebase/, 'it warns that a version chosen against the stale tip may be taken');
assert.match(concurrency, /Bound the retries/, 'it keeps a protected branch from turning into an unbounded loop');
assert.match(concurrency, /see principle 9/, 'it points at the pull-request recovery for a rule-blocked push');

// Principle 9 must hold up its end of that cross-reference.
const releaseAutomation = englishGuide.match(/### 9\.[\s\S]*?\n### 10\./)?.[0];
assert.match(releaseAutomation, /rule-blocked push is not a failed release/i, 'principle 9 names the pull-request recovery principle 10 refers to');
assert.match(releaseAutomation, /see principle 10/, 'the cross-reference points back');

// The principle is only worth documenting if this repository follows it.
const workflow = readFileSync('.github/workflows/release.yml', 'utf8');
assert.equal(/^\s*ref:\s*main\s*$/m.test(workflow), false, 'release.yml must not paper over the race by checking out the branch tip');
// npm's trusted publishing allows exactly one workflow file, so this
// repository's writers are serialised by the workflow-level group instead of a
// repository-scoped one; the queue-on-main half of principle 10 still holds.
assert.match(workflow, /cancel-in-progress: \$\{\{ github\.ref != 'refs\/heads\/main' \}\}/, 'a run on main is queued, never cancelled');
assert.match(workflow, /node scripts\/version-and-commit\.mjs/, 'the version bump is pushed by the script that classifies and rebases');

const attempts = [];
const runner = async (command, args) => {
  attempts.push([command, ...args].join(' '));
  if (command === 'git' && args[0] === 'push') {
    return attempts.filter(a => a.startsWith('git push')).length === 1 ? { code: 1, stderr: ' ! [rejected]        main -> main (non-fast-forward)' } : { code: 0, stdout: '' };
  }
  return { code: 0, stdout: '' };
};

const pushed = await pushWithRebaseRetry({ runner, sleeper: async () => {}, logger: { log() {}, error() {} } });
assert.deepEqual(pushed, { pushed: true, attempt: 2 }, 'a writer that starts behind lands on the second attempt');
assert.ok(attempts.includes('git pull --rebase origin main'), 'it rebases onto the writer that won the queue rather than forcing over it');

assert.equal(isNonFastForward({ stderr: 'remote: - Changes must be made through a pull request.\n ! [remote rejected] main -> main (protected branch hook declined)' }), false, 'a ruleset rejection is not a lost race, however similar the output looks');

console.log('cicd-best-practices-serialised-writers-2220.test.mjs: all assertions passed');
