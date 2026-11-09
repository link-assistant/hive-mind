#!/usr/bin/env node
// Real package admission with synthetic authorities; execute no provider code.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { pathToFileURL } from 'node:url';

const [moduleFile, command] = process.argv.slice(2);
assert.ok(moduleFile && command);
const { admitNativeGeminiStorage: admit } = await import(pathToFileURL(path.resolve(moduleFile)));
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gemini-launch-real-package-'));
await fs.chmod(root, 0o700);
const credential = '{"access_token":"synthetic-gemini-admission","refresh_token":"synthetic-gemini-refresh","token_type":"Bearer","expiry_date":4102444800000}';
const refusal = { code: 'NATIVE_GEMINI_STORAGE_VIOLATION' };
try {
  const home = path.join(root, 'private');
  const auth = path.join(root, 'auth');
  const history = path.join(root, 'history');
  for (const directory of [home, auth, history]) await fs.mkdir(directory, { mode: 0o700 });
  const configuration = path.join(home, '.gemini');
  await fs.mkdir(configuration, { mode: 0o700 });
  const credentials = path.join(auth, 'oauth_creds.json');
  await fs.writeFile(credentials, credential, { mode: 0o600 });
  const env = { PATH: process.env.PATH, HOME: home, GEMINI_CLI_HOME: home, GEMINI_AUTH_HOME: auth, GEMINI_HISTORY_HOME: history };
  const options = { env, homeDir: home, command };
  const admission = await admit(options);
  const check = (overrides = {}) => admit({ ...options, expected: admission, ...overrides });
  for (const kind of ['AUTH', 'HISTORY']) {
    const info = await fs.stat(env[`GEMINI_${kind}_HOME`], { bigint: true });
    assert.equal(admission.env[`HIVE_MIND_GEMINI_${kind}_IDENTITY`], `${info.dev}:${info.ino}`);
  }
  assert.equal(admission.command, await fs.realpath(command));
  await check({ env: { ...env, ...admission.env } });
  console.log('PASS: real verified native package admits unmarked and forwarded marked storage without provider execution.');

  const replacement = credentials + '.replacement';
  await fs.writeFile(replacement, credential.replace('synthetic-gemini-admission', 'synthetic-gemini-refreshed'), { mode: 0o600 });
  await fs.rename(replacement, credentials);
  await check();
  console.log('PASS: admission accepts native atomic credential replacement within the same canonical parent.');
  await fs.unlink(credentials);
  await assert.rejects(check(), refusal);
  await fs.writeFile(credentials, credential, { mode: 0o600 });
  await check();
  console.log('PASS: native logout refuses admission and canonical re-login restores the same parent authority.');

  for (const kind of ['AUTH', 'HISTORY']) {
    const marker = `HIVE_MIND_GEMINI_${kind}_IDENTITY`;
    const selector = `GEMINI_${kind}_HOME`;
    await assert.rejects(check({ env: { ...env, [marker]: '0:0' } }), refusal);
    const dropped = { ...env };
    delete dropped[selector];
    await assert.rejects(check({ env: dropped }), refusal);
    const marked = { ...env, ...admission.env };
    const markedAdmission = await admit({ ...options, env: marked });
    delete marked[marker];
    await assert.rejects(admit({ ...options, env: marked, expected: markedAdmission }), refusal);
    console.log(`PASS: ${kind.toLowerCase()} identity mismatch and selector/marker removal refuse retained launch admission.`);
  }
  await assert.rejects(check({ env: { ...env, GEMINI_HISTORY_HOME: auth } }), refusal);
  await fs.writeFile(path.join(configuration, 'oauth_creds.json'), credential, { mode: 0o600 });
  await assert.rejects(check(), refusal);
  await fs.unlink(path.join(configuration, 'oauth_creds.json'));
  await fs.writeFile(path.join(configuration, 'google_accounts.json'), '{}', { mode: 0o600 });
  await assert.rejects(check(), refusal);
  await fs.unlink(path.join(configuration, 'google_accounts.json'));
  console.log('PASS: overlapping selected roots and competing private credentials/account metadata refuse admission.');

  for (const bytes of ['null', '[]', '{}', '{', '{"access_token":"synthetic-incomplete"}', credential.replace('4102444800000', '-1')]) {
    await fs.writeFile(credentials, bytes, { mode: 0o600 });
    await assert.rejects(check(), refusal);
  }
  await fs.writeFile(credentials, credential, { mode: 0o600 });
  await check();
  console.log('PASS: malformed and incomplete OAuth documents refuse admission without exposing credential bytes.');
  for (const name of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_CLOUD_ACCESS_TOKEN', 'GOOGLE_GENAI_USE_VERTEXAI', 'GOOGLE_GENAI_USE_GCA', 'GEMINI_FORCE_ENCRYPTED_FILE_STORAGE']) await assert.rejects(check({ env: { ...env, [name]: 'synthetic-alternate' } }), refusal);
  const historyOnly = { ...env, GEMINI_API_KEY: 'synthetic-history-only' };
  delete historyOnly.GEMINI_AUTH_HOME;
  const historyAdmission = await admit({ ...options, env: historyOnly });
  assert.equal(historyAdmission.selection.auth, undefined);
  assert.equal(historyAdmission.selection.history.root, history);
  console.log('PASS: selected OAuth refuses seven competing authorities; history-only admission remains independent.');
  await assert.rejects(check({ env: { ...env, GEMINI_CLI_HOME: '' } }), refusal);
  const alias = path.join(root, 'home-alias');
  await fs.symlink(home, alias);
  await assert.rejects(check({ env: { ...env, GEMINI_CLI_HOME: alias } }), refusal);
  await fs.rmdir(configuration);
  await fs.symlink(auth, configuration);
  await assert.rejects(check(), refusal);
  await fs.unlink(configuration);
  await fs.mkdir(configuration, { mode: 0o700 });
  await check();
  console.log('PASS: empty custom configuration roots and symlinked configuration paths refuse admission.');

  const helper = path.join(path.dirname(admission.command), 'hive-gemini-storage-identity.mjs');
  const original = await fs.readFile(helper);
  try {
    await fs.appendFile(helper, '\n// synthetic changed executable bytes\n');
    await assert.rejects(check(), refusal);
  } finally {
    await fs.writeFile(helper, original);
  }
  await check();
  console.log('PASS: changed real native helper bytes refuse admission; exact restored bytes admit.');

  for (const kind of ['AUTH', 'HISTORY']) {
    const directory = env[`GEMINI_${kind}_HOME`];
    await fs.rename(directory, directory + '-retired');
    await fs.mkdir(directory, { mode: 0o700 });
    if (kind === 'AUTH') await fs.writeFile(credentials, credential, { mode: 0o600 });
    await assert.rejects(check(), refusal);
    await fs.rm(directory, { recursive: true });
    await fs.rename(directory + '-retired', directory);
    await check();
    console.log(`PASS: equal-content ${kind.toLowerCase()} directory replacement refuses the retained launch identity.`);
  }
  assert.equal(await admit({ ...options, env: { HOME: home } }), null);
  await assert.rejects(check({ expected: null }), refusal);
  assert.equal(await admit({ ...options, useRouter: true }), null);
  await assert.rejects(check({ useRouter: true }), refusal);
  console.log('PASS: ordinary unselected and Router admissions remain independent; retained native selection cannot change authority.');
  await assert.rejects(fs.lstat(path.join(configuration, 'oauth_creds.json')), { code: 'ENOENT' });
  await assert.rejects(fs.lstat(path.join(configuration, 'google_accounts.json')), { code: 'ENOENT' });
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
