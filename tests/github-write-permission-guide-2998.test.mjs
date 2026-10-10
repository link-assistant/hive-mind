#!/usr/bin/env node
/**
 * Issue #2998: the CLI checks write access before anything else, so its
 * failure output is the first thing a `solve` user sees for a private or
 * read-only repository. It must name the account to invite and link the
 * GitHub Docs sections, like the Telegram reply does.
 *
 * Runs the real checkRepositoryWritePermission in a child process with a fake
 * `gh` first on PATH, so no network or GitHub account is needed.
 *
 * Run with: node tests/github-write-permission-guide-2998.test.mjs
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { getGitHubOwnerType } from '../src/github-access-guide.lib.mjs';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}`);
    failed++;
  }
}

const FAKE_GH = `#!/bin/sh
case "$*" in
  "api repos/acme/private-app --jq .permissions") echo '{"message":"Not Found","status":"404"}'; echo 'gh: Not Found (HTTP 404)' >&2; exit 1 ;;
  "api repos/acme/read-only --jq .permissions") echo '{"admin":false,"maintain":false,"pull":true,"push":false,"triage":false}' ;;
  "api repos/konard/demo --jq .permissions") echo '{"admin":false,"maintain":false,"pull":true,"push":false,"triage":false}' ;;
  "api user --jq .login") echo hive-bot ;;
  "api users/acme --jq .type") echo Organization ;;
  "api users/konard --jq .type") echo User ;;
  *) echo "fake gh: unexpected: $*" >&2; exit 1 ;;
esac
`;

const libUrl = new URL('../src/github.lib.mjs', import.meta.url).href;
const binDir = await mkdtemp(join(tmpdir(), 'fake-gh-2998-'));
await writeFile(join(binDir, 'gh'), FAKE_GH);
await chmod(join(binDir, 'gh'), 0o755);

async function checkWithFakeGh(owner, repo, options) {
  const script = `const { checkRepositoryWritePermission } = await import(${JSON.stringify(libUrl)});
console.log('RESULT=' + (await checkRepositoryWritePermission(${JSON.stringify(owner)}, ${JSON.stringify(repo)}, ${JSON.stringify(options)})));`;
  const env = { ...process.env, PATH: `${binDir}${delimiter}${process.env.PATH}`, LANG: 'ru_RU.UTF-8', LC_ALL: '', HIVE_MIND_LOCALE: '' };
  const { stdout, stderr } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], { env, cwd: fileURLToPath(new URL('..', import.meta.url)), timeout: 60000 });
  return `${stdout}\n${stderr}`;
}

try {
  await test('404 (private repository): the guide names the account, the org invite docs and the manual acceptance page', async () => {
    const output = await checkWithFakeGh('acme', 'private-app', { issueUrl: 'https://github.com/acme/private-app/issues/1', autoAcceptInvite: false });
    assert.match(output, /RESULT=false/);
    assert.match(output, /Repository not found or no access/);
    assert.ok(output.includes('`hive-bot`'), output);
    assert.ok(output.includes('https://github.com/acme/private-app/settings/access'), output);
    assert.ok(output.includes('https://github.com/acme/private-app/invitations'), output);
    assert.ok(output.includes('managing-teams-and-people-with-access-to-your-repository#inviting-a-team-or-person'), output);
    assert.match(output, /https:\/\/docs\.github\.com\/ru\//, 'docs follow the POSIX locale');
    assert.ok(output.includes('--auto-accept-invite'), 'flag hint when invitations are not accepted automatically');
  });

  await test('read-only organization repository: keeps the --fork advice and asks to change the role to Write', async () => {
    const output = await checkWithFakeGh('acme', 'read-only', { issueUrl: 'https://github.com/acme/read-only/issues/2' });
    assert.match(output, /RESULT=false/);
    assert.match(output, /--fork/);
    assert.match(output, /Your fork will be: hive-bot\/read-only/);
    assert.ok(output.includes('#changing-permissions-for-a-team-or-person'), output);
    assert.ok(!output.includes('Request collaborator access'), 'old wording is gone');
  });

  await test('read-only personal repository: invites a collaborator (personal collaborators always push)', async () => {
    const output = await checkWithFakeGh('konard', 'demo', { issueUrl: 'https://github.com/konard/demo/issues/3' });
    assert.ok(output.includes('inviting-collaborators-to-a-personal-repository#inviting-a-collaborator-to-a-personal-repository'), output);
    assert.ok(output.includes('`hive-bot`'), output);
  });

  await test('getGitHubOwnerType accepts only User and Organization', async () => {
    assert.equal(await getGitHubOwnerType('acme', { run: async () => ({ code: 0, stdout: 'Organization\n' }) }), 'Organization');
    assert.equal(await getGitHubOwnerType('x', { run: async () => ({ code: 0, stdout: 'Bot' }) }), null);
    assert.equal(await getGitHubOwnerType('x', { run: async () => ({ code: 1, stdout: '' }) }), null);
    assert.equal(
      await getGitHubOwnerType('x', {
        run: async () => {
          throw new Error('gh missing');
        },
      }),
      null
    );
  });
} finally {
  await rm(binDir, { recursive: true, force: true });
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
