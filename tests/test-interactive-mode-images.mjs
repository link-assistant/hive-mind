#!/usr/bin/env node

/**
 * Tests for inline image display in --interactive-mode (Issue #1843).
 *
 * Covers:
 *  - the payload extractor / helpers in interactive-image-upload.lib.mjs
 *  - the redaction / embed helpers in interactive-mode.shared.lib.mjs
 *  - createImageUploader: orphan-branch creation (once), Contents-API upload,
 *    ?raw=true URL, content-hash de-duplication, disabled + failure degradation
 *  - handleToolResult / handleCodexMcpToolCall: embed images, never leak base64,
 *    redact the raw-JSON sections, and still run token sanitization (#1745).
 *
 * All GitHub access is mocked — no network calls, no real commits.
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createHash } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const srcDir = join(__dirname, '..', 'src');

const uploadLib = await import(join(srcDir, 'interactive-image-upload.lib.mjs'));
const sharedLib = await import(join(srcDir, 'interactive-mode.shared.lib.mjs'));
const interactiveLib = await import(join(srcDir, 'interactive-mode.lib.mjs'));
const sanitizeLib = await import(join(srcDir, 'token-sanitization.lib.mjs'));

const { extractImagePayload, isImageNode, extensionForMediaType, buildRawBlobUrl, createImageUploader, DEFAULT_MEDIA_BRANCH } = uploadLib;
const { redactImageData, createRedactedRawJsonSection, formatImageEmbeds, formatBytes } = sharedLib;
const { createInteractiveHandler } = interactiveLib;
const { sanitizeCommentBody } = sanitizeLib;

// A real 1x1 transparent PNG (base64) — long enough (>64 chars) to exercise
// redaction and realistic enough to flow through the upload path.
const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

let testsPassed = 0;
let testsFailed = 0;

async function runTest(name, testFn) {
  process.stdout.write(`Testing ${name}... `);
  try {
    await testFn();
    console.log('✅ PASSED');
    testsPassed++;
  } catch (error) {
    console.log(`❌ FAILED: ${error.message}`);
    testsFailed++;
  }
}

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

// ============================================================
// MOCK gh RUNNER for the uploader
// ============================================================
//
// Simulates the GitHub API sequence createImageUploader drives:
//   GET  repos/.../git/ref/heads/<branch>   → 404 (throws) unless branchExists
//   POST repos/.../git/blobs|trees|commits  → { sha }
//   POST repos/.../git/refs                 → { ref }
//   PUT  repos/.../contents/<path>          → { content }
function makeMockGh({ branchExists = false, failPut = false, existsAfterFail = false } = {}) {
  const calls = [];
  const run = async (cmd, args) => {
    const apiPath = args[1];
    const xIndex = args.indexOf('-X');
    const method = xIndex >= 0 ? args[xIndex + 1] : 'GET';
    calls.push({ apiPath, method });

    if (method === 'GET' && apiPath.includes('/git/ref/heads/')) {
      if (!branchExists) {
        const err = new Error('gh: Not Found (HTTP 404)');
        err.code = 1;
        throw err;
      }
      return { stdout: JSON.stringify({ ref: `refs/heads/${DEFAULT_MEDIA_BRANCH}`, object: { sha: 'existingsha' } }) };
    }
    if (method === 'POST' && /\/git\/(blobs|trees|commits)$/.test(apiPath)) {
      return { stdout: JSON.stringify({ sha: 'fakesha-' + apiPath.split('/').pop() }) };
    }
    if (method === 'POST' && apiPath.endsWith('/git/refs')) {
      return { stdout: JSON.stringify({ ref: `refs/heads/${DEFAULT_MEDIA_BRANCH}` }) };
    }
    if (method === 'PUT' && apiPath.includes('/contents/')) {
      if (failPut) {
        const err = new Error('gh: Unprocessable Entity (HTTP 422)');
        err.code = 1;
        throw err;
      }
      return { stdout: JSON.stringify({ content: { path: apiPath.split('/contents/')[1] } }) };
    }
    if (method === 'GET' && apiPath.includes('/contents/')) {
      // existence re-check after a failed PUT
      if (existsAfterFail) return { stdout: JSON.stringify({ path: 'exists' }) };
      const err = new Error('gh: Not Found (HTTP 404)');
      err.code = 1;
      throw err;
    }
    return { stdout: '' };
  };
  return { run, calls };
}

// ============================================================
// extractImagePayload / isImageNode
// ============================================================

console.log('\n=== extractImagePayload / helpers ===\n');

await runTest('extractImagePayload: Claude tool_result image block', () => {
  const p = extractImagePayload({ type: 'image', source: { type: 'base64', data: PNG_1x1, media_type: 'image/png' } });
  assert(p && p.base64 === PNG_1x1, 'expected base64 extracted');
  assert(p.mediaType === 'image/png', `expected image/png, got ${p && p.mediaType}`);
});

await runTest('extractImagePayload: MCP image content {data,mimeType}', () => {
  const p = extractImagePayload({ type: 'image', data: PNG_1x1, mimeType: 'image/jpeg' });
  assert(p && p.base64 === PNG_1x1, 'expected base64 extracted');
  assert(p.mediaType === 'image/jpeg', `expected image/jpeg, got ${p && p.mediaType}`);
});

await runTest('extractImagePayload: Claude Read tool_use_result file', () => {
  const p = extractImagePayload({ type: 'image', file: { base64: PNG_1x1, type: 'image/png', originalSize: 7573219 } });
  assert(p && p.base64 === PNG_1x1, 'expected base64 from file.base64');
  assert(p.originalSize === 7573219, 'expected originalSize preserved');
});

await runTest('extractImagePayload: rejects non-image nodes', () => {
  assert(extractImagePayload(null) === null, 'null → null');
  assert(extractImagePayload({ type: 'text', text: 'hi' }) === null, 'text → null');
  assert(extractImagePayload({ type: 'image' }) === null, 'image with no data → null');
  assert(extractImagePayload('a string') === null, 'string → null');
});

await runTest('isImageNode mirrors extractImagePayload', () => {
  assert(isImageNode({ type: 'image', data: PNG_1x1 }) === true, 'image node → true');
  assert(isImageNode({ type: 'text', text: 'x' }) === false, 'text node → false');
});

await runTest('extensionForMediaType maps known + unknown', () => {
  assert(extensionForMediaType('image/png') === 'png', 'png');
  assert(extensionForMediaType('image/jpeg') === 'jpg', 'jpeg→jpg');
  assert(extensionForMediaType('image/svg+xml') === 'svg', 'svg');
  assert(extensionForMediaType('image/webp; charset=binary') === 'webp', 'webp with params');
  assert(extensionForMediaType(undefined) === 'png', 'undefined → png default');
  assert(extensionForMediaType('application/x-weird') === 'png', 'unknown → png default');
});

await runTest('buildRawBlobUrl produces an embeddable ?raw=true URL', () => {
  const url = buildRawBlobUrl('o', 'r', 'media-branch', 'media/pr-1/abcd.png');
  assert(url === 'https://github.com/o/r/blob/media-branch/media/pr-1/abcd.png?raw=true', `unexpected URL: ${url}`);
});

await runTest('embedded image URL (16-char hex filename) survives token sanitizer (#1745)', async () => {
  // The real uploader names files `media/pr-<n>/<sha256-prefix-16>.<ext>`. That
  // 16-char hex segment, embedded in a blob URL, must NOT be mistaken for a
  // secret/commit hash and masked — otherwise the rendered link would break.
  // The handler-integration tests use non-hex fake URLs, so this guards the
  // real filename shape against the LIVE sanitizer explicitly.
  // knownTokens:[] is a truthy empty array → Pass 1 (known-local tokens) is a
  // no-op, while Pass 2 (regex + secretlint — where the hex rule lives) runs.
  const hex16 = createHash('sha256').update(PNG_1x1).digest('hex').slice(0, 16);
  const url = buildRawBlobUrl('link-assistant', 'hive-mind', DEFAULT_MEDIA_BRANCH, `media/pr-1844/${hex16}.png`);
  const body = `### 🖼️ Images\n\n![shot.png](${url})\n`;
  const out = await sanitizeCommentBody(body, { knownTokens: [] });
  assert(out === body, `image embed must be unchanged by sanitizer; got:\n${out}`);
  assert(out.includes(url), 'blob URL must survive intact');

  // Worst case: a filename that is ALL [a-f0-9] for the full 16 chars.
  const allHex = buildRawBlobUrl('o', 'r', DEFAULT_MEDIA_BRANCH, 'media/pr-9/abcdef0123456789.png');
  const out2 = await sanitizeCommentBody(`![](${allHex})`, { knownTokens: [] });
  assert(out2 === `![](${allHex})`, `all-hex segment must survive; got: ${out2}`);

  // Guard against a false pass from an inert sanitizer: a loose 40-char hex IS
  // masked, proving Pass 2 actually ran above.
  const loose = `token ${'a'.repeat(40)}`;
  const live = await sanitizeCommentBody(loose, { knownTokens: [] });
  assert(live !== loose, 'sanitizer must be live (loose 40-char hex is masked)');
});

// ============================================================
// redaction + embed helpers (shared lib)
// ============================================================

console.log('\n=== redaction / embed helpers ===\n');

await runTest('redactImageData strips all three base64 carriers', () => {
  const event = {
    keep: 'me',
    content: [{ type: 'image', source: { type: 'base64', data: PNG_1x1, media_type: 'image/png' } }],
    mcp: { type: 'image', data: PNG_1x1, mimeType: 'image/png' },
    tool_use_result: { type: 'image', file: { base64: PNG_1x1, type: 'image/png', originalSize: 999 } },
  };
  const out = redactImageData(event);
  const text = JSON.stringify(out);
  assert(!text.includes(PNG_1x1), 'base64 must not survive redaction');
  assert(text.includes('<image data:'), 'expected redaction placeholder');
  assert(out.keep === 'me', 'non-image fields preserved');
  assert(out.tool_use_result.file.originalSize === 999, 'metadata (originalSize) preserved');
});

await runTest('redactImageData leaves short non-image data untouched', () => {
  const out = redactImageData({ type: 'image', data: 'short' });
  assert(out.data === 'short', 'short data should not be redacted');
});

await runTest('redactImageData handles circular references', () => {
  const obj = { a: 1 };
  obj.self = obj;
  const out = redactImageData(obj);
  assert(out.a === 1 && out.self === '[Circular]', 'circular ref replaced');
});

await runTest('createRedactedRawJsonSection has no base64 but is valid section', () => {
  const section = createRedactedRawJsonSection([{ type: 'image', source: { data: PNG_1x1, media_type: 'image/png' } }]);
  assert(section.includes('📄 Raw JSON'), 'expected Raw JSON summary');
  assert(!section.includes(PNG_1x1), 'base64 must not appear in redacted raw JSON');
  assert(section.includes('<image data:'), 'expected placeholder');
});

await runTest('formatImageEmbeds renders inline image when url present', () => {
  const md = formatImageEmbeds([{ url: 'https://x/y?raw=true', mediaType: 'image/png', originalSize: 7573219, name: 'Read image' }]);
  assert(md.includes('### 🖼️ Images'), 'expected images heading');
  assert(md.includes('![Read image](https://x/y?raw=true)'), `expected embed, got: ${md}`);
  assert(md.includes('image/png'), 'expected media type in caption');
  assert(md.includes('7.2 MB') || md.includes('7 MB'), `expected human size, got: ${md}`);
});

await runTest('formatImageEmbeds degrades to a metadata note without url', () => {
  const md = formatImageEmbeds([{ url: null, mediaType: 'image/png', originalSize: 1024, name: 'img' }]);
  assert(md.includes('image upload unavailable'), 'expected degradation note');
  assert(!md.includes('!['), 'must not emit an embed without a url');
});

await runTest('formatImageEmbeds returns empty string for no images', () => {
  assert(formatImageEmbeds([]) === '', 'empty array → empty string');
  assert(formatImageEmbeds(undefined) === '', 'undefined → empty string');
});

await runTest('formatBytes human-readable', () => {
  assert(formatBytes(512) === '512 B', `512 B, got ${formatBytes(512)}`);
  assert(formatBytes(1024) === '1 KB', `1 KB, got ${formatBytes(1024)}`);
  assert(formatBytes(7573219) === '7.2 MB', `7.2 MB, got ${formatBytes(7573219)}`);
  assert(formatBytes(-1) === '', 'negative → empty');
});

// ============================================================
// createImageUploader
// ============================================================

console.log('\n=== createImageUploader ===\n');

await runTest('uploadImage creates orphan branch once, returns ?raw=true URL', async () => {
  const { run, calls } = makeMockGh({ branchExists: false });
  const uploader = createImageUploader({ owner: 'o', repo: 'r', prNumber: 7, execFile: run });
  const url = await uploader.uploadImage({ base64: PNG_1x1, mediaType: 'image/png', name: 'first' });
  assert(typeof url === 'string' && url.includes('?raw=true'), `expected raw URL, got ${url}`);
  assert(url.includes(`/blob/${DEFAULT_MEDIA_BRANCH}/media/pr-7/`), `expected pr-namespaced path, got ${url}`);

  // Upload a SECOND, different image — branch must NOT be recreated.
  const url2 = await uploader.uploadImage({ base64: PNG_1x1.replace('iVBOR', 'AAAAA'), mediaType: 'image/png', name: 'second' });
  assert(url2 && url2 !== url, 'second distinct image gets its own URL');
  const refCreations = calls.filter(c => c.method === 'POST' && c.apiPath.endsWith('/git/refs'));
  assert(refCreations.length === 1, `branch ref should be created exactly once, got ${refCreations.length}`);
  const puts = calls.filter(c => c.method === 'PUT');
  assert(puts.length === 2, `expected 2 content PUTs, got ${puts.length}`);
});

await runTest('uploadImage de-duplicates identical content by hash', async () => {
  const { run, calls } = makeMockGh({ branchExists: true });
  const uploader = createImageUploader({ owner: 'o', repo: 'r', prNumber: 1, execFile: run });
  const a = await uploader.uploadImage({ base64: PNG_1x1, mediaType: 'image/png' });
  const b = await uploader.uploadImage({ base64: PNG_1x1, mediaType: 'image/png' });
  assert(a === b, 'identical content should map to the same URL');
  const puts = calls.filter(c => c.method === 'PUT');
  assert(puts.length === 1, `expected a single PUT for duplicate content, got ${puts.length}`);
});

await runTest('uploadImage skips branch creation when branch already exists', async () => {
  const { run, calls } = makeMockGh({ branchExists: true });
  const uploader = createImageUploader({ owner: 'o', repo: 'r', prNumber: 1, execFile: run });
  await uploader.uploadImage({ base64: PNG_1x1, mediaType: 'image/png' });
  const blobCreations = calls.filter(c => c.apiPath.endsWith('/git/blobs'));
  assert(blobCreations.length === 0, 'should not create blobs when branch exists');
});

await runTest('uploadImage returns null when disabled (no gh calls)', async () => {
  const { run, calls } = makeMockGh({ branchExists: false });
  const uploader = createImageUploader({ owner: 'o', repo: 'r', prNumber: 1, execFile: run, enabled: false });
  const url = await uploader.uploadImage({ base64: PNG_1x1, mediaType: 'image/png' });
  assert(url === null, 'disabled uploader returns null');
  assert(calls.length === 0, `disabled uploader must not call gh, got ${calls.length}`);
});

await runTest('uploadImage returns null on hard failure', async () => {
  const { run } = makeMockGh({ branchExists: true, failPut: true, existsAfterFail: false });
  const logs = [];
  const uploader = createImageUploader({ owner: 'o', repo: 'r', prNumber: 1, execFile: run, log: async m => logs.push(m) });
  const url = await uploader.uploadImage({ base64: PNG_1x1, mediaType: 'image/png' });
  assert(url === null, 'failed upload returns null');
  assert(
    logs.some(l => String(l).includes('image upload failed')),
    'expected a failure log'
  );
});

await runTest('uploadImage reuses URL when PUT 422 but file already exists', async () => {
  const { run } = makeMockGh({ branchExists: true, failPut: true, existsAfterFail: true });
  const uploader = createImageUploader({ owner: 'o', repo: 'r', prNumber: 1, execFile: run });
  const url = await uploader.uploadImage({ base64: PNG_1x1, mediaType: 'image/png' });
  assert(typeof url === 'string' && url.includes('?raw=true'), 'existing file → reuse URL');
});

await runTest('uploadImage returns null for empty/invalid input', async () => {
  const { run } = makeMockGh({ branchExists: true });
  const uploader = createImageUploader({ owner: 'o', repo: 'r', prNumber: 1, execFile: run });
  assert((await uploader.uploadImage({ base64: '' })) === null, 'empty base64 → null');
  assert((await uploader.uploadImage({})) === null, 'missing base64 → null');
});

// ============================================================
// HANDLER INTEGRATION
// ============================================================

console.log('\n=== handler integration ===\n');

let mockCommentIdCounter = 5000;
function makeHandler({ imageUploadEnabled = true, imageUploader, execFile } = {}) {
  const comments = [];
  const edits = [];
  const logs = [];
  const mockExecFile =
    execFile ||
    (async (cmd, args, options) => {
      const argsStr = args.join(' ');
      const inputBody = options?.input ? JSON.parse(options.input).body : '';
      if (argsStr.includes('-X PATCH')) {
        edits.push({ args: argsStr, body: inputBody });
        return { stdout: JSON.stringify({ id: mockCommentIdCounter, body: inputBody }) };
      }
      const id = ++mockCommentIdCounter;
      comments.push({ args: argsStr, body: inputBody });
      return { stdout: JSON.stringify({ id, html_url: `https://github.com/o/r/pull/1#issuecomment-${id}` }) };
    });
  const handler = createInteractiveHandler({
    owner: 'o',
    repo: 'r',
    prNumber: 1,
    log: async m => logs.push(m),
    verbose: false,
    execFile: mockExecFile,
    imageUploadEnabled,
    imageUploader,
  });
  return { handler, comments, edits, logs };
}

/** A fake uploader that records calls and returns deterministic URLs. */
function makeFakeUploader() {
  const uploads = [];
  return {
    enabled: true,
    uploads,
    uploadImage: async ({ base64, mediaType, name }) => {
      uploads.push({ base64, mediaType, name });
      return `https://github.com/o/r/blob/${DEFAULT_MEDIA_BRANCH}/media/pr-1/img-${uploads.length}.png?raw=true`;
    },
  };
}

await runTest('handleToolResult embeds image and never leaks base64', async () => {
  const fake = makeFakeUploader();
  const { handler, comments } = makeHandler({ imageUploader: fake });
  await handler._handlers.handleToolResult({ type: 'user', tool_use_result: { type: 'image', file: { base64: PNG_1x1, type: 'image/png', originalSize: 7573219 } } }, { tool_use_id: 'toolu_img', content: [{ type: 'image', source: { type: 'base64', data: PNG_1x1, media_type: 'image/png' } }] });
  assert(comments.length === 1, `expected 1 comment, got ${comments.length}`);
  const body = comments[0].body;
  assert(body.includes('### 🖼️ Images'), 'expected images section');
  assert(body.includes('?raw=true'), 'expected embedded ?raw=true URL');
  assert(body.includes('!['), 'expected a Markdown image embed');
  assert(!body.includes(PNG_1x1), 'base64 must NOT appear anywhere in the comment');
  assert(body.includes('<image data:'), 'raw JSON should be redacted');
  // The same image appears in both content[] and tool_use_result.file → render once.
  assert(fake.uploads.length === 1, `expected a single upload (dedup), got ${fake.uploads.length}`);
});

await runTest('handleToolResult replaces image block with a text placeholder', async () => {
  const fake = makeFakeUploader();
  const { handler, comments } = makeHandler({ imageUploader: fake });
  await handler._handlers.handleToolResult({ type: 'user' }, { tool_use_id: 't2', content: [{ type: 'image', source: { type: 'base64', data: PNG_1x1, media_type: 'image/png' } }] });
  const body = comments[0].body;
  assert(body.includes('_[image: image/png]_'), 'expected inline placeholder in the output fence');
});

await runTest('handleToolResult with upload disabled shows metadata note, no base64', async () => {
  // No injected uploader + disabled flag → real uploader, enabled:false (no gh calls).
  const { handler, comments } = makeHandler({ imageUploadEnabled: false });
  await handler._handlers.handleToolResult({ type: 'user', tool_use_result: { type: 'image', file: { base64: PNG_1x1, type: 'image/png', originalSize: 4096 } } }, { tool_use_id: 't3', content: [{ type: 'image', source: { type: 'base64', data: PNG_1x1, media_type: 'image/png' } }] });
  const body = comments[0].body;
  assert(body.includes('### 🖼️ Images'), 'expected images section even when disabled');
  assert(body.includes('image upload unavailable'), 'expected metadata note when disabled');
  assert(!body.includes(PNG_1x1), 'base64 must NOT appear when disabled');
  assert(!body.includes('?raw=true'), 'no embed URL when disabled');
});

await runTest('handleToolResult: non-image results are unchanged (no images section)', async () => {
  const fake = makeFakeUploader();
  const { handler, comments } = makeHandler({ imageUploader: fake });
  await handler._handlers.handleToolResult({ type: 'user' }, { tool_use_id: 't4', content: 'plain text output' });
  const body = comments[0].body;
  assert(!body.includes('### 🖼️ Images'), 'no images section for text-only results');
  assert(body.includes('plain text output'), 'text output preserved');
  assert(fake.uploads.length === 0, 'no uploads for text-only results');
});

await runTest('handleToolResult merges image into pending tool-use comment (edit path)', async () => {
  const fake = makeFakeUploader();
  const { handler, comments, edits } = makeHandler({ imageUploader: fake });
  // First emit the tool_use so a pending call + comment exist.
  await handler._handlers.handleToolUse({ type: 'assistant' }, { type: 'tool_use', id: 'toolu_pending', name: 'Read', input: { file_path: '/tmp/shot.png' } });
  await handler._handlers.handleToolResult({ type: 'user', tool_use_result: { type: 'image', file: { base64: PNG_1x1, type: 'image/png', originalSize: 100 } } }, { tool_use_id: 'toolu_pending', content: [{ type: 'image', source: { type: 'base64', data: PNG_1x1, media_type: 'image/png' } }] });
  const edited = edits.find(e => e.body.includes('### 🖼️ Images'));
  assert(edited, 'expected the merged (edited) comment to contain the images section');
  assert(edited.body.includes('?raw=true'), 'merged comment embeds the image');
  assert(!edited.body.includes(PNG_1x1), 'merged comment must not leak base64');
  assert(comments.length === 1, 'only the original tool_use comment is posted; result is an edit');
});

await runTest('handleCodexMcpToolCall embeds MCP image and redacts result JSON', async () => {
  const fake = makeFakeUploader();
  const { handler, comments } = makeHandler({ imageUploader: fake });
  await handler._handlers.handleCodexMcpToolCall({
    type: 'item.completed',
    item: {
      type: 'mcp_tool_call',
      server: 'playwright',
      tool: 'browser_take_screenshot',
      status: 'completed',
      result: { content: [{ type: 'image', data: PNG_1x1, mimeType: 'image/png' }] },
    },
  });
  assert(comments.length === 1, `expected 1 comment, got ${comments.length}`);
  const body = comments[0].body;
  assert(body.includes('### 🖼️ Images'), 'expected images section for MCP result');
  assert(body.includes('?raw=true') && body.includes('!['), 'expected embedded MCP image');
  assert(!body.includes(PNG_1x1), 'base64 must NOT appear (result section + raw JSON redacted)');
  assert(body.includes('<image data:'), 'result/raw JSON should be redacted');
  assert(fake.uploads.length === 1, 'one MCP image uploaded');
});

await runTest('token sanitization still runs through the image path (#1745)', async () => {
  const fake = makeFakeUploader();
  const { handler, comments } = makeHandler({ imageUploader: fake });
  const secret = 'ghp_' + 'A'.repeat(36); // looks like a GitHub PAT → must be masked
  await handler._handlers.handleToolResult(
    { type: 'user' },
    {
      tool_use_id: 't5',
      content: [
        { type: 'text', text: `leaked ${secret}` },
        { type: 'image', source: { type: 'base64', data: PNG_1x1, media_type: 'image/png' } },
      ],
    }
  );
  const body = comments[0].body;
  assert(!body.includes(secret), 'the GitHub token must be masked by sanitization');
  assert(body.includes('?raw=true'), 'image still embedded alongside sanitized text');
});

await runTest('createInteractiveHandler exposes the bound uploader', async () => {
  const fake = makeFakeUploader();
  const { handler } = makeHandler({ imageUploader: fake });
  assert(handler.imageUploader === fake, 'expected injected uploader to be exposed');
});

// ============================================================
// Summary
// ============================================================

console.log('\n' + '='.repeat(50));
console.log('Test Results for interactive-mode image display (#1843):');
console.log(`  ✅ Passed: ${testsPassed}`);
console.log(`  ❌ Failed: ${testsFailed}`);
console.log('='.repeat(50));

process.exit(testsFailed > 0 ? 1 : 0);
