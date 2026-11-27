#!/usr/bin/env node
/** Required packaged-image stock gate. No auth, inference, repair or downloads. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { CODEX_STOCK_SKILLS, validateCodexStockSkills } from './codex-stock-skills.lib.mjs';
import { assertCodexStockSkillDiscovery } from './codex-stock-catalog.lib.mjs';
import { runAgentConfigAudit } from './agent-config-audit.lib.mjs';
import { verifyNativeGeminiCommand } from './native-gemini-command.lib.mjs';
import { verifyNativeCodexCommand } from './native-codex-command.lib.mjs';
import { discoverCodexStock, executeVersionProbe, probeEnvironment, withRuntimeProbeHome } from './agent-runtime-probe.lib.mjs';
import { getInstalledCodexStockManifest } from './codex-installed-stock.lib.mjs';

async function verifyPinnedCodexStock(command, { home, cwd, env }) {
  const result = await discoverCodexStock(command, cwd, { ...env, CODEX_SQLITE_HOME: path.join(home, '.codex') });
  assertCodexStockSkillDiscovery({ result, home, cwd });
  const stock = path.join(home, '.codex/skills/.system');
  const snapshot = await validateCodexStockSkills({ directory: stock });
  assert.notEqual(snapshot.get(stock), 'missing', 'Stock CLI did not materialize its pinned runtime.');
  await writeFile(path.join(home, '.codex/config.toml'), '[features]\nremote_plugin = false\nplugins = false\napps = false\n');
  await runAgentConfigAudit({ tool: 'codex', homeDir: home, autoRepair: false, requireClean: true });
}

export async function verifyToolDataRuntimeVersions({ homeDir, cwd, agentCommand = 'agent', opencodeCommand = 'opencode', geminiCommand = 'gemini', qwenCommand = 'qwen', rgCommand = 'rg' }) {
  for (const [command, expected] of [
    [agentCommand, '0.27.2'],
    [opencodeCommand, '1.19.5'],
    [geminiCommand, '0.65.0'],
    [qwenCommand, '0.27.0'],
  ]) {
    const { stdout } = await executeVersionProbe(command, { env: probeEnvironment(homeDir), cwd, maxBuffer: 64 * 1024 });
    assert.equal(stdout.trim(), expected, 'Installed data-storage CLI version differs from the pinned runtime.');
  }
  const { stdout } = await executeVersionProbe(rgCommand, { env: probeEnvironment(homeDir), cwd, maxBuffer: 16 * 1024 });
  assert.match(stdout, /^ripgrep \d+\.\d+\.\d+\b/u, 'Installed Agent search runtime is missing or unusable.');
}

/** Baseline/catalog probes, also exercised with isolated unit-test CLIs.
 * Production callers must use verifyAgentRuntime for native byte admission.
 */
export async function verifyAgentRuntimeBaseline({ homeDir = os.homedir(), env = {}, codexCommand = 'codex', claudeCommand = 'claude', agentCommand = 'agent', opencodeCommand = 'opencode', geminiCommand = 'gemini', qwenCommand = 'qwen' } = {}) {
  await runAgentConfigAudit({ homeDir, env, autoRepair: false, requireClean: true });
  await withRuntimeProbeHome(async ({ home, cwd, env: probeEnv }) => {
    for (const [command, expected] of [
      [claudeCommand, '2.1.319 (Claude Code)'],
      [codexCommand, CODEX_STOCK_SKILLS.cliVersion],
    ]) {
      const { stdout } = await executeVersionProbe(command, { env: { ...probeEnv, CODEX_SQLITE_HOME: path.join(home, '.codex') }, cwd, maxBuffer: 64 * 1024 });
      assert.equal(stdout.trim(), expected, 'Installed CLI version differs from the pinned runtime.');
    }
    await verifyPinnedCodexStock(codexCommand, { home, cwd, env: probeEnv });
    await verifyNativeGeminiCommand({ command: geminiCommand });
    await verifyToolDataRuntimeVersions({ homeDir: home, cwd, agentCommand, opencodeCommand, geminiCommand, qwenCommand });
    await runAgentConfigAudit({ homeDir, env, autoRepair: false, requireClean: true });
  });
}

/** Audit selected roots and admit the packaged CLI before any native execution. */
export async function verifyAgentRuntime(options = {}) {
  const { homeDir = os.homedir(), env = {}, codexCommand = 'codex' } = options;
  await runAgentConfigAudit({ homeDir, env, autoRepair: false, requireClean: true });
  const native = await verifyNativeCodexCommand({ command: codexCommand, searchPath: env.PATH ?? process.env.PATH });
  if (!env.HIVE_MIND_IMAGE_NATIVE_BIN) {
    await verifyAgentRuntimeBaseline({ ...options, codexCommand: native.entrypoint });
    return;
  }
  await verifyNativeGeminiCommand({ command: options.geminiCommand });
  await withRuntimeProbeHome(async ({ home, cwd, env: probeEnv }) => {
    await verifyPinnedCodexStock(native.entrypoint, { home, cwd, env: probeEnv });
    for (const command of [options.claudeCommand ?? 'claude', options.agentCommand ?? 'agent', options.opencodeCommand ?? 'opencode', options.geminiCommand ?? 'gemini', options.qwenCommand ?? 'qwen', 'copilot', 'rg']) {
      const { stdout } = await executeVersionProbe(command, { env: probeEnv, cwd, maxBuffer: 64 * 1024 });
      assert.match(stdout.trim(), /(?:^|\s)\d+\.\d+\.\d+\b/u, `Installed ${command} runtime did not report a version.`);
    }
  });
  await getInstalledCodexStockManifest(env);
  await runAgentConfigAudit({ homeDir, env, autoRepair: false, requireClean: true });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    await verifyAgentRuntime({ env: process.env });
    console.log('Installed CLI versions, native Codex and Gemini adapters, and the clean Codex stock runtime verified.');
  } catch (error) {
    if (process.env.HIVE_MIND_AGENT_RUNTIME_DEBUG === '1') console.error(error);
    console.error('Installed agent runtime verification failed. Check installed CLI commands and restore a verified clean baseline.');
    process.exitCode = 1;
  }
}
