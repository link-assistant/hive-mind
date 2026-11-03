/** Actual native capability discovery with synthetic selected credentials. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL, fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import console from 'node:console';

const binary = process.argv[2];
const installed = process.argv[3]?.startsWith('--') ? undefined : process.argv[3];
const development = process.argv.includes('--unpackaged-development');
assert.ok(path.isAbsolute(binary));
const moduleRoot = installed || fileURLToPath(new URL('../../', import.meta.url));
const { runCodexCapabilityPreflight, verifyCodexCapabilityExecutionCatalog } = await import(pathToFileURL(path.join(moduleRoot, 'src/codex-capability-preflight.lib.mjs')));
const execute = promisify(execFile);
function stopGroup(child) {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-native-capability-auth-'));
const scopes = [];
try {
  const canonical = path.join(root, 'canonical');
  const home = path.join(root, 'home');
  const projectDir = path.join(root, 'checkout');
  for (const directory of [canonical, home, projectDir]) await fs.mkdir(directory, { mode: 0o700 });
  const config = 'model="gpt-5.5"\nmodel_provider="offline"\n[features]\nremote_plugin=false\napps=false\n[model_providers.offline]\nname="Offline"\nbase_url="http://127.0.0.1:1/v1"\nwire_api="responses"\nrequires_openai_auth=false\n';
  await fs.writeFile(path.join(canonical, 'config.toml'), config);
  const auth = path.join(canonical, 'auth.json');
  const initial = '{"OPENAI_API_KEY":"sk-SYNTHETIC-CAPABILITY-ORIGINAL"}';
  const replacement = '{"OPENAI_API_KEY":"sk-SYNTHETIC-CAPABILITY-REPLACED"}';
  await fs.writeFile(auth, initial, { mode: 0o600 });
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    CODEX_HOME: canonical,
    CODEX_AUTH_HOME: canonical,
    TOKIO_WORKER_THREADS: '2',
    RUST_LOG: 'off',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    HTTP_PROXY: 'http://127.0.0.1:1',
    HTTPS_PROXY: 'http://127.0.0.1:1',
    ALL_PROXY: 'http://127.0.0.1:1',
    NO_PROXY: '127.0.0.1,localhost',
  };
  // The development control exercises the preserved full native executable.
  // Installed-package CI uses the actual default runner and byte admission.
  const runCommand = development
    ? async ({ command, args, env: selected, cwd }) => {
        assert.equal(command, binary);
        const pending = execute('prlimit', ['--data=536870912', '--stack=16777216', '--core=0', '--', binary, ...args], {
          env: selected,
          cwd,
          detached: true,
          maxBuffer: 262144,
          signal: globalThis.AbortSignal.timeout(20000),
          killSignal: 'SIGKILL',
        });
        try {
          const result = await pending;
          return { code: 0, stdout: result.stdout, stderr: result.stderr };
        } finally {
          stopGroup(pending.child);
        }
      }
    : undefined;
  const options = { owner: 'fixture', repo: 'canonical', projectDir, baseCodexHome: canonical, env, codexPath: binary, runCommand };
  const first = await runCodexCapabilityPreflight(options);
  scopes.push(first);
  assert.ok(first.skillCatalog?.length > 0, 'The actual native prompt must expose its bundled skill catalog.');
  await assert.rejects(fs.lstat(path.join(first.codexHome, 'auth.json')), { code: 'ENOENT' });
  assert.equal(await fs.readFile(auth, 'utf8'), initial);
  await fs.writeFile(`${auth}.new`, replacement, { mode: 0o600 });
  await fs.rename(`${auth}.new`, auth);
  const second = await runCodexCapabilityPreflight(options);
  scopes.push(second);
  assert.notEqual(first.codexHome, second.codexHome);
  assert.ok(second.skillCatalog?.length > 0);
  await assert.rejects(fs.lstat(path.join(second.codexHome, 'auth.json')), { code: 'ENOENT' });
  await verifyCodexCapabilityExecutionCatalog({ ...options, capabilityPreflight: first });
  await first.dispose();
  assert.equal(await fs.readFile(auth, 'utf8'), replacement);
  await verifyCodexCapabilityExecutionCatalog({ ...options, capabilityPreflight: second });
  await fs.unlink(auth);
  await assert.rejects(verifyCodexCapabilityExecutionCatalog({ ...options, capabilityPreflight: second }), /Canonical Codex authentication storage/u);
  await assert.rejects(runCodexCapabilityPreflight(options), /Canonical Codex authentication storage/u);
  await fs.writeFile(auth, replacement, { mode: 0o600 });
  await fs.writeFile(path.join(second.codexHome, 'auth.json'), initial, { mode: 0o600 });
  await assert.rejects(verifyCodexCapabilityExecutionCatalog({ ...options, capabilityPreflight: second }), /Canonical Codex authentication storage/u);
  assert.equal(await fs.readFile(auth, 'utf8'), replacement);
  console.log(`PASS: ${development ? 'unpackaged development' : 'actual installed-package'} native capability discovery preserves one selected credential authority across two tasks, atomic replacement, task disposal, logout and injected-private-auth refusal.`);
} finally {
  for (const scope of scopes) await scope.dispose();
  await fs.rm(root, { recursive: true, force: true });
}
