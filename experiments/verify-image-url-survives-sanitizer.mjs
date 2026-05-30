#!/usr/bin/env node
/**
 * Issue #1843 verification: confirm that the `?raw=true` blob URLs we embed for
 * interactive-mode images survive the token sanitizer (#1745) UNCHANGED.
 *
 * The image path is `media/pr-<n>/<sha256-prefix-16>.<ext>`. A 16-char hex
 * segment embedded in a URL must NOT be mistaken for a secret/commit hash and
 * masked — otherwise the rendered image link would break in real sessions
 * (mocked tests would not catch this because they bypass the real sanitizer).
 *
 * Run: node experiments/verify-image-url-survives-sanitizer.mjs
 */
import { sanitizeCommentBody } from '../src/token-sanitization.lib.mjs';
import { buildRawBlobUrl, createImageUploader, DEFAULT_MEDIA_BRANCH } from '../src/interactive-image-upload.lib.mjs';
import { createHash } from 'node:crypto';

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

// A realistic 16-char SHA-256 prefix (all-hex, worst case for the masker).
const fakeBase64 = Buffer.from('the quick brown fox jumps over the lazy dog').toString('base64');
const hash16 = createHash('sha256').update(fakeBase64).digest('hex').slice(0, 16);
const path = `media/pr-1844/${hash16}.png`;
const url = buildRawBlobUrl('link-assistant', 'hive-mind', DEFAULT_MEDIA_BRANCH, path);

console.log(`hash16 = ${hash16} (len ${hash16.length})`);
console.log(`url    = ${url}\n`);

// 1. The raw URL passes through unchanged.
const body1 = `### 🖼️ Images\n\n![screenshot.png](${url})\n`;
const out1 = await sanitizeCommentBody(body1, { skipActiveTokensOutputSanitization: true });
check('image-embed body is unchanged by sanitizer', out1 === body1, out1 === body1 ? 'identical' : `DIFF:\n${out1}`);

// 2. The URL substring still present (defensive: mask could rewrite part of it).
check('blob URL still intact in output', out1.includes(url));

// 3. Worst case: force an all-[a-f0-9] 16-char segment explicitly.
const url2 = buildRawBlobUrl('o', 'r', DEFAULT_MEDIA_BRANCH, 'media/pr-9/abcdef0123456789.png');
const body2 = `![](${url2})`;
const out2 = await sanitizeCommentBody(body2, { skipActiveTokensOutputSanitization: true });
check('all-hex 16-char segment in URL survives', out2 === body2, out2 === body2 ? 'identical' : `DIFF: ${out2}`);

// 4. Sanity: a REAL 40-char hex commit-shaped token still IS handled by the
//    sanitizer (proves the sanitizer is actually doing something — guards
//    against a false-positive "passes because sanitizer is a no-op").
const body3 = `loose token: ${'a'.repeat(40)}`;
const out3 = await sanitizeCommentBody(body3, { skipActiveTokensOutputSanitization: true });
check('40-char loose hex is masked (sanitizer is live)', out3 !== body3, out3 === body3 ? 'NOT masked (sanitizer inert?)' : `masked → ${out3}`);

// 5. End-to-end through the uploader with an injected gh stub: the URL it
//    returns is the same one we just proved survives.
const uploader = createImageUploader({
  owner: 'link-assistant',
  repo: 'hive-mind',
  prNumber: 1844,
  execFile: async (_cmd, args) => {
    // ensureBranch: ref lookup → pretend branch exists; contents PUT → ok
    if (args.includes('git/ref/heads/' + DEFAULT_MEDIA_BRANCH)) return { stdout: JSON.stringify({ ref: 'x' }) };
    return { stdout: JSON.stringify({ content: { sha: 'deadbeef' } }) };
  },
});
const producedUrl = await uploader.uploadImage({ base64: fakeBase64, mediaType: 'image/png', name: 'shot' });
const outProduced = await sanitizeCommentBody(`![](${producedUrl})`, { skipActiveTokensOutputSanitization: true });
check('uploader-produced URL survives sanitizer', outProduced === `![](${producedUrl})`, producedUrl || '(null)');

console.log(`\n${failures === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
