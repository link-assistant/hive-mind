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
 * After the fix only the credential file and the session directories are
 * shared; a task's application folder is per container.
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

for (const tool of ['claude', 'codex']) {
  const args = buildDockerIsolationStartArgs('solve', [url, '--tool', tool], { tool, homeDir: HOME, env: {}, existsSync });
  const volumes = args.filter((value, index) => args[index - 1] === '--volume');
  const sources = volumes.map(volume => volume.split(':')[0]);
  assertEqual(sources.includes(`${HOME}/.claude`), false, `${tool}: the whole ~/.claude directory is not mounted`);
  assertEqual(sources.includes(`${HOME}/.claude.json`), false, `${tool}: ~/.claude.json (MCP/plugin registry) is not mounted`);
  assertEqual(sources.includes(`${HOME}/.codex`), false, `${tool}: the whole ~/.codex directory is not mounted`);
  assertEqual(sources.includes(`${HOME}/.agents`), false, `${tool}: ~/.agents (global skills) is not mounted`);
  assertEqual(
    sources.some(source => source.includes('plugins') || source.includes('superpowers') || source.endsWith('config.toml') || source.endsWith('settings.json')),
    false,
    `${tool}: no plugin cache, skill, config.toml or settings.json reaches the task`
  );
  const own = tool === 'claude' ? `${HOME}/.claude/.credentials.json` : `${HOME}/.codex/auth.json`;
  assertEqual(sources.includes(own), true, `${tool}: the credential file itself is still shared (token refresh visible to every task)`);
  const sessionDirs = tool === 'claude' ? [`${HOME}/.claude/projects`, `${HOME}/.claude/sessions`] : [`${HOME}/.codex/sessions`];
  for (const dir of sessionDirs) assertEqual(sources.includes(dir), true, `${tool}: ${path.relative(HOME, dir)} is still shared for audit/discovery`);
}

console.log('\n--- Exact mount list ---');

assertDeepEqual(mountPairs(getDockerIsolationAuthMounts({ tool: 'claude', homeDir: HOME, env: {}, existsSync })), [`${HOME}/.config/gh:${HOME}/.config/gh`, `${HOME}/.gitconfig:${HOME}/.gitconfig`, `${HOME}/.claude/.credentials.json:${HOME}/.claude/.credentials.json`, `${HOME}/.claude/projects:${HOME}/.claude/projects`, `${HOME}/.claude/sessions:${HOME}/.claude/sessions`], 'claude: gh, git identity, credential file, projects, sessions — nothing else');
assertDeepEqual(mountPairs(getDockerIsolationAuthMounts({ tool: 'codex', homeDir: HOME, env: {}, existsSync })), [`${HOME}/.config/gh:${HOME}/.config/gh`, `${HOME}/.gitconfig:${HOME}/.gitconfig`, `${HOME}/.codex/auth.json:${HOME}/.codex/auth.json`, `${HOME}/.codex/sessions:${HOME}/.codex/sessions`], 'codex: gh, git identity, auth.json, sessions — nothing else');

const noAuth = candidate => host.has(candidate) && !candidate.endsWith('.credentials.json') && !candidate.endsWith('auth.json');
assertEqual(
  mountPairs(getDockerIsolationAuthMounts({ tool: 'codex', homeDir: HOME, env: {}, existsSync: noAuth })).some(pair => pair.includes('auth.json')),
  false,
  'a missing credential file is skipped rather than mounted (Docker would otherwise create a directory in its place)'
);

console.log('\n--- The mount table is the single source of truth ---');

assertDeepEqual(
  DOCKER_ISOLATION_TOOL_MOUNTS.claude.map(entry => entry.relativePath),
  ['.claude/.credentials.json', '.claude/projects', '.claude/sessions'],
  'claude shares exactly the credential file and the two session directories'
);
assertDeepEqual(
  DOCKER_ISOLATION_TOOL_MOUNTS.codex.map(entry => entry.relativePath),
  ['.codex/auth.json', '.codex/sessions'],
  'codex shares exactly auth.json and the sessions directory'
);
assertEqual(Object.isFrozen(DOCKER_ISOLATION_TOOL_MOUNTS) && Object.isFrozen(DOCKER_ISOLATION_TOOL_MOUNTS.claude), true, 'the table is frozen so a task or a test cannot widen it at runtime');

console.log('\n--- Router suppression still covers the split entries (issue #2164) ---');

for (const tool of ['claude', 'codex']) {
  const suppressed = getRouterSuppressedCredentialPaths({ tool });
  const routed = mountPairs(getDockerIsolationAuthMounts({ tool, homeDir: HOME, env: {}, existsSync, useRouter: true }));
  assertEqual(
    routed.some(pair => suppressed.some(prefix => pair.includes(`/${prefix}`))),
    false,
    `${tool}: with --use-router none of the split ${tool} paths survives (prefix suppression)`
  );
  assertEqual(routed.includes(`${HOME}/.config/gh:${HOME}/.config/gh`), true, `${tool}: gh is still mounted when GitHub is not routed`);
}

console.log('\n--- Host-side preparation creates the session directories, never the credential file ---');

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-2190-home-'));
try {
  const codexPrep = prepareDockerIsolationHostPaths({ tool: 'codex', homeDir: tmpHome });
  assertDeepEqual(codexPrep.created, [path.join(tmpHome, '.codex', 'sessions')], 'codex: the sessions directory is created on a fresh host');
  assertDeepEqual(codexPrep.missingAuth, [path.join(tmpHome, '.codex', 'auth.json')], 'codex: a missing auth.json is reported, not fabricated');
  assertEqual(fs.existsSync(path.join(tmpHome, '.codex', 'auth.json')), false, 'codex: auth.json is never created (an empty file breaks codex: "EOF while parsing")');

  fs.mkdirSync(path.join(tmpHome, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(tmpHome, '.claude', '.credentials.json'), '{}');
  const claudePrep = prepareDockerIsolationHostPaths({ tool: 'claude', homeDir: tmpHome });
  assertDeepEqual(claudePrep.created, [path.join(tmpHome, '.claude', 'projects'), path.join(tmpHome, '.claude', 'sessions')], 'claude: projects and sessions are created on a fresh host');
  assertDeepEqual(claudePrep.missingAuth, [], 'claude: an existing credential file is not reported');
  const again = prepareDockerIsolationHostPaths({ tool: 'claude', homeDir: tmpHome });
  assertDeepEqual(again.created, [], 'preparation is idempotent');
  const routed = prepareDockerIsolationHostPaths({ tool: 'codex', homeDir: tmpHome, useRouter: true });
  assertDeepEqual(routed, { created: [], missingAuth: [] }, 'a routed task prepares nothing: it mounts no vendor state at all');
} finally {
  fs.rmSync(tmpHome, { recursive: true, force: true });
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
