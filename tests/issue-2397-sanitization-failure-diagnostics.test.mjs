#!/usr/bin/env node
/**
 * Issue #2397: a blocked log publication must say which check blocked it.
 *
 * On konard/vietnam-accomodation-search#76 the only upload failure reason was
 * "Credential sanitization failed; publication was blocked." The error's cause
 * was discarded, so it could not be told whether the primary sanitizer failed,
 * Secretlint was unavailable, or a residual was found — and in which part of the
 * 5 MB log. These tests pin the non-sensitive diagnostics that are now kept.
 *
 * Run with: node tests/issue-2397-sanitization-failure-diagnostics.test.mjs
 */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialSanitizationError, describeCredentialSanitizationFailure, sanitizeForPublication } from '../src/token-sanitization.lib.mjs';
import { sanitizeLogFileToFile } from '../src/log-sanitize-stream.lib.mjs';
import { sanitizeLogFileInWorker } from '../src/log-sanitize-worker.lib.mjs';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`❌ ${name}: ${error.message}`);
    failed++;
  }
}

const SECRET = 'super-secret-value-that-must-never-be-printed';

const captureError = async fn => {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected an error');
};

await test('a residual finding records stage and rule ids, never the matched text', async () => {
  const error = await captureError(() =>
    sanitizeForPublication('text', {
      scanner: async value => value,
      residualScanner: async () => [{ ruleId: '@secretlint/secretlint-rule-preset-recommend > @secretlint/secretlint-rule-basicauth', token: SECRET, start: 0, end: 4 }, { ruleId: 'credential-pattern' }, { ruleId: 'credential-pattern' }],
    })
  );
  assert.ok(error instanceof CredentialSanitizationError);
  assert.equal(error.stage, 'residual');
  assert.deepEqual(error.findings, [
    { ruleId: '@secretlint/secretlint-rule-preset-recommend > @secretlint/secretlint-rule-basicauth', count: 1 },
    { ruleId: 'credential-pattern', count: 2 },
  ]);
  const description = describeCredentialSanitizationFailure(error);
  assert.match(description, /^Credential sanitization failed; publication was blocked\. \(stage: residual; findings: /);
  assert.match(description, /credential-pattern×2/);
  assert.ok(!description.includes(SECRET), 'the description must not contain the matched secret');
});

await test('a primary sanitizer failure is reported as the primary stage', async () => {
  const error = await captureError(() =>
    sanitizeForPublication('text', {
      scanner: async () => {
        throw new Error('Primary sanitizer failed.');
      },
    })
  );
  assert.equal(error.stage, 'primary');
  assert.match(describeCredentialSanitizationFailure(error), /\(stage: primary\)$/);
});

await test('a residual scanner crash is reported as the residual-scan stage', async () => {
  const error = await captureError(() =>
    sanitizeForPublication('text', {
      scanner: async value => value,
      residualScanner: async () => {
        throw new Error('Secretlint scanner is unavailable.');
      },
    })
  );
  assert.equal(error.stage, 'residual-scan');
});

await test('the streaming sanitizer records which log block was blocked', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'issue-2397-'));
  try {
    const sourcePath = join(dir, 'source.log');
    await writeFile(sourcePath, `${'a'.repeat(99)}\n${'b'.repeat(99)}\n${'c'.repeat(99)}\n`);
    let calls = 0;
    const error = await captureError(() =>
      sanitizeLogFileToFile({
        sourcePath,
        destPath: join(dir, 'dest.log'),
        chunkBytes: 100,
        maxHoldBytes: 50, // release every line as its own block
        sanitize: async text => {
          calls++;
          if (calls === 2) throw new CredentialSanitizationError({ stage: 'residual', findings: [{ ruleId: 'credential-pattern', count: 1 }] });
          return text;
        },
      })
    );
    assert.equal(error.blockIndex, 2);
    assert.equal(error.blockStartChar, 100);
    assert.equal(error.blockChars, 100);
    assert.match(describeCredentialSanitizationFailure(error), /stage: residual; findings: credential-pattern×1; log block 2 starting at character 100, 100 characters/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

await test('diagnostics survive the bounded worker boundary', async () => {
  const fakeWorker = new EventEmitter();
  fakeWorker.terminate = async () => {};
  const workerFactory = () => {
    setImmediate(() => {
      fakeWorker.emit('message', { type: 'ready' });
      fakeWorker.emit('message', {
        type: 'error',
        name: 'CredentialSanitizationError',
        code: 'ERR_CREDENTIAL_SANITIZATION',
        message: 'Credential sanitization failed; publication was blocked.',
        diagnostics: { stage: 'secretlint', blockIndex: 3, blockStartChar: 2097152, blockChars: 1048576 },
      });
    });
    return fakeWorker;
  };
  const error = await captureError(() => sanitizeLogFileInWorker({ sourcePath: '/nonexistent', destPath: '/nonexistent.out', workerFactory }));
  assert.equal(error.code, 'ERR_CREDENTIAL_SANITIZATION');
  assert.equal(error.sanitizeWorkerStarted, true);
  assert.match(describeCredentialSanitizationFailure(error), /stage: secretlint; log block 3 starting at character 2097152/);
});

await test('other errors are described by their own message', async () => {
  assert.equal(describeCredentialSanitizationFailure(new Error('ENOSPC')), 'ENOSPC');
  assert.equal(describeCredentialSanitizationFailure('plain'), 'plain');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
