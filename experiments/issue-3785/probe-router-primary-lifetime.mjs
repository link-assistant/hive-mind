#!/usr/bin/env node
// Claude/Codex lifetime uses bounded synthetic commands, never a provider.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { buildRouterCodexConfig, buildRouterTaskEnv } from '../../src/router-isolation.lib.mjs';
import { ROUTER_ROUTE_DIALECTS } from '../../src/router-routes.lib.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'router-primary-lifetime-'));
const inherited = { ...process.env };
fs.mkdirSync(path.join(root, 'tmp'));
Object.assign(process.env, { HOME: root, TMPDIR: path.join(root, 'tmp'), XDG_CONFIG_HOME: path.join(root, 'config'), XDG_DATA_HOME: path.join(root, 'data'), XDG_CACHE_HOME: path.join(root, 'cache'), HIVE_MIND_STATE_DIR: path.join(root, 'state'), HIVE_MIND_MODELS_HOT_LOAD: '0', HIVE_MIND_MAX_TRANSIENT_ERROR_RETRIES: '0' });
after(() => {
  for (const key of Object.keys(process.env)) if (!(key in inherited)) delete process.env[key];
  Object.assign(process.env, inherited);
  fs.rmSync(root, { recursive: true, force: true });
});
globalThis.use = async name => {
  const packageName = name.replace(/@\d[^/]*$/, '');
  if (packageName === 'command-stream') return { $: () => assert.fail('unexpected global native command') };
  if (packageName === 'fs') return { ...fs, default: fs };
  if (packageName === 'os') return { ...os, default: os };
  if (packageName === 'path') return { ...path, default: path };
  if (packageName === 'getenv') return (key, fallback) => process.env[key] ?? fallback;
  return import(packageName);
};

for (const [tool, suffix, model] of [
  ['claude', 'Claude', 'claude-sonnet-4-6'],
  ['codex', 'Codex', 'gpt-6.1-sol'],
]) {
  const execute = (await import(`../../src/${tool}.lib.mjs`))[`execute${suffix}Command`];
  for (const resume of [false, true])
    for (const useRouter of [false, true])
      for (const disposition of ['persistent', 'removed', 'ordinary', 'healthy']) {
        test(`Router ${tool} ${resume ? 'resume' : 'new'} ${useRouter ? 'argv' : 'env'} post-spawn ${disposition}`, { timeout: 10_000 }, async t => {
          const home = fs.mkdtempSync(path.join(root, `${tool}-`));
          const cwd = path.join(home, 'workspace');
          fs.mkdirSync(cwd);
          const env = { ...buildRouterTaskEnv({ tool, baseUrl: 'https://router.invalid', token: 'synthetic-router-task', homeDir: home, dialect: ROUTER_ROUTE_DIALECTS.canonical }), HOME: home, XDG_CONFIG_HOME: path.join(home, 'config'), XDG_DATA_HOME: path.join(home, 'data'), XDG_CACHE_HOME: path.join(home, 'cache'), HIVE_MIND_STATE_DIR: path.join(home, 'state'), HIVE_MIND_USE_ROUTER: useRouter ? '0' : '1', HIVE_MIND_ROUTER_AUTH_GUARD_INTERVAL_MS: '100' };
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
          let launchedEnv;
          let launches = 0;
          let kills = 0;
          let blocked = false;
          let notifyKilled;
          const killed = new Promise(resolve => {
            notifyKilled = resolve;
          });
          const dollar = options => () => {
            launchedEnv = options.env;
            assert.equal(++launches, 1, 'one bounded native command');
            return {
              result: { code: 0 },
              kill(signal) {
                assert.equal(signal, 'SIGKILL');
                kills++;
                notifyKilled();
              },
              async *stream() {
                const events =
                  tool === 'claude'
                    ? [
                        { type: 'system', subtype: 'init', session_id: 'synthetic-session' },
                        { type: 'result', subtype: 'success', result: 'Done.', num_turns: 1, is_error: false },
                      ]
                    : [
                        { type: 'thread.started', thread_id: 'synthetic-session' },
                        { type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } },
                      ];
                for (const event of events) yield { type: 'stdout', data: Buffer.from(JSON.stringify(event) + '\n') };
                yield { type: 'exit', code: 0 };
              },
            };
          };
          const result = await execute({
            tempDir: cwd,
            branchName: 'issue-3785-test',
            prompt: 'Synthetic request.',
            systemPrompt: 'Synthetic system.',
            argv: { tool, model, attribution: 'none', agentMemoryDisabled: false, auxiliaryModelCallsDisabled: false, useRouter, ...(resume ? { resume: 'synthetic-session' } : {}) },
            getLogFile: () => path.join(home, 'execution.log'),
            setLogFile: () => {},
            log: async text => {
              if (disposition === 'healthy' || !launches || blocked || !text.includes('Command details:')) return;
              blocked = true;
              if (disposition !== 'ordinary') fs.writeFileSync(path.join(home, '.git-credentials'), 'synthetic forbidden credential');
              let timer;
              try {
                await Promise.race([
                  killed,
                  new Promise(resolve => {
                    timer = setTimeout(resolve, 600);
                  }),
                ]);
                if (disposition === 'removed') fs.unlinkSync(path.join(home, '.git-credentials'));
                // Return an ordinary logging error before entering the output
                // iterator; the adapter must still close and preserve its guard.
                throw new Error('synthetic post-spawn logging failure');
              } finally {
                clearTimeout(timer);
              }
            },
            formatAligned: (_icon, label, value = '') => `${label} ${value}`,
            getResourceSnapshot: async () => ({ memory: 'Mem:\n available', load: '0.00' }),
            [`${tool}Path`]: tool,
            $: dollar,
            calculatePricing: async () => ({ totalCostUSD: null }),
            waitForRetryDelay: async () => assert.fail('security failure must not retry'),
          });
          if (disposition === 'healthy') {
            assert.equal(result.success, true, 'retain healthy new/resumed execution');
            assert.equal(launchedEnv.HIVE_MIND_USE_ROUTER, '1', 'forward explicit selection into the actual native environment');
            assert.equal(kills, 0, 'successful commands do not need cancellation');
            return;
          }
          assert.equal(blocked, true, 'exercise an actual post-command await');
          if (disposition === 'ordinary') {
            assert.equal(result.success, false);
            assert.equal(result.routerAuthViolation, undefined, 'ordinary failures remain ordinary');
            assert.equal(kills, 1, 'stop an abandoned native command before closing its monitoring');
            fs.writeFileSync(path.join(home, '.git-credentials'), 'synthetic forbidden credential after completion');
            let timer;
            try {
              await new Promise(resolve => {
                timer = setTimeout(resolve, 250);
              });
            } finally {
              clearTimeout(timer);
            }
            assert.equal(kills, 1, 'a failed completed attempt must close its monitoring without a second stop');
          } else {
            assert.equal(kills, 1, 'monitoring must stop the native process before output consumption');
            assert.ok(result.routerAuthViolation, 'retain security refusal after the logging failure');
          }
        });
      }
}
