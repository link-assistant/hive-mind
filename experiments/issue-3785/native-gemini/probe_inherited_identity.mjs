#!/usr/bin/env node
// Isolated native constructor/account/history admission; no network transports.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (process.argv[2] === '--worker') {
  const [bundle, kind, state, directory, configuration] = process.argv.slice(3);
  const auth = kind === 'auth';
  const selector = auth ? 'GEMINI_AUTH_HOME' : 'GEMINI_HISTORY_HOME';
  const marker = auth ? 'HIVE_MIND_GEMINI_AUTH_IDENTITY' : 'HIVE_MIND_GEMINI_HISTORY_IDENTITY';
  const refused = auth ? /Gemini canonical authentication is unavailable or unsafe\./u : /Gemini canonical conversation history is unavailable or unsafe\./u;
  const load = name => import(pathToFileURL(path.join(bundle, `hive-gemini-${name}.mjs`)));
  const native = await load(auth ? 'admission' : 'history');
  const readers = auth ? await load('reads') : native;
  const accounts = auth ? await load('accounts') : null;
  const selected = () => (auth ? readers.nativeGeminiSelected() : native.nativeGeminiHistorySelected());
  const admit = () => (auth ? native.assertNativeGeminiAuthority({ authType: 'oauth-personal' }) : native.assertNativeGeminiHistoryCurrent());
  const accountPath = () => accounts.getNativeGeminiAccountsPath(path.join(configuration, 'google_accounts.json'), path.join(configuration, 'oauth_creds.json'));
  const info = await fs.lstat(directory, { bigint: true });
  const identity = `${info.dev}:${info.ino}`;
  if (state === 'ordinary') {
    assert.equal(selected(), false);
    admit();
  } else {
    process.env[selector] = directory;
    if (!['unmarked', 'marker-add'].includes(state)) process.env[marker] = identity;
    if (state.startsWith('invalid-')) process.env[marker] = ['', '0:0', '1', '-1:1', '1:2:3', '1'.repeat(21) + ':1', '0:0\n'][Number(state.slice(8))];
    if (state === 'marker-only') delete process.env[selector];
    assert.equal(selected(), true, 'A marker without its selector must retain selected admission.');
    if (state.startsWith('invalid-') || state === 'marker-only') {
      assert.throws(admit, refused, 'Native admission must refuse an invalid inherited identity.');
      if (auth) assert.throws(accountPath, /Gemini canonical account storage is unavailable or unsafe\./u);
    } else {
      admit();
      if (auth) assert.equal(accountPath(), path.join(directory, 'google_accounts.json'));
      if (state === 'marker-remove') delete process.env[marker];
      else if (state === 'marker-add') process.env[marker] = identity;
      else if (state === 'marker-change') process.env[marker] = '0:0';
      else if (state === 'selector-remove') delete process.env[selector];
      else if (state === 'both-remove') {
        delete process.env[selector];
        delete process.env[marker];
      } else if (state === 'selector-change') {
        process.env[selector] = directory + '-replacement';
        await fs.mkdir(process.env[selector], { mode: 0o700 });
      } else if (state === 'root-replacement') {
        await fs.rename(directory, directory + '-retired');
        await fs.mkdir(directory, { mode: 0o700 });
      } else if (state === 'mode-change') await fs.chmod(directory, 0o755);
      if (!['matching', 'unmarked'].includes(state)) {
        assert.equal(selected(), true, 'Admitted storage must never fall back after selector removal.');
        assert.throws(admit, refused, 'Native admission must retain its initial root and inherited marker.');
        if (auth) assert.throws(accountPath, /Gemini canonical account storage is unavailable or unsafe\./u);
      }
    }
  }
  console.log(`PASS: native ${kind} identity ${state}.`);
} else {
  const bundle = path.join(path.resolve(process.argv[2]), 'bundle');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-gemini-inherited-'));
  await fs.chmod(root, 0o700);
  const states = ['ordinary', 'matching', 'unmarked', ...Array.from({ length: 7 }, (_, index) => `invalid-${index}`), 'marker-only', 'marker-add', 'marker-remove', 'marker-change', 'selector-remove', 'both-remove', 'selector-change', 'root-replacement', 'mode-change'];
  try {
    for (const kind of ['auth', 'history']) {
      for (const state of states) {
        const directory = path.join(root, `${kind}-${state}`);
        const configuration = path.join(root, `${kind}-${state}-configuration`);
        await fs.mkdir(directory, { mode: 0o700 });
        await fs.mkdir(configuration, { mode: 0o700 });
        const result = execFileSync('/usr/bin/prlimit', ['--data=2147483648', '--stack=16777216', '--core=0', '--', process.execPath, '--max-old-space-size=64', fileURLToPath(import.meta.url), '--worker', bundle, kind, state, directory, configuration], {
          env: { PATH: process.env.PATH, HOME: configuration },
          cwd: configuration,
          timeout: 10000,
          killSignal: 'SIGKILL',
          maxBuffer: 65536,
          encoding: 'utf8',
        });
        process.stdout.write(result);
      }
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
