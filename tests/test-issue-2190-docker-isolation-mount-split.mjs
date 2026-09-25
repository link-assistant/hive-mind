#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Issue #2190: split the auth files from the rest of the Claude/Codex
 * application folders for Docker-isolated tasks.
 *
 * Before the fix, `--isolation docker` mounted the whole `~/.claude`,
 * `~/.claude.json`, `~/.codex` and (for codex) `~/.agents` directories into the
 * task container. Two consequences:
 *
 *   1. a plugin synced into the host's global state (Superpowers via the Codex
 *      remote plugin catalog or the official Claude marketplace) was inherited
 *      by every task and made the agent refuse to work;
 *   2. a task could rewrite the host's global config (config.toml,
 *      settings.json, installed plugins) and thereby reconfigure every task
 *      that followed it.
 *
 * After the fix only the credential file and the session directories were
 * shared. Issue #2296 showed that a single-file credential mount goes stale on
 * the first host-side token rotation and cannot share the OAuth refresh lock,
 * so the config directory is shared again — with every entry that carries
 * plugins, skills, settings or memory overlaid by a per-task private copy. This
 * test keeps the #2190 guarantee under that layout.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildDockerIsolationStartArgs, DOCKER_ISOLATION_TOOL_MOUNTS, getDockerIsolationAuthMounts, prepareDockerIsolationHostPaths } from '../src/isolation-runner.lib.mjs';
import { getRouterSuppressedCredentialPaths } from '../src/router-isolation.lib.mjs';

let passed = 0;
let failed = 0;
function pass(label) {
  console.log(`  PASS: ${label}`);
  passed++;
}
function fail(label, expected, actual) {
  console.log(`  FAIL: ${label}`);
  console.log(`    expected: ${JSON.stringify(expected)}`);
  console.log(`    actual:   ${JSON.stringify(actual)}`);
  failed++;
}
function assertEqual(actual, expected, label) {
  if (actual === expected) pass(label);
  else fail(label, expected, actual);
}
function assertDeepEqual(actual, expected, label) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass(label);
  else fail(label, expected, actual);
}
const mountPairs = mounts => mounts.map(mount => `${mount.source}:${mount.target}`);

const HOME = '/home/box';
const url = 'https://github.com/link-assistant/hive-mind/issues/2190';

// The host state from the case study: a synced Superpowers plugin in both
// tools' global folders, plus the ordinary credential files and session dirs.
const host = new Set([`${HOME}/.config/gh`, `${HOME}/.gitconfig`, `${HOME}/.claude`, `${HOME}/.claude.json`, `${HOME}/.claude/.credentials.json`, `${HOME}/.claude/settings.json`, `${HOME}/.claude/projects`, `${HOME}/.claude/sessions`, `${HOME}/.claude/plugins/cache/claude-plugins-official/superpowers/6.3.0`, `${HOME}/.codex`, `${HOME}/.codex/auth.json`, `${HOME}/.codex/config.toml`, `${HOME}/.codex/sessions`, `${HOME}/.codex/plugins/cache/openai-curated-remote/superpowers/6.3.0`, `${HOME}/.agents`, `${HOME}/.agents/skills/superpowers`]);
const existsSync = candidate => host.has(candidate);

console.log('\n--- Reproduction: a task must not inherit the global application folder ---');

const SESSION = 'task-2190';
const privateDir = tool => `${HOME}/.hive-mind/docker-isolation/${SESSION}/${tool}`;
// The overlay sources exist once prepareDockerIsolationHostPaths has run.
const prepared = candidate => host.has(candidate) || candidate.startsWith(`${HOME}/.hive-mind/docker-isolation/`);
for (const tool of ['claude', 'codex']) {
  const args = buildDockerIsolationStartArgs('solve', [url, '--tool', tool], { tool, sessionId: SESSION, homeDir: HOME, env: {}, existsSync: prepared });
  const volumes = args.filter((value, index) => args[index - 1] === '--volume').map(volume => ({ source: volume.split(':')[0], target: volume.split(':')[1] }));
  const sources = volumes.map(volume => volume.source);
  const own = tool === 'claude' ? '.claude' : '.codex';
  const other = tool === 'claude' ? '.codex' : '.claude';
  assertEqual(sources.includes(`${HOME}/${other}`), false, `${tool}: the other tool's ${other} directory is not mounted`);
  assertEqual(sources.includes(`${HOME}/.claude.json`), false, `${tool}: ~/.claude.json (MCP/plugin registry) is not mounted`);
  assertEqual(sources.includes(`${HOME}/.agents`), false, `${tool}: ~/.agents (global skills) is not mounted`);
  assertEqual(sources.includes(`${HOME}/${own}`), true, `${tool}: ${own} is shared as a directory (credentials and refresh lock together, issue #2296)`);
  // Every host path that carries a plugin, skill, setting or config is shadowed by a private overlay mounted after the shared directory.
  const sharedIndex = sources.indexOf(`${HOME}/${own}`);
  for (const hostPath of [...host].filter(candidate => candidate.startsWith(`${HOME}/${own}/`) && /plugins|skills|settings\.json|config\.toml/.test(candidate))) {
    const covering = volumes.findIndex(volume => volume.source.startsWith(privateDir(tool)) && (hostPath === `${HOME}/${own}/${path.basename(volume.target)}` || hostPath.startsWith(`${HOME}/${own}/${path.basename(volume.target)}/`)));
    assertEqual(covering > sharedIndex, true, `${tool}: host ${path.relative(HOME, hostPath)} is hidden by a per-task overlay`);
  }
}

console.log('\n--- Exact mount list ---');

const overlayPairs = (tool, names) => names.map(name => `${privateDir(tool)}/${name}:${HOME}/.${tool}/${name}`);
assertDeepEqual(mountPairs(getDockerIsolationAuthMounts({ tool: 'claude', sessionId: SESSION, homeDir: HOME, env: {}, existsSync: prepared })), [`${HOME}/.config/gh:${HOME}/.config/gh`, `${HOME}/.gitconfig:${HOME}/.gitconfig`, `${HOME}/.claude:${HOME}/.claude`, ...overlayPairs('claude', ['plugins', 'skills', 'agents', 'commands', 'hooks', 'output-styles', 'rules', 'settings.json', 'CLAUDE.md'])], 'claude: gh, git identity, the shared ~/.claude, then the private overlays — nothing else');
assertDeepEqual(mountPairs(getDockerIsolationAuthMounts({ tool: 'codex', sessionId: SESSION, homeDir: HOME, env: {}, existsSync: prepared })), [`${HOME}/.config/gh:${HOME}/.config/gh`, `${HOME}/.gitconfig:${HOME}/.gitconfig`, `${HOME}/.codex:${HOME}/.codex`, ...overlayPairs('codex', ['plugins', 'skills', 'rules', 'prompts', '.tmp', 'hive-mind', 'config.toml', 'AGENTS.md'])], 'codex: gh, git identity, the shared ~/.codex, then the private overlays — nothing else');
assertEqual(
  mountPairs(getDockerIsolationAuthMounts({ tool: 'claude', sessionId: SESSION, homeDir: HOME, env: {}, existsSync })).some(pair => pair.includes('settings.json') || pair.includes('CLAUDE.md')),
  false,
  'a missing file overlay source is skipped rather than mounted (Docker would otherwise create a directory in its place)'
);

console.log('\n--- The mount table is the single source of truth ---');

assertDeepEqual([DOCKER_ISOLATION_TOOL_MOUNTS.claude.configDir, DOCKER_ISOLATION_TOOL_MOUNTS.claude.authFile], ['.claude', '.credentials.json'], 'claude shares ~/.claude, which holds .credentials.json and .oauth_refresh.lock');
assertDeepEqual([DOCKER_ISOLATION_TOOL_MOUNTS.codex.configDir, DOCKER_ISOLATION_TOOL_MOUNTS.codex.authFile], ['.codex', 'auth.json'], 'codex shares ~/.codex, which holds auth.json');
assertEqual(Object.isFrozen(DOCKER_ISOLATION_TOOL_MOUNTS) && Object.isFrozen(DOCKER_ISOLATION_TOOL_MOUNTS.claude) && Object.isFrozen(DOCKER_ISOLATION_TOOL_MOUNTS.claude.privateOverlays), true, 'the table is frozen so a task or a test cannot widen it at runtime');

console.log('\n--- Router suppression still covers the tool directory (issue #2164) ---');

for (const tool of ['claude', 'codex']) {
  const suppressed = getRouterSuppressedCredentialPaths({ tool });
  const routed = mountPairs(getDockerIsolationAuthMounts({ tool, sessionId: SESSION, homeDir: HOME, env: {}, existsSync: prepared, useRouter: true }));
  assertEqual(
    routed.some(pair => suppressed.some(prefix => pair.includes(`/${prefix}`))),
    false,
    `${tool}: with --use-router none of the ${tool} paths survives (prefix suppression)`
  );
  assertEqual(routed.includes(`${HOME}/.config/gh:${HOME}/.config/gh`), true, `${tool}: gh is still mounted when GitHub is not routed`);
}

console.log('\n--- Host-side preparation creates mount points and overlays, never the credential file ---');

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-2190-home-'));
try {
  const codexPrep = prepareDockerIsolationHostPaths({ tool: 'codex', sessionId: SESSION, homeDir: tmpHome });
  assertEqual(codexPrep.created.includes(path.join(tmpHome, '.codex')), true, 'codex: the config directory is created on a fresh host');
  assertEqual(codexPrep.created.includes(path.join(tmpHome, '.hive-mind', 'docker-isolation', SESSION, 'codex', 'config.toml')), true, 'codex: a private config.toml is seeded for the task');
  assertEqual(fs.readFileSync(path.join(tmpHome, '.hive-mind', 'docker-isolation', SESSION, 'codex', 'config.toml'), 'utf8').includes('remote_plugin = false'), true, 'codex: the private config.toml pins remote_plugin = false');
  assertDeepEqual(codexPrep.missingAuth, [path.join(tmpHome, '.codex', 'auth.json')], 'codex: a missing auth.json is reported, not fabricated');
  assertEqual(fs.existsSync(path.join(tmpHome, '.codex', 'auth.json')), false, 'codex: auth.json is never created (an empty file breaks codex: "EOF while parsing")');

  fs.mkdirSync(path.join(tmpHome, '.claude', 'plugins', 'cache', 'superpowers'), { recursive: true });
  fs.writeFileSync(path.join(tmpHome, '.claude', '.credentials.json'), '{}');
  fs.writeFileSync(path.join(tmpHome, '.claude', 'settings.json'), '{"enabledPlugins":{"superpowers@claude-plugins-official":true}}');
  const claudePrep = prepareDockerIsolationHostPaths({ tool: 'claude', sessionId: SESSION, homeDir: tmpHome });
  assertDeepEqual(claudePrep.missingAuth, [], 'claude: an existing credential file is not reported');
  assertEqual(fs.readFileSync(path.join(tmpHome, '.claude', 'settings.json'), 'utf8').includes('superpowers'), true, 'claude: the host settings.json is left untouched');
  assertEqual(fs.readFileSync(path.join(tmpHome, '.hive-mind', 'docker-isolation', SESSION, 'claude', 'settings.json'), 'utf8'), '{}\n', 'claude: the task gets its own empty settings.json (solve re-applies the baseline at runtime)');
  assertDeepEqual(fs.readdirSync(path.join(tmpHome, '.hive-mind', 'docker-isolation', SESSION, 'claude', 'plugins')), [], 'claude: the task gets an empty private plugins directory');
  const mounts = getDockerIsolationAuthMounts({ tool: 'claude', sessionId: SESSION, homeDir: tmpHome, env: {} });
  assertEqual(
    mounts.every(mount => fs.existsSync(mount.source)),
    true,
    'claude: after preparation every mount source exists'
  );
  const again = prepareDockerIsolationHostPaths({ tool: 'claude', sessionId: SESSION, homeDir: tmpHome });
  assertDeepEqual(again.created, [], 'preparation is idempotent');
  const routed = prepareDockerIsolationHostPaths({ tool: 'codex', sessionId: SESSION, homeDir: tmpHome, useRouter: true });
  assertDeepEqual(routed, { created: [], missingAuth: [], pruned: [] }, 'a routed task prepares nothing: it mounts no vendor state at all');
} finally {
  fs.rmSync(tmpHome, { recursive: true, force: true });
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
