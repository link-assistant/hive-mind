#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Security regression coverage for issue #2111. Every generated output and
 * publication sink must use the same credential sanitizer, including values
 * that were not already present in the Hive Mind process environment.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { sanitizeCredentialText } from '../src/credential-sanitization-core.lib.mjs';
import { maskToken } from '../src/lib.mjs';
import { createCredentialStreamSanitizer, sanitizeForPublication, sanitizeOutput } from '../src/token-sanitization.lib.mjs';
import { collectAndCommitDevelopmentLogArtifacts, writeDevelopmentLogArtifacts } from '../src/development-log.lib.mjs';
import { installTelegramFormattingFallback } from '../src/telegram-safe-reply.lib.mjs';
import { uploadLogWithGhUploadLog } from '../src/log-upload.lib.mjs';

const assertSanitized = (output, secrets) => {
  for (const secret of secrets) {
    assert.ok(!output.includes(secret), `raw credential survived sanitization: ${secret.slice(0, 3)}…`);
  }
};

// Every published executable must install the terminal boundary. This guards
// future bins from silently bypassing child-output sanitization.
const packageManifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
for (const executablePath of Object.values(packageManifest.bin)) {
  const executableSource = await readFile(new URL(`../${executablePath.replace(/^\.\//, '')}`, import.meta.url), 'utf8');
  assert.match(executableSource, /setupStdioLogInterceptor\(\)/, `${executablePath} must install the shared stdio sanitizer`);
}

const runProcess = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => {
      stdout += chunk;
    });
    child.stderr.on('data', chunk => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', code => resolve({ code, stdout, stderr }));
  });

// Masking contract: longer than 12 preserves exactly 3+3; 12 or fewer is
// fully redacted.
assert.equal(maskToken('SYNTHETIC_PASSWORD_123456'), 'SYN…456');
assert.equal(maskToken('abcdefghijkl'), '[REDACTED]');
assert.equal(maskToken('abc123'), '[REDACTED]');

const clientSecret = 'GOCSPX-SYNTHETIC-EXAMPLE-123456789';
const bearer = 'ghp_SYNTHETIC_TOKEN_ABCDEF123456';
const databasePassword = 'SYNTHETIC_PASSWORD_123456';
const alpha = 'SYNTHETIC_TOKEN_ALPHA_123456';
const beta = 'SYNTHETIC_TOKEN_BETA_654321';

const acceptanceInput = ['unrelated-before', `GOOGLE_CLIENT_SECRET=${clientSecret}`, `Authorization: Bearer ${bearer}`, `DATABASE_URL=postgres://app:${databasePassword}@database.internal/app`, `A=${alpha} B=${beta}`, 'SHORT_PASSWORD=abc123', 'unrelated-after'].join('\n');
const acceptanceOutput = await sanitizeOutput(acceptanceInput);
assertSanitized(acceptanceOutput, [clientSecret, bearer, databasePassword, alpha, beta, 'abc123']);
assert.ok(acceptanceOutput.includes('GOOGLE_CLIENT_SECRET=GOC…789'));
assert.ok(acceptanceOutput.includes('Authorization: Bearer ghp…456'));
assert.ok(acceptanceOutput.includes('postgres://app:SYN…456@database.internal/app'));
assert.ok(acceptanceOutput.includes('A=SYN…456 B=SYN…321'), 'multiple credentials on one line must be independently masked');
assert.ok(acceptanceOutput.includes('SHORT_PASSWORD=[REDACTED]'));
assert.ok(acceptanceOutput.includes('unrelated-before'));
assert.ok(acceptanceOutput.includes('unrelated-after'));
assert.equal(sanitizeCredentialText('{"authorization":"Bearer opaque-authorization-secret"}'), '{"authorization":"Bea…ret"}');
assert.equal(sanitizeCredentialText('Authorization: Bearer ghp…456'), 'Authorization: Bearer ghp…456');
assert.equal(sanitizeCredentialText('SharedAccessSignature sr=namespace&sig=abcdefghijklmnopqrstuvwxyz123456&se=123456'), 'SharedAccessSignature sr=…456');
assert.equal(sanitizeCredentialText('Authorization: SharedAccessSignature sr=namespace&sig=abcdefghijklmnopqrstuvwxyz123456&se=123456'), 'Authorization: SharedAccessSignature sr=…456');
assert.equal(await sanitizeOutput(acceptanceOutput), acceptanceOutput, 'sanitization must be idempotent');

const slackBotFixture = [['xo', 'xb'].join(''), '123456789012', '123456789012', 'SYNTHETICSLACKTOKEN123456'].join('-');
const vendorSecrets = ['glpat-SYNTHETIC_GITLAB_TOKEN_123456', 'sk-proj-SYNTHETIC_OPENAI_TOKEN_123456', 'AKIASYNTHETIC1234567', slackBotFixture, 'xapp-SYNTHETICSLACKAPPTOKEN123456789012345', 'xwfp-SYNTHETICSLACKWORKFLOWTOKEN1234567890', 'SG.SYNTHETICABCDE.SYNTHETICSENDGRIDTOKEN123456789012345', 'npm_SYNTHETICPACKAGETOKEN1234567890', 'pypi-SYNTHETICPACKAGEUPLOADTOKEN123456789012345678901234567890', 'eyJzeW50aGV0aWMiOiJ0cnVlIn0.eyJzdWIiOiJ0ZXN0In0.SYNTHETICJWT_SIGNATURE_123456', '123456789:SYNTHETIC_TELEGRAM_BOT_TOKEN_123456789'];
const vendorOutput = await sanitizeOutput(vendorSecrets.join('\n'));
assertSanitized(vendorOutput, vendorSecrets);

const formatSecrets = {
  json: 'SYNTHETIC_JSON_SECRET_123456',
  yaml: 'SYNTHETIC_YAML_SECRET_123456',
  toml: 'SYNTHETIC_TOML_SECRET_123456',
  ini: 'SYNTHETIC_INI_SECRET_123456',
  xml: 'SYNTHETIC_XML_SECRET_123456',
  cookie: 'SYNTHETIC_COOKIE_SECRET_123456',
  cli: 'SYNTHETIC_CLI_SECRET_123456',
  query: 'SYNTHETIC_QUERY_SECRET_123456',
  docker: 'SYNTHETIC_DOCKER_AUTH_123456',
  azureSas: 'sv=2024-11-04&ss=b&srt=sco&sp=rwdlacupiytfx&sig=SYNTHETIC_AZURE_SAS_123456',
};
const structuredInput = [`{"client_secret":"${formatSecrets.json}","safe":"keep"}`, `password: '${formatSecrets.yaml}'`, `refresh_token = "${formatSecrets.toml}"`, `passwd=${formatSecrets.ini}`, `<private_key>${formatSecrets.xml}</private_key>`, `Set-Cookie: session=${formatSecrets.cookie}; HttpOnly`, `tool --api-key ${formatSecrets.cli} --safe value`, `https://example.test/callback?access_token=${formatSecrets.query}&page=2`, `{"auths":{"registry.example":{"auth":"${formatSecrets.docker}"}}}`, `SharedAccessSignature=${formatSecrets.azureSas}`].join('\n');
const structuredOutput = await sanitizeOutput(structuredInput);
assertSanitized(structuredOutput, Object.values(formatSecrets));
assertSanitized(structuredOutput, ['SYNTHETIC_AZURE_SAS_123456']);
assert.ok(structuredOutput.includes('"safe":"keep"'));
assert.ok(structuredOutput.includes('--safe value'));
assert.ok(structuredOutput.includes('page=2'));

// Telegram is a network publication boundary too. The bot-wide wrapper must
// sanitize the exact message passed to the underlying transport.
const telegramPayloads = [];
const telegram = {
  async sendMessage(_chatId, text) {
    telegramPayloads.push(text);
    return { message_id: 1 };
  },
  async editMessageText(_chatId, _messageId, _inlineMessageId, text) {
    telegramPayloads.push(text);
    return { message_id: 1 };
  },
};
installTelegramFormattingFallback(telegram);
await telegram.sendMessage(1, `API_TOKEN=${alpha}`);
await telegram.editMessageText(1, 1, undefined, `password=abc123`);
assertSanitized(telegramPayloads.join('\n'), [alpha, 'abc123']);
assert.ok(telegramPayloads[0].includes('API_TOKEN=SYN…456'));
assert.ok(telegramPayloads[1].includes('password=[REDACTED]'));

const privateKey = ['-----BEGIN PRIVATE KEY-----', 'SYNTHETIC_PRIVATE_KEY_MATERIAL_123456789', 'SECOND_SYNTHETIC_PRIVATE_KEY_LINE_987654321', '-----END PRIVATE KEY-----'].join('\n');
const pemOutput = await sanitizeOutput(`before\n${privateKey}\nafter`);
assertSanitized(pemOutput, ['SYNTHETIC_PRIVATE_KEY_MATERIAL_123456789', 'SECOND_SYNTHETIC_PRIVATE_KEY_LINE_987654321']);
assert.ok(pemOutput.includes('-----BEGIN PRIVATE KEY-----'));
assert.ok(pemOutput.includes('-----END PRIVATE KEY-----'));
assert.ok(pemOutput.includes('[REDACTED]'));

// A credential split across arbitrary child-process chunks must never be
// emitted raw. The stream helper returns sanitized completed records and
// retains an incomplete suffix until flush.
const splitSecret = 'SYNTHETIC_STREAM_TOKEN_123456789';
const stream = createCredentialStreamSanitizer();
const streamed = [stream.write('prefix API_TO'), stream.write(`KEN=${splitSecret.slice(0, 12)}`), stream.write(`${splitSecret.slice(12)} suffix\n`), stream.flush()].join('');
assertSanitized(streamed, [splitSecret]);
assert.ok(streamed.includes('API_TOKEN=SYN…789'));

// Multiline PEM material must remain buffered until the matching end marker;
// an interrupted/unterminated key must also fail closed during flush.
const pemStream = createCredentialStreamSanitizer();
const pemChunks = [pemStream.write('before\n-----BEGIN PRIVATE KEY-----\n'), pemStream.write('SYNTHETIC_PRIVATE_KEY_MATERIAL_123456789\n'), pemStream.write('SECOND_SYNTHETIC_PRIVATE_KEY_LINE_987654321\n'), pemStream.write('-----END PRIVATE KEY-----\nafter\n'), pemStream.flush()];
assert.equal(pemChunks[0], 'before\n');
assert.equal(pemChunks[1], '');
assert.equal(pemChunks[2], '');
const streamedPem = pemChunks.join('');
assertSanitized(streamedPem, ['SYNTHETIC_PRIVATE_KEY_MATERIAL_123456789', 'SECOND_SYNTHETIC_PRIVATE_KEY_LINE_987654321']);
assert.ok(streamedPem.includes('-----BEGIN PRIVATE KEY-----\n[REDACTED]\n-----END PRIVATE KEY-----'));

const interruptedPemStream = createCredentialStreamSanitizer();
const interruptedPem = [interruptedPemStream.write('-----BEGIN RSA PRIVATE KEY-----\n'), interruptedPemStream.write('SYNTHETIC_UNTERMINATED_KEY_MATERIAL_123456789\n'), interruptedPemStream.flush()].join('');
assertSanitized(interruptedPem, ['SYNTHETIC_UNTERMINATED_KEY_MATERIAL_123456789']);
assert.equal(interruptedPem, '-----BEGIN RSA PRIVATE KEY-----\n[REDACTED]');

// Buffer chunks can split a UTF-8 code point as well as a credential. Preserve
// the surrounding diagnostic text while still masking the credential.
const unicodeStream = createCredentialStreamSanitizer();
const unicodeRecord = Buffer.from(`café API_TOKEN=${splitSecret}\n`);
const unicodeOutput = [unicodeStream.write(unicodeRecord.subarray(0, 4)), unicodeStream.write(unicodeRecord.subarray(4)), unicodeStream.flush()].join('');
assert.equal(unicodeOutput, 'café API_TOKEN=SYN…789\n');

// The real stdout/stderr interceptor applies the stream sanitizer before both
// terminal display and the persistent process log.
const terminalRoot = await mkdtemp(join(tmpdir(), 'hive-terminal-sanitization-2111-'));
try {
  const terminalLog = join(terminalRoot, 'solve.log');
  const libUrl = new URL('../src/lib.mjs', import.meta.url).href;
  const childSource = `
    import { setLogFile, setupStdioLogInterceptor } from ${JSON.stringify(libUrl)};
    setLogFile(process.argv[1]);
    setupStdioLogInterceptor();
    process.stdout.write('API_TO');
    process.stdout.write('KEN=${splitSecret}\\n');
    process.stderr.write('password=abc123\\n');
    process.stdout.write('AUTH_TOKEN=SYNTHETIC_FINAL_TAIL_123456');
    await new Promise(resolve => setTimeout(resolve, 100));
  `;
  const child = await new Promise((resolve, reject) => {
    const processHandle = spawn(process.execPath, ['--input-type=module', '--eval', childSource, terminalLog], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    processHandle.stdout.on('data', chunk => {
      stdout += chunk;
    });
    processHandle.stderr.on('data', chunk => {
      stderr += chunk;
    });
    processHandle.once('error', reject);
    processHandle.once('close', code => resolve({ code, stdout, stderr }));
  });
  assert.equal(child.code, 0);
  assertSanitized(`${child.stdout}\n${child.stderr}`, [splitSecret, 'abc123', 'SYNTHETIC_FINAL_TAIL_123456']);
  assert.ok(child.stdout.includes('API_TOKEN=SYN…789'));
  assert.ok(child.stdout.includes('AUTH_TOKEN=SYN…456'));
  assert.ok(child.stderr.includes('password=[REDACTED]'));
  const terminalLogBytes = await readFile(terminalLog, 'utf8');
  assertSanitized(terminalLogBytes, [splitSecret, 'abc123', 'SYNTHETIC_FINAL_TAIL_123456']);
  assert.ok(terminalLogBytes.includes('AUTH_TOKEN=SYN…456'));
  assert.equal((await stat(terminalLog)).mode & 0o777, 0o600);
} finally {
  await rm(terminalRoot, { recursive: true, force: true });
}

// Publication is fail-closed. Scanner failure and a deliberately injected
// residual detector both block the mutation without echoing the credential.
await assert.rejects(
  sanitizeForPublication(`API_TOKEN=${alpha}`, {
    scanner: async () => {
      throw new Error(`scanner exploded near ${alpha}`);
    },
  }),
  error => error.code === 'ERR_CREDENTIAL_SANITIZATION' && !error.message.includes(alpha)
);
await assert.rejects(
  sanitizeForPublication('safe text', {
    residualScanner: async () => [{ ruleId: 'synthetic-residual' }],
  }),
  error => error.code === 'ERR_CREDENTIAL_SANITIZATION' && error.message === 'Credential sanitization failed; publication was blocked.'
);

// --attach-logs must hand only a private sanitized copy to gh-upload-log and
// remove that exact intermediate even when the uploader fails.
const uploadRoot = await mkdtemp(join(tmpdir(), 'hive-upload-sanitization-2111-'));
try {
  const rawUploadLog = join(uploadRoot, 'raw.log');
  await writeFile(rawUploadLog, `API_TOKEN=${alpha}\n`, { mode: 0o600 });
  let preparedPath = null;
  let preparedBytes = null;
  let preparedMode = null;
  let preparedDescription = null;
  const uploadResult = await uploadLogWithGhUploadLog({
    logFile: rawUploadLog,
    isPublic: false,
    description: `credential ${beta}`,
    runUpload: async args => {
      [preparedPath] = args;
      preparedBytes = await readFile(preparedPath, 'utf8');
      preparedMode = (await stat(preparedPath)).mode & 0o777;
      preparedDescription = args[args.indexOf('--description') + 1];
      return { code: 1, stdout: '', stderr: 'synthetic upload failure' };
    },
  });
  assert.equal(uploadResult.success, false);
  assertSanitized(`${preparedBytes}\n${preparedDescription}`, [alpha, beta]);
  assert.equal(preparedBytes, 'API_TOKEN=SYN…456\n');
  assert.equal(preparedDescription, 'credential SYN…321');
  assert.equal(preparedMode, 0o600);
  await assert.rejects(stat(preparedPath), error => error.code === 'ENOENT');
  assert.equal(await readFile(rawUploadLog, 'utf8'), `API_TOKEN=${alpha}\n`, 'upload must not modify the raw source');
} finally {
  await rm(uploadRoot, { recursive: true, force: true });
}

// --development-log keeps the source audit files unchanged and writes only
// sanitized, owner-readable publication copies into the repository.
const tempRoot = await mkdtemp(join(tmpdir(), 'hive-sanitization-2111-'));
try {
  const repositoryPath = join(tempRoot, 'repo');
  const homeDir = join(tempRoot, 'home');
  const codexDirectory = join(homeDir, '.codex', 'sessions', '2026', '07', '27');
  const sourceLog = join(tempRoot, 'solve.log');
  const sessionId = 'synthetic-session';
  const sourceTranscript = join(codexDirectory, `rollout-2026-07-27T00-00-00-${sessionId}.jsonl`);
  await mkdir(repositoryPath, { recursive: true });
  await mkdir(codexDirectory, { recursive: true });
  await writeFile(sourceLog, `API_TOKEN=${alpha}\n`, { mode: 0o600 });
  await writeFile(sourceTranscript, `{"password":"${databasePassword}"}\n`, { mode: 0o600 });

  const artifacts = await writeDevelopmentLogArtifacts({
    repositoryPath,
    logFile: sourceLog,
    issueNumber: 2111,
    prNumber: 2112,
    tool: 'codex',
    sessionId,
    branchName: 'issue-2111-9d069d234785',
    rawCommand: `solve --token ${beta} --development-log`,
    homeDir,
  });

  assert.equal(await readFile(sourceLog, 'utf8'), `API_TOKEN=${alpha}\n`, 'local audit source must remain unchanged');
  assert.equal(await readFile(sourceTranscript, 'utf8'), `{"password":"${databasePassword}"}\n`, 'local transcript source must remain unchanged');

  const publishedLogPath = join(repositoryPath, artifacts.copiedLogRelativePath);
  const publishedTranscriptPath = join(repositoryPath, artifacts.sessionFiles[0].replace(/^\.\//, ''));
  const publishedMetadataPath = join(repositoryPath, artifacts.metadataRelativePath);
  const publishedBytes = [await readFile(publishedLogPath, 'utf8'), await readFile(publishedTranscriptPath, 'utf8'), await readFile(publishedMetadataPath, 'utf8')].join('\n');
  assertSanitized(publishedBytes, [alpha, beta, databasePassword]);
  assert.equal((await stat(publishedLogPath)).mode & 0o777, 0o600);
  assert.equal((await stat(publishedTranscriptPath)).mode & 0o777, 0o600);
  assert.equal((await stat(publishedMetadataPath)).mode & 0o777, 0o600);

  // Inspect the real Git index at the staging boundary. Only sanitized copies
  // may enter the index; the raw audit source remains outside the repository.
  assert.equal((await runProcess('git', ['init'], { cwd: repositoryPath })).code, 0);
  assert.equal((await runProcess('git', ['config', 'user.name', 'Credential Sanitization Test'], { cwd: repositoryPath })).code, 0);
  assert.equal((await runProcess('git', ['config', 'user.email', 'sanitization@example.test'], { cwd: repositoryPath })).code, 0);
  let stagedBytes = '';
  const gitRunner =
    ({ cwd }) =>
    async (strings, ...values) => {
      const command = strings.reduce((text, part, index) => `${text}${part}${values[index] ?? ''}`, '');
      if (command.startsWith('git push ')) return { code: 0, stdout: '', stderr: '' };

      let args;
      if (command.startsWith('git add ')) args = ['add', '-f', '--', String(values[0])];
      else if (command.startsWith('git diff ')) args = ['diff', '--cached', '--quiet', '--', String(values[0])];
      else if (command.startsWith('git commit ')) args = ['commit', '-m', String(values[0]), '--', String(values[1])];
      else throw new Error(`Unexpected git command in regression: ${command}`);

      const result = await runProcess('git', args, { cwd });
      if (command.startsWith('git add ') && result.code === 0) {
        stagedBytes = (await runProcess('git', ['diff', '--cached'], { cwd })).stdout;
      }
      return result;
    };

  const committed = await collectAndCommitDevelopmentLogArtifacts({
    enabled: true,
    repositoryPath,
    logFile: sourceLog,
    issueNumber: 2111,
    prNumber: 2112,
    tool: 'codex',
    sessionId: 'staged-session',
    branchName: 'issue-2111-test',
    rawCommand: `solve --token ${beta} --development-log`,
    $: gitRunner,
    log: async () => {},
  });
  assert.equal(committed.committed, true);
  assertSanitized(stagedBytes, [alpha, beta, databasePassword]);
  assert.ok(stagedBytes.includes('API_TOKEN=SYN…456'));
  assert.equal(await readFile(sourceLog, 'utf8'), `API_TOKEN=${alpha}\n`, 'staging must not modify the local audit source');

  // A future raw file accidentally added beneath the broad artifact directory
  // must block the entire staging attempt.
  const roguePath = join(repositoryPath, committed.relativeDirectory, 'raw-retry.log');
  await writeFile(roguePath, `API_TOKEN=${alpha}\n`, { mode: 0o600 });
  let stagingAttempted = false;
  const blocked = await collectAndCommitDevelopmentLogArtifacts({
    enabled: true,
    repositoryPath,
    logFile: sourceLog,
    issueNumber: 2111,
    prNumber: 2112,
    tool: 'codex',
    sessionId: 'blocked-session',
    branchName: 'issue-2111-test',
    rawCommand: 'solve --development-log',
    $: () => {
      stagingAttempted = true;
      return async () => ({ code: 0, stdout: '', stderr: '' });
    },
    log: async () => {},
  });
  assert.equal(blocked.skipped, 'error');
  assert.equal(stagingAttempted, false, 'residual scan must run before git add');
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

// Keep a coarse large-log budget so an accidental quadratic replacement pass
// cannot make sanitization practically bypassable via size.
const largeSecret = 'SYNTHETIC_LARGE_LOG_TOKEN_123456';
const largeInput = `${'ordinary diagnostic line\n'.repeat(50_000)}API_TOKEN=${largeSecret}\n`;
const started = performance.now();
const largeOutput = await sanitizeOutput(largeInput);
const elapsedMs = performance.now() - started;
assertSanitized(largeOutput, [largeSecret]);
assert.ok(elapsedMs < 10_000, `1MB sanitizer run took too long: ${Math.round(elapsedMs)}ms`);

console.log('credential sanitization tests passed (issue #2111)');
