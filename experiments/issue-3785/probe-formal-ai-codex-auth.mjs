/** Actual Formal AI configuration writes with synthetic canonical credentials. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';

const command = process.argv[2];
assert.ok(path.isAbsolute(command));
const moduleRoot = process.argv[3] || fileURLToPath(new URL('../../', import.meta.url));
const { seedFormalAiClientHome, configureFormalAiClientHome } = await import(pathToFileURL(path.join(moduleRoot, 'src/formal-ai-runtime.lib.mjs')));
const execute = promisify(execFile);
function stopGroup(child) {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'formal-ai-native-codex-auth-'));
let invocations = 0;
try {
  const canonical = path.join(root, 'canonical');
  const originalHome = path.join(root, 'operator-home');
  for (const directory of [canonical, originalHome]) await fs.mkdir(directory, { mode: 0o700 });
  const auth = path.join(canonical, 'auth.json');
  const initial = '{"OPENAI_API_KEY":"sk-SYNTHETIC-FORMAL-AI-ORIGINAL"}';
  const replacement = '{"OPENAI_API_KEY":"sk-SYNTHETIC-FORMAL-AI-REPLACEMENT"}';
  await fs.writeFile(auth, initial, { mode: 0o600 });
  const originalConfig = 'model="gpt-5.5"\n[features]\nremote_plugin=false\n';
  await fs.writeFile(path.join(canonical, 'config.toml'), originalConfig);
  const env = {
    PATH: '/usr/local/bin:/usr/bin:/bin',
    HOME: originalHome,
    CODEX_HOME: canonical,
    CODEX_AUTH_HOME: canonical,
    FORMAL_AI_API_KEY: 'SYNTHETIC-FORMAL-AI-KEY',
    XDG_CONFIG_HOME: path.join(root, 'xdg-config'),
    XDG_DATA_HOME: path.join(root, 'xdg-data'),
    XDG_STATE_HOME: path.join(root, 'xdg-state'),
    XDG_CACHE_HOME: path.join(root, 'xdg-cache'),
    TOKIO_WORKER_THREADS: '2',
    RUST_LOG: 'off',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    HTTP_PROXY: 'http://127.0.0.1:1',
    HTTPS_PROXY: 'http://127.0.0.1:1',
    ALL_PROXY: 'http://127.0.0.1:1',
    NO_PROXY: '127.0.0.1,localhost',
  };
  const run = async (binary, args, options) => {
    assert.equal(binary, command);
    invocations++;
    // Only synthetic fixture state reaches the real writer, including when
    // the production helper merges its caller's process environment.
    const pending = execute('prlimit', ['--data=536870912', '--stack=16777216', '--core=0', '--', command, ...args], {
      env: { ...env, HOME: options.env.HOME, CODEX_HOME: options.env.CODEX_HOME },
      cwd: root,
      detached: true,
      maxBuffer: 262144,
      signal: globalThis.AbortSignal.timeout(20000),
      killSignal: 'SIGKILL',
    });
    try {
      return await pending;
    } finally {
      stopGroup(pending.child);
    }
  };
  const version = (await run(command, ['--version'], { env })).stdout.trim();
  assert.match(version, /^formal-ai [0-9]+\.[0-9]+\.[0-9]+(?:[-+][a-zA-Z0-9.-]+)?$/u);
  console.log(`Native writer: ${version}`);
  const client = { id: 'codex', global_configs: [{ format: 'toml', path: '.codex/config.toml' }] };
  const homes = [];
  for (const [generation, expected] of [
    [0, initial],
    [1, replacement],
  ]) {
    if (generation) {
      await fs.writeFile(`${auth}.next`, replacement, { mode: 0o600 });
      await fs.rename(`${auth}.next`, auth);
    }
    const home = path.join(root, `task-${generation}`);
    homes.push(home);
    await seedFormalAiClientHome({ client, home, env });
    await configureFormalAiClientHome({ tool: 'codex', home, env, formalAiPath: command, baseUrl: 'http://127.0.0.1:1', run });
    await assert.rejects(fs.lstat(path.join(home, '.codex/auth.json')), { code: 'ENOENT' });
    assert.equal(await fs.readFile(auth, 'utf8'), expected);
    assert.equal(await fs.readFile(path.join(canonical, 'config.toml'), 'utf8'), originalConfig);
    const config = await fs.readFile(path.join(home, '.codex/config.toml'), 'utf8');
    assert.ok(config.includes('http://127.0.0.1:1'), 'The actual writer must configure the selected private provider.');
  }
  await fs.rm(homes[0], { recursive: true });
  assert.equal(await fs.readFile(auth, 'utf8'), replacement);
  await fs.unlink(auth);
  const before = invocations;
  await assert.rejects(seedFormalAiClientHome({ client, home: path.join(root, 'after-logout'), env }), /Canonical Codex authentication storage/u);
  await assert.rejects(configureFormalAiClientHome({ tool: 'codex', home: homes[1], env, formalAiPath: command, baseUrl: 'http://127.0.0.1:1', run }), /Canonical Codex authentication storage/u);
  assert.equal(invocations, before);
  console.log('PASS: actual Formal AI configuration writes preserve one selected Codex credential authority across two tasks, atomic replacement, private disposal and logout refusal without inference.');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
