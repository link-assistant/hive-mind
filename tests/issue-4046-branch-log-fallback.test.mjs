/**
 * @hive-mind-test-suite default
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { TextDecoder } from 'node:util';
import { attachLogToGitHub } from '../src/github.lib.mjs';
import { BRANCH_LOG_MAX_PART_BYTES, publishLogToBranch, publishLogToPullRequestBranch } from '../src/log-upload-branch.lib.mjs';
import { buildLogUploadFailureComment, formatLogLinkLines } from '../src/log-upload-failure.lib.mjs';
import { uploadLogWithGhUploadLog } from '../src/log-upload.lib.mjs';

const baseOid = 'a'.repeat(40);
const ok = stdout => ({ code: 0, stdout });
const missing = { code: 1, stderr: 'not found' };
const withLog = async (bytes, check) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-branch-logs-'));
  try {
    const file = path.join(directory, 'session.log');
    await fs.writeFile(file, bytes);
    await check(file, directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
};

function fakeGitHub({ failAt = Infinity, lostAt = Infinity, visibility = 'private', headVisibility = visibility, consumePart } = {}) {
  const commits = [];
  const refs = new Map([
    ['main', baseOid],
    ['issue-17-test', baseOid],
  ]);
  const files = new Map();
  const comments = [];
  let attempts = 0;
  const $ =
    options =>
    async (strings, ...values) => {
      const args = strings.reduce((text, segment, index) => text + segment + (values[index] ?? ''), '');
      const body = options.stdin && JSON.parse(options.stdin);
      if (args.startsWith('gh api graphql')) {
        const input = body.variables.input;
        const { branchName, repositoryNameWithOwner } = input.branch;
        assert.equal(input.expectedHeadOid, refs.get(branchName));
        assert.notEqual(branchName, 'main');
        assert.equal(input.fileChanges.additions.length, 1);
        const [addition] = input.fileChanges.additions;
        attempts++;
        if (attempts === failAt) return missing;
        const bytes = Buffer.from(addition.contents, 'base64');
        const oid = (commits.length + 1).toString(16).padStart(40, '0');
        const isPart = addition.path.endsWith('.txt');
        if (isPart) consumePart?.(bytes);
        commits.push({ oid, branch: branchName, repository: repositoryNameWithOwner, path: addition.path, bytes: isPart && consumePart ? null : bytes });
        files.set(addition.path, createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'));
        refs.set(branchName, oid);
        return attempts === lostAt ? missing : ok(oid);
      }
      if (args.includes(' -X POST --input - --jq .ref')) {
        assert.equal(body.sha, baseOid);
        const ref = body.ref.replace(/^refs\/heads\//, '');
        assert.match(ref, /^hive-mind\/logs\/issue-17\//);
        assert.equal(refs.has(ref), false);
        refs.set(ref, body.sha);
        return ok(body.ref);
      }
      if (args.includes('/issues/17/comments -X POST')) {
        comments.push(body.body);
        return ok(JSON.stringify({ id: 4046 }));
      }
      if (args.includes('/git/ref/heads/')) {
        const ref = args.split('/git/ref/heads/')[1].split(' ')[0];
        return refs.has(ref) ? ok(refs.get(ref)) : missing;
      }
      if (args.includes('/contents/')) {
        const file = args.split('/contents/')[1].split('?')[0];
        return files.has(file) ? ok(files.get(file)) : missing;
      }
      if (args.includes('/pulls/42 ')) {
        return ok(JSON.stringify({ head: { ref: 'issue-17-test', sha: refs.get('issue-17-test'), repo: { full_name: 'fork/repo', default_branch: 'main', visibility: headVisibility } }, base: { ref: 'main', visibility } }));
      }
      if (args.includes('/issues/17 ')) return ok(JSON.stringify({ number: 17, isPullRequest: false }));
      if (args.endsWith('--jq .default_branch')) return ok('main');
      if (args.endsWith('--jq .visibility')) return ok(visibility);
      return missing;
    };
  return { $, commits, refs, comments };
}

const baseOptions = { owner: 'owner', repo: 'repo', log: async () => {} };
const issueOptions = { ...baseOptions, targetType: 'issue', targetNumber: 17 };
const fatalUtf8 = new TextDecoder('utf-8', { fatal: true });
const nameOf = file => path.posix.basename(file);

test('PR branch commits bounded, independently valid UTF-8 parts and an ordered index', { timeout: 20_000 }, async () => {
  const prefix = Buffer.from('a'.repeat(65_533));
  const bytes = Buffer.concat([prefix, Buffer.from('é🎉世界\r\n'.repeat(12_900))]);
  await withLog(bytes, async logFile => {
    const { $, commits, refs } = fakeGitHub({ lostAt: 2 });
    const result = await publishLogToPullRequestBranch({ ...baseOptions, $, logFile, prNumber: 42, partSizeBytes: 65_536 });
    assert.equal(result.success, true, result.failureReason);
    const index = commits.at(-1);
    const parts = commits.slice(0, -1);
    assert.ok(parts.length > 2);
    assert.equal(result.chunks, parts.length);
    assert.equal(parts[0].bytes.length, 65_535, 'the four-byte code point is moved wholly into the next part');
    for (const part of parts) {
      assert.equal(part.repository, 'fork/repo');
      assert.equal(part.branch, 'issue-17-test');
      assert.ok(part.bytes.length <= 65_536);
      fatalUtf8.decode(part.bytes);
    }
    assert.deepEqual(Buffer.concat(parts.map(part => part.bytes)), bytes);
    assert.equal(nameOf(index.path), 'README.md');
    const listed = [...index.bytes.toString().matchAll(/^- \[([^\]]+)\]\(([^)]+)\)/gm)];
    assert.deepEqual(
      listed.map(match => [match[1], match[2]]),
      parts.map(part => [nameOf(part.path), nameOf(part.path)])
    );
    assert.equal(result.url, result.indexUrl);
    assert.ok(result.indexUrl.endsWith(`/blob/${index.oid}/${index.path}`));
    const comment = formatLogLinkLines({ uploadResult: result, logUrl: result.url, label: 'View complete failure log' });
    assert.match(comment, /fork\/repo branch issue-17-test/);
    for (const url of [result.indexUrl, ...result.parts.map(part => part.url)]) assert.ok(comment.includes(url));
    assert.equal(refs.get('main'), baseOid);
  });
});

test('a log over 100 MiB reconstructs exactly with the production part limit', { timeout: 20_000 }, async () => {
  const size = 101 * 1024 * 1024;
  await withLog('session started\n', async logFile => {
    // A sparse fixture keeps local disk use low and exercises the normal part size.
    await fs.truncate(logFile, size);
    const tail = await fs.open(logFile, 'r+');
    try {
      await tail.write('🎉\n', size - 5, 'utf8');
    } finally {
      await tail.close();
    }

    const expectedHash = createHash('sha256');
    for await (const chunk of createReadStream(logFile)) expectedHash.update(chunk);
    const publishedHash = createHash('sha256');
    const { $, commits } = fakeGitHub({
      consumePart: bytes => {
        assert.ok(bytes.length <= BRANCH_LOG_MAX_PART_BYTES);
        publishedHash.update(bytes);
      },
    });
    const result = await publishLogToBranch({ ...issueOptions, $, logFile });
    assert.equal(result.success, true, result.failureReason);
    assert.equal(result.chunks, Math.ceil(size / BRANCH_LOG_MAX_PART_BYTES));
    assert.equal(
      result.parts.reduce((total, part) => total + part.bytes, 0),
      size
    );
    assert.equal(publishedHash.digest('hex'), expectedHash.digest('hex'));
    assert.equal(nameOf(commits.at(-1).path), 'README.md');
  });
});

test('a private PR log cannot fall back to a public fork', { timeout: 20_000 }, async () => {
  await withLog('session data', async logFile => {
    const { $, commits } = fakeGitHub({ headVisibility: 'public' });
    const result = await publishLogToPullRequestBranch({ ...baseOptions, $, logFile, prNumber: 42 });
    assert.equal(result.success, false);
    assert.match(result.failureReason, /visibility/);
    assert.equal(commits.length, 0);
  });
});

test('partial publication reports confirmed parts and leaves the complete index unpublished', { timeout: 20_000 }, async () => {
  await withLog('🎉'.repeat(80), async logFile => {
    const { $, refs, commits } = fakeGitHub({ failAt: 2 });
    const result = await publishLogToBranch({ ...issueOptions, $, logFile, partSizeBytes: 64 });
    assert.equal(result.success, false);
    assert.equal(result.url, undefined);
    assert.equal(result.indexUrl, undefined);
    assert.equal(commits.length, 1);
    assert.equal(result.publishedParts.length, 1);
    assert.equal(refs.get('main'), baseOid);
    const body = buildLogUploadFailureComment({ ...result, logSizeBytes: 80 * 4, logFile, errorMessage: 'execution stopped' });
    assert.match(body, /parts were published before the attachment failed/);
    assert.ok(body.includes(result.publishedParts[0].url));
    assert.ok(body.includes(result.destination.url));
    assert.ok(body.includes(result.destination.branch));
  });
});

test('an index failure still reports all confirmed part links with no complete attachment', { timeout: 20_000 }, async () => {
  await withLog('λ'.repeat(64), async logFile => {
    const { $, commits } = fakeGitHub({ failAt: 3 });
    const result = await publishLogToBranch({ ...issueOptions, $, logFile, partSizeBytes: 64 });
    assert.equal(result.success, false);
    assert.match(result.failureReason, /README.md/);
    assert.equal(commits.length, 2);
    assert.equal(result.publishedParts.length, 2);
    const body = buildLogUploadFailureComment({ ...result, logSizeBytes: 128, logFile });
    assert.match(body, /parts were published before the attachment failed/);
    for (const part of result.publishedParts) assert.ok(body.includes(part.url));
  });
});

test('issue attachment streams straight to its own branch and posts the failure log link with no scratch space', { timeout: 20_000 }, async () => {
  const secret = `ghp_${'A'.repeat(36)}`;
  const text = `start of log\ncredential: ${secret}\n${'progress 世界\n'.repeat(10_000)}last line\n`;
  await withLog(text, async logFile => {
    const { $, comments, commits, refs } = fakeGitHub();
    const statfs = fs.statfs;
    fs.statfs = async () => ({ bavail: 0, bsize: 4096 });
    try {
      const attached = await attachLogToGitHub({ ...issueOptions, $, logFile, errorMessage: 'tool stopped', recordResources: async () => {} });
      assert.equal(attached, true);
    } finally {
      fs.statfs = statfs;
    }
    assert.equal(commits.length, 1);
    assert.equal(refs.get('main'), baseOid);
    const [commit] = commits;
    assert.match(commit.branch, /^hive-mind\/logs\/issue-17\//);
    assert.equal(commit.repository, 'owner/repo');
    assert.match(commit.path, /^dev\/log\/issues\/17\/attachments\/[^/]+\/solve.log$/);
    const published = commit.bytes.toString();
    assert.match(published, /^start of log\n/);
    assert.match(published, /last line\n$/);
    assert.ok(!published.includes(secret));
    assert.equal(comments.length, 1);
    assert.match(comments[0], /Solution Draft Failed/);
    assert.ok(comments[0].includes(`/blob/${commit.oid}/${commit.path}`));
  });
});

test('ENOSPC opening the sanitized copy switches to the streaming sanitizer', { timeout: 20_000 }, async () => {
  await withLog('diagnostic line\n'.repeat(16), async logFile => {
    const { $, commits } = fakeGitHub();
    let uploaderCalled = false;
    const result = await uploadLogWithGhUploadLog({
      logFile,
      isPublic: false,
      sanitize: async () => {
        throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
      },
      runUpload: async () => {
        uploaderCalled = true;
      },
      publishToBranch: (source, { needsSanitization }) => {
        assert.equal(source, logFile);
        assert.equal(needsSanitization, true);
        return publishLogToBranch({ ...issueOptions, $, logFile: source, needsSanitization });
      },
    });
    assert.equal(result.success, true, result.failureReason);
    assert.equal(uploaderCalled, false);
    assert.deepEqual(commits[0].bytes, await fs.readFile(logFile));
  });
});

test('a whole log larger than available memory takes the streaming branch path', { timeout: 20_000 }, async t => {
  t.mock.method(process, 'availableMemory', () => 128);
  await withLog('diagnostic line\n'.repeat(16), async logFile => {
    const { $, commits } = fakeGitHub();
    const result = await uploadLogWithGhUploadLog({
      logFile,
      isPublic: true,
      sanitize: async () => assert.fail('should stream the sanitizer output directly'),
      runUpload: async () => assert.fail('should skip the whole-file uploader'),
      publishToBranch: (source, { needsSanitization }) => publishLogToBranch({ ...issueOptions, $, logFile: source, needsSanitization }),
    });
    assert.equal(result.success, true, result.failureReason);
    assert.ok(result.rawUrl.endsWith(`/raw/${commits[0].oid}/${commits[0].path}`));
    assert.deepEqual(commits[0].bytes, await fs.readFile(logFile));
  });
});

test('scratch precheck reserves one sanitized copy plus one gh-upload-log part, not two full copies', { timeout: 20_000 }, async t => {
  const MiB = 1024 * 1024;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-branch-logs-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const logFile = path.join(directory, 'session.log');
  await fs.writeFile(logFile, '');
  await fs.truncate(logFile, 300 * MiB); // sparse: no real disk use
  const route = async freeBytes => {
    t.mock.method(fs, 'statfs', async () => ({ bavail: freeBytes, bsize: 1 }));
    t.mock.method(process, 'availableMemory', () => 1024 * MiB);
    let path = null;
    await uploadLogWithGhUploadLog({
      logFile,
      isPublic: false,
      sanitize: async () => {
        path = 'gh-upload-log';
        throw new Error('stop after routing');
      },
      runUpload: async () => assert.fail('sanitize stops first'),
      publishToBranch: async () => {
        path = 'branch';
        return { success: false, failureReason: 'not published in this test' };
      },
    });
    t.mock.restoreAll();
    return path;
  };
  // Older gh-upload-log needed 600 MiB here; 0.13.4 stages at most one 100 MiB part.
  assert.equal(await route(400 * MiB + 1), 'gh-upload-log');
  assert.equal(await route(400 * MiB), 'branch');
});
