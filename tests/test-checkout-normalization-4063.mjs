#!/usr/bin/env node

/**
 * Regression tests for issue #4063: "Repository has uncommitted changes after
 * clone".
 *
 * link-foundation/java-ai-driven-development-pipeline-template@dd803a2 commits
 * `mvnw.cmd` with CRLF line endings and marks it `text eol=crlf` in
 * `.gitattributes`. Every fresh clone reports ` M mvnw.cmd` although the bytes
 * on disk equal the commit, and solve refused to start:
 *
 *     [INFO]  M mvnw.cmd
 *     [INFO] Error: Repository has uncommitted changes after clone
 *
 * (docs/case-studies/issue-4063/raw/solve-failure-comment.md)
 *
 * These tests build that repository state offline, clone it, and check that the
 * conversion artifact is neutralized locally while real changes still stop
 * the run.
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { CHECKOUT_NORMALIZATION_HEADER, classifyStatusEntries, parsePorcelainZ, resolveCheckoutArtifacts, toAttributesPattern } from '../src/checkout-normalization.lib.mjs';
import { verifyDefaultBranchAndStatus } from '../src/solve.repo-setup.lib.mjs';
import { ensureUseM } from '../src/use-m-bootstrap.lib.mjs';

const use = await ensureUseM();
const { $: $raw } = await use('command-stream');
// verifyDefaultBranchAndStatus calls $({ cwd })`...`, so pass options through.
const $ = options => $raw({ ...options, mirror: false, capture: true });

let passed = 0;
const test = async (name, fn) => {
  await fn();
  passed += 1;
  console.log(`✅ ${name}`);
};

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
const status = cwd => git(cwd, 'status', '--porcelain');
const collectLog = () => {
  const lines = [];
  const log = async message => {
    lines.push(String(message));
  };
  return { lines, log };
};

const root = await mkdtemp(path.join(os.tmpdir(), 'hive-mind-4063-'));

/**
 * Create an origin repository whose committed blobs do not match their
 * attributes: the files are added *before* `.gitattributes` exists, exactly
 * like the maven-wrapper output in the reproduction.
 */
const makeOrigin = async (name, files, attributes) => {
  const origin = path.join(root, `${name}-origin`);
  await mkdir(origin, { recursive: true });
  git(origin, 'init', '-q', '-b', 'main');
  git(origin, 'config', 'user.email', 'test@example.invalid');
  git(origin, 'config', 'user.name', 'test');
  git(origin, 'config', 'core.autocrlf', 'false');
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(origin, file)), { recursive: true });
    await writeFile(path.join(origin, file), content);
    git(origin, 'add', '--', file);
  }
  await writeFile(path.join(origin, '.gitattributes'), attributes);
  git(origin, 'add', '.gitattributes');
  git(origin, 'commit', '-q', '-m', 'initial');
  return origin;
};

const cloneOf = (origin, name) => {
  const clone = path.join(root, name);
  execFileSync('git', ['clone', '-q', origin, clone]);
  return clone;
};

try {
  await test('parsePorcelainZ keeps paths verbatim and reads rename sources', async () => {
    assert.deepEqual(parsePorcelainZ(' M mvnw.cmd\0R  new name.txt\0old name.txt\0?? a\tb\0'), [
      { code: ' M', path: 'mvnw.cmd' },
      { code: 'R ', path: 'new name.txt', origPath: 'old name.txt' },
      { code: '??', path: 'a\tb' },
    ]);
    assert.deepEqual(parsePorcelainZ(''), []);
  });

  await test('toAttributesPattern anchors and escapes paths', async () => {
    assert.equal(toAttributesPattern('mvnw.cmd'), '/mvnw.cmd');
    assert.equal(toAttributesPattern('dir/a*b?.cmd'), '/dir/a\\*b\\?.cmd');
    assert.equal(toAttributesPattern('dir/[x].cmd'), '/dir/\\[x\\].cmd');
    assert.equal(toAttributesPattern('my dir/a b.cmd'), '"/my dir/a b.cmd"');
  });

  const javaOrigin = await makeOrigin('java', { mvnw: '#!/bin/sh\necho hi\n', 'mvnw.cmd': '@echo off\r\necho hi\r\n', 'pom.xml': '<project/>\n' }, '/mvnw text eol=lf\n/mvnw.cmd text eol=crlf\n');

  await test('a fresh clone of the reproduction is dirty (the bug exists without the fix)', async () => {
    const clone = cloneOf(javaOrigin, 'java-raw');
    assert.equal(status(clone), ' M mvnw.cmd\n');
    const { artifacts, changes } = await classifyStatusEntries({ cwd: clone });
    assert.deepEqual(
      artifacts.map(entry => entry.path),
      ['mvnw.cmd']
    );
    assert.deepEqual(changes, []);
  });

  await test('resolveCheckoutArtifacts neutralizes the artifact locally and keeps the bytes', async () => {
    const clone = cloneOf(javaOrigin, 'java-fixed');
    const before = await readFile(path.join(clone, 'mvnw.cmd'));
    const { lines, log } = collectLog();
    const result = await resolveCheckoutArtifacts({ cwd: clone, log });
    assert.equal(result.clean, true);
    assert.deepEqual(result.neutralized, ['mvnw.cmd']);
    assert.equal(status(clone), '', 'git itself reports the clone as clean');
    assert.deepEqual(await readFile(path.join(clone, 'mvnw.cmd')), before, 'the working tree file is untouched');
    const attributes = await readFile(path.join(clone, '.git', 'info', 'attributes'), 'utf8');
    assert.ok(attributes.includes(CHECKOUT_NORMALIZATION_HEADER));
    assert.ok(attributes.includes('/mvnw.cmd -text -eol -ident -filter -working-tree-encoding'));
    assert.ok(!git(clone, 'status', '--porcelain', '--ignored').includes('attributes'), 'the override lives in .git, never in the pull request');
    assert.ok(
      lines.some(line => line.includes('git add --renormalize')),
      'the log tells the owner how to fix the repository'
    );
    assert.ok(
      lines.some(line => line.includes('attr') || line.includes('eol')),
      'the log explains the attributes involved'
    );

    // Idempotent: a second run (e.g. a resumed session) changes nothing.
    await resolveCheckoutArtifacts({ cwd: clone, log });
    assert.equal(await readFile(path.join(clone, '.git', 'info', 'attributes'), 'utf8'), attributes);

    // A later real edit of the same file is still visible and committable.
    await writeFile(path.join(clone, 'mvnw.cmd'), '@echo off\r\necho changed\r\n');
    assert.equal(status(clone), ' M mvnw.cmd\n');
    git(clone, 'add', 'mvnw.cmd');
    assert.equal(git(clone, 'cat-file', '-p', ':mvnw.cmd'), '@echo off\r\necho changed\r\n', 'the edit is committed byte for byte, without a whole-file rewrite');
  });

  await test('a real change after clone still stops the run', async () => {
    const clone = cloneOf(javaOrigin, 'java-real-change');
    await writeFile(path.join(clone, 'pom.xml'), '<project>changed</project>\n');
    const result = await resolveCheckoutArtifacts({ cwd: clone });
    assert.equal(result.clean, false);
    assert.deepEqual(result.changes.map(entry => entry.path).sort(), ['pom.xml']);
    assert.deepEqual(
      result.artifacts.map(entry => entry.path),
      ['mvnw.cmd']
    );
    await assert.rejects(readFile(path.join(clone, '.git', 'info', 'attributes'), 'utf8'), /ENOENT/, 'nothing is neutralized when real changes exist');
  });

  await test('an untracked file is never treated as an artifact', async () => {
    const origin = await makeOrigin('clean', { 'a.txt': 'a\n' }, '* text=auto\n');
    const clone = cloneOf(origin, 'clean-untracked');
    await writeFile(path.join(clone, 'new.txt'), 'new\n');
    const result = await resolveCheckoutArtifacts({ cwd: clone });
    assert.equal(result.clean, false);
    assert.deepEqual(
      result.changes.map(entry => entry.code + entry.path),
      ['??new.txt']
    );
  });

  await test('a Windows-authored repository with `* text` and special file names is handled', async () => {
    const origin = await makeOrigin('windows', { 'src/a.txt': 'a\r\nb\r\n', 'my dir/b c*.txt': 'x\r\n', 'lf.txt': 'lf\n' }, '* text\n');
    const clone = cloneOf(origin, 'windows-clone');
    assert.notEqual(status(clone), '');
    const result = await resolveCheckoutArtifacts({ cwd: clone });
    assert.equal(result.clean, true);
    assert.deepEqual(result.neutralized.sort(), ['my dir/b c*.txt', 'src/a.txt']);
    assert.equal(status(clone), '');
  });

  await test('verifyDefaultBranchAndStatus continues on the reproduction and still fails on real changes', async () => {
    const formatAligned = (icon, label, value) => `${icon} ${label} ${value}`;
    const clone = cloneOf(javaOrigin, 'java-verify');
    const { log } = collectLog();
    assert.equal(await verifyDefaultBranchAndStatus({ tempDir: clone, log, formatAligned, $, argv: {}, owner: 'o', repo: 'r', issueUrl: null }), 'main');

    const dirty = cloneOf(javaOrigin, 'java-verify-dirty');
    await writeFile(path.join(dirty, 'pom.xml'), '<project>changed</project>\n');
    const failure = collectLog();
    await assert.rejects(verifyDefaultBranchAndStatus({ tempDir: dirty, log: failure.log, formatAligned, $, argv: {}, owner: 'o', repo: 'r', issueUrl: null }), /Repository has uncommitted changes after clone \( ?M pom\.xml\)/);
    assert.ok(
      failure.lines.some(line => line.includes('hold exactly the committed bytes')),
      'the failure separates artifacts from real changes'
    );
  });
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log(`\n${passed} issue #4063 checkout normalization tests passed`);
