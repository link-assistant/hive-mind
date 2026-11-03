#!/usr/bin/env node
// Production factory/guard contract only; no native CLI, provider or real token.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildRouterCodexConfig, buildRouterTaskEnv } from '../../src/router-isolation.lib.mjs';
import { ROUTER_ROUTE_DIALECTS } from '../../src/router-routes.lib.mjs';
import { inspectRouterAuthSurface } from '../../src/router-auth-guard.lib.mjs';

for (const tool of ['claude', 'agent', 'codex', 'opencode', 'qwen', 'gemini']) {
  test(`Router factory forwards the selected native dialect for ${tool}`, { timeout: 10_000 }, () => {
    const env = buildRouterTaskEnv({ tool, baseUrl: 'https://router.invalid', token: 'synthetic-router-task', dialect: ROUTER_ROUTE_DIALECTS.canonical });
    assert.equal(env.HIVE_MIND_ROUTER_ROUTES, 'canonical', 'nested launch admission must retain the already-selected dialect');
  });
  for (const scenario of ['healthy', 'changed key', 'missing key', 'changed endpoint', 'missing origin', 'invalid dialect']) {
    test(`Router launch environment ${tool}: ${scenario}`, { timeout: 10_000 }, t => {
      const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'router-task-environment-'));
      t.after(() => fs.rmSync(homeDir, { recursive: true, force: true }));
      const cwd = path.join(homeDir, 'workspace');
      fs.mkdirSync(cwd);
      const dialect = ROUTER_ROUTE_DIALECTS.canonical;
      const env = { ...buildRouterTaskEnv({ tool, baseUrl: 'https://router.invalid', token: 'synthetic-router-task', homeDir, dialect }), HOME: homeDir };
      const anthropic = ['claude', 'agent'].includes(tool);
      const key = anthropic ? 'ANTHROPIC_API_KEY' : tool === 'gemini' ? 'GEMINI_API_KEY' : 'OPENAI_API_KEY';
      const endpoint = anthropic ? 'ANTHROPIC_BASE_URL' : tool === 'gemini' ? 'GOOGLE_GEMINI_BASE_URL' : 'OPENAI_BASE_URL';
      if (scenario === 'changed key') env[key] = 'SYNTHETIC-UNRELATED-VENDOR-KEY';
      if (scenario === 'missing key') delete env[key];
      if (scenario === 'changed endpoint') env[endpoint] = 'https://vendor.invalid/v1';
      if (scenario === 'missing origin') delete env.HIVE_MIND_ROUTER_URL;
      if (scenario === 'invalid dialect') env.HIVE_MIND_ROUTER_ROUTES = 'SYNTHETIC-PRIVATE-DIALECT';
      if (tool === 'codex') {
        fs.mkdirSync(env.CODEX_HOME);
        let text = buildRouterCodexConfig({ baseUrl: 'https://router.invalid', dialect });
        if (scenario === 'changed endpoint') text = text.replace('https://router.invalid/api/services/codex/v1', env.OPENAI_BASE_URL);
        fs.writeFileSync(path.join(env.CODEX_HOME, 'config.toml'), text);
      }
      const result = inspectRouterAuthSurface({ tool, env, homeDir, cwd });
      if (process.env.HIVE_MIND_ROUTER_PROBE_DEBUG === '1' && tool === 'codex' && scenario === 'healthy') t.diagnostic(JSON.stringify(result));
      assert.equal(result.violations.length > 0, scenario !== 'healthy', 'Only the factory-selected task credential and route may be admitted.');
      assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC-UNRELATED-VENDOR-KEY|SYNTHETIC-PRIVATE-DIALECT/);
    });
  }
}
