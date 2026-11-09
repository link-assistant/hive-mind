// Issue #3785: print the model-visible Codex skill catalog with and without HIVE_MIND_CODEX_SYSTEM_SKILLS=1.
// Usage: node experiments/issue-3785/inspect-codex-default-catalog.mjs <absolute native codex binary>
import process from 'node:process';
import console from 'node:console';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const { runCodexCapabilityPreflight } = await import(path.resolve('src/codex-capability-preflight.lib.mjs'));
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);
const binary = process.argv[2];
for (const on of [false, true]) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-cat-'));
  const canonical = path.join(root, 'c'),
    home = path.join(root, 'h'),
    projectDir = path.join(root, 'p');
  for (const d of [canonical, home, projectDir]) await fs.mkdir(d, { mode: 0o700 });
  await fs.writeFile(path.join(canonical, 'config.toml'), 'model="gpt-5.5"\nmodel_provider="offline"\n[features]\nremote_plugin=false\napps=false\n[model_providers.offline]\nname="Offline"\nbase_url="http://127.0.0.1:1/v1"\nwire_api="responses"\nrequires_openai_auth=false\n');
  await fs.writeFile(path.join(canonical, 'auth.json'), '{"OPENAI_API_KEY":"sk-SYNTHETIC"}', { mode: 0o600 });
  const env = { PATH: process.env.PATH, HOME: home, CODEX_HOME: canonical, CODEX_AUTH_HOME: canonical, RUST_LOG: 'off', GIT_CONFIG_GLOBAL: '/dev/null', HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1', NO_PROXY: '127.0.0.1,localhost', ...(on ? { HIVE_MIND_CODEX_SYSTEM_SKILLS: '1' } : {}) };
  const runCommand = async ({ args, env: e, cwd }) => {
    const r = await execute(binary, args, { env: e, cwd, maxBuffer: 1 << 20, timeout: 20000 });
    return { code: 0, stdout: r.stdout, stderr: r.stderr };
  };
  const r = await runCodexCapabilityPreflight({
    owner: 'fixture',
    repo: 'canonical',
    projectDir,
    baseCodexHome: canonical,
    env,
    codexPath: binary,
    runCommand,
    log: async m => {
      if (/skill/i.test(m)) console.log('  log:', m.trim().slice(0, 200));
    },
  });
  console.log(
    on ? 'OPT-IN' : 'DEFAULT',
    'catalog',
    r.skillCatalog?.map(s => s.name),
    'fp',
    r.skillCatalogFingerprint,
    'required',
    r.required,
    'degraded',
    r.degraded
  );
  await r.dispose?.();
  await fs.rm(root, { recursive: true, force: true });
}
