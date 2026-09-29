/**
 * @hive-mind-test-suite default
 * Issue #2301 (link-foundation/meta-language#196): the AI session failed and its 165 MB log died on
 * the only upload attempt ("error: RPC failed; HTTP 408"). Nothing was posted on the pull request,
 * while the automation-stop comment told the reader to review "the attached" log.
 *
 * The upload is now retried, then re-sent as complete, line-aligned parts. If it still cannot be
 * published, the pull request gets a comment that says so, and why, without posting a partial log
 * (issue #1678).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { splitLogIntoLineAlignedParts, summarizeUploadFailure, uploadLogWithGhUploadLog } from '../src/log-upload.lib.mjs';
import { buildLogUploadFailureComment, formatLogLinkLines, postLogUploadFailureComment } from '../src/log-upload-failure.lib.mjs';
import { attachLogToGitHub } from '../src/github.lib.mjs';
import { isToolGeneratedComment, LOG_UPLOAD_FAILED_MARKER } from '../src/tool-comments.lib.mjs';

// The failing run's gh-upload-log output, trimmed (see docs/case-studies/issue-2301).
const HTTP_408_OUTPUT = `Options: {
  filePath: "/tmp/hive-mind-log-upload-n5G6Oz/sanitized.log",
  isPublic: true,
}
Strategy: File exceeds Gist limit, will be split into 2 chunks
→ Adding and committing files...
error: RPC failed; HTTP 408 curl 22 The requested URL returned error: 408
send-pack: unexpected disconnect while reading sideband packet
fatal: the remote end hung up unexpectedly
❌ Error: Failed to push shared repository upload to public-logs: error: RPC failed; HTTP 408 curl 22 The requested URL returned error: 408
Stack trace:
    at ensureCommandSucceeded (/home/box/.bun/install/global/node_modules/gh-upload-log/src/common.js:135:21)`;

const uploadedOutput = name => `✅ Uploaded
🔗 https://github.com/konard/public-logs/tree/main/tmp/${name}
📄 https://raw.githubusercontent.com/konard/public-logs/main/tmp/${name}.txt

Details:
  Type: 📦 Repository
  File count: 1
`;

const withTempLog = async (content, fn) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'issue-2301-upload-'));
  try {
    const logFile = path.join(dir, 'session.log');
    await fs.writeFile(logFile, content);
    return await fn(logFile, dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
};

const LOG_LINES = Array.from({ length: 200 }, (_, i) => `line ${i} — ünïcödé payload ${'x'.repeat(i % 37)}\n`).join('');

test('a failed upload is retried with backoff before giving up', async () => {
  await withTempLog(LOG_LINES, async logFile => {
    const sleeps = [];
    let calls = 0;
    const result = await uploadLogWithGhUploadLog({
      logFile,
      isPublic: true,
      description: 'log',
      sleep: async ms => sleeps.push(ms),
      runUpload: async args => {
        calls++;
        return calls < 3 ? { code: 1, stdout: '', stderr: HTTP_408_OUTPUT } : { code: 0, stdout: uploadedOutput(path.basename(args[0])), stderr: '' };
      },
    });
    assert.equal(result.success, true);
    assert.equal(result.attempts, 3);
    assert.deepEqual(sleeps, [30_000, 120_000]);
    assert.equal(result.parts, undefined, 'a single upload has no parts');
  });
});

test('when the whole log keeps failing, every byte is uploaded as line-aligned parts', async () => {
  await withTempLog(LOG_LINES, async logFile => {
    const uploaded = [];
    const result = await uploadLogWithGhUploadLog({
      logFile,
      isPublic: true,
      description: 'Solution draft log',
      sleep: async () => {},
      partSizeBytes: 2048,
      runUpload: async args => {
        if (!args[0].includes('.part-')) return { code: 1, stdout: '', stderr: HTTP_408_OUTPUT };
        uploaded.push({ name: path.basename(args[0]), bytes: await fs.readFile(args[0], 'utf8'), description: args[args.indexOf('--description') + 1] });
        return { code: 0, stdout: uploadedOutput(path.basename(args[0])), stderr: '' };
      },
    });
    assert.equal(result.success, true);
    assert.equal(result.failureReason, undefined);
    assert.ok(uploaded.length > 1, 'split into several parts');
    assert.equal(result.parts.length, uploaded.length);
    assert.equal(result.chunks, uploaded.length);
    assert.equal(uploaded.map(part => part.bytes).join(''), LOG_LINES, 'the parts add up to the complete log');
    for (const [index, part] of uploaded.entries()) {
      assert.equal(part.name, `session-log.part-${index + 1}-of-${uploaded.length}.log`);
      assert.equal(part.description, `Solution draft log (part ${index + 1} of ${uploaded.length})`);
      if (index < uploaded.length - 1) assert.ok(part.bytes.endsWith('\n'), 'parts end on a line boundary');
    }
  });
});

test('if a part cannot be uploaded either, the result is a failure with the reason', async () => {
  await withTempLog(LOG_LINES, async logFile => {
    const result = await uploadLogWithGhUploadLog({ logFile, isPublic: true, description: 'log', sleep: async () => {}, partSizeBytes: 2048, runUpload: async () => ({ code: 1, stdout: '', stderr: HTTP_408_OUTPUT }) });
    assert.equal(result.success, false);
    assert.match(result.failureReason, /RPC failed; HTTP 408/);
    assert.equal(result.attempts, 3 + 3, 'three whole-log attempts, then three for the first part');
  });
});

test('a missing gh-upload-log binary is not retried', async () => {
  await withTempLog(LOG_LINES, async logFile => {
    let calls = 0;
    const result = await uploadLogWithGhUploadLog({
      logFile,
      isPublic: true,
      description: 'log',
      sleep: async () => assert.fail('no backoff for exit 127'),
      runUpload: async () => {
        calls++;
        return { code: 127, stdout: '', stderr: 'spawn gh-upload-log ENOENT' };
      },
    });
    assert.equal(result.success, false);
    assert.equal(calls, 1);
    assert.match(result.failureReason, /ENOENT/);
  });
});

test('parts never split a line or a multi-byte character', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'issue-2301-split-'));
  try {
    const source = path.join(dir, 'source.log');
    await fs.writeFile(source, LOG_LINES);
    const parts = await splitLogIntoLineAlignedParts({ sourcePath: source, directory: dir, partSizeBytes: 1000 });
    const contents = await Promise.all(parts.map(part => fs.readFile(part, 'utf8')));
    assert.equal(contents.join(''), LOG_LINES);
    for (const content of contents) assert.ok(content.endsWith('\n'));
    assert.ok(!contents.join('').includes('�'));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('the upload failure reason keeps the error lines and drops the option dump and stack', () => {
  const reason = summarizeUploadFailure(HTTP_408_OUTPUT);
  assert.match(reason, /error: RPC failed; HTTP 408/);
  assert.match(reason, /fatal: the remote end hung up unexpectedly/);
  assert.doesNotMatch(reason, /Options: \{|ensureCommandSucceeded/);
});

test('the upload-failure comment explains the outcome without posting a partial log', () => {
  const body = buildLogUploadFailureComment({ errorMessage: 'Claude command failed with exit code 1', failureReason: summarizeUploadFailure(HTTP_408_OUTPUT), attempts: 6, logSizeBytes: 172_898_015, logFile: '/home/box/95ad3d3e.log', isPublic: true });
  assert.match(body, /Solution Draft Failed/);
  assert.match(body, /Claude command failed with exit code 1/);
  assert.ok(body.includes(LOG_UPLOAD_FAILED_MARKER));
  assert.match(body, /\(165 MB\) could not be uploaded after 6 attempts/);
  assert.match(body, /HTTP 408/);
  assert.match(body, /\/home\/box\/95ad3d3e\.log/);
  assert.match(body, /gh-upload-log "\/home\/box\/95ad3d3e\.log" --public/);
  assert.ok(isToolGeneratedComment(body));

  const success = buildLogUploadFailureComment({ logSizeBytes: 2048, logFile: '/tmp/a.log', isPublic: false });
  assert.match(success, /Solution Draft Log: Log Upload Failed/);
  assert.match(success, /--private/);
});

test('posting the upload-failure comment never throws', async () => {
  const logs = [];
  const posted = await postLogUploadFailureComment({
    $: null,
    owner: 'o',
    repo: 'r',
    targetNumber: 1,
    log: async message => logs.push(message),
    postComment: async () => {
      throw new Error('network down');
    },
    logSizeBytes: 10,
    logFile: '/tmp/x.log',
  });
  assert.equal(posted, false);
  assert.match(logs.join('\n'), /network down/);
});

test('a log published as parts links every part', () => {
  const uploadResult = { parts: [{ url: 'https://github.com/a/1' }, { url: 'https://github.com/a/2' }] };
  const lines = formatLogLinkLines({ uploadResult, logUrl: 'https://github.com/a/1', label: 'View complete failure log', selectUrl: part => part.url });
  assert.equal(lines, '- [View complete failure log: part 1 of 2](https://github.com/a/1)\n- [View complete failure log: part 2 of 2](https://github.com/a/2)');
  assert.equal(formatLogLinkLines({ uploadResult: {}, logUrl: 'https://x', label: 'L', selectUrl: () => null }), '- [L](https://x)');
});

test('attachLogToGitHub posts the upload-failure comment when gh-upload-log fails', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'issue-2301-attach-'));
  const originalPath = process.env.PATH;
  try {
    await fs.writeFile(path.join(dir, 'gh-upload-log'), `#!/bin/sh\necho "error: RPC failed; HTTP 408 curl 22 The requested URL returned error: 408" >&2\nexit 1\n`, { mode: 0o755 });
    process.env.PATH = `${dir}${path.delimiter}${originalPath}`;
    const logFile = path.join(dir, 'big.log');
    await fs.writeFile(logFile, 'a transcript line\n'.repeat(8000));
    const posts = [];
    const $ = first => {
      if (Array.isArray(first)) return Promise.resolve({ code: 0, stdout: 'public', stderr: '' });
      return async (strings, ...rest) => {
        const command = strings.reduce((text, part, index) => text + part + (index < rest.length ? rest[index] : ''), '');
        if (first?.stdin) posts.push({ command, body: JSON.parse(first.stdin).body });
        return { code: 0, stdout: first?.stdin ? '{"id":123}' : 'public', stderr: '' };
      };
    };
    const logs = [];
    const attached = await attachLogToGitHub({ logFile, targetType: 'pr', targetNumber: 196, owner: 'link-foundation', repo: 'meta-language', $, log: async message => logs.push(String(message)), errorMessage: 'Claude command failed', uploadRetryDelaysMs: [], recordResources: async () => {} });
    assert.equal(attached, false, 'no log was attached');
    assert.equal(posts.length, 1, logs.join('\n'));
    assert.match(posts[0].command, /issues\/196\/comments/);
    assert.ok(posts[0].body.includes(LOG_UPLOAD_FAILED_MARKER));
    assert.match(posts[0].body, /HTTP 408/);
    assert.match(posts[0].body, /Claude command failed/);
  } finally {
    process.env.PATH = originalPath;
    await fs.rm(dir, { recursive: true, force: true });
  }
});
