/**
 * @hive-mind-test-suite default
 *
 * Issue #2198: a CI/CD false negative found by comparing this repository's file
 * tree against the pipeline template, as the issue asks.
 *
 * `.github/workflows/security.yml` ran CodeQL and `dependency-review-action`.
 * Neither audits the dependency tree that is actually installed:
 *
 *   - CodeQL analyses *our* source, not our dependencies' advisories.
 *   - `dependency-review-action` only runs on `pull_request` and only looks at
 *     the dependencies a PR *changes*. A high-severity advisory published for a
 *     package that has been pinned in package-lock.json for a year is invisible
 *     to it forever, because no PR changes that line.
 *
 * So a known-vulnerable dependency shipped green. The template's `security.yml`
 * has an `npm-audit` job for exactly this; hive-mind had no equivalent and no
 * `npm audit` anywhere in .github/, package.json or scripts/.
 *
 * This test is the gate on the gate: it fails if the job is dropped, if it stops
 * failing the build (`--audit-level` weakened past high), or if it loses the
 * bounds every job in this repository is required to have.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2198
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const readRepoFile = relative => readFileSync(join(repoRoot, relative), 'utf8').replaceAll('\r\n', '\n');

// Jobs are the top-level keys under `jobs:`, i.e. two-space-indented names.
const jobBlock = (workflow, name) => {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  assert.notEqual(start, -1, `security.yml declares a "${name}" job`);
  const rest = workflow.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[A-Za-z0-9_-]+:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
};

describe('issue #2198: the dependency tree is audited on every run', () => {
  const workflow = readRepoFile('.github/workflows/security.yml');
  // Resolved per test, not once in the suite body: a missing job then reports as
  // a failing assertion rather than as a suite that never ran any test.
  const npmAudit = () => jobBlock(workflow, 'npm-audit');

  it('runs npm audit against the committed lockfile', () => {
    const job = npmAudit();
    assert.match(job, /npm audit --package-lock-only/, 'the job audits the lockfile as committed');
  });

  it('fails the build on high-severity advisories', () => {
    const job = npmAudit();
    assert.match(job, /--audit-level=(high|critical|moderate|low)\b/, 'an audit level is set explicitly');
    const [, level] = job.match(/--audit-level=([a-z]+)/);
    assert.ok(['low', 'moderate', 'high'].includes(level), `--audit-level=${level} would let high-severity advisories pass`);
  });

  it('is bounded and cancellable like every other job here', () => {
    const job = npmAudit();
    assert.match(job, /timeout-minutes: \d+/, 'a hanging registry cannot burn the 6-hour default');
    assert.match(job, /concurrency:\n\s+group: /, 'the job joins a concurrency group');
  });

  it('runs outside pull requests too', () => {
    // dependency-review is `if: github.event_name == 'pull_request'`. This job
    // must not be, or the scheduled run -- the only thing that can notice an
    // advisory published after the code stopped changing -- would skip it.
    const job = npmAudit();
    assert.ok(!/^\s+if:.*pull_request/m.test(job), 'the audit is not restricted to pull requests');
    assert.match(workflow, /schedule:\n\s+- cron:/, 'security.yml runs on a schedule');
  });
});
