#!/usr/bin/env node
/** Required packaged-image stock gate. No auth, inference, repair or downloads. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { CODEX_STOCK_SKILLS } from './codex-stock-skills.lib.mjs';
import { executeVersionProbe, probeEnvironment, withRuntimeProbe } from './agent-runtime-probe.lib.mjs';
import { probeCodexStock } from './codex-runtime-probe.lib.mjs';
import { runAgentConfigAudit } from './agent-config-audit.lib.mjs';
import { verifyNativeGeminiCommand } from './native-gemini-command.lib.mjs';
import { isStockCodexAllowed, verifyNativeCodexCommand, verifyStockCodexCommand } from './native-codex-command.lib.mjs';

export async function verifyToolDataRuntimeVersions({ homeDir, cwd, agentCommand = 'agent', opencodeCommand = 'opencode', geminiCommand = 'gemini', qwenCommand = 'qwen', rgCommand = 'rg', searchPath }) {
  for (const [command, expected] of [
    [agentCommand, '0.27.2'],
    [opencodeCommand, '1.19.5'],
    [geminiCommand, '0.65.0'],
    [qwenCommand, '0.27.0'],
  ]) {
    const { stdout } = await executeVersionProbe(command, { env: probeEnvironment(homeDir, searchPath), cwd, maxBuffer: 64 * 1024 });
    assert.equal(stdout.trim(), expected, 'Installed data-storage CLI version differs from the pinned runtime.');
  }
  const { stdout } = await executeVersionProbe(rgCommand, { env: probeEnvironment(homeDir, searchPath), cwd, maxBuffer: 16 * 1024 });
  assert.match(stdout, /^ripgrep \d+\.\d+\.\d+\b/u, 'Installed Agent search runtime is missing or unusable.');
}

/** Baseline and catalog probes, also exercised with isolated unit-test CLIs. */
export function verifyAgentRuntimeBaseline(options) {
  return verifyRuntime(options, false);
}

/** Audit selected roots and admit the installed Codex command before probing it. */
export function verifyAgentRuntime(options) {
  return verifyRuntime(options, true);
}

async function verifyRuntime({ homeDir = os.homedir(), env = {}, codexCommand = 'codex', claudeCommand = 'claude', agentCommand = 'agent', opencodeCommand = 'opencode', geminiCommand = 'gemini', qwenCommand = 'qwen', reportPhase = () => {} } = {}, requireAdmission) {
  const auditOptions = { homeDir, env, codexCommand, autoRepair: false, requireClean: true };
  reportPhase('global configuration audit');
  await runAgentConfigAudit(auditOptions);
  const searchPath = env.PATH ?? process.env.PATH;
  const selected = { command: codexCommand, searchPath };
  let codexRuntime;
  if (requireAdmission) {
    reportPhase('Codex command admission');
    const stock = isStockCodexAllowed(env) ? await verifyStockCodexCommand(selected) : null;
    codexRuntime = stock ?? (await verifyNativeCodexCommand(selected));
  }
  await withRuntimeProbe(async context => {
    reportPhase('Claude Code version probe');
    const { stdout } = await executeVersionProbe(claudeCommand, { ...context, maxBuffer: 64 * 1024 });
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)? \(Claude Code\)$/u.test(stdout.trim())) throw new Error('Installed Claude Code returned an invalid version label.');

    reportPhase('Codex version and stock catalog probe');
    const version = codexRuntime?.version ?? CODEX_STOCK_SKILLS.cliVersion.slice('codex-cli '.length);
    const manifest = codexRuntime?.stock ? undefined : CODEX_STOCK_SKILLS;
    if (manifest && manifest.cliVersion !== `codex-cli ${version}`) throw new Error('The bundled Codex stock manifest must match the packaged native runtime.');
    const stock = await probeCodexStock(codexRuntime?.entrypoint ?? codexCommand, context, { version, manifest });

    reportPhase('disposable Codex configuration audit');
    const { home, cwd } = context;
    await writeFile(path.join(home, '.codex/config.toml'), '[features]\nremote_plugin = false\nplugins = false\napps = false\n');
    await runAgentConfigAudit({ tool: 'codex', homeDir: home, codexStockManifest: stock, autoRepair: false, requireClean: true });
    reportPhase('native Gemini command admission');
    await verifyNativeGeminiCommand({ command: geminiCommand, searchPath });
    reportPhase('data-storage runtime probes');
    await verifyToolDataRuntimeVersions({ homeDir: home, cwd, agentCommand, opencodeCommand, geminiCommand, qwenCommand, searchPath });
    reportPhase('global configuration recheck');
    await runAgentConfigAudit({ ...auditOptions, codexStockManifest: codexRuntime?.stock ? stock : undefined });
  }, searchPath);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  let phase;
  try {
    await verifyAgentRuntime({ env: process.env, reportPhase: value => (phase = value) });
    console.log('Installed agent runtimes, global configuration and Codex stock skills verified.');
  } catch {
    console.error('Installed agent runtime verification failed. Check the installed runtimes and restore a verified clean baseline.');
    if (process.env.HIVE_MIND_AGENT_RUNTIME_DEBUG === '1' && phase) console.error(`Runtime verification stopped during ${phase}.`);
    process.exitCode = 1;
  }
}
