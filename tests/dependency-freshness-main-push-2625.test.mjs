/**
 * Regression coverage for issue #2625 (Checks and release run 37603921340).
 *
 * command-stream 2.0.0 was published two hours before PR #2550 merged. The
 * freshness gate runs inside `detect-changes`, so on the push to main it
 * failed and every downstream job -- lint, tests, release, Docker, Helm -- was
 * skipped. Code that had passed the gate as a pull request was never released.
 *
 * Pull requests stay fail-closed (issue #2264: no merge while a newer release
 * exists). Pushes to main, manual runs and anything else only warn, because
 * the fix is a new pull request, not a blocked release of already-merged code.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2625
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { formatFreshnessReport, freshnessEnforcement } from '../scripts/dependency-freshness.lib.mjs';

assert.equal(freshnessEnforcement('pull_request'), 'fail');
assert.equal(freshnessEnforcement('merge_group'), 'fail');
assert.equal(freshnessEnforcement(undefined), 'fail', 'local runs stay strict');
assert.equal(freshnessEnforcement(''), 'fail');
assert.equal(freshnessEnforcement('push'), 'warn');
assert.equal(freshnessEnforcement('workflow_dispatch'), 'warn');
assert.equal(freshnessEnforcement('schedule'), 'warn');

const stale = [{ location: 'src/use-with-retry.lib.mjs#USE_M_PACKAGE_VERSIONS', name: 'command-stream', current: '1.6.2', latest: '2.0.0', policy: 'exact' }];
const errors = [{ location: 'Dockerfile:48', name: 'link-foundation/box', error: '403' }];

{
  const report = formatFreshnessReport({ stale, errors, mode: 'fail' });
  assert.equal(report.exitCode, 1);
  assert.match(report.lines.join('\n'), /^STALE src\/use-with-retry\.lib\.mjs#USE_M_PACKAGE_VERSIONS: command-stream 1\.6\.2 -> 2\.0\.0 \(exact\)$/m);
  assert.match(report.lines.join('\n'), /^ERROR Dockerfile:48: link-foundation\/box: 403$/m);
  assert.match(report.lines.join('\n'), /Dependency freshness failed: 1 stale, 1 unresolved\./);
}

{
  const report = formatFreshnessReport({ stale, errors, mode: 'warn' });
  assert.equal(report.exitCode, 0, 'a push to main must not skip tests and the release');
  assert.match(report.lines.join('\n'), /^::warning title=Stale dependency::src\/use-with-retry\.lib\.mjs#USE_M_PACKAGE_VERSIONS: command-stream 1\.6\.2 -> 2\.0\.0 \(exact\)$/m);
  assert.match(report.lines.join('\n'), /^::warning title=Unresolved dependency::Dockerfile:48: link-foundation\/box: 403$/m);
  assert.match(report.summary, /command-stream/);
}

{
  const report = formatFreshnessReport({ stale: [], errors: [], mode: 'fail' });
  assert.equal(report.exitCode, 0);
  assert.deepEqual(report.lines, ['All tracked dependency declarations are current.']);
  assert.equal(report.summary, '');
}

// The workflow must pass the event so the script can choose the mode.
const repositoryRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const releaseWorkflow = fs.readFileSync(path.join(repositoryRoot, '.github', 'workflows', 'release.yml'), 'utf8');
assert.match(releaseWorkflow, /detect-changes:[\s\S]*GITHUB_EVENT_NAME: \$\{\{ github\.event_name \}\}[\s\S]*node scripts\/check-dependency-freshness\.mjs/);

// The CLI is a thin wrapper: it must take the mode from the event and exit
// with the report's code.
const cli = fs.readFileSync(path.join(repositoryRoot, 'scripts', 'check-dependency-freshness.mjs'), 'utf8');
assert.match(cli, /freshnessEnforcement\(process\.env\.GITHUB_EVENT_NAME\)/);
assert.match(cli, /formatFreshnessReport\(/);
assert.match(cli, /process\.exitCode = report\.exitCode/);

console.log('PASS: issue #2625 freshness gate warns on main and blocks pull requests');
