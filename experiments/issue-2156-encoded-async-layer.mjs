#!/usr/bin/env node
/**
 * Issue #2156 — manual probe for the async sanitization layer.
 *
 * Reproduces the shape that leaked: a GHCR token-exchange response body that
 * echoes the supplied PAT back base64-encoded, embedded in an agent tool result
 * where every quote is backslash-escaped.
 *
 * SYNTHETIC TOKEN ONLY. The real leaked value is never written to this repo.
 */
const SYNTHETIC = 'gho_' + 'A'.repeat(12) + 'SyntheticNotReal' + '9'.repeat(8);
const encoded = Buffer.from(JSON.stringify({ token: SYNTHETIC })).toString('base64');
const logLine = `{"type":"tool_result","content":"token len ${SYNTHETIC.length}\\n{\\"token\\":\\"${encoded}\\"}\\n"}`;

process.env.GH_TOKEN = SYNTHETIC;

const { sanitizeCommentBody, containsKnownToken, sanitizeForPublication } = await import('../src/token-sanitization.lib.mjs');
const { sanitizeCredentialText } = await import('../src/credential-sanitization-core.lib.mjs');

const known = [{ source: 'gh-command', name: 'github', value: SYNTHETIC }];

console.log('--- input ---');
console.log(logLine);

const core = sanitizeCredentialText(logLine);
console.log('\n--- core (sync) ---');
console.log(core);
console.log('core leaks encoded?', core.includes(encoded));

const comment = await sanitizeCommentBody(logLine, { knownTokens: known });
console.log('\n--- sanitizeCommentBody ---');
console.log(comment);
console.log('comment leaks encoded?', comment.includes(encoded));

console.log('\n--- containsKnownToken ---');
console.log('on raw encoded:', JSON.stringify(await containsKnownToken(logLine, known)));
console.log('on sanitized  :', JSON.stringify(await containsKnownToken(comment, known)));

try {
  const published = await sanitizeForPublication(logLine);
  console.log('\n--- sanitizeForPublication ---');
  console.log(published);
  console.log('publication leaks encoded?', published.includes(encoded));
} catch (err) {
  console.log('\nsanitizeForPublication threw:', err.code || err.message);
}
