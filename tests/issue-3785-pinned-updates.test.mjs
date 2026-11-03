/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { AGENTIC_CLI_TARGETS, listAgenticCliUpdateTargets } from '../src/agentic-cli-updater.lib.mjs';

for (const dockerfile of ['Dockerfile', 'Dockerfile.dind', 'coolify/Dockerfile']) {
  test(`${dockerfile} keeps pinned runtimes out of automatic and command-triggered updates`, async () => {
    const content = await readFile(new URL(`../${dockerfile}`, import.meta.url), 'utf8');
    const excluded = content.match(/^ENV HIVE_MIND_AGENTIC_CLI_UPDATE_EXCLUDE=["']?([^\s"']+)/mu)?.[1];
    const env = { HIVE_MIND_AGENTIC_CLI_UPDATE_EXCLUDE: excluded };
    assert.deepEqual(listAgenticCliUpdateTargets(env, { only: ['claude', 'codex', 'agent', 'opencode', 'gemini', 'qwen'] }), [], 'launch-time freshness checks must preserve the attested CLI versions');
    assert.match(content, /bun install --backend=copyfile -g opencode-ai@1\.19\.4\b/u);
    assert.match(content, /bun install --backend=copyfile -g @google\/gemini-cli@0\.65\.0\b/u);
    assert.match(content, /bun install --backend=copyfile -g @qwen-code\/qwen-code@0\.26\.1\b/u);
    assert.deepEqual(
      listAgenticCliUpdateTargets(env).map(target => target.id),
      AGENTIC_CLI_TARGETS.filter(target => !['claude', 'codex', 'agent', 'opencode', 'gemini', 'qwen'].includes(target.id)).map(target => target.id),
      'other agentic and operational tools retain their update behavior'
    );
  });
}

test('outside pinned images the existing CLI update defaults remain available', () => {
  assert.deepEqual(listAgenticCliUpdateTargets({}), AGENTIC_CLI_TARGETS);
});
