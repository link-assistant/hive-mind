#!/usr/bin/env node
/**
 * Issue #2837: `--verbose` turned on SDK/CLI debug logging (Codex
 * `RUST_LOG=debug`, Claude `ANTHROPIC_LOG=debug`). That output carries the
 * operator's account e-mail, account UUID, organization and workspace IDs on
 * nearly every line, and the publication sanitizer let all of them through —
 * router#719 published 1,273 copies of the ChatGPT e-mail and account UUID,
 * web-capture#178 published `anthropic-organization-id` /
 * `anthropic-workspace-id` on every request.
 *
 * Covered here:
 *   1. the sanitizer core redacts identity fields in the real log shapes
 *      (codex_otel lines, Anthropic SDK header dumps in JS/JSON/escaped/raw form),
 *      idempotently, and leaves neighbouring diagnostics intact;
 *   2. the authenticated account's own identifiers (from the Codex `auth.json`
 *      and Claude `.claude.json`) are redacted wherever they appear in a
 *      published log, and the publication boundary verifies it;
 *   3. debug tracing is a separate opt-in (`--codex-debug`, `--anthropic-debug`),
 *      no longer implied by `--verbose`.
 *
 * Run with: node tests/issue-2837-account-identity-redaction.test.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findCredentialResiduals, sanitizeAccountIdentityFields, sanitizeCredentialText } from '../src/credential-sanitization-core.lib.mjs';
import { extractClaudeIdentityValues, extractCodexIdentityValues, getAccountIdentityValues, resetAccountIdentityCache } from '../src/account-identity.lib.mjs';
import { applyAnthropicDebugEnv, getCodexExecEnv } from '../src/tool-debug-env.lib.mjs';
import { parseCodexDiagnosticLine } from '../src/codex.diagnostics.lib.mjs';
import { createCodexTokenUsage } from '../src/codex.lib.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`❌ ${name}: ${error.message}`);
    failed++;
  }
}

const EMAIL = 'operator.person@example.com';
const ACCOUNT_ID = 'e9c72023-174b-4cfd-8374-963550c2ef98';
const ORG_ID = 'ebc2ac93-f86f-4d15-aff3-de8830d8d789';
const WORKSPACE_ID = 'wrkspc_0117gBnPr68DBsCrmom3Bxq6';

const sanitize = text => sanitizeCredentialText(text, { includeEnvironmentCredentials: false });
const assertNoIdentity = text => {
  for (const value of [EMAIL, ACCOUNT_ID, ORG_ID, WORKSPACE_ID]) assert.ok(!text.includes(value), `${value} survived in ${JSON.stringify(text)}`);
};

// Shapes copied from the published logs of router#719 (Codex 0.x, hive-mind 2.34.0).
const CODEX_OTEL_FIXTURES = [`2026-10-01T10:00:00.000000Z  INFO app_server.request{otel.name="thread/start"}: codex_otel.log_only: event.name="codex.conversation_starts" event.timestamp=2026-10-01T10:00:00.000Z conversation.id=019fb331 app.version=0.130.0 auth_mode="Chatgpt" originator=codex_exec user.account_id="${ACCOUNT_ID}" user.email="${EMAIL}" terminal.type=unknown model=gpt-5.5`, `2026-10-01T10:00:01.000000Z  INFO codex_otel.trace_safe: event.name="codex.api_request" endpoint="/responses/compact" http.response.status_code=200 user.account_id=${ACCOUNT_ID} user.email=${EMAIL} attempt=1`];

// Shapes copied from web-capture#178 (`ANTHROPIC_LOG=debug`, Claude Code 2.x).
const ANTHROPIC_HEADER_FIXTURES = [`[log_8c1f2e] response 200 https://api.anthropic.com/v1/messages?beta=true Headers {\n  'anthropic-organization-id': '${ORG_ID}',\n  'anthropic-ratelimit-unified-5h-utilization': '0.42',\n  'anthropic-workspace-id': '${WORKSPACE_ID}',\n  'request-id': 'req_011CU'\n}`, `{"anthropic-organization-id": "${ORG_ID}", "anthropic-workspace-id": "${WORKSPACE_ID}", "anthropic-ratelimit-unified-7d-utilization": "0.10"}`, `{\\"anthropic-organization-id\\": \\"${ORG_ID}\\", \\"anthropic-workspace-id\\": \\"${WORKSPACE_ID}\\"}`, `anthropic-organization-id: ${ORG_ID}\r\nanthropic-workspace-id: "${WORKSPACE_ID}"\r\nanthropic-ratelimit-unified-status: allowed`];

for (const fixture of [...CODEX_OTEL_FIXTURES, ...ANTHROPIC_HEADER_FIXTURES]) {
  await test(`identity fields are redacted: ${fixture.slice(0, 70).replace(/\s+/g, ' ')}…`, () => {
    const output = sanitize(fixture);
    assertNoIdentity(output);
    assert.ok(output.includes('[REDACTED]'));
    assert.equal(sanitize(output), output, 'a second pass must not change the text');
    assert.deepEqual(findCredentialResiduals(output), []);
  });
}

await test('neighbouring diagnostics survive redaction', () => {
  const codex = sanitize(CODEX_OTEL_FIXTURES[0]);
  assert.match(codex, /event\.name="codex\.conversation_starts"/);
  assert.match(codex, /user\.email="\[REDACTED\]"/);
  assert.match(codex, /user\.account_id="\[REDACTED\]"/);
  assert.match(codex, /model=gpt-5\.5/);
  const anthropic = sanitize(ANTHROPIC_HEADER_FIXTURES[0]);
  assert.match(anthropic, /'anthropic-ratelimit-unified-5h-utilization': '0\.42'/);
  assert.match(anthropic, /'request-id': 'req_011CU'/);
});

await test('codex compaction detection still works on a redacted line', () => {
  const usage = createCodexTokenUsage('gpt-5.5');
  parseCodexDiagnosticLine(sanitize(CODEX_OTEL_FIXTURES[1].replace('codex_otel.trace_safe', 'codex_otel.log_only')), usage);
  assert.equal(usage.compactifications.length, 1);
});

await test('git configuration lines and unrelated e-mail fields are left alone', () => {
  for (const text of ['git config user.email "someone@example.com"', 'Author: Someone <someone@example.com>', 'user.email', '{"email_verified": true}']) {
    assert.equal(sanitizeAccountIdentityFields(text), text);
  }
});

const makeJwt = payload => `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;
const CODEX_AUTH = {
  OPENAI_API_KEY: null,
  tokens: {
    id_token: makeJwt({ email: EMAIL, 'https://api.openai.com/auth': { chatgpt_account_id: ACCOUNT_ID, chatgpt_user_id: 'user-AbCdEfGhIjKlMnOp', organizations: [{ id: 'org-QrStUvWxYz012345' }] } }),
    access_token: 'not-a-jwt',
    account_id: ACCOUNT_ID,
  },
};
const CLAUDE_CONFIG = { oauthAccount: { accountUuid: '11111111-2222-3333-4444-555555555555', emailAddress: EMAIL, organizationUuid: ORG_ID }, projects: {} };

await test('identity values are extracted from Codex auth.json and Claude .claude.json', () => {
  const codex = extractCodexIdentityValues(CODEX_AUTH).map(entry => entry.value);
  assert.ok(codex.includes(EMAIL));
  assert.ok(codex.includes(ACCOUNT_ID));
  assert.ok(codex.includes('user-AbCdEfGhIjKlMnOp'));
  assert.ok(codex.includes('org-QrStUvWxYz012345'));
  assert.ok(!codex.includes('not-a-jwt'), 'credentials are not identity values');
  assert.deepEqual(
    extractClaudeIdentityValues(CLAUDE_CONFIG).map(entry => entry.value),
    [EMAIL, '11111111-2222-3333-4444-555555555555', ORG_ID]
  );
  assert.deepEqual(extractCodexIdentityValues(null), []);
  assert.deepEqual(extractClaudeIdentityValues({}), []);
});

const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'issue-2837-'));
const savedEnv = { HOME: process.env.HOME, CODEX_HOME: process.env.CODEX_HOME, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR, HIVE_MIND_PARENT_CODEX_HOME: process.env.HIVE_MIND_PARENT_CODEX_HOME };
try {
  await fs.mkdir(path.join(tempHome, '.codex'));
  await fs.writeFile(path.join(tempHome, '.codex', 'auth.json'), JSON.stringify(CODEX_AUTH));
  await fs.writeFile(path.join(tempHome, '.claude.json'), JSON.stringify(CLAUDE_CONFIG));
  process.env.HOME = tempHome;
  delete process.env.CODEX_HOME;
  delete process.env.CLAUDE_CONFIG_DIR;
  delete process.env.HIVE_MIND_PARENT_CODEX_HOME;
  resetAccountIdentityCache();

  await test('identity values are read from the auth files and re-read after a change', async () => {
    const first = (await getAccountIdentityValues({ homeDir: tempHome, env: {} })).map(entry => entry.value);
    assert.ok(first.includes(EMAIL) && first.includes(ORG_ID));
    const changed = { oauthAccount: { emailAddress: 'second.person@example.com' } };
    await fs.writeFile(path.join(tempHome, '.claude.json'), JSON.stringify(changed) + ' '.repeat(64));
    const second = (await getAccountIdentityValues({ homeDir: tempHome, env: {} })).map(entry => entry.value);
    assert.ok(second.includes('second.person@example.com'));
    await fs.writeFile(path.join(tempHome, '.claude.json'), JSON.stringify(CLAUDE_CONFIG));
  });

  const { sanitizeForPublication } = await import('../src/token-sanitization.lib.mjs');

  await test('publication redacts the account identity wherever it appears', async () => {
    const log = [...CODEX_OTEL_FIXTURES, ...ANTHROPIC_HEADER_FIXTURES, `Logged in as ${EMAIL} (organization ${ORG_ID})`, `{"account":{"email":"${EMAIL}","uuid":"${ACCOUNT_ID}"}}`].join('\n');
    const published = await sanitizeForPublication(log);
    assertNoIdentity(published);
    assert.match(published, /Logged in as \[REDACTED\] \(organization \[REDACTED\]\)/);
  });

  await test('the publication boundary blocks an identity value its sanitizer missed', async () => {
    await assert.rejects(sanitizeForPublication(`contact ${EMAIL}`, { scanner: async value => value }), error => error.stage === 'residual' && error.findings.some(finding => finding.ruleId.startsWith('account-identity:')));
  });
} finally {
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  resetAccountIdentityCache();
  await fs.rm(tempHome, { recursive: true, force: true });
}

await test('--verbose alone no longer enables Codex RUST_LOG=debug', () => {
  assert.equal(getCodexExecEnv(false, { PATH: '/bin' }).RUST_LOG, undefined);
  assert.equal(getCodexExecEnv(true, { PATH: '/bin' }).RUST_LOG, 'debug');
  assert.equal(getCodexExecEnv(false, { RUST_LOG: 'codex_core=info' }).RUST_LOG, 'codex_core=info', 'an operator-exported filter is inherited');
});

await test('--verbose alone no longer enables ANTHROPIC_LOG=debug', () => {
  assert.equal(applyAnthropicDebugEnv({}, { verbose: true }).ANTHROPIC_LOG, undefined);
  assert.equal(applyAnthropicDebugEnv({}, { verbose: true, anthropicDebug: true }).ANTHROPIC_LOG, 'debug');
});

await test('tool runners wire the debug env to the new options, not to --verbose', async () => {
  const claude = await fs.readFile(path.join(repoRoot, 'src/claude.lib.mjs'), 'utf8');
  const codex = await fs.readFile(path.join(repoRoot, 'src/codex.lib.mjs'), 'utf8');
  assert.doesNotMatch(claude, /argv\.verbose\)\s*claudeEnv\.ANTHROPIC_LOG/);
  assert.match(claude, /applyAnthropicDebugEnv\(claudeEnv, argv\)/);
  assert.doesNotMatch(codex, /getCodexExecEnv\((?:argv\.)?verbose\)/);
  assert.match(codex, /getCodexExecEnv\(argv\.codexDebug\)/);
  assert.doesNotMatch(codex, /RUST_LOG: 'debug'/);
});

await test('solve defines --codex-debug and --anthropic-debug, both off by default', async () => {
  const config = await fs.readFile(path.join(repoRoot, 'src/solve.config.lib.mjs'), 'utf8');
  for (const name of ['codex-debug', 'anthropic-debug']) {
    assert.match(config, new RegExp(`'${name}': \\{\\n\\s+type: 'boolean',[\\s\\S]*?default: false,`));
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
