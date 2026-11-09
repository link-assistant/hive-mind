#!/usr/bin/env node
// @hive-mind-test-suite default,pr-essential

/**
 * Issue #4025: the Broken Link Checker failed on main with no broken link.
 *
 * lycheeverse/lychee-action@v2 downloads lychee with a single `curl -sfLO`
 * and no retry, so one transient error from GitHub's release CDN (run
 * 42570340566, curl exit 22) failed the job. The workflow now installs lychee
 * with scripts/install-lychee.sh (retries + SHA-256 check) and runs it in its
 * own step.
 *
 * Running lychee directly means the step has to do what the action did:
 * expose `exit_code`, publish the report, and fail when nothing was checked.
 * lychee also exits 2 both for broken links and for a bad command line, so the
 * step only treats 2 as "broken links" when a report was written. This file
 * runs the real step script and the real installer against local stubs, so it
 * needs no network.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const workflow = readFileSync(join(repoRoot, '.github/workflows/links.yml'), 'utf8').replaceAll('\r\n', '\n');
const installer = join(repoRoot, 'scripts/install-lychee.sh');

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ✅ PASS: ${name}`);
}

// --- the lychee step -------------------------------------------------------

const stepMatch = workflow.match(/\n {6}- name: Check links with lychee\n {8}id: lychee\n[\s\S]*?\n {8}run: \|\n([\s\S]*?)(?=\n {6}- name: )/);
assert.ok(stepMatch, 'links.yml has a "Check links with lychee" step with id lychee and a run block');
const stepScript = stepMatch[1]
  .split('\n')
  .map(line => line.replace(/^ {10}/, ''))
  .join('\n');

const SUMMARY = total => `# Summary

| Status         | Count |
|----------------|-------|
| 🔍 Total       | ${total}     |
| 🔗 Unique      | ${total}     |
| ✅ Successful  | ${total}     |
| 🚫 Errors      | 0     |
`;

/** Run the step with a stub `lychee` that writes `report` (or nothing) and exits `code`. */
function runStep({ code, report }) {
  const dir = mkdtempSync(join(tmpdir(), 'links-4025-'));
  try {
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    const reportFile = join(dir, 'report.md');
    if (report !== undefined) writeFileSync(reportFile, report);
    // The stub finds --output and copies the canned report there.
    writeFileSync(
      join(bin, 'lychee'),
      `#!/usr/bin/env bash
out=""
while [ $# -gt 0 ]; do
  if [ "$1" = --output ]; then out="$2"; shift; fi
  shift
done
${report === undefined ? '' : `cp "${reportFile}" "$out"`}
echo "stub lychee exiting ${code}" >&2
exit ${code}
`
    );
    chmodSync(join(bin, 'lychee'), 0o755);
    const work = join(dir, 'work');
    mkdirSync(work);
    const output = join(dir, 'output');
    const summary = join(dir, 'summary');
    writeFileSync(output, '');
    writeFileSync(summary, '');
    const result = spawnSync('bash', ['-e', '-c', stepScript], {
      cwd: work,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary },
      encoding: 'utf8',
    });
    return { status: result.status, stdout: result.stdout, output: readFileSync(output, 'utf8'), summary: readFileSync(summary, 'utf8') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log('links.yml lychee step');

check('no broken links: step passes, exit_code=0, report in the job summary', () => {
  const r = runStep({ code: 0, report: SUMMARY(42) });
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.output, /^exit_code=0$/m);
  assert.match(r.summary, /# Summary/);
});

check('broken links: step passes so the Wayback lookup can run, exit_code=2', () => {
  const r = runStep({ code: 2, report: SUMMARY(42).replace('Errors      | 0', 'Errors      | 1') });
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.output, /^exit_code=2$/m);
});

check('bad arguments (exit 2, no report) fail the step instead of passing as "broken links"', () => {
  const r = runStep({ code: 2 });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /::error title=lychee failed::lychee exited with code 2 without writing a report/);
});

check('an unexpected lychee error (exit 1) fails the step', () => {
  const r = runStep({ code: 1, report: SUMMARY(42) });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /::error title=lychee failed::lychee exited with code 1/);
});

check('zero links checked fails the step (replaces lychee-action failIfEmpty)', () => {
  const r = runStep({ code: 0, report: SUMMARY(0) });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /::error title=No links checked::/);
});

// --- the installer ---------------------------------------------------------

/** Build a fake release directory with a lychee archive and its checksum. */
function fakeRelease(dir, { corruptChecksum = false } = {}) {
  const arch = { x64: 'x86_64', arm64: 'aarch64' }[process.arch];
  const version = 'v9.9.9';
  const release = join(dir, 'release', `lychee-${version}`);
  const staging = join(dir, 'staging');
  mkdirSync(release, { recursive: true });
  mkdirSync(staging);
  writeFileSync(join(staging, 'lychee'), '#!/usr/bin/env bash\necho "lychee 9.9.9 (stub)"\n');
  chmodSync(join(staging, 'lychee'), 0o755);
  const asset = `lychee-${arch}-unknown-linux-gnu.tar.gz`;
  execFileSync('tar', ['-czf', join(release, asset), '-C', staging, 'lychee']);
  const sum = corruptChecksum
    ? '0'.repeat(64)
    : createHash('sha256')
        .update(readFileSync(join(release, asset)))
        .digest('hex');
  writeFileSync(join(release, `${asset}.sha256`), `${sum}  ${asset}\n`);
  return { version, baseUrl: `file://${join(dir, 'release')}` };
}

function install(env, installDir) {
  mkdirSync(dirname(installDir), { recursive: true });
  const githubPath = join(dirname(installDir), 'github-path');
  writeFileSync(githubPath, '');
  const result = spawnSync('bash', [installer, installDir], {
    env: { ...process.env, LYCHEE_DOWNLOAD_RETRIES: '0', LYCHEE_DOWNLOAD_RETRY_DELAY: '0', GITHUB_PATH: githubPath, ...env },
    encoding: 'utf8',
  });
  return { ...result, githubPath: readFileSync(githubPath, 'utf8') };
}

console.log('scripts/install-lychee.sh');

if (process.platform === 'linux' && ['x64', 'arm64'].includes(process.arch)) {
  check('installs a verified archive and adds it to GITHUB_PATH', () => {
    const dir = mkdtempSync(join(tmpdir(), 'install-lychee-4025-'));
    try {
      const { version, baseUrl } = fakeRelease(dir);
      const r = install({ LYCHEE_VERSION: version, LYCHEE_DOWNLOAD_BASE_URL: baseUrl }, join(dir, 'out', 'bin'));
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /lychee 9\.9\.9 \(stub\)/);
      assert.equal(r.githubPath.trim(), join(dir, 'out', 'bin'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  check('refuses an archive whose checksum does not match', () => {
    const dir = mkdtempSync(join(tmpdir(), 'install-lychee-4025-'));
    try {
      const { version, baseUrl } = fakeRelease(dir, { corruptChecksum: true });
      const r = install({ LYCHEE_VERSION: version, LYCHEE_DOWNLOAD_BASE_URL: baseUrl }, join(dir, 'out', 'bin'));
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /::error title=lychee install::Checksum mismatch/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  check('reports a download that keeps failing with a clear error', () => {
    const dir = mkdtempSync(join(tmpdir(), 'install-lychee-4025-'));
    try {
      const r = install({ LYCHEE_VERSION: 'v9.9.9', LYCHEE_DOWNLOAD_BASE_URL: `file://${join(dir, 'missing')}` }, join(dir, 'out', 'bin'));
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /::error title=lychee install::Could not download lychee v9\.9\.9/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
} else {
  console.log(`  (installer download checks skipped on ${process.platform}/${process.arch})`);
}

check('rejects an unpinned version', () => {
  const dir = mkdtempSync(join(tmpdir(), 'install-lychee-4025-'));
  try {
    const r = install({ LYCHEE_VERSION: 'latest' }, join(dir, 'out', 'bin'));
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /must be a pinned release/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

check('the installer retries every transient error', () => {
  const source = readFileSync(installer, 'utf8');
  assert.match(source, /--retry "\$\{LYCHEE_DOWNLOAD_RETRIES:-5\}" --retry-all-errors/);
});

console.log(`\nlinks-workflow-lychee-4025.test.mjs: ${passed} checks passed`);
