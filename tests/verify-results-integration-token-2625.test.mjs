/**
 * Regression coverage for issue #2625 (E2E claude / formal-ai, run 37616874265).
 *
 * With the default GITHUB_TOKEN layer, `gh api user` returns HTTP 403
 * "Resource not accessible by integration". verifyResults threw on it and the
 * catch block printed "⚠️  Could not verify results:" with an empty reason,
 * because the message was passed as log()'s options argument.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2625
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { isCommentByCurrentIdentity, isIntegrationForbidden } from '../src/github-identity.lib.mjs';

const stderr = '{"message":"Resource not accessible by integration","status":"403"}gh: Resource not accessible by integration (HTTP 403)';
assert.equal(isIntegrationForbidden(stderr), true);
assert.equal(isIntegrationForbidden('gh: Bad credentials (HTTP 401)'), false);
assert.equal(isIntegrationForbidden(undefined), false);

const botComment = { user: { login: 'github-actions[bot]' }, performed_via_github_app: { slug: 'github-actions' } };
const humanComment = { user: { login: 'konard' }, performed_via_github_app: null };
assert.equal(isCommentByCurrentIdentity(humanComment, 'konard'), true);
assert.equal(isCommentByCurrentIdentity(botComment, 'konard'), false);
assert.equal(isCommentByCurrentIdentity(botComment, null), true);
assert.equal(isCommentByCurrentIdentity(humanComment, null), false);

const source = await readFile(new URL('../src/solve.results.lib.mjs', import.meta.url), 'utf8');
// The reason must be part of the message, never log()'s options argument.
assert.doesNotMatch(source, /log\('\\n⚠️ {2}Could not verify results:',/);
assert.match(source, /Could not verify results: \$\{searchError\.message\}/);
// An integration token must not abort verification.
assert.match(source, /isIntegrationForbidden\(/);
assert.match(source, /isCommentByCurrentIdentity\(comment, currentUser\)/);

console.log('verify-results integration token regression: ok');
