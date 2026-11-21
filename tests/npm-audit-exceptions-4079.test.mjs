/**
 * @hive-mind-test-suite default
 *
 * The npm-audit job (issue #2198) turned red on every branch, PR #4080 included,
 * when GHSA-fc5q-39xc-vjpf was widened to every published picomatch release
 * with no patched version. scripts/check-npm-audit.mjs accepts an advisory only
 * while it still reports the exact range recorded in
 * scripts/npm-audit-exceptions.json, so the job fails again as soon as a fix
 * ships or the exception goes stale.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { checkNpmAudit, DEFAULT_EXCEPTIONS_PATH } from '../scripts/check-npm-audit.mjs';

const URL_PICOMATCH = 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf';
const advisory = (name, range, { url = URL_PICOMATCH, severity = 'high' } = {}) => ({ source: 1, name, dependency: name, title: `${name} advisory`, url, severity, range });
const report = (...vias) => ({
  vulnerabilities: {
    ...Object.fromEntries(vias.map(via => [via.name, { name: via.name, severity: via.severity, via: [via] }])),
    // Packages that only depend on a vulnerable one list it as a string.
    secretlint: { name: 'secretlint', severity: 'high', via: ['picomatch'] },
  },
});
const exceptions = [{ advisory: URL_PICOMATCH, package: 'picomatch', range: '<=4.0.7', reason: 'no patched release' }];

describe('issue #4079: npm audit exceptions', () => {
  it('accepts a recorded advisory while its range is unchanged', () => {
    const { failures, accepted } = checkNpmAudit(report(advisory('picomatch', '<=4.0.7')), exceptions);
    assert.deepEqual(failures, []);
    assert.equal(accepted.length, 1);
  });

  it('fails on any other high or critical advisory', () => {
    const other = advisory('lodash', '<4.17.21', { url: 'https://github.com/advisories/GHSA-x', severity: 'critical' });
    const { failures } = checkNpmAudit(report(advisory('picomatch', '<=4.0.7'), other), exceptions);
    assert.equal(failures.length, 1);
    assert.match(failures[0], /lodash/);
  });

  it('ignores advisories below high', () => {
    const moderate = advisory('debug', '<1', { url: 'https://github.com/advisories/GHSA-y', severity: 'moderate' });
    assert.deepEqual(checkNpmAudit(report(advisory('picomatch', '<=4.0.7'), moderate), exceptions).failures, []);
  });

  it('fails when the accepted advisory changes its range (a fix shipped)', () => {
    const { failures } = checkNpmAudit(report(advisory('picomatch', '<4.0.8')), exceptions);
    assert.equal(failures.length, 1);
    assert.match(failures[0], /upgrade picomatch, then remove the exception/);
  });

  it('fails on a stale exception', () => {
    const { failures } = checkNpmAudit({ vulnerabilities: {} }, exceptions);
    assert.equal(failures.length, 1);
    assert.match(failures[0], /no longer reported/);
  });

  it('fails closed when npm audit itself failed', () => {
    assert.throws(() => checkNpmAudit({ error: { code: 'ENOAUDIT', summary: 'registry unreachable' } }, exceptions), /registry unreachable/);
    assert.throws(() => checkNpmAudit(null, exceptions), /did not produce a report/);
  });

  it('every committed exception names a reason, a package and an exact range', () => {
    const committed = JSON.parse(readFileSync(DEFAULT_EXCEPTIONS_PATH, 'utf8'));
    assert.ok(Array.isArray(committed));
    for (const entry of committed) {
      assert.match(entry.advisory, /^https:\/\/github\.com\/advisories\/GHSA-/);
      for (const key of ['package', 'range', 'reason']) assert.ok(typeof entry[key] === 'string' && entry[key].trim(), `${entry.advisory} has a ${key}`);
    }
  });

  it('the npm-audit job is decided by the checker', () => {
    const workflow = readFileSync(new URL('../.github/workflows/security.yml', import.meta.url), 'utf8');
    assert.match(workflow, /npm audit --package-lock-only --audit-level=high --json > npm-audit\.json/);
    assert.match(workflow, /node scripts\/check-npm-audit\.mjs npm-audit\.json/);
  });
});
