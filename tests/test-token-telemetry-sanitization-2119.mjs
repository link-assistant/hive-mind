#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for issue #2119.
 *
 * The credential sanitizer treated every key containing the substring "token"
 * as a credential name. Because its unquoted-value pattern also accepted the
 * JSON structural opener `{`, the agent telemetry record
 *
 *   "tokens": {
 *     "input": 21677,
 *
 * was published as `"tokens": [REDACTED]`, which truncated the object, made the
 * record unparseable and destroyed token/cost accounting in the uploaded logs.
 *
 * Evidence: docs/case-studies/issue-2119/data/logs/agent-scala-solution-draft.log
 *
 * The exemption must stay narrow: only a counter-shaped key with a purely
 * numeric value is telemetry. Real credentials, including numeric ones under
 * singular credential names, must still be masked.
 */

import assert from 'node:assert/strict';

import { sanitizeCredentialText } from '../src/credential-sanitization-core.lib.mjs';

const sanitize = text => sanitizeCredentialText(text, { includeEnvironmentCredentials: false });

// A JSON structural opener is punctuation, never a secret.
for (const opener of ['{', '[']) {
  const record = `  "tokens": ${opener}`;
  assert.equal(sanitize(record), record, `structural opener must survive sanitization: ${record}`);
}

// The exact record shape emitted by the agent CLI must round-trip through the
// sanitizer and still parse as JSON.
const telemetryRecord = JSON.stringify(
  {
    type: 'step_finish',
    sessionID: 'ses_04c9fe206ffeSfRyxn0SRerDHe',
    part: {
      type: 'step-finish',
      reason: 'tool-calls',
      cost: 0,
      tokens: { input: 21677, output: 22834, reasoning: 0, cache: { read: 0, write: 0 } },
      model: { providerID: 'formalai', requestedModelID: 'formal-ai', respondedModelID: 'formal-ai' },
      context: { contextLimit: 60000, outputLimit: 8192, currentTokens: 38856, headroom: -5655 },
    },
  },
  null,
  2
);

const sanitizedRecord = sanitize(telemetryRecord);
assert.equal(sanitizedRecord, telemetryRecord, 'token telemetry must not be rewritten by the sanitizer');
const reparsed = JSON.parse(sanitizedRecord);
assert.equal(reparsed.part.tokens.input, 21677, 'input token count must survive sanitization');
assert.equal(reparsed.part.tokens.output, 22834, 'output token count must survive sanitization');
assert.equal(reparsed.part.context.currentTokens, 38856, 'context counter must survive sanitization');

// Counter-shaped keys from every provider dialect we consume.
const counterAssignments = ['"prompt_tokens": 1234', '"completion_tokens": 5', '"total_tokens":44511', '"cache_read_input_tokens": 0', '"inputTokens": 21677', '"maxTokens": 8192', '"token_count": 17', '"tokenLimit": 60000', 'tokens=44511'];
for (const assignment of counterAssignments) {
  assert.equal(sanitize(assignment), assignment, `token counter must survive sanitization: ${assignment}`);
}

// Real credentials must still be masked, including numeric ones and values
// that merely contain a brace.
const mustBeMasked = [
  ['access_token=abcdef1234567890abcdef', 'abcdef1234567890abcdef'],
  ['"access_token": "abcdef1234567890abcdef"', 'abcdef1234567890abcdef'],
  ['token=123456', '123456'],
  ['password=1234', '1234'],
  ['"tokens": "sk-secretvalue1234567890"', 'sk-secretvalue1234567890'],
  ['password=ab{cdefghijklmnop', 'ab{cdefghijklmnop'],
  ['"api_key": "AKIAIOSFODNN7EXAMPLE"', 'AKIAIOSFODNN7EXAMPLE'],
];
for (const [input, secret] of mustBeMasked) {
  const output = sanitize(input);
  assert.ok(!output.includes(secret), `credential survived sanitization: ${input}`);
}

// Sanitization stays idempotent for telemetry.
assert.equal(sanitize(sanitize(telemetryRecord)), telemetryRecord, 'sanitization must be idempotent');

console.log('✅ issue #2119: token telemetry survives credential sanitization');
