/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDockerIsolationStartArgs } from '../src/isolation-runner.lib.mjs';

for (const selected of [{ useRouter: true, env: {} }, { env: { HIVE_MIND_USE_ROUTER: '1' } }]) {
  test(`selected Router without a task token rejects before inspecting vendor mounts: ${JSON.stringify(selected)}`, async () => {
    let inspected = 0;
    await assert.rejects(buildDockerIsolationStartArgs('solve', [], { ...selected, existsSync: () => ++inspected }), /Router.*token/i);
    assert.equal(inspected, 0);
  });
}

test('invalid selected Router endpoint rejects without exposing its value', async () => {
  await assert.rejects(buildDockerIsolationStartArgs('solve', [], { useRouter: true, routerToken: 'synthetic-task-token', env: { HIVE_MIND_ROUTER_URL: 'file:///private-endpoint-sentinel' } }), error => /Router.*origin/i.test(error.message) && !error.message.includes('sentinel'));
});

test('a Router dialect without a route for the selected tool rejects before native fallback', async () => {
  await assert.rejects(buildDockerIsolationStartArgs('solve', [], { tool: 'gemini', useRouter: true, routerToken: 'synthetic-task-token', env: { HIVE_MIND_ROUTER_IMAGE: 'konard/router:0.125.4' } }), /Router.*route/i);
});

test('task routing uses the selected image dialect from the launch environment', async () => {
  const args = await buildDockerIsolationStartArgs('solve', [], { sessionId: 'router-admission', tool: 'claude', useRouter: true, routerToken: 'synthetic-task-token', env: { HIVE_MIND_ROUTER_IMAGE: 'konard/router:1.0.0' }, existsSync: () => false, installGuard: async () => ({ installed: false }) });
  assert.ok(args.some(value => value.startsWith('ANTHROPIC_BASE_URL=') && value.endsWith('/api/services/anthropic')));
});
