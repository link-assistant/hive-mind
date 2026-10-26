/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDockerIsolationStartArgs } from '../src/isolation-runner.lib.mjs';
import { acquireRouterForTask, attachRouterTaskContainer } from '../src/router-task-isolation.lib.mjs';
import { wireRouterTaskContainer } from '../src/router-sidecar.lib.mjs';
import { ROUTER_ROUTE_DIALECTS } from '../src/router-routes.lib.mjs';

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

for (const options of [{ tool: 'gemini', env: {} }, { env: { HIVE_MIND_ROUTER_ROUTES: 'invalid-private-sentinel' } }, { env: { HIVE_MIND_ROUTER_URL: 'file:///private-sentinel' } }]) {
  test(`unusable Router route rejects before minting a task lease: ${JSON.stringify(options)}`, async () => {
    let acquired = 0;
    const result = await acquireRouterForTask({ backend: 'docker', useRouter: true, sessionId: 'router-admission', log: null, ...options, acquire: async () => (++acquired, { token: 'synthetic-task-token' }) });
    assert.equal(acquired, 0);
    assert.equal(result.router, null);
    assert.match(result.error, /Router/i);
    assert.ok(!result.error.includes('sentinel'));
  });
}

test('the launch dialect follows the lease through container attachment', async () => {
  const { router, error } = await acquireRouterForTask({ backend: 'docker', useRouter: true, tool: 'codex', sessionId: 'router-admission', env: { HIVE_MIND_ROUTER_IMAGE: 'konard/router:1.0.0' }, log: null, acquire: async () => ({ token: 'synthetic-task-token', baseUrl: 'https://router.test' }) });
  assert.equal(error, null);
  let wired;
  assert.equal(await attachRouterTaskContainer({ router, sessionId: 'router-admission', attach: async () => ({ attached: true }), wire: async options => ((wired = options), { wired: true }) }), null);
  assert.equal(wired.dialect?.id, 'canonical');
});

test('Codex container wiring uses the launch dialect rather than the global default', async () => {
  const commands = [];
  const result = await wireRouterTaskContainer({
    sessionId: 'router-admission',
    tool: 'codex',
    baseUrl: 'https://router.test',
    dialect: ROUTER_ROUTE_DIALECTS.canonical,
    githubMode: 'off',
    run: async (_binary, args) => {
      commands.push(args);
      return { stdout: args.includes('tls') ? '-----BEGIN CERTIFICATE-----\nsynthetic\n-----END CERTIFICATE-----' : '', stderr: '' };
    },
  });
  assert.equal(result.wired, true);
  assert.ok(commands.at(-1).at(-1).includes('https://router.test/api/services/codex/v1'));
});
