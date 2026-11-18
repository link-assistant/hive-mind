#!/usr/bin/env node
/**
 * Issue #4082 (case 7): tell the AI when the repository's git hooks cannot run.
 *
 * The task image runs Node 26, which no longer bundles corepack. A repository
 * whose hooks run the package manager through corepack (lefthook with
 * `packageManager: pnpm@…`) then failed every commit with
 *
 *     lefthook runner: failed to start corepack: spawnSync corepack ENOENT
 *
 * and the AI either bypassed the hooks without saying so or did not notice
 * that the hooks' checks were skipped. The image now installs corepack, but a
 * repository can still need a tool the image lacks (pre-commit, lefthook, bun,
 * …). This probe reads the hook configuration right after the clone, checks
 * that the tools it needs are on PATH (or in `node_modules/.bin`), and returns
 * prompt lines that name what is missing and what to do instead.
 *
 * It only reads files: nothing is executed, so it is safe on any repository.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/4082
 */

import { accessSync, constants, existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { delimiter, join } from 'path';

import { promptText } from './prompt-text.lib.mjs';

const LEFTHOOK_CONFIG = /^\.?lefthook(?:-local)?\.(?:ya?ml|json|jsonc|toml)$/i;
const PRE_COMMIT_CONFIGS = ['.pre-commit-config.yaml', '.pre-commit-config.yml'];
const SIMPLE_GIT_HOOKS_CONFIGS = ['.simple-git-hooks.json', '.simple-git-hooks.js', '.simple-git-hooks.cjs', '.simple-git-hooks.mjs', 'simple-git-hooks.json', 'simple-git-hooks.js', 'simple-git-hooks.cjs', 'simple-git-hooks.mjs'];
// Commands a hook commonly starts. Each one named in a hook file must be installed for the hook to run.
const HOOK_COMMANDS = ['corepack', 'pnpm', 'pnpx', 'yarn', 'bun', 'bunx', 'npx', 'deno', 'uv', 'uvx', 'poetry', 'pipx'];
const COREPACK_MANAGERS = new Set(['pnpm', 'yarn']);
const MAX_HOOK_FILE_BYTES = 256 * 1024;

const readText = path => {
  try {
    if (statSync(path).size > MAX_HOOK_FILE_BYTES) return '';
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
};

const readPackageJson = repoDir => {
  try {
    return JSON.parse(readFileSync(join(repoDir, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
};

/** `true` when `name` is an executable on PATH. */
export const isOnPath = (name, { env = process.env } = {}) =>
  String(env.PATH || '')
    .split(delimiter)
    .filter(Boolean)
    .some(dir => {
      try {
        accessSync(join(dir, name), constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });

/**
 * Hook configuration of a repository.
 *
 * @returns {{ files: Array<{ path: string, manager: string, text: string }>, packageJson: Object|null }}
 */
export const findGitHookConfigs = repoDir => {
  const files = [];
  let entries;
  try {
    entries = readdirSync(repoDir);
  } catch {
    return { files, packageJson: null };
  }
  for (const entry of entries) if (LEFTHOOK_CONFIG.test(entry)) files.push({ path: entry, manager: 'lefthook', text: readText(join(repoDir, entry)) });
  for (const entry of PRE_COMMIT_CONFIGS) if (entries.includes(entry)) files.push({ path: entry, manager: 'pre-commit', text: readText(join(repoDir, entry)) });
  for (const entry of SIMPLE_GIT_HOOKS_CONFIGS) if (entries.includes(entry)) files.push({ path: entry, manager: 'simple-git-hooks', text: readText(join(repoDir, entry)) });
  const huskyDir = join(repoDir, '.husky');
  if (entries.includes('.husky')) {
    try {
      for (const hook of readdirSync(huskyDir)) {
        const hookPath = join(huskyDir, hook);
        if (hook.startsWith('_') || hook.startsWith('.') || !statSync(hookPath).isFile()) continue;
        files.push({ path: `.husky/${hook}`, manager: 'husky', text: readText(hookPath) });
      }
    } catch {
      // An unreadable .husky directory only means fewer hooks to check.
    }
  }
  const packageJson = readPackageJson(repoDir);
  if (packageJson?.['simple-git-hooks'] && typeof packageJson['simple-git-hooks'] === 'object') {
    files.push({ path: 'package.json ("simple-git-hooks")', manager: 'simple-git-hooks', text: Object.values(packageJson['simple-git-hooks']).join('\n') });
  }
  if (packageJson?.husky?.hooks && typeof packageJson.husky.hooks === 'object') {
    files.push({ path: 'package.json ("husky.hooks")', manager: 'husky', text: Object.values(packageJson.husky.hooks).join('\n') });
  }
  return { files, packageJson };
};

const declaresDependency = (packageJson, names) => names.some(name => packageJson?.devDependencies?.[name] || packageJson?.dependencies?.[name]);

/**
 * Reasons the repository's git hooks cannot run here.
 *
 * @param {string} repoDir - the cloned repository
 * @param {Object} [options]
 * @param {(name: string) => boolean} [options.commandExists] - PATH lookup (injectable for tests)
 * @returns {{ configFiles: string[], reasons: string[] }}
 */
export const detectGitHookProblems = (repoDir, { commandExists = name => isOnPath(name) } = {}) => {
  const { files, packageJson } = findGitHookConfigs(repoDir);
  const configFiles = files.map(file => file.path);
  if (files.length === 0) return { configFiles, reasons: [] };

  const binDir = join(repoDir, 'node_modules', '.bin');
  const available = name => commandExists(name) || existsSync(join(binDir, name));
  const reasons = [];
  const reported = new Set();

  // `packageManager: pnpm@9` makes Node tooling (lefthook among it) start the manager through corepack.
  const pinned = typeof packageJson?.packageManager === 'string' ? packageJson.packageManager.trim() : '';
  const pinnedManager = pinned.split('@')[0];
  if (COREPACK_MANAGERS.has(pinnedManager) && !available('corepack')) {
    const managerNote = available(pinnedManager) ? `${pinnedManager} itself is installed, but hooks that start it through corepack still fail` : `${pinnedManager} is not installed either`;
    reasons.push(`package.json pins \`packageManager: ${pinned}\`, and \`corepack\` is not installed (${managerNote}; the hook fails with \`spawnSync corepack ENOENT\`).`);
    reported.add('corepack');
    if (!available(pinnedManager)) reported.add(pinnedManager);
  }

  for (const file of files) {
    for (const command of HOOK_COMMANDS) {
      if (reported.has(command) || !new RegExp(String.raw`(?:^|[\s;&|("'\`])${command}(?=[\s;&|)"'\`]|$)`, 'm').test(file.text)) continue;
      if (available(command)) continue;
      reported.add(command);
      reasons.push(`\`${file.path}\` runs \`${command}\`, which is not installed.`);
    }
  }

  const managers = new Set(files.map(file => file.manager));
  if (managers.has('lefthook') && !available('lefthook') && !declaresDependency(packageJson, ['lefthook', '@evilmartians/lefthook', '@arkweid/lefthook'])) {
    reasons.push('lefthook is configured but not installed (no `lefthook` on PATH and no lefthook dependency in package.json).');
  }
  if (managers.has('pre-commit') && !available('pre-commit')) {
    reasons.push('`.pre-commit-config.yaml` is present, but the `pre-commit` tool is not installed, so its hooks cannot be installed or run.');
  }
  return { configFiles, reasons };
};

/** Prompt lines for the AI, or `[]` when every hook can run. */
export const buildGitHooksPreflightLines = ({ configFiles, reasons }) => {
  if (!reasons || reasons.length === 0) return [];
  const key = name => `prompt.templates.git-hooks-preflight.warning.${name}`;
  return ['', promptText(key('header')), ...reasons.map(reason => promptText(key('item'), { reason })), promptText(key('instruction'), { configFiles: configFiles.map(file => `\`${file}\``).join(', ') })];
};

/**
 * Run the probe on a cloned repository and log what it found.
 *
 * @returns {Promise<{ configFiles: string[], reasons: string[], promptLines: string[] }>}
 */
export const runGitHooksPreflight = async ({ tempDir, log = async () => {}, commandExists } = {}) => {
  try {
    const result = detectGitHookProblems(tempDir, commandExists ? { commandExists } : undefined);
    for (const reason of result.reasons) await log(`⚠️  Git hooks: ${reason}`, { level: 'warning' });
    return { ...result, promptLines: buildGitHooksPreflightLines(result) };
  } catch (error) {
    await log(`⚠️  Git hooks preflight skipped: ${error?.message || error}`, { level: 'warning' });
    return { configFiles: [], reasons: [], promptLines: [] };
  }
};

export default { isOnPath, findGitHookConfigs, detectGitHookProblems, buildGitHooksPreflightLines, runGitHooksPreflight };
