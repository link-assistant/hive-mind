#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Issue #3739: regression tests for the sanitization part of closed issues
 * that had no test of their own. Each case names the issue it pins, and runs
 * the current publication path (the sensitive-data-sanitizer migration
 * replaced several of the original code paths; where it did, the case tests
 * the current equivalent and says so).
 *
 * Every secret below is synthetic and assembled at runtime.
 *
 * Run with: node tests/issue-3739-closed-sanitization-regressions.test.mjs
 */

import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import { chmodSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// #66: `gh auth token` is a known secret. The sanitizer runs that command once
// per process and caches the answer, so a fake `gh` must be on PATH before the
// first sanitize call. GH_CONFIG_DIR points at an empty directory so no real
// hosts.yml token takes part.
const GH_AUTH_TOKEN = ['Kq7v', 'Rt2mWx9pLz4n', 'Bc8dFh3jYs6g', 'Tu1eQa5o'].join(''); // opaque, no vendor prefix
const fakeGhDirectory = mkdtempSync(join(tmpdir(), 'hive-3739-fake-gh-'));
const emptyGhConfig = mkdtempSync(join(tmpdir(), 'hive-3739-gh-config-'));
writeFileSync(join(fakeGhDirectory, 'gh'), `#!/bin/sh\nif [ "$1" = auth ] && [ "$2" = token ]; then echo '${GH_AUTH_TOKEN}'; exit 0; fi\nexit 1\n`);
chmodSync(join(fakeGhDirectory, 'gh'), 0o755);
process.env.PATH = `${fakeGhDirectory}:${process.env.PATH}`;
process.env.GH_CONFIG_DIR = emptyGhConfig;

const { describeCredentialSanitizationFailure, sanitizeForPublication } = await import('../src/token-sanitization.lib.mjs');
const { sanitizeLogFileToFileBounded } = await import('../src/log-sanitize-worker.lib.mjs');
const { sanitizeLogFileToFile } = await import('../src/log-sanitize-stream.lib.mjs');
const { uploadLogWithGhUploadLog } = await import('../src/log-upload.lib.mjs');
const { isENOSPC } = await import('../src/lib.mjs');
const { buildUpdateErrorMessage } = await import('../src/telegram-update-error.lib.mjs');
const { sanitizeSentryValue } = await import('../src/instrument.sanitize.lib.mjs');
const { repairPullRequestBodyLinks } = await import('../src/pr-image-link-repair.lib.mjs');
const { readCredentials, readCodexAuth } = await import('../src/limits.lib.mjs');

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

const GHO_TOKEN = ['gho_', 'Ab3Cd5Ef7Gh9Ij1Kl3Mn', '5Op7Qr9St1Uv3Wx5Yz'].join('');
const GHP_TOKEN = ['ghp_', 'Zx9Qw7Er5Ty3Ui1Op0As', '2Df4Gh6Jk8Lz0Xc2Vb4N'].join('');
const mask = value => `${value.slice(0, 3)}…${value.slice(-3)}`;
const workDirectory = mkdtempSync(join(tmpdir(), 'hive-3739-closed-'));
const quietConsole = async (fn, sink = []) => {
  const saved = { log: console.log, error: console.error, warn: console.warn };
  console.log = console.error = console.warn = (...args) => sink.push(args.map(String).join(' '));
  try {
    return await fn(sink);
  } finally {
    Object.assign(console, saved);
  }
};

await test('#66: an --attach-logs log keeps gho_/ghp_ and the exact `gh auth token` value out of the sanitized file, masked as abc…xyz', async () => {
  const sourcePath = join(workDirectory, 'attach-logs.log');
  const destPath = join(workDirectory, 'attach-logs.sanitized.log');
  writeFileSync(sourcePath, [`[2026-01-01T00:00:00Z] gh auth status -> Token: ${GHO_TOKEN}`, `git remote set-url origin https://x-access-token:${GHP_TOKEN}@github.com/o/r.git`, `GITHUB_TOKEN value seen in output: ${GH_AUTH_TOKEN}`, ''].join('\n'));
  await sanitizeLogFileToFileBounded({ sourcePath, destPath });
  const sanitized = await fsPromises.readFile(destPath, 'utf8');
  for (const secret of [GHO_TOKEN, GHP_TOKEN, GH_AUTH_TOKEN]) {
    assert.ok(!sanitized.includes(secret), `${secret.slice(0, 4)} leaked: ${sanitized}`);
    assert.ok(sanitized.includes(mask(secret)), `expected ${mask(secret)} in ${sanitized}`);
  }
  // The publication boundary used for descriptions and comments agrees.
  const comment = await sanitizeForPublication(`token ${GH_AUTH_TOKEN} and ${GHO_TOKEN}`);
  assert.equal(comment, `token ${mask(GH_AUTH_TOKEN)} and ${mask(GHO_TOKEN)}`);
});

// #580 (PR #581) added redaction to the Telegram bot's error reply and its
// Sentry reports. The reply now lives in telegram-update-error.lib.mjs and the
// Sentry hook in instrument.sanitize.lib.mjs.
await test('#580: a token inside an error is masked in the Telegram error reply', async () => {
  const error = new Error(`git push failed: https://x-access-token:${GHP_TOKEN}@github.com/o/r.git`);
  const reply = buildUpdateErrorMessage(error, { update: { update_id: 1 } }, { logger: { error() {} } });
  assert.ok(!reply.includes(GHP_TOKEN), reply);
  assert.ok(reply.includes('Details:'), reply);
  assert.ok(reply.includes(mask(GHP_TOKEN)), reply);
});

await test('#580: a token inside an error is masked in the Sentry event', async () => {
  const event = { message: `request failed with ${GHO_TOKEN}`, exception: { values: [{ type: 'Error', value: `Authorization: token ${GHP_TOKEN}` }] }, extra: { stderr: `fatal: ${GHO_TOKEN}` } };
  sanitizeSentryValue(event);
  const serialized = JSON.stringify(event);
  assert.ok(!serialized.includes(GHO_TOKEN) && !serialized.includes(GHP_TOKEN), serialized);
  assert.ok(event.exception.values[0].value.startsWith('Authorization: token '), event.exception.values[0].value);
});

await test('#1076: CLAUDE_CODE_MAX_OUTPUT_TOKENS and MAX_THINKING_TOKENS are not masked (was CLAUD*******************OKENS)', async () => {
  const text = 'export CLAUDE_CODE_MAX_OUTPUT_TOKENS=32000\nMAX_THINKING_TOKENS=31999\nenv: { CLAUDE_CODE_MAX_OUTPUT_TOKENS: "64000", MAX_THINKING_TOKENS: "0" }\n';
  assert.equal(await sanitizeForPublication(text), text);
});

await test('#1088: 40-hex SHAs, UUIDs, npm names with "token", --token-limit and an already-masked gho…999 are not masked', async () => {
  const sha = 'b3f1c9e07a2d4c6b8e5f0a1d2c3b4a5968778695';
  const text = [`commit ${sha}`, `https://github.com/o/r/commit/${sha}`, 'session 123e4567-e89b-12d3-a456-426614174000', 'npm install @octokit/auth-token js-tokens tokenizers', 'claude --token-limit 32000', 'token: gho…999', ''].join('\n');
  assert.equal(await sanitizeForPublication(text), text);
});

await test('#1212: ENOSPC during the streamed sanitize fails closed and leaves no sanitized file', async () => {
  const sourcePath = join(workDirectory, 'enospc.log');
  const destPath = join(workDirectory, 'enospc.sanitized.log');
  writeFileSync(sourcePath, `line with ${GHP_TOKEN}\n`);
  const fsImpl = {
    ...fsPromises,
    async open(file, flags, mode) {
      const handle = await fsPromises.open(file, flags, mode);
      if (file !== destPath) return handle;
      return {
        write: async () => {
          throw Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' });
        },
        chmod: mode => handle.chmod(mode),
        close: () => handle.close(),
      };
    },
  };
  const error = await sanitizeLogFileToFile({ sourcePath, destPath, fsImpl }).then(
    () => null,
    caught => caught
  );
  assert.ok(error, 'the sanitize must fail');
  assert.ok(isENOSPC(error), String(error));
  assert.ok(!existsSync(destPath), 'a partly written sanitized file must be removed');
  assert.match(describeCredentialSanitizationFailure(error), /no space left on device/i);
});

await test('#1212: ENOSPC during the --attach-logs sanitize uploads nothing and the failure reason names disk space', async () => {
  const logFile = join(workDirectory, 'upload-enospc.log');
  writeFileSync(logFile, `upload ${GHO_TOKEN}\n`);
  const uploads = [];
  const privateBefore = new Set(readdirSync(tmpdir()).filter(name => name.startsWith('hive-mind-log-upload-')));
  const originalOpen = fsPromises.open;
  // uploadLogWithGhUploadLog has no fs injection point; fail only the write to
  // its private sanitized.log.
  fsPromises.open = async (file, flags, mode) => {
    const handle = await originalOpen(file, flags, mode);
    if (!String(file).endsWith('sanitized.log') || flags !== 'wx') return handle;
    return {
      write: async () => {
        throw Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' });
      },
      chmod: m => handle.chmod(m),
      close: () => handle.close(),
    };
  };
  let result;
  try {
    result = await quietConsole(() => uploadLogWithGhUploadLog({ logFile, isPublic: false, description: 'log', runUpload: async args => uploads.push(args), sleep: async () => {} }));
  } finally {
    fsPromises.open = originalOpen;
  }
  assert.equal(uploads.length, 0, 'nothing may be uploaded');
  assert.equal(result.success, false);
  assert.ok(isENOSPC(result.failureReason), result.failureReason);
  assert.match(result.failureReason, /no space left on device/i);
  assert.match(result.failureReason, /free disk space and retry/i, 'the comment carries the actionable advice');
  assert.ok(!result.failureReason.includes(GHO_TOKEN));
  const leftover = readdirSync(tmpdir()).filter(name => name.startsWith('hive-mind-log-upload-') && !privateBefore.has(name));
  assert.deepEqual(leftover, [], 'the private sanitized copy must be removed');
});

const makeFakeDollar = scripted => {
  const calls = [];
  const dispatch = (rawArgs, values, options) => {
    const raw = String.raw({ raw: rawArgs }, ...values.map(value => String(value)));
    calls.push({ raw, options });
    const handler = scripted.find(entry => entry.match.test(raw));
    if (!handler) return Promise.resolve({ code: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' });
    return Promise.resolve(handler.respond);
  };
  const $ = (...args) => {
    if (Array.isArray(args[0]) && args[0].raw) return dispatch(args[0].raw, args.slice(1), {});
    const options = args[0] || {};
    return (rawArgs, ...values) => dispatch(rawArgs.raw, values, options);
  };
  $.calls = calls;
  return $;
};

await test('#2239: a credential in the PR image-link repair PATCH payload is masked before the request', async () => {
  const body = ['![shot](https://github.com/base/repo/blob/feature/docs/shot.png?raw=true)', '', `Debug: GITHUB_TOKEN=${GHP_TOKEN}`].join('\n');
  const $ = makeFakeDollar([
    { match: /repos\/base\/repo\/pulls\/7$/, respond: { code: 0, stdout: JSON.stringify({ body, head: { ref: 'feature', sha: 'a'.repeat(40), repo: { full_name: 'fork/repo' } }, base: { ref: 'main' } }), stderr: '' } },
    { match: /repos\/fork\/repo\/contents\/docs\/shot\.png\?ref=feature/, respond: { code: 0, stdout: 'abc123\n', stderr: '' } },
    { match: /pulls\/7 -X PATCH --input -/, respond: { code: 0, stdout: '{}', stderr: '' } },
  ]);
  const stats = await repairPullRequestBodyLinks({ $, owner: 'base', repo: 'repo', prNumber: 7 });
  assert.equal(stats.edited, 1, JSON.stringify(stats));
  const edit = $.calls.find(call => /pulls\/7 -X PATCH/.test(call.raw));
  assert.ok(!edit.options.stdin.includes(GHP_TOKEN), edit.options.stdin);
  const sent = JSON.parse(edit.options.stdin).body;
  assert.ok(sent.includes('https://github.com/fork/repo/blob/feature/docs/shot.png?raw=true'), sent);
  assert.ok(sent.includes(`GITHUB_TOKEN=${mask(GHP_TOKEN)}`), sent);
});

// #3785 (PR #3786): the /limits verbose diagnostics print only the error name,
// never the error message, because a JSON.parse message quotes the start of
// the credential file it failed on (for example a bare token written where
// JSON was expected).
await test('#3785: /limits credential diagnostics never print the credential file contents', async () => {
  const claudePath = join(workDirectory, '.credentials.json');
  const codexPath = join(workDirectory, 'auth.json');
  writeFileSync(claudePath, `${GHO_TOKEN}\n`);
  writeFileSync(codexPath, `${GHP_TOKEN}\n`);
  const prefix = token => token.slice(0, 10);
  assert.throws(
    () => JSON.parse(`${GHO_TOKEN}\n`),
    error => error.message.includes(prefix(GHO_TOKEN)),
    'precondition: the parse message quotes the token'
  );
  const saved = { claude: process.env.HIVE_MIND_CLAUDE_AUTH_IDENTITY, codexHome: process.env.CODEX_AUTH_HOME, codexIdentity: process.env.HIVE_MIND_CODEX_AUTH_IDENTITY };
  delete process.env.HIVE_MIND_CLAUDE_AUTH_IDENTITY;
  delete process.env.CODEX_AUTH_HOME;
  delete process.env.HIVE_MIND_CODEX_AUTH_IDENTITY;
  try {
    const lines = await quietConsole(async sink => {
      assert.equal(await readCredentials(claudePath, true), null);
      assert.equal(await readCodexAuth(codexPath, true), null);
      return sink;
    });
    const output = lines.join('\n');
    assert.match(output, /failed to read credentials: SyntaxError/);
    assert.match(output, /failed to read Codex auth: SyntaxError/);
    assert.ok(!output.includes(prefix(GHO_TOKEN)) && !output.includes(prefix(GHP_TOKEN)), output);
  } finally {
    for (const [name, value] of Object.entries({ HIVE_MIND_CLAUDE_AUTH_IDENTITY: saved.claude, CODEX_AUTH_HOME: saved.codexHome, HIVE_MIND_CODEX_AUTH_IDENTITY: saved.codexIdentity })) {
      if (value !== undefined) process.env[name] = value;
    }
  }
});

await test('#4043: Playwright --secrets help text, ${{ secrets.GITHUB_TOKEN }} and --password <value> stay byte-for-byte; a real --password value is masked', async () => {
  // Published as `--secrets [REDACTED]` on #2347 and #2348 (2026-09-30).
  const text = '  --secrets <path>                      path to a file containing secrets in the\n                                        dotenv format\n  --password <value>\n  token: ${{ secrets.GITHUB_TOKEN }}\n';
  assert.equal(await sanitizeForPublication(text), text);
  const value = ['Xy7q', 'L9mN2v', 'B4tR8k'].join('');
  for (const command of [`mysql --password ${value}`, `mysql --password=${value}`]) {
    const output = await sanitizeForPublication(command);
    assert.ok(!output.includes(value), `${command} keeps the real value`);
    assert.ok(output.includes('Xy7…R8k'), output);
  }
});

rmSync(workDirectory, { recursive: true, force: true });
rmSync(fakeGhDirectory, { recursive: true, force: true });
rmSync(emptyGhConfig, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
