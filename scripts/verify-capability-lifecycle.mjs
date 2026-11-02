#!/usr/bin/env node
// Issue #3785 (PR #3786 review): installed-tool capability lifecycle gate.
//
// One synthetic operator home goes through the events that repopulated the
// global profile on a real deployment, with the installed Claude Code and
// Codex binaries and the production Hive Mind entry points:
//
//   P1 deployment probes (version, login, MCP list, one model call each)
//   P2 positive control: a pre-#3785 home *does* receive account skill sync,
//      the curated plugin catalog and hosted connectors from the same
//      provider; the production audit detects and repairs it, and the next
//      native start stays clean (pins, not a one-time cleanup, prevent it)
//   P3 the idle CLI updater (`updateAgenticClisWhenIdle`) and a native start
//      with the binaries it installed
//   P4 task completion: Codex repository-scoped preflight + `codex exec` +
//      dispose, and a Claude task with the minimal task environment
//   P5 root restart: the Telegram startup audit admits the home unchanged
//   P6 Router restart: acquire/stop/acquire/stop of the real sidecar image on
//      an `--internal` upstream network, then a native start
//   P7 restore of the accumulating maintenance archive (history + a
//      contaminated capability snapshot): the startup audit removes the
//      capability state, history stays byte-identical, auth is untouched
//
// After every phase two independent checks run:
//   - capability: the gate's own manifest scan (scripts/capability-lifecycle-
//     state.lib.mjs), the production audit with repair disabled and
//     requireClean, and the provider's record of capability endpoints;
//   - canonical: auth and pre-existing history keep their bytes and identity.
//
// Every credential, account and conversation is synthetic. All vendor API,
// OAuth and account hosts are answered by a loopback provider; only package
// and binary download hosts are tunnelled (not decrypted). Output names phases,
// counts and relative path categories only; native output goes to a private
// log inside the disposable fixture.
//
// Usage: node scripts/verify-capability-lifecycle.mjs [hive-launcher]
//   HIVE_LIFECYCLE_FIXTURE       parent directory for the fixture (default tmp)
//   HIVE_LIFECYCLE_BASELINE_HOME copy the image's Playwright-only baseline
//                                (settings, MCP registration, Codex config and
//                                stock system skills) from this home
//   HIVE_LIFECYCLE_SKIP=updater,router  skip phases explicitly (reported)
//   HIVE_LIFECYCLE_KEEP=1        keep the fixture for inspection
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startSyntheticVendorProvider } from './capability-lifecycle-provider.lib.mjs';
import { assertNoCapabilityTraffic, captureCanonicalState, classifyCapabilityTraffic, compareCanonicalState, scanCapabilityManifest } from './capability-lifecycle-state.lib.mjs';

const execFileAsync = promisify(execFile);
const launcher = process.argv[2] || fileURLToPath(new URL('../src/hive.mjs', import.meta.url));
const source = path.dirname(await fs.realpath(launcher));
const lib = name => import(pathToFileURL(path.join(source, name)));
const { parse: parseToml } = await import(pathToFileURL(createRequire(path.join(source, 'anchor.js')).resolve('smol-toml')));
const { runAgentConfigAudit, auditAgentConfig, AGENT_CONFIG_MINIMAL_ENV, CODEX_REMOTE_PLUGIN_DISABLE_ARGS, CODEX_PLUGIN_SYNC_DISABLE_ARGS, CODEX_HOSTED_APPS_DISABLE_ARGS } = await lib('agent-config-audit.lib.mjs');
const { CLAUDE_CLOUD_DISABLE_SETTINGS, CLAUDE_CLOUD_DISABLE_ENV } = await lib('claude-cloud-policy.lib.mjs');
const { ensureClaudeAuthAuthority, defaultClaudeAuthorityHome } = await lib('claude-auth-authority.lib.mjs');
const { runCodexCapabilityPreflight, applyCodexCapabilityEnv } = await lib('codex-capability-preflight.lib.mjs');

const skip = new Set(
  String(process.env.HIVE_LIFECYCLE_SKIP || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
);
const HOLD_MS = Number(process.env.HIVE_LIFECYCLE_HOLD_MS || 6000);
const fixtureParent = process.env.HIVE_LIFECYCLE_FIXTURE || os.tmpdir();
const fixture = await fs.mkdtemp(path.join(fixtureParent, 'hive-capability-lifecycle-'));
await fs.chmod(fixture, 0o700);
const privateLog = path.join(fixture, 'private-native.log');
const home = path.join(fixture, 'operator');
const work = path.join(fixture, 'work');
const stateDir = path.join(fixture, 'state');
const report = [];
const say = line => {
  report.push(line);
  process.stdout.write(`${line}\n`);
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const provider = await startSyntheticVendorProvider({ root: path.join(fixture, 'provider') });

// ---------------------------------------------------------------- utilities

/** Bounded native run in its own process group; output only reaches the private log. */
async function runNative(label, command, args, { env, cwd = work, timeoutMs = 150_000, hold = false } = {}) {
  let release = () => {};
  if (hold) provider.holdModels(new Promise(resolve => (release = resolve)));
  const child = spawn(command, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const chunks = [];
  let size = 0;
  const keep = chunk => {
    if ((size += chunk.length) <= 262_144) chunks.push(chunk);
  };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  const closed = new Promise(resolve => {
    child.once('error', error => resolve({ code: null, error: error.code || 'spawn-error' }));
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  const holdTimer = hold ? setTimeout(() => release(), HOLD_MS) : null;
  const timer = setTimeout(() => {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }, timeoutMs);
  const result = await closed;
  clearTimeout(timer);
  if (holdTimer) clearTimeout(holdTimer);
  release();
  provider.holdModels(null);
  // Background helpers a CLI leaves in its group must not outlive the step.
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    // No group left.
  }
  await fs.appendFile(privateLog, `\n### ${label}: ${command} ${args.join(' ')} -> ${result.code ?? result.signal ?? result.error}\n${Buffer.concat(chunks).toString('utf8')}`, { mode: 0o600 });
  return result;
}

/** Small bounded command whose stdout the gate parses (versions only; never auth). */
async function runCapture(command, args, env) {
  const { stdout } = await execFileAsync(command, args, { cwd: work, env, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
  return stdout;
}
const outcomeVersion = text => String(text).match(/\d+\.\d+\.\d+/u)?.[0] ?? null;

const baseEnv = (operatorHome, extra = {}) => ({ HOME: operatorHome, USER: os.userInfo().username, PATH: process.env.PATH, TERM: 'dumb', LANG: 'C.UTF-8', HIVE_MIND_STATE_DIR: stateDir, ...provider.env, ...extra });

/**
 * The probes a deployment (and an operator) runs right after start, plus one
 * model call each with the response held so background catalog/account sync
 * has its window.
 */
async function nativeStartup(label, operatorHome, env, { codexArgs = [] } = {}) {
  const outcome = {};
  outcome.claudeVersion = await runNative(`${label} claude --version`, 'claude', ['--version'], { env });
  outcome.claudeAuth = await runNative(`${label} claude auth status`, 'claude', ['auth', 'status'], { env });
  outcome.claudeMcp = await runNative(`${label} claude mcp list`, 'claude', ['mcp', 'list'], { env, timeoutMs: 90_000 });
  outcome.claudeModel = await runNative(`${label} claude -p`, 'claude', ['-p', 'ping', '--max-turns', '1'], { env, hold: true });
  outcome.codexVersion = await runNative(`${label} codex --version`, 'codex', ['--version'], { env });
  outcome.codexLogin = await runNative(`${label} codex login status`, 'codex', ['login', 'status'], { env });
  outcome.codexMcp = await runNative(`${label} codex mcp list`, 'codex', ['mcp', 'list'], { env, timeoutMs: 90_000 });
  outcome.codexModel = await runNative(`${label} codex exec`, 'codex', ['exec', '--json', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', ...codexArgs, 'echo synthetic'], { env, hold: true });
  for (const [step, result] of Object.entries(outcome)) {
    if (/Version|Model|Auth|Login/u.test(step)) assert.equal(result.code, 0, `${label}: native ${step} exited ${result.code ?? result.signal ?? result.error} (see the private log)`);
  }
  return outcome;
}

const syntheticClaudeCredentials = () => JSON.stringify({ claudeAiOauth: { accessToken: 'SYNTHETIC-ACCESS', refreshToken: 'SYNTHETIC-REFRESH', expiresAt: Date.now() + 6 * 3_600_000, scopes: ['user:inference', 'user:profile', 'user:sessions:claude_code'], subscriptionType: 'max', rateLimitTier: 'default_claude_max_20x' } });
const part = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const syntheticCodexAuth = () => {
  const idToken = `${part({ alg: 'none' })}.${part({ email: 'synthetic@example.invalid', 'https://api.openai.com/auth': { chatgpt_account_id: 'synthetic-account', chatgpt_user_id: 'synthetic-user', chatgpt_plan_type: 'plus' } })}.synthetic`;
  return JSON.stringify({ auth_mode: 'chatgpt', tokens: { id_token: idToken, access_token: 'SYNTHETIC-ACCESS', refresh_token: 'SYNTHETIC-REFRESH', account_id: 'synthetic-account' }, last_refresh: new Date().toISOString() });
};
const writePrivate = async (file, text) => {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.writeFile(file, text, { mode: 0o600 });
};

/** The image's Playwright-only baseline, or a synthetic equivalent. Never copies auth or history. */
async function writeBaseline(operatorHome, { hivePolicy }) {
  const baseline = process.env.HIVE_LIFECYCLE_BASELINE_HOME;
  const read = async relative => (baseline ? fs.readFile(path.join(baseline, relative), 'utf8').catch(() => null) : null);
  const settings = JSON.parse((await read('.claude/settings.json')) || '{}');
  for (const key of [...Object.keys(CLAUDE_CLOUD_DISABLE_SETTINGS), 'enabledPlugins', 'extraKnownMarketplaces']) delete settings[key];
  if (settings.env) for (const key of Object.keys(CLAUDE_CLOUD_DISABLE_ENV)) delete settings.env[key];
  if (hivePolicy) Object.assign(settings, CLAUDE_CLOUD_DISABLE_SETTINGS, { env: { ...settings.env, ...CLAUDE_CLOUD_DISABLE_ENV } });
  await writePrivate(path.join(operatorHome, '.claude/settings.json'), JSON.stringify(settings, null, 2));
  const state = JSON.parse((await read('.claude.json')) || '{}');
  // `--no-install`: an approved registration shape that never downloads anything.
  const playwright = state.mcpServers?.playwright ?? { type: 'stdio', command: 'npx', args: ['--no-install', '@playwright/mcp@latest', '--headless', '--isolated'], env: {} };
  await writePrivate(path.join(operatorHome, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true, mcpServers: { playwright } }, null, 2));
  const codexConfig = (await read('.codex/config.toml')) ?? '[mcp_servers.playwright]\ncommand = "npx"\nargs = ["--no-install", "@playwright/mcp@latest", "--headless", "--isolated"]\n';
  const parsed = parseToml(codexConfig);
  const playwrightTable = parsed.mcp_servers?.playwright;
  const pins = hivePolicy ? 'remote_plugin = false\nplugins = false\napps = false\n' : 'remote_plugin = false\n';
  const table = playwrightTable ? `\n[mcp_servers.playwright]\ncommand = ${JSON.stringify(playwrightTable.command)}\nargs = ${JSON.stringify(playwrightTable.args ?? [])}\n` : '';
  await writePrivate(path.join(operatorHome, '.codex/config.toml'), `[features]\n${pins}${table}`);
  if (baseline) await fs.cp(path.join(baseline, '.codex/skills/.system'), path.join(operatorHome, '.codex/skills/.system'), { recursive: true, verbatimSymlinks: true }).catch(error => (error.code === 'ENOENT' ? null : Promise.reject(error)));
}

const HISTORY = Object.freeze({
  claudeTranscript: `.claude/projects/-work/${randomUUID()}.jsonl`,
  claudeJournal: '.claude/history.jsonl',
  codexRollout: `.codex/sessions/2026/11/01/rollout-2026-11-01T00-00-00-${randomUUID()}.jsonl`,
  codexJournal: '.codex/history.jsonl',
});
const APPEND_ONLY = [HISTORY.claudeJournal, HISTORY.codexJournal];

async function writeSyntheticHistory(operatorHome) {
  const sessionId = path.basename(HISTORY.claudeTranscript, '.jsonl');
  await writePrivate(path.join(operatorHome, HISTORY.claudeTranscript), `${JSON.stringify({ type: 'user', sessionId, cwd: '/work', timestamp: '2026-11-01T00:00:00.000Z', uuid: randomUUID(), message: { role: 'user', content: 'synthetic history' } })}\n`);
  await writePrivate(path.join(operatorHome, HISTORY.claudeJournal), `${JSON.stringify({ display: 'synthetic history', pastedContents: {}, timestamp: 1793577600000, project: '/work', sessionId })}\n`);
  const threadId = HISTORY.codexRollout.slice(-41, -6);
  await writePrivate(path.join(operatorHome, HISTORY.codexRollout), `${JSON.stringify({ timestamp: '2026-11-01T00:00:00.000Z', type: 'session_meta', payload: { id: threadId, timestamp: '2026-11-01T00:00:00.000Z', cwd: '/work', originator: 'codex_exec', cli_version: '0.0.0', source: 'exec', model_provider: 'openai' } })}\n`);
  await writePrivate(path.join(operatorHome, HISTORY.codexJournal), `${JSON.stringify({ session_id: threadId, ts: 1793577600, text: 'synthetic history' })}\n`);
}

let canonicalPaths;
let canonicalBefore;
let phaseStart = 0;
const beginPhase = () => {
  phaseStart = provider.requests.length;
  provider.tunnels.clear();
  provider.refused.clear();
};

/** Two independent checks: capability state, then canonical auth/history. */
async function checkpoint(phase, { contentOnly = [] } = {}) {
  const manifest = await scanCapabilityManifest(home, { parseToml });
  assert.deepEqual(manifest, [], `${phase}: global capability state appeared: ${manifest.join(', ')}`);
  const { findings } = await runAgentConfigAudit({ homeDir: home, env: {}, autoRepair: false, requireClean: true });
  assert.equal(findings.length, 0, `${phase}: production audit reported ${findings.map(finding => `${finding.tool}:${finding.kind}`).join(', ')}`);
  const traffic = classifyCapabilityTraffic(provider.requests.slice(phaseStart), provider.tunnels);
  assertNoCapabilityTraffic(traffic, phase);
  const changed = compareCanonicalState(canonicalBefore, await captureCanonicalState(home, canonicalPaths), { appendOnly: APPEND_ONLY, contentOnly });
  assert.deepEqual(changed, [], `${phase}: canonical auth/history changed: ${changed.join(', ')}`);
  say(`✅ ${phase}: capability manifest empty, audit clean, 0 capability requests (${provider.requests.length - phaseStart} answered, ${provider.tunnels.size} download tunnel(s), ${provider.refused.size} refused origin(s)); ${canonicalPaths.length} canonical auth/history files unchanged`);
}

const codexTaskArgs = [...CODEX_REMOTE_PLUGIN_DISABLE_ARGS, ...CODEX_PLUGIN_SYNC_DISABLE_ARGS, ...CODEX_HOSTED_APPS_DISABLE_ARGS];
let routerNetwork = null;
let routerVolumeExisted = true;
let routerTouched = false;
let routerLib = null;
const routerEnv = () => ({ ...process.env, HIVE_MIND_STATE_DIR: stateDir, HIVE_MIND_ROUTER_UPSTREAM_NETWORK: routerNetwork });

try {
  await fs.mkdir(work, { recursive: true });
  await fs.mkdir(stateDir, { recursive: true, mode: 0o700 });

  // ------------------------------------------------------------ P0 baseline
  await writeBaseline(home, { hivePolicy: true });
  await writePrivate(path.join(home, '.claude/.credentials.json'), syntheticClaudeCredentials());
  await writePrivate(path.join(home, '.codex/auth.json'), syntheticCodexAuth());
  await writeSyntheticHistory(home);
  const env = baseEnv(home);
  const authority = await ensureClaudeAuthAuthority({ env, homeDir: home, establish: true });
  assert.equal(authority.mode, 'shared', 'P0: the synthetic Claude login must migrate into the default shared authority');
  const authorityCredentials = path.relative(home, path.join(defaultClaudeAuthorityHome(env, home), '.credentials.json'));
  canonicalPaths = [authorityCredentials, '.codex/auth.json', ...Object.values(HISTORY)];
  canonicalBefore = await captureCanonicalState(home, canonicalPaths);
  assert.ok([...canonicalBefore.values()].every(Boolean), 'P0: every canonical fixture file must exist');
  beginPhase();
  await checkpoint('P0 baseline (Playwright-only, default Claude authority)');

  // ------------------------------------------------ P1 deployment probes
  beginPhase();
  await nativeStartup('P1', home, env);
  await checkpoint('P1 deployment version/login/MCP/model probes with forced account sync');

  // ------------------------------------------------ P2 positive control
  const control = path.join(fixture, 'control');
  await writeBaseline(control, { hivePolicy: false });
  await writePrivate(path.join(control, '.claude/.credentials.json'), syntheticClaudeCredentials());
  await writePrivate(path.join(control, '.codex/auth.json'), syntheticCodexAuth());
  const controlEnv = baseEnv(control);
  const controlAuth = ['.claude/.credentials.json', '.codex/auth.json'];
  const controlAuthBefore = await captureCanonicalState(control, controlAuth);
  beginPhase();
  await runNative('P2 claude -p (pre-#3785 settings)', 'claude', ['-p', 'ping', '--max-turns', '1'], { env: controlEnv, hold: true });
  const curated = path.join(control, '.codex/.tmp/plugins');
  let release;
  provider.holdModels(new Promise(resolve => (release = resolve)));
  const codexControl = runNative('P2 codex exec (remote_plugin=false only)', 'codex', ['exec', '--json', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', 'echo synthetic'], { env: controlEnv });
  for (let waited = 0; waited < 90_000 && !(await fs.stat(curated).catch(() => null)); waited += 500) await sleep(500);
  await sleep(HOLD_MS);
  release();
  await codexControl;
  const controlTraffic = classifyCapabilityTraffic(provider.requests.slice(phaseStart), provider.tunnels);
  for (const channel of ['accountSync', 'curatedCatalog', 'hostedConnectors']) assert.ok(controlTraffic[channel].length > 0, `P2: positive control did not reproduce ${channel}; the provider no longer exercises this channel`);
  const contaminated = await scanCapabilityManifest(control, { parseToml });
  for (const expected of ['claude:skill:.claude/skills/', 'claude:policy:', 'codex:catalog:.codex/.tmp/plugins', 'codex:feature-pin:.codex/config.toml#features.apps'])
    assert.ok(
      contaminated.some(entry => entry.startsWith(expected)),
      `P2: manifest is missing ${expected}`
    );
  const controlAudit = auditAgentConfig({ homeDir: control, env: {} });
  const kinds = new Set(controlAudit.findings.map(finding => `${finding.tool}:${finding.kind}`));
  for (const expected of ['claude:skill', 'claude:cloud-capabilities', 'codex:marketplace', 'codex:curated-plugin-sync', 'codex:hosted-connectors']) assert.ok(kinds.has(expected), `P2: production audit missed ${expected}`);
  for (const finding of controlAudit.findings) if (['plugin', 'marketplace', 'plugin-state', 'skill'].includes(finding.kind)) assert.doesNotMatch(finding.detail, /\benabled\b/iu, `P2: ${finding.tool}:${finding.kind} presence is misreported as enabled`);
  say(`✅ P2 positive control (pre-#3785 home): ${controlTraffic.accountSync.length} account-sync, ${controlTraffic.curatedCatalog.length} curated-catalog and ${controlTraffic.hostedConnectors.length} hosted-connector request(s); manifest ${contaminated.length} entries; audit ${controlAudit.findings.length} findings (${[...kinds].sort().join(', ')}), none claims a cached item is enabled`);
  // The accumulating archive of a pre-#3785 deployment held exactly this state.
  const archiveStage = path.join(fixture, 'archive-stage');
  for (const relative of new Set(contaminated.map(entry => entry.split(':')[2].split('#')[0]))) await fs.cp(path.join(control, relative), path.join(archiveStage, relative), { recursive: true, verbatimSymlinks: true });
  await runAgentConfigAudit({ homeDir: control, env: {}, autoRepair: true, requireClean: true });
  assert.deepEqual(await scanCapabilityManifest(control, { parseToml }), [], 'P2: the production repair left capability state behind');
  assert.deepEqual(compareCanonicalState(controlAuthBefore, await captureCanonicalState(control, controlAuth)), [], 'P2: the production repair changed authentication');
  beginPhase();
  await runNative('P2 relaunch claude -p (repaired)', 'claude', ['-p', 'ping', '--max-turns', '1'], { env: controlEnv, hold: true });
  await runNative('P2 relaunch codex exec (repaired)', 'codex', ['exec', '--json', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', 'echo synthetic'], { env: controlEnv, hold: true });
  const relaunched = await scanCapabilityManifest(control, { parseToml });
  assert.deepEqual(relaunched, [], `P2: the next native start repopulated a repaired home: ${relaunched.join(', ')}`);
  assertNoCapabilityTraffic(classifyCapabilityTraffic(provider.requests.slice(phaseStart), provider.tunnels), 'P2 relaunch');
  say('✅ P2 repaired control: the next native Claude and Codex starts sent 0 capability requests and repopulated nothing (the persisted pins, not the cleanup, prevent recurrence)');

  // ------------------------------------------------ P3 CLI updater
  if (skip.has('updater')) say('⏭️  P3 idle CLI updater: SKIPPED by HIVE_LIFECYCLE_SKIP');
  else {
    const bunInstall = path.join(fixture, 'bun');
    const updaterEnv = { ...env, BUN_INSTALL: bunInstall, PATH: `${path.join(home, '.local/bin')}:${path.join(bunInstall, 'bin')}:${env.PATH}`, HIVE_MIND_AGENTIC_CLI_AUTO_UPDATE: '1' };
    // Stage the previous stable release of each CLI inside the synthetic home
    // so the updater really replaces both binaries instead of reporting them
    // current (the image always ships the latest).
    beginPhase();
    const previous = {};
    for (const [id, pkg, current] of [
      ['claude', '@anthropic-ai/claude-code', outcomeVersion(await runCapture('claude', ['--version'], updaterEnv))],
      ['codex', '@openai/codex', outcomeVersion(await runCapture('codex', ['--version'], updaterEnv))],
    ]) {
      const versions = JSON.parse(await runCapture('npm', ['view', pkg, 'versions', '--json'], updaterEnv)).filter(version => /^\d+\.\d+\.\d+$/u.test(version));
      const index = versions.indexOf(current);
      assert.ok(index > 0, `P3: cannot find a release before the installed ${id} ${current}`);
      previous[id] = versions[index - 1];
    }
    const stagedClaude = await runNative('P3 stage claude', 'claude', ['install', previous.claude], { env: updaterEnv, timeoutMs: 600_000 });
    const stagedCodex = await runNative('P3 stage codex', 'bun', ['install', '-g', `@openai/codex@${previous.codex}`], { env: updaterEnv, timeoutMs: 600_000 });
    assert.equal(stagedClaude.code, 0, `P3: staging claude ${previous.claude} failed (see the private log)`);
    assert.equal(stagedCodex.code, 0, `P3: staging codex ${previous.codex} failed (see the private log)`);
    assert.equal(outcomeVersion(await runCapture('claude', ['--version'], updaterEnv)), previous.claude, 'P3: the staged claude is not the one on PATH');
    assert.equal(outcomeVersion(await runCapture('codex', ['--version'], updaterEnv)), previous.codex, 'P3: the staged codex is not the one on PATH');
    await checkpoint(`P3 previous CLI releases installed (claude ${previous.claude}, codex ${previous.codex})`);
    beginPhase();
    await nativeStartup('P3 previous', home, updaterEnv);
    await checkpoint('P3 native start with the previous releases');
    beginPhase();
    const program = `const { updateAgenticClisWhenIdle } = await import(process.argv[1]);
      const result = await updateAgenticClisWhenIdle({ force: true, only: ['claude', 'codex'], getActiveTasksImpl: async () => [] });
      process.stdout.write(JSON.stringify({ status: result.status, updated: result.updated.map(({ id, from, to }) => ({ id, from, to })), upToDate: result.upToDate.map(({ id, version }) => ({ id, version })), failed: result.failed.map(({ id, error }) => ({ id, error: String(error).slice(0, 160) })) }));`;
    const child = await execFileAsync(process.execPath, ['--input-type=module', '-e', program, pathToFileURL(path.join(source, 'agentic-cli-updater.lib.mjs')).href], { cwd: work, env: updaterEnv, maxBuffer: 4 * 1024 * 1024, timeout: 900_000 });
    const updated = JSON.parse(child.stdout);
    assert.equal(updated.status, 'checked', `P3: updater status ${updated.status}`);
    assert.deepEqual(updated.failed, [], `P3: updater failures ${JSON.stringify(updated.failed)}`);
    assert.deepEqual(updated.updated.map(entry => entry.id).sort(), ['claude', 'codex'], 'P3: the updater must replace both staged CLIs');
    say(`ℹ️  P3 updater: updated [${updated.updated.map(entry => `${entry.id} ${entry.from}→${entry.to}`).join(', ')}], current [${updated.upToDate.map(entry => `${entry.id} ${entry.version}`).join(', ')}]`);
    await checkpoint('P3 idle CLI updater (claude update / bun install -g)');
    beginPhase();
    await nativeStartup('P3 updated', home, updaterEnv);
    await checkpoint('P3 first native start with the updated binaries');
  }

  // ------------------------------------------------ P4 task completion
  beginPhase();
  const projectDir = path.join(fixture, 'project');
  await fs.mkdir(projectDir, { recursive: true });
  await execFileAsync('git', ['init', '-q', projectDir]);
  const codexBase = { ...env, CODEX_HOME: path.join(home, '.codex') };
  const preflight = await runCodexCapabilityPreflight({ owner: 'synthetic-owner', repo: 'synthetic-repo', issueNumber: null, projectDir, codexPath: 'codex', env: codexBase, log: async line => fs.appendFile(privateLog, `\n[preflight] ${line}`) });
  try {
    assert.notEqual(path.resolve(preflight.codexHome), path.resolve(home, '.codex'), 'P4: the preflight must give the task a private CODEX_HOME');
    const taskEnv = applyCodexCapabilityEnv(codexBase, preflight);
    const taskArgs = preflight.plugins?.length ? CODEX_REMOTE_PLUGIN_DISABLE_ARGS : codexTaskArgs;
    const ran = await runNative('P4 codex task', 'codex', ['exec', '--json', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', ...taskArgs, 'echo synthetic'], { env: taskEnv, cwd: projectDir, hold: true });
    assert.equal(ran.code, 0, 'P4: the scoped Codex task failed (see the private log)');
  } finally {
    await preflight.dispose();
  }
  const claudeTask = await runNative('P4 claude task', 'claude', ['-p', 'ping', '--max-turns', '1'], { env: { ...env, ...AGENT_CONFIG_MINIMAL_ENV }, cwd: projectDir, hold: true });
  assert.equal(claudeTask.code, 0, 'P4: the Claude task failed (see the private log)');
  await checkpoint('P4 task completion (scoped Codex preflight + exec + dispose, Claude task)');

  // ------------------------------------------------ P5 root restart
  beginPhase();
  // The exact startup admission telegram-bot.mjs performs.
  const restart = await runAgentConfigAudit({ homeDir: home, env: {}, autoRepair: true, requireClean: true });
  assert.equal(restart.findings.length, 0, 'P5: the root restart audit had something to repair');
  await nativeStartup('P5', home, env);
  await checkpoint('P5 root restart (startup audit admits unchanged) + native start');

  // ------------------------------------------------ P6 Router restart
  if (skip.has('router')) say('⏭️  P6 Router restart: SKIPPED by HIVE_LIFECYCLE_SKIP');
  else {
    routerLib = await lib('router-sidecar.lib.mjs');
    const existing = await execFileAsync('docker', ['container', 'inspect', 'hive-mind-router']).then(
      () => true,
      () => false
    );
    assert.equal(existing, false, 'P6: a hive-mind-router container already exists on this daemon; refusing to restart an operator Router');
    routerVolumeExisted = await execFileAsync('docker', ['volume', 'inspect', 'hive-mind-router-data']).then(
      () => true,
      () => false
    );
    routerNetwork = `hive-lifecycle-upstream-${randomUUID().slice(0, 8)}`;
    // Synthetic credentials must have no route to any vendor.
    await execFileAsync('docker', ['network', 'create', '--internal', routerNetwork]);
    beginPhase();
    for (const round of [1, 2]) {
      routerTouched = true;
      const lease = await routerLib.acquireRouterSidecar({ sessionId: `lifecycle-${round}`, env: routerEnv(), homeDir: home, log: async line => fs.appendFile(privateLog, `\n[router] ${line}`) });
      assert.equal(lease.error, null, `P6: Router acquire ${round} failed (see the private log)`);
      assert.ok(lease.token?.startsWith('la_sk_'), 'P6: the Router must issue a scoped la_sk_ task token');
      await routerLib.stopRouterSidecar({ env: routerEnv(), reason: `lifecycle-${round}` });
    }
    await checkpoint('P6 Router start/stop/start/stop');
    beginPhase();
    await nativeStartup('P6', home, env);
    await checkpoint('P6 native start after Router restart');
  }

  // ------------------------------------------------ P7 archive restore
  for (const relative of Object.values(HISTORY)) await fs.cp(path.join(home, relative), path.join(archiveStage, relative));
  const archive = path.join(fixture, 'maintenance-archive.tar');
  await execFileAsync('tar', ['-cf', archive, '-C', archiveStage, '.']);
  const { stdout: archived } = await execFileAsync('tar', ['-tf', archive]);
  assert.ok(!/credentials|auth\.json/u.test(archived), 'P7: the maintenance archive must not contain authentication');
  await execFileAsync('tar', ['-xf', archive, '-C', home]);
  const restored = await scanCapabilityManifest(home, { parseToml });
  assert.ok(restored.length > 0, 'P7: restoring the archive should bring the archived capability state back');
  beginPhase();
  const admission = await runAgentConfigAudit({ homeDir: home, env: {}, autoRepair: true, requireClean: true });
  say(`ℹ️  P7 restore brought back ${restored.length} capability entr${restored.length === 1 ? 'y' : 'ies'}; startup audit repaired ${admission.repaired.length}`);
  await checkpoint('P7 archive restore + startup audit', { contentOnly: Object.values(HISTORY) });
  beginPhase();
  await nativeStartup('P7', home, env);
  await checkpoint('P7 native start after restore', { contentOnly: Object.values(HISTORY) });
  say(`✅ capability lifecycle gate passed (${[...skip].length ? `skipped: ${[...skip].join(', ')}` : 'no phase skipped'})`);
} catch (error) {
  process.stderr.write(`❌ ${error.message}\n`);
  if (process.env.HIVE_LIFECYCLE_KEEP === '1') process.stderr.write(`private fixture kept at ${fixture}\n`);
  process.exitCode = 1;
} finally {
  await provider.close();
  if (routerTouched && routerLib) await routerLib.stopRouterSidecar({ env: routerEnv(), reason: 'lifecycle-cleanup' }).catch(() => {});
  if (routerNetwork) await execFileAsync('docker', ['network', 'rm', routerNetwork]).catch(() => {});
  if (routerTouched && !routerVolumeExisted) await execFileAsync('docker', ['volume', 'rm', 'hive-mind-router-data']).catch(() => {});
  if (process.env.HIVE_LIFECYCLE_KEEP !== '1') await fs.rm(fixture, { recursive: true, force: true }).catch(error => process.stderr.write(`⚠️  fixture cleanup: ${error.code}\n`));
}
