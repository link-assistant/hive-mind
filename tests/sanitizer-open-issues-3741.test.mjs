/**
 * @hive-mind-test-suite default
 * Open sanitizer issues audited for PR #3741. All credentials are synthetic.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createCredentialStreamSanitizer, sanitizeCredentialText } from '../src/credential-sanitization-core.lib.mjs';
import { computeReleaseBoundary, findResidualCredentialBlock } from '../src/log-sanitize-stream.lib.mjs';
import { verifyDevelopmentLogDirectory } from '../src/development-log.lib.mjs';

const secret = ['ghp_', 'Zx9Qw7Er5Ty3Ui1Op0As', '2Df4Gh6Jk8Lz0Xc2Vb4N'].join('');
const sanitize = text => sanitizeCredentialText(text, { includeEnvironmentCredentials: false });
const workflow = 'permissions:\n  id-token: write\n  id-token: read\n  id-token: none\n  token: ${{ secrets.GITHUB_TOKEN }}\n';

test('already masked prose remains stable while another credential is removed (#148)', { timeout: 15000 }, () => {
  const once = sanitize(`User token: ${secret}. Next sentence`);
  assert.equal(once, 'User token: ghp…b4N. Next sentence');
  assert.equal(sanitize(once), once);
  assert.ok(!sanitize(`${once}; password=${secret}`).includes(secret));
  assert.ok(!sanitize(`${once}; token: ${secret}`).includes(secret));
});

test('Actions syntax and realistic OTEL/SDK account details stay; credentials do not (#2841, #2837)', { timeout: 15000 }, () => {
  const logs = 'user.email="operator@example.com" user.account_id="12345678-1234-1234-1234-123456789012" anthropic-organization-id="org_123" anthropic-workspace-id="wrkspc_123"';
  assert.equal(sanitize(workflow), workflow);
  assert.equal(sanitize(logs), logs);
  assert.equal(sanitize(`${logs}\nAuthorization: token ${secret}`), `${logs}\nAuthorization: token ghp…b4N`);
});

test('native private-key types fully redact multiline bodies, including encoded copies (#154)', { timeout: 15000 }, () => {
  const key = ['-----BEGIN PRIVATE KEY-----', 'SYNTHETIC_PRIVATE_KEY_MATERIAL_123456789', 'SECOND_SYNTHETIC_PRIVATE_KEY_LINE_987654321', '-----END PRIVATE KEY-----'].join('\n');
  const expected = '-----BEGIN PRIVATE KEY-----\n[REDACTED]\n-----END PRIVATE KEY-----';
  assert.equal(sanitize(key), expected);
  const encoded = sanitize(Buffer.from(key).toString('base64'));
  assert.equal(Buffer.from(encoded, 'base64').toString(), expected);
  assert.equal(sanitize(encoded), encoded);
});

test('adapter exemptions cannot retain explicitly known values', { timeout: 15000 }, () => {
  for (const value of ['Z2hv4oCmOTk5', 'SharedAccessSignature', '<secret>', 'ghp…b4N']) {
    const output = sanitizeCredentialText(`token: ${value}`, { includeEnvironmentCredentials: false, knownTokens: [value] });
    assert.ok(!output.includes(value));
  }
});

test('closed JSON image lines and wrapped binary streams drain promptly and byte-for-byte (#3747)', { timeout: 20000 }, () => {
  // Finite 200 KiB probes: the old suffix regex takes tens of seconds here.
  const image = JSON.stringify({ type: 'image', data: randomBytes(150000).toString('base64') }) + '\n';
  const wrapped =
    randomBytes(150000)
      .toString('base64')
      .match(/.{1,76}/g)
      .join('\n') + '\n';
  for (const [input, width] of [
    [image, 4096],
    [wrapped, 77],
  ]) {
    const started = performance.now();
    const stream = createCredentialStreamSanitizer({ includeEnvironmentCredentials: false });
    let output = '';
    for (let at = 0; at < input.length; at += width) output += stream.write(input.slice(at, at + width));
    output += stream.flush();
    assert.equal(output === input, true, 'noncredential image content must survive');
    assert.ok(performance.now() - started < 10000, 'stream processing must remain bounded');
  }
  assert.equal(computeReleaseBoundary(image), image.length);
  for (const separator of ['\n', '\r', '\r\n']) {
    const stream = createCredentialStreamSanitizer({ includeEnvironmentCredentials: false });
    const line = `Authorization: token ${secret}${separator}`;
    assert.equal(stream.write(line.slice(0, 30)) + stream.write(line.slice(30)) + stream.flush(), `Authorization: token ghp…b4N${separator}`);
  }
});

test('development evidence is repaired in place and residual diagnostics identify file/line/rule (#2841)', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'sanitizer-2841-'));
  try {
    await mkdir(join(root, 'data'));
    const file = join(root, 'data', 'workflow.yml');
    await writeFile(file, workflow);
    assert.equal(await findResidualCredentialBlock(file), null);
    await writeFile(file, `${workflow}Authorization: token ${secret}\n`);
    const residual = await findResidualCredentialBlock(file);
    assert.equal(residual.line, 6);
    assert.match(residual.ruleId, /authorization|github|context/);
    await assert.rejects(verifyDevelopmentLogDirectory(root, { repair: false }), error => error.message.includes(`${file}:6`) && error.message.includes('rule ') && !error.message.includes(secret));
    await verifyDevelopmentLogDirectory(root);
    assert.equal(await readFile(file, 'utf8'), `${workflow}Authorization: token ghp…b4N\n`);
    assert.equal(await findResidualCredentialBlock(file), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
