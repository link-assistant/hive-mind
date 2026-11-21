#!/usr/bin/env node
// Synthetic thenable native commands exercise actual connection validators.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { buildRouterCodexConfig, buildRouterTaskEnv } from '../../src/router-isolation.lib.mjs';
import { ROUTER_ROUTE_DIALECTS } from '../../src/router-routes.lib.mjs';
import { defaultModels } from '../../src/models/catalog.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'router-connection-lifetime-'));
const inherited = { ...process.env };
fs.mkdirSync(path.join(root, 'tmp'));
Object.assign(process.env, { HOME: root, TMPDIR: path.join(root, 'tmp'), XDG_CONFIG_HOME: path.join(root, 'config'), XDG_DATA_HOME: path.join(root, 'data'), XDG_CACHE_HOME: path.join(root, 'cache'), HIVE_MIND_STATE_DIR: path.join(root, 'state'), HIVE_MIND_MODELS_HOT_LOAD: '0', HIVE_MIND_MAX_TRANSIENT_ERROR_RETRIES: '0' });
after(() => {
  for (const name of Object.keys(process.env)) if (!(name in inherited)) delete process.env[name];
  Object.assign(process.env, inherited);
  fs.rmSync(root, { recursive: true, force: true });
});
let createCommand;
const dollar = (options, ...values) => (Array.isArray(options) ? createCommand({}, options, values) : (strings, ...args) => createCommand(options, strings, args));
globalThis.use = async name => {
  const packageName = name.replace(/@\d[^/]*$/, '');
  if (packageName === 'command-stream') return { $: dollar };
  if (packageName === 'fs') return { ...fs, default: fs };
  if (packageName === 'os') return { ...os, default: os };
  if (packageName === 'path') return { ...path, default: path };
  if (packageName === 'getenv') return (key, fallback) => process.env[key] ?? fallback;
  return import(packageName);
};

const toolCases = [
  ['claude', 'Claude', 'claude-sonnet-4-6'],
  ['codex', 'Codex', 'gpt-6.1-sol'],
  ['agent', 'Agent', 'sonnet'],
  ['opencode', 'OpenCode', 'sonnet'],
  ['gemini', 'Gemini', 'gemini-2.5-pro'],
  ['qwen', 'Qwen', 'qwen3-coder-plus'],
];
// Register tests only after every import: a filtered early group can otherwise
// finish and run the global cleanup before a later import registers its tests.
const validators = new Map();
for (const [tool, suffix] of toolCases) validators.set(tool, (await import(`../../src/${tool}.lib.mjs`))[`validate${suffix}Connection`]);
for (const [tool, , model] of toolCases) {
  const validate = validators.get(tool);
  for (const useRouter of [false, true, null])
    for (const scenario of useRouter === null ? ['healthy'] : ['healthy', 'version persistent', 'version removed', 'paid persistent', 'paid removed']) {
      test(`${useRouter === null ? 'Ordinary' : 'Router'} ${tool} ${useRouter ? 'argv' : 'env'} connection lifetime: ${scenario}`, { timeout: 10_000 }, async t => {
        const home = fs.mkdtempSync(path.join(root, `${tool}-`));
        const env = { ...buildRouterTaskEnv({ tool, baseUrl: 'https://router.invalid', token: 'synthetic-router-task', homeDir: home, dialect: ROUTER_ROUTE_DIALECTS.canonical }), HOME: home, XDG_CONFIG_HOME: path.join(home, 'config'), XDG_DATA_HOME: path.join(home, 'data'), XDG_CACHE_HOME: path.join(home, 'cache'), HIVE_MIND_STATE_DIR: path.join(home, 'state'), GEMINI_CLI_HOME: home, QWEN_HOME: path.join(home, '.qwen'), HIVE_MIND_USE_ROUTER: useRouter === null || useRouter ? '0' : '1', HIVE_MIND_ROUTER_AUTH_GUARD_INTERVAL_MS: '100' };
        const freeAgent = tool === 'agent' && useRouter === null;
        const existingAgentConfig = { mcp: { playwright: { enabled: false } }, provider: { kilo: { options: { baseURL: 'https://synthetic-kilo.invalid' }, models: { existing: { id: 'synthetic-existing' } } } } };
        if (freeAgent) env.LINK_ASSISTANT_AGENT_CONFIG_CONTENT = JSON.stringify(existingAgentConfig);
        if (tool === 'codex') {
          fs.mkdirSync(env.CODEX_HOME, { recursive: true });
          fs.writeFileSync(path.join(env.CODEX_HOME, 'config.toml'), buildRouterCodexConfig({ baseUrl: 'https://router.invalid', dialect: ROUTER_ROUTE_DIALECTS.canonical }));
        }
        for (const [name, value] of Object.entries(env)) {
          const before = process.env[name];
          process.env[name] = value;
          t.after(() => {
            if (before === undefined) delete process.env[name];
            else process.env[name] = before;
          });
        }
        const file = ['agent', 'opencode'].includes(tool) ? path.join(env.XDG_DATA_HOME, tool === 'agent' ? 'link-assistant-agent' : 'opencode', 'auth.json') : ['gemini', 'qwen'].includes(tool) ? path.join(home, `.${tool}`, 'oauth_creds.json') : path.join(home, '.git-credentials');
        if (useRouter === null) {
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, '{"synthetic":"ordinary native credentials remain available"}');
        }
        let calls = 0;
        let kills = 0;
        const nativeEnvironments = [];
        const nativeArguments = [];
        createCommand = (options, strings, values) => {
          assert.ok(++calls <= 2, 'bounded version and paid native probes');
          const version = strings.join(' ').includes('--version');
          nativeEnvironments.push({ ...(options.env || process.env) });
          nativeArguments.push(values);
          let notify;
          const stopped = new Promise(resolve => {
            notify = resolve;
          });
          return {
            kill(signal) {
              assert.equal(signal, 'SIGKILL');
              kills++;
              notify();
            },
            then(resolve, reject) {
              return (async () => {
                if (scenario.startsWith(version ? 'version' : 'paid')) {
                  fs.mkdirSync(path.dirname(file), { recursive: true });
                  fs.writeFileSync(file, '{"synthetic":"non-Router authority"}');
                  let timer;
                  try {
                    await Promise.race([
                      stopped,
                      new Promise(done => {
                        timer = setTimeout(done, 600);
                      }),
                    ]);
                    if (scenario.endsWith('removed')) fs.unlinkSync(file);
                    throw new Error('synthetic native probe stopped');
                  } finally {
                    clearTimeout(timer);
                  }
                }
                return { code: 0, stdout: version ? '99.0.0' : '', stderr: '' };
              })().then(resolve, reject);
            },
          };
        };
        let result;
        let error;
        try {
          result = tool === 'codex' ? await validate(model, false, { useRouter }) : tool === 'qwen' ? await validate(model, 'qwen', { useRouter }) : await validate(freeAgent ? defaultModels.agent : model, { useRouter });
        } catch (caught) {
          error = caught;
        }
        if (scenario === 'healthy') {
          assert.equal(result, true, 'healthy validation remains available');
          assert.deepEqual(
            nativeEnvironments.map(value => value.HIVE_MIND_USE_ROUTER),
            useRouter === null ? ['0', '0'] : ['1', '1'],
            'both native probes receive the selected mode'
          );
          assert.equal(kills, 0);
          if (useRouter === null) assert.ok(fs.existsSync(file), 'ordinary credential storage is preserved');
          if (freeAgent) {
            assert.deepEqual(JSON.parse(nativeEnvironments[0].LINK_ASSISTANT_AGENT_CONFIG_CONTENT), existingAgentConfig, 'version probing preserves the original inline config');
            const config = JSON.parse(nativeEnvironments[1].LINK_ASSISTANT_AGENT_CONFIG_CONTENT);
            const definition = config.provider.kilo.models['nemotron-3-super-free'];
            assert.equal(definition.id, 'nvidia/nemotron-3-super-120b-a12b:free');
            assert.deepEqual(definition.cost, { input: 0, output: 0, cache_read: 0, cache_write: 0 });
            assert.deepEqual(config.mcp, existingAgentConfig.mcp);
            assert.deepEqual(config.provider.kilo.options, existingAgentConfig.provider.kilo.options);
            assert.deepEqual(config.provider.kilo.models.existing, existingAgentConfig.provider.kilo.models.existing);
            assert.ok(nativeArguments[1].includes('kilo/nemotron-3-super-free'), 'the actual validation child receives the mapped free model');
          }
        } else assert.deepEqual({ securityRefusal: Boolean(error?.routerAuthViolation), calls, kills }, { securityRefusal: true, calls: scenario.startsWith('version') ? 1 : 2, kills: 1 }, 'stop a running connection probe and retain its refusal before ordinary fallback');
      });
    }
}
