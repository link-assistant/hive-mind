/** Actual compiled metadata must remain independent of credentials and config. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';

const binary = process.argv[2];
const development = process.argv.includes('--unpackaged-development');
const installed = process.argv[3]?.startsWith('--') ? undefined : process.argv[3];
assert.ok(path.isAbsolute(binary));
const moduleRoot = installed || fileURLToPath(new URL('../../', import.meta.url));
const { fetchCodexCliCatalogue } = await import(pathToFileURL(path.join(moduleRoot, 'src/model-catalogue-fetch.lib.mjs')));
const { verifyNativeCodexCommand } = await import(pathToFileURL(path.join(moduleRoot, 'src/native-codex-command.lib.mjs')));
const command = development ? binary : (await verifyNativeCodexCommand({ command: binary })).entrypoint;
const execute = promisify(execFile);
function stopGroup(child) {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-native-model-catalogue-'));
try {
  const home = path.join(root, 'home');
  const privateHome = path.join(root, 'private');
  const canonical = path.join(root, 'canonical');
  for (const directory of [home, privateHome, canonical]) await fs.mkdir(directory, { mode: 0o700 });
  const config = 'model = [ deliberately invalid TOML\n';
  await fs.writeFile(path.join(privateHome, 'config.toml'), config, { mode: 0o600 });
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    CODEX_HOME: privateHome,
    ...(development ? {} : { CODEX_AUTH_HOME: canonical }),
    TOKIO_WORKER_THREADS: '2',
    RUST_LOG: 'off',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    HTTP_PROXY: 'http://127.0.0.1:1',
    HTTPS_PROXY: 'http://127.0.0.1:1',
    ALL_PROXY: 'http://127.0.0.1:1',
    NO_PROXY: '127.0.0.1,localhost',
  };
  const pending = execute(command, ['debug', 'models'], { env, detached: true, maxBuffer: 262144, signal: globalThis.AbortSignal.timeout(20000), killSignal: 'SIGKILL' });
  try {
    await assert.rejects(pending, error => error.code === 1 && /config\.toml|TOML/u.test(error.stderr), 'The control without --bundled must reject malformed private configuration.');
  } finally {
    stopGroup(pending.child);
  }
  const result = await fetchCodexCliCatalogue({ binary, env, timeoutMs: 20000 });
  assert.equal(result.status, 'ok', result.error);
  assert.ok(result.models.length > 0);
  assert.ok(
    result.models.some(model => model.supportedReasoningEfforts?.length > 0),
    'The real compiled catalogue must retain reasoning metadata.'
  );
  assert.equal(await fs.readFile(path.join(privateHome, 'config.toml'), 'utf8'), config);
  assert.deepEqual(await fs.readdir(canonical), []);
  await assert.rejects(fs.lstat(path.join(privateHome, 'auth.json')), { code: 'ENOENT' });
  console.log(`PASS: ${development ? 'unpackaged development' : 'actual installed-package'} Codex reads ${result.models.length} compiled model entries and reasoning metadata through the production reader despite malformed private configuration and absent credentials; the unbundled control refuses that configuration.`);
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
