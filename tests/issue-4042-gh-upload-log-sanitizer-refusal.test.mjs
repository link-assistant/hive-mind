/**
 * @hive-mind-test-suite default
 * Issue #4042 (link-assistant/router#785): a 399 MB log was already sanitized by Hive Mind, but
 * gh-upload-log's own pinned sanitizer refused it with
 * "Sanitization failed (ERR_LIMIT) (record exceeds 64 MiB or detector limit)". Hive Mind treated the
 * refusal as transient and sent the same bytes 6 times, parts kept lines over 64 MiB whole, and the
 * failure comment suggested a manual gh-upload-log command that is refused the same way.
 * Upstream: link-foundation/gh-upload-log#63, fixed in gh-upload-log 0.13.2, which still refuses
 * (ERR_SANITIZATION) a long letter run near non-ASCII text: link-foundation/sensitive-data-sanitizer#172.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { TextDecoder } from 'node:util';
import { detectGhUploadLogSanitizerRefusal, GH_UPLOAD_LOG_MAX_RECORD_BYTES, LOG_UPLOAD_ISOLATED_RUN_BYTES, LOG_UPLOAD_MAX_PART_BYTES, splitLogIntoLineAlignedParts, uploadLogWithGhUploadLog } from '../src/log-upload.lib.mjs';
import { GH_UPLOAD_LOG_LONG_RUN_ISSUE_URL, GH_UPLOAD_LOG_REFUSAL_ISSUE_URL } from '../src/gh-upload-log-refusal.lib.mjs';
import { buildLogUploadFailureComment } from '../src/log-upload-failure.lib.mjs';

// gh-upload-log 0.13.1 output quoted in the router#785 failure comments.
const REFUSAL_OUTPUT = `❌ Error: Sanitization failed (ERR_LIMIT) (record exceeds 64 MiB or detector limit); nothing was uploaded
Error: Sanitization failed (ERR_LIMIT) (record exceeds 64 MiB or detector limit); nothing was uploaded`;
const HTTP_408_OUTPUT = 'error: RPC failed; HTTP 408 curl 22 The requested URL returned error: 408';
// gh-upload-log 0.13.2 output (experiments/issue-3739/gh-upload-log-err-limit.mjs).
const LONG_RUN_REFUSAL_OUTPUT = 'Error: Sanitization failed (ERR_SANITIZATION) (longest record 4194305 bytes); not retryable; nothing was uploaded';
const DETECTOR_LIMIT_OUTPUT = 'Error: Sanitization failed (ERR_DETECTOR_LIMIT) (a sanitizer detector, findings or registry limit was reached by this content; retrying the same bytes cannot succeed; longest record 120 bytes); not retryable; nothing was uploaded';
const INPUT_CHANGED_OUTPUT = 'Error: Sanitization failed (ERR_INPUT_CHANGED) (the file changed size while it was being scanned; retry once it is complete); retryable; nothing was uploaded';
const NO_SPACE_OUTPUT = 'Error: Sanitization failed (ENOSPC) (not enough disk space for private sanitized output; longest record 120 bytes); retryable; nothing was uploaded';

// Longest ASCII letter/digit run, and whether there is a non-ASCII byte.
const runProfile = buffer => {
  let longest = 0;
  let run = 0;
  let nonAscii = false;
  for (const byte of buffer) {
    if ((byte >= 48 && byte <= 57) || (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122)) longest = Math.max(longest, ++run);
    else {
      run = 0;
      if (byte >= 0x80) nonAscii = true;
    }
  }
  return { longest, nonAscii };
};

const uploadedOutput = name => `✅ Uploaded
🔗 https://github.com/example/public-logs/tree/main/tmp/${name}
📄 https://raw.githubusercontent.com/example/public-logs/main/tmp/${name}.txt

Details:
  Type: 📦 Repository
  File count: 1
`;

const LOG_LINES = Array.from({ length: 200 }, (_, i) => `line ${i} — ünïcödé payload ${'x'.repeat(i % 37)}\n`).join('');

const withTempDir = async fn => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'issue-4042-'));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
};

const withTempLog = (content, fn) =>
  withTempDir(async dir => {
    const logFile = path.join(dir, 'session.log');
    await fs.writeFile(logFile, content);
    return fn(logFile);
  });

const strictUtf8 = new TextDecoder('utf-8', { fatal: true });

test('the gh-upload-log sanitizer refusal is recognized; transient and auth failures are not', () => {
  assert.equal(detectGhUploadLogSanitizerRefusal(REFUSAL_OUTPUT), 'ERR_LIMIT');
  assert.equal(detectGhUploadLogSanitizerRefusal('Sanitization failed (ERR_ENGINE) (a required credential detector failed); nothing was uploaded'), 'ERR_ENGINE');
  assert.equal(detectGhUploadLogSanitizerRefusal(HTTP_408_OUTPUT), null);
  assert.equal(detectGhUploadLogSanitizerRefusal('HTTP 401: Bad credentials'), null);
  assert.equal(detectGhUploadLogSanitizerRefusal(null), null);
  // gh-upload-log 0.13.2 says which failures can clear; only "not retryable" ones are refusals.
  assert.equal(detectGhUploadLogSanitizerRefusal(LONG_RUN_REFUSAL_OUTPUT), 'ERR_SANITIZATION');
  assert.equal(detectGhUploadLogSanitizerRefusal(DETECTOR_LIMIT_OUTPUT), 'ERR_DETECTOR_LIMIT');
  assert.equal(detectGhUploadLogSanitizerRefusal(INPUT_CHANGED_OUTPUT), null);
  assert.equal(detectGhUploadLogSanitizerRefusal(NO_SPACE_OUTPUT), null);
  assert.ok(LOG_UPLOAD_MAX_PART_BYTES < GH_UPLOAD_LOG_MAX_RECORD_BYTES, 'parts stay under the 64 MiB record limit');
});

test('a refused log that fits in one part is not retried and goes straight to the branch fallback', async () => {
  await withTempLog(LOG_LINES, async logFile => {
    let calls = 0;
    const published = [];
    const result = await uploadLogWithGhUploadLog({
      logFile,
      isPublic: true,
      description: 'log',
      sleep: async () => assert.fail('a deterministic refusal must not back off'),
      runUpload: async () => {
        calls++;
        return { code: 1, stdout: '', stderr: REFUSAL_OUTPUT };
      },
      publishToBranch: async sanitizedPath => {
        published.push(await fs.readFile(sanitizedPath, 'utf8'));
        return { success: true, url: 'https://github.com/example/repo/blob/branch/solve.log', rawUrl: null, type: 'repository', chunks: 1 };
      },
    });
    assert.equal(calls, 1, 'identical bytes are sent once');
    assert.equal(result.attempts, 1);
    assert.equal(result.success, true, 'published by the fallback');
    assert.equal(published.length, 1);
    assert.equal(published[0], LOG_LINES);
  });
});

test('a refused whole log is not retried and is re-sent once as bounded parts', async () => {
  await withTempLog(LOG_LINES, async logFile => {
    const uploaded = [];
    let wholeCalls = 0;
    const result = await uploadLogWithGhUploadLog({
      logFile,
      isPublic: true,
      description: 'log',
      partSizeBytes: 2048,
      sleep: async () => assert.fail('no backoff after a refusal'),
      runUpload: async args => {
        if (!args[0].includes('.part-')) {
          wholeCalls++;
          return { code: 1, stdout: '', stderr: REFUSAL_OUTPUT };
        }
        uploaded.push(await fs.readFile(args[0], 'utf8'));
        return { code: 0, stdout: uploadedOutput(path.basename(args[0])), stderr: '' };
      },
    });
    assert.equal(wholeCalls, 1);
    assert.equal(result.success, true);
    assert.ok(uploaded.length > 1);
    assert.equal(result.attempts, 1 + uploaded.length);
    assert.equal(uploaded.join(''), LOG_LINES);
  });
});

test('a refused part stops the part upload at once and falls back, reporting the refusal', async () => {
  await withTempLog(LOG_LINES, async logFile => {
    let calls = 0;
    let fallbackCalls = 0;
    const result = await uploadLogWithGhUploadLog({
      logFile,
      isPublic: true,
      description: 'log',
      partSizeBytes: 2048,
      sleep: async () => assert.fail('no backoff after a refusal'),
      runUpload: async () => {
        calls++;
        return { code: 1, stdout: '', stderr: REFUSAL_OUTPUT };
      },
      publishToBranch: async () => {
        fallbackCalls++;
        return { success: false, failureReason: 'branch push rejected' };
      },
    });
    assert.equal(result.success, false);
    assert.equal(calls, 2, 'one whole-log attempt and one for the first part (router#785 needed 6)');
    assert.equal(result.attempts, 2);
    assert.equal(fallbackCalls, 1);
    assert.match(result.failureReason, /Sanitization failed \(ERR_LIMIT\)/);
  });
});

test('transient failures are still retried with backoff', async () => {
  await withTempLog(LOG_LINES, async logFile => {
    const sleeps = [];
    let calls = 0;
    const result = await uploadLogWithGhUploadLog({
      logFile,
      isPublic: true,
      description: 'log',
      sleep: async ms => sleeps.push(ms),
      runUpload: async args => (++calls < 2 ? { code: 1, stdout: '', stderr: HTTP_408_OUTPUT } : { code: 0, stdout: uploadedOutput(path.basename(args[0])), stderr: '' }),
    });
    assert.equal(result.success, true);
    assert.deepEqual(sleeps, [30_000]);
  });
});

test('an overlong line is cut at the part cap on a UTF-8 boundary, and the parts concatenate to the exact log', async () => {
  await withTempDir(async dir => {
    const source = path.join(dir, 'source.log');
    // One 9 KB line of 1-, 2-, 3- and 4-byte characters between normal lines.
    const longLine = `{"text":"${'aé€😀'.repeat(900)}"}\n`;
    const content = `first\n${longLine}last line\n`;
    await fs.writeFile(source, content);
    const stats = {};
    const parts = await splitLogIntoLineAlignedParts({ sourcePath: source, directory: dir, partSizeBytes: 1000, stats });
    const buffers = await Promise.all(parts.map(part => fs.readFile(part)));
    assert.equal(Buffer.concat(buffers).toString('utf8'), content);
    assert.ok(stats.cutLines > 0, 'the cuts are counted for the log');
    for (const buffer of buffers) {
      assert.ok(buffer.length <= 2000 + 3, `a part of ${buffer.length} bytes exceeds the 2x cap`);
      assert.doesNotThrow(() => strictUtf8.decode(buffer), 'every part is valid UTF-8 on its own');
    }
  });
});

test('a cut is also UTF-8 safe when a character spans two 1 MiB read chunks', async () => {
  await withTempDir(async dir => {
    const source = path.join(dir, 'source.log');
    // 3-byte characters, so read chunks (1 MiB) end inside a character.
    const content = `${'€'.repeat(1_100_000)}\n`;
    await fs.writeFile(source, content);
    const stats = {};
    const partSizeBytes = 1024 * 1024 - 1;
    const parts = await splitLogIntoLineAlignedParts({ sourcePath: source, directory: dir, partSizeBytes, maxPartSizeBytes: partSizeBytes + 1, stats });
    const buffers = await Promise.all(parts.map(part => fs.readFile(part)));
    assert.ok(buffers.length >= 3);
    assert.ok(stats.cutLines >= 2);
    assert.equal(Buffer.concat(buffers).toString('utf8'), content);
    for (const buffer of buffers) assert.doesNotThrow(() => strictUtf8.decode(buffer));
  });
});

test('short lines are still never cut', async () => {
  await withTempDir(async dir => {
    const source = path.join(dir, 'source.log');
    await fs.writeFile(source, LOG_LINES);
    const stats = {};
    const parts = await splitLogIntoLineAlignedParts({ sourcePath: source, directory: dir, partSizeBytes: 1000, stats });
    const contents = await Promise.all(parts.map(part => fs.readFile(part, 'utf8')));
    assert.equal(stats.cutLines, 0);
    assert.equal(contents.join(''), LOG_LINES);
    for (const content of contents) assert.ok(content.endsWith('\n'));
  });
});

test('upstream #172: no part holds a long letter run together with non-ASCII text', async () => {
  await withTempDir(async dir => {
    const source = path.join(dir, 'run.log');
    const limit = 1000;
    const content = `🔐 token refreshed\n{"type":"image","data":"${'A'.repeat(3500)}"}\n✅ done ${'B'.repeat(1500)} — ok\nplain\n`;
    await fs.writeFile(source, content);
    const stats = {};
    const parts = await splitLogIntoLineAlignedParts({ sourcePath: source, directory: dir, partSizeBytes: 1024 * 1024, isolatedRunBytes: limit, stats });
    const buffers = await Promise.all(parts.map(part => fs.readFile(part)));
    assert.equal(Buffer.concat(buffers).toString('utf8'), content, 'the parts concatenate to the exact log');
    for (const buffer of buffers) {
      strictUtf8.decode(buffer);
      const { longest, nonAscii } = runProfile(buffer);
      assert.ok(!(nonAscii && longest >= limit), `a part mixes a ${longest}-byte run with non-ASCII text`);
    }
    assert.equal(stats.isolatedRuns, parts.length - 1);
    assert.ok(parts.length >= 3, 'the run before and the run after the emoji are both isolated');
    assert.equal(LOG_UPLOAD_ISOLATED_RUN_BYTES, 1024 * 1024);
  });
});

test('upstream #172: a refused log under the part size is re-sent as parts that isolate the run', async () => {
  const content = `🔐 token refreshed\n{"type":"image","data":"${'A'.repeat(3 * 1024 * 1024)}"}\n✅ done\n`;
  await withTempLog(content, async logFile => {
    const uploaded = [];
    const result = await uploadLogWithGhUploadLog({
      logFile,
      isPublic: true,
      description: 'log',
      sleep: async () => assert.fail('no backoff after a refusal'),
      // Like gh-upload-log 0.13.2: refuse a file mixing a long run with non-ASCII text.
      runUpload: async args => {
        const buffer = await fs.readFile(args[0]);
        const { longest, nonAscii } = runProfile(buffer);
        if (nonAscii && longest >= 2 * 1024 * 1024) return { code: 65, stdout: '', stderr: LONG_RUN_REFUSAL_OUTPUT };
        uploaded.push(buffer.toString('utf8'));
        return { code: 0, stdout: uploadedOutput(path.basename(args[0])), stderr: '' };
      },
    });
    assert.equal(result.success, true);
    assert.ok(uploaded.length >= 2);
    assert.equal(uploaded.join(''), content);
  });
});

test('a refused log under the part size without a long run still goes straight to the fallback', async () => {
  await withTempLog(LOG_LINES, async logFile => {
    let calls = 0;
    const result = await uploadLogWithGhUploadLog({
      logFile,
      isPublic: true,
      description: 'log',
      sleep: async () => assert.fail('no backoff after a refusal'),
      runUpload: async () => {
        calls++;
        return { code: 65, stdout: '', stderr: LONG_RUN_REFUSAL_OUTPUT };
      },
    });
    assert.equal(calls, 1, 'one part would be the same bytes again');
    assert.equal(result.success, false);
  });
});

test('retryable gh-upload-log 0.13.2 sanitization failures are retried', async () => {
  await withTempLog(LOG_LINES, async logFile => {
    let calls = 0;
    const result = await uploadLogWithGhUploadLog({
      logFile,
      isPublic: true,
      description: 'log',
      retryDelaysMs: [1],
      sleep: async () => {},
      runUpload: async args => (++calls < 2 ? { code: 75, stdout: '', stderr: INPUT_CHANGED_OUTPUT } : { code: 0, stdout: uploadedOutput(path.basename(args[0])), stderr: '' }),
    });
    assert.equal(calls, 2);
    assert.equal(result.success, true);
  });
});

test('the failure comment explains a refusal instead of suggesting the command that fails the same way', () => {
  const logFile = '/home/box/solve-2026-11-06T22-17-57-120Z.log';
  const location = { kind: 'host' };
  const body = buildLogUploadFailureComment({ errorMessage: 'Cannot create a string longer than 0x1fffffe8 characters', failureReason: REFUSAL_OUTPUT, attempts: 2, logSizeBytes: 399 * 1024 * 1024, logFile, location });
  assert.match(body, /gh-upload-log's own sanitizer refused this file \(`ERR_LIMIT`\)/);
  assert.ok(body.includes(GH_UPLOAD_LOG_REFUSAL_ISSUE_URL));
  assert.ok(body.includes(`split --line-bytes=20M --numeric-suffixes=1 --additional-suffix=.log "${logFile}" "${logFile}.part-"`));
  assert.ok(body.includes(`for part in "${logFile}".part-*.log; do gh-upload-log "$part" --public; done`));
  assert.ok(!body.includes(`gh-upload-log "${logFile}" --public`), 'no command that is refused again');

  const transient = buildLogUploadFailureComment({ failureReason: HTTP_408_OUTPUT, logSizeBytes: 1024, logFile, location });
  assert.ok(transient.includes(`gh-upload-log "${logFile}" --public`), 'a transient failure keeps the plain retry command');
  assert.ok(!transient.includes('split --line-bytes'));

  const limitBody = buildLogUploadFailureComment({ failureReason: REFUSAL_OUTPUT, logSizeBytes: 1024, logFile, location });
  assert.ok(limitBody.includes('upgrade it to 0.13.2 or later'), 'ERR_LIMIT names the gh-upload-log release that fixes it');
  const longRun = buildLogUploadFailureComment({ failureReason: LONG_RUN_REFUSAL_OUTPUT, logSizeBytes: 1024, logFile, location });
  assert.ok(longRun.includes(GH_UPLOAD_LOG_LONG_RUN_ISSUE_URL));
  assert.ok(longRun.includes(`split --line-bytes=2M --numeric-suffixes=1 --additional-suffix=.log "${logFile}" "${logFile}.part-"`));
  const retryable = buildLogUploadFailureComment({ failureReason: INPUT_CHANGED_OUTPUT, logSizeBytes: 1024, logFile, location });
  assert.ok(retryable.includes(`gh-upload-log "${logFile}" --public`), 'a retryable failure keeps the plain retry command');
});
