/**
 * @hive-mind-test-suite default
 *
 * Regression tests for scripts/recheck-broken-links.mjs. On main (run
 * 37005554914) every one of lychee's 32 errors was a github.com
 * `503 Service Unavailable` for a healthy URL, so the Broken Link Checker
 * went red on a false positive. Transient answers (429, 5xx, connection
 * errors) must be re-checked; definite answers (404, missing file) must not.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2423
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { classifyBrokenLinks, existsViaGithubApi, githubContentsApiUrl, isTransientStatus, recheckUrl } from '../scripts/recheck-broken-links.mjs';

const report = `# Summary

## Errors per input

### Errors in docs/FREE_MODELS.md

* [503] <https://github.com/link-assistant/agent/blob/main/FREE_MODELS.md> | Rejected status code: 503 Service Unavailable
* [503] <https://github.com/link-assistant/hive-mind/blob/main/LICENSE> | Error (cached)
* [429] <https://example.net/rate> | Too Many Requests
* [ERROR] <https://example.net/reset> | Connection reset
* [404] <https://example.net/gone> | Not Found
* [ERROR] <file:///repo/missing.md> | File not found

## Redirects per input

* [503] <https://example.net/not-an-error>
`;

const response = status => ({ status, ok: status >= 200 && status < 300 });

describe('isTransientStatus', () => {
  it('treats 429, 5xx, ERROR and TIMEOUT as transient', () => {
    for (const s of ['429', '500', '503', 'ERROR', 'TIMEOUT']) assert.ok(isTransientStatus(s), s);
    for (const s of ['400', '403', '404', 'UNKNOWN']) assert.ok(!isTransientStatus(s), s);
  });
});

describe('classifyBrokenLinks', () => {
  it('separates transient http failures from definite ones', () => {
    const { transient, final } = classifyBrokenLinks(report);
    assert.deepEqual(transient, ['https://github.com/link-assistant/agent/blob/main/FREE_MODELS.md', 'https://github.com/link-assistant/hive-mind/blob/main/LICENSE', 'https://example.net/rate', 'https://example.net/reset']);
    assert.deepEqual(final, ['https://example.net/gone', 'file:///repo/missing.md']);
  });

  it('keeps a URL broken when any entry for it failed definitively', () => {
    const { transient, final } = classifyBrokenLinks('* [503] <https://a.test/x>\n* [404] <https://a.test/x>\n');
    assert.deepEqual(transient, []);
    assert.deepEqual(final, ['https://a.test/x']);
  });
});

describe('recheckUrl', () => {
  it('recovers a URL that answers 200 after a 503', async () => {
    const answers = [503, 200];
    const result = await recheckUrl('https://a.test', [0, 0], async () => response(answers.shift()));
    assert.deepEqual(result, { ok: true, status: '200' });
  });

  it('stops at a definite 404', async () => {
    let calls = 0;
    const result = await recheckUrl('https://a.test', [0, 0], async () => (calls++, response(404)));
    assert.deepEqual(result, { ok: false, status: '404' });
    assert.equal(calls, 1);
  });

  it('gives up after the last retry and retries thrown errors', async () => {
    let calls = 0;
    const result = await recheckUrl('https://a.test', [0, 0], async () => {
      calls++;
      throw new Error('ECONNRESET');
    });
    assert.deepEqual(result, { ok: false, status: 'ERROR' });
    assert.equal(calls, 3);
  });
});

describe('GitHub contents API fallback', () => {
  it('maps blob and tree pages to the contents endpoint', () => {
    assert.equal(githubContentsApiUrl('https://github.com/google-gemini/gemini-cli/blob/main/packages/cli/src/validateNonInterActiveAuth.ts'), 'https://api.github.com/repos/google-gemini/gemini-cli/contents/packages/cli/src/validateNonInterActiveAuth.ts?ref=main');
    assert.equal(githubContentsApiUrl('https://github.com/o/r/tree/v1/docs#x'), 'https://api.github.com/repos/o/r/contents/docs?ref=v1');
    assert.equal(githubContentsApiUrl('https://github.com/o/r/issues/1'), null);
  });

  it('reports existence from the API status', async () => {
    assert.equal(await existsViaGithubApi('https://github.com/o/r/blob/main/a.md', async () => response(200)), true);
    assert.equal(await existsViaGithubApi('https://github.com/o/r/blob/main/a.md', async () => response(404)), false);
    assert.equal(await existsViaGithubApi('https://example.net/a', async () => response(200)), false);
  });
});
