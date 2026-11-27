/**
 * Regression coverage for an unrecoverable credential-sanitizer finding in
 * tool diagnostics and transcript publication. All data is synthetic.
 *
 * @hive-mind-test-suite default
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { CREDENTIAL_SANITIZATION_ERROR_CODE, OMITTED_DIAGNOSTIC, sanitizeCredentialText } from '../src/credential-sanitization-core.lib.mjs';
import { sanitizeLogFileToFile } from '../src/log-sanitize-stream.lib.mjs';
import { sanitizeLogFileToFileBounded } from '../src/log-sanitize-worker.lib.mjs';
import { CredentialSanitizationError, describeCredentialSanitizationFailure, sanitizeForPublication } from '../src/token-sanitization.lib.mjs';

const exec = promisify(execFile);
const encoded = '%20'.repeat(3000);

async function tempDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'issue-4176-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('keeps parsing tool events after a rejected mirror write and keeps opt-in tracing value-free', { timeout: 10000 }, async t => {
  const dir = await tempDir(t);
  const code = `
    import { log, setLogFile, setupStdioLogInterceptor, setupVerboseLogInterceptor } from './src/lib.mjs';
    process.env.ISSUE_4176_SECRET = 'REDACTED';
    global.verboseMode = true;
    await setLogFile(process.argv[1]);
    setupVerboseLogInterceptor();
    setupStdioLogInterceptor();

    async function acceptToolEvent(raw) {
      await log(raw, { stream: 'stdout' });
      const { type } = JSON.parse(raw);
      if (type === 'turn.completed') await log('Tool event parsed');
    }
    await acceptToolEvent('{"type":"item.completed","output":"private fixture REDACTED"}');
    console.log('[VERBOSE] another REDACTED fixture');
    process.stderr.write('stderr REDACTED fixture\\n');
    await acceptToolEvent('{"type":"turn.completed"}');
    process.stdout.write('stdout still works\\n');
  `;

  for (const debug of ['0', '1']) {
    const logFile = join(dir, `run-${debug}.log`);
    const { stdout, stderr } = await exec(process.execPath, ['--max-old-space-size=192', '--input-type=module', '-e', code, logFile], { env: { ...process.env, HIVE_MIND_SANITIZER_DEBUG: debug } });
    const log = await readFile(logFile, 'utf8');
    for (const output of [stdout, log]) {
      assert.ok(output.includes(OMITTED_DIAGNOSTIC));
      assert.match(output, /Tool event parsed/);
      assert.match(output, /stdout still works/);
    }
    assert.ok(stderr.includes(OMITTED_DIAGNOSTIC));
    assert.doesNotMatch(stdout + stderr + log, /REDACTED|private fixture/);
    assert.doesNotMatch(log, /\[hive-mind sanitizer\]/);
    const traces = stderr.split('\n').filter(line => line.startsWith('[hive-mind sanitizer] '));
    if (debug === '0') assert.deepEqual(traces, []);
    else {
      const events = traces.map(line => JSON.parse(line.slice('[hive-mind sanitizer] '.length)));
      assert.ok(events.some(event => event.event === 'blocked' && event.source === 'stdout' && event.code === 'ERR_RESIDUAL' && event.inputLength > 0));
      assert.ok(events.some(event => event.event === 'blocked' && event.source === 'stderr'));
    }
  }
});

test('replaces the entire encoded span whose decoded contents exceed the inspection budget', { timeout: 10000 }, async () => {
  const output = await sanitizeForPublication(`before\n${encoded}\nafter\n`);
  assert.equal(output, 'before\n[REDACTED]\nafter\n');
  assert.equal(await sanitizeForPublication(output), output);
});

test('uses the normal worker to replace only the refused transcript block', { timeout: 20000 }, async t => {
  const dir = await tempDir(t);
  const sourcePath = join(dir, 'source.log');
  const destPath = join(dir, 'sanitized.log');
  const before = `before ${'.'.repeat(56)}\n`;
  const after = 'after\n';
  const rejected = 'REDACTED secret diagnostic\n';
  await writeFile(sourcePath, before + rejected + after);
  const previous = process.env.ISSUE_4176_SECRET;
  process.env.ISSUE_4176_SECRET = 'REDACTED';
  t.after(() => {
    if (previous === undefined) delete process.env.ISSUE_4176_SECRET;
    else process.env.ISSUE_4176_SECRET = previous;
  });

  assert.throws(() => sanitizeCredentialText(rejected), { code: 'ERR_RESIDUAL' });
  const options = { sourcePath, destPath, chunkBytes: 32, maxHoldBytes: 32, thresholdBytes: 0 };
  await assert.rejects(sanitizeLogFileToFileBounded(options), error => {
    assert.equal(error.code, CREDENTIAL_SANITIZATION_ERROR_CODE);
    assert.equal(error.sanitizerCode, 'ERR_RESIDUAL');
    assert.equal(error.stage, 'primary');
    assert.doesNotMatch(describeCredentialSanitizationFailure(error), /REDACTED|secret diagnostic/);
    return true;
  });
  await assert.rejects(access(destPath), { code: 'ENOENT' });

  const stats = await sanitizeLogFileToFileBounded({ ...options, omitResidualBlocks: true });
  assert.equal(stats.worker, true);
  assert.equal(stats.omittedBlocks, 1);
  assert.equal(await readFile(destPath, 'utf8'), `${before}${OMITTED_DIAGNOSTIC}\n${after}`);

  await writeFile(sourcePath, `left ${encoded} right\n`);
  const spanDestPath = join(dir, 'opaque-span.log');
  const spanOptions = { ...options, destPath: spanDestPath, chunkBytes: 16384 };
  await assert.rejects(sanitizeLogFileToFileBounded(spanOptions), { sanitizerCode: 'ERR_RESIDUAL' });
  const spanStats = await sanitizeLogFileToFileBounded({ ...spanOptions, omitResidualBlocks: true });
  assert.equal(spanStats.omittedBlocks, 0);
  assert.equal(await readFile(spanDestPath, 'utf8'), `left ${OMITTED_DIAGNOSTIC} right\n`);
});

test('an unverified omission notice or unrelated publication failure removes the partial destination', { timeout: 10000 }, async t => {
  const dir = await tempDir(t);
  const sourcePath = join(dir, 'source.log');
  const destPath = join(dir, 'dest.log');
  await writeFile(sourcePath, 'before...........\nfailed diagnostic\n');
  const residualError = new CredentialSanitizationError({ stage: 'primary', cause: Object.assign(new Error('fixture'), { code: 'ERR_RESIDUAL' }) });
  const scannerError = new CredentialSanitizationError({ stage: 'secretlint' });

  for (const failure of [residualError, scannerError]) {
    let verifiedNotice = false;
    await assert.rejects(
      sanitizeLogFileToFile({
        sourcePath,
        destPath,
        chunkBytes: 18,
        omitResidualBlocks: true,
        sanitize(text) {
          if (text.startsWith('before')) return text;
          if (text === `${OMITTED_DIAGNOSTIC}\n`) {
            verifiedNotice = true;
            throw scannerError;
          }
          throw failure;
        },
      }),
      { code: CREDENTIAL_SANITIZATION_ERROR_CODE, stage: 'secretlint', blockIndex: 2 }
    );
    assert.equal(verifiedNotice, failure === residualError);
    await assert.rejects(access(destPath), { code: 'ENOENT' });
  }
});
