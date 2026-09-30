/**
 * @hive-mind-test-suite default
 * The real matrix leaked its task-owned Formal AI server on both success and
 * tool failure: the synchronous exit hook ran after child-process diagnostics.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const runtimeUrl = new URL('../src/formal-ai-runtime.lib.mjs', import.meta.url).href;
const exitUrl = new URL('../src/exit-handler.lib.mjs', import.meta.url).href;

for (const code of [0, 1]) {
  test(`safeExit(${code}) awaits owned servers and removes client homes before exit`, { timeout: 15_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'hive-runtime-shutdown-'));
    const record = join(root, 'stopped.json');
    try {
      const child = spawnSync(
        process.execPath,
        [
          '--input-type=module',
          '--eval',
          `
        import { prepareFormalAiRuntime } from ${JSON.stringify(runtimeUrl)};
        import { safeExit } from ${JSON.stringify(exitUrl)};
        import { writeFile } from 'node:fs/promises';
        import { setTimeout } from 'node:timers/promises';
        const stopped = [];
        const homes = [];
        for (const tool of ['claude', 'agent', 'codex']) {
          const runtime = await prepareFormalAiRuntime({
            tool, workdir: ${JSON.stringify(root)},
            env: { HIVE_MIND_FORMAL_AI_HOME_ROOT: ${JSON.stringify(root)}, ...(tool === 'codex' ? { HIVE_MIND_FORMAL_AI_BASE_URL: 'http://127.0.0.1:12346' } : {}) },
            deps: {
              readVersionImpl: async () => '0.352.1',
              probeBackendImpl: async () => ({ ok: true, version: '0.352.1', memory: { compatible: true } }),
              startServerImpl: async () => { if (tool === 'codex') throw new Error('External sidecars must not be started or stopped'); return { baseUrl: 'http://127.0.0.1:12345', stop: async () => {
                await setTimeout(20);
                stopped.push(tool);
                await writeFile(${JSON.stringify(record)}, JSON.stringify({ stopped, homes }));
              } }; },
              loadRegistryImpl: async () => [{ id: tool, default_protocol: 'openai', global_configs: [] }],
              seedImpl: async () => [], configureImpl: async () => {}, ghAuthImpl: async () => ({})
            }
          });
          homes.push(runtime.home);
        }
        await safeExit(${code}, 'matrix runtime shutdown');
      `,
        ],
        { encoding: 'utf8', timeout: 10_000 }
      );
      assert.equal(child.status, code, child.stderr);
      const evidence = JSON.parse(await readFile(record, 'utf8'));
      assert.deepEqual(evidence.stopped.sort(), ['agent', 'claude']);
      for (const home of evidence.homes) await assert.rejects(stat(home), { code: 'ENOENT' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
