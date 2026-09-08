import { ensureUseM } from './use-m-bootstrap.lib.mjs';
/**
 * Playwright CLI Agent Skill deployment (issue #2190)
 *
 * By default a task talks to the browser through the Playwright MCP server the
 * image registers for both tools, and nothing else. Some agents work better
 * with the `playwright-cli` Agent Skill (a SKILL.md plus reference files that
 * teach the agent to drive the browser through a shell command), and some
 * operators want to run the skill *instead of* the MCP server to save the
 * per-turn tool-schema cost. Hence three modes:
 *
 *   default                              → MCP only
 *   --playwright-skill                   → MCP + skill
 *   --no-playwright-mcp --playwright-skill → skill only
 *
 * The skill is the one that ships with `@playwright/cli` (`playwright-cli
 * install --skills`). We do not run that installer inside the checkout: it
 * also initialises a workspace (`.playwright/`), tries to provision a browser,
 * and touches the home cache, none of which belongs in a pull request. Instead
 * the skill directory is located (see resolvePlaywrightSkillSource) and copied
 * into the workspace ourselves, following the handoff-skill layout: one real
 * directory under `.claude/skills/` for Claude Code, a relative symlink under
 * `.agents/skills/` for Codex, both listed in `.git/info/exclude` so they never
 * show up as changes.
 *
 * Nothing is ever written to the global `~/.claude` / `~/.codex` / `~/.agents`
 * folders: a skill is per task and disappears with the workspace. The global
 * configuration stays minimal (see agent-config-audit.lib.mjs).
 */

if (typeof globalThis.use === 'undefined') {
  await ensureUseM();
}
const fs = (await use('fs')).promises;
const path = (await use('path')).default;

const noopLog = async () => {};

export const PLAYWRIGHT_SKILL_NAME = 'playwright-cli';
export const PLAYWRIGHT_SKILL_PACKAGE = '@playwright/cli';
export const PLAYWRIGHT_SKILL_PRIMARY_DIR = path.join('.claude', 'skills', PLAYWRIGHT_SKILL_NAME);
export const PLAYWRIGHT_SKILL_LINKED_DIRS = Object.freeze([path.join('.agents', 'skills', PLAYWRIGHT_SKILL_NAME)]);
export const PLAYWRIGHT_SKILL_DIRS = Object.freeze([PLAYWRIGHT_SKILL_PRIMARY_DIR, ...PLAYWRIGHT_SKILL_LINKED_DIRS]);
const GIT_EXCLUDE_HEADER = '# hive-mind --playwright-skill: Playwright CLI Agent Skill (issue #2190)';

/**
 * Which Playwright surfaces a task gets, from the parsed CLI options.
 * @returns {{ mcp: boolean, skill: boolean, mode: 'mcp'|'mcp+skill'|'skill'|'none' }}
 */
export const resolvePlaywrightMode = (argv = {}) => {
  const mcp = argv.playwrightMcp !== false;
  const skill = argv.playwrightSkill === true;
  const mode = mcp && skill ? 'mcp+skill' : mcp ? 'mcp' : skill ? 'skill' : 'none';
  return { mcp, skill, mode };
};

/**
 * Where `@playwright/cli` keeps the skill, relative to the package root. The
 * same files are bundled a second time in the package's own `playwright-core`.
 */
export const PLAYWRIGHT_SKILL_PACKAGE_DIRS = Object.freeze([path.join('skills', PLAYWRIGHT_SKILL_NAME), path.join('node_modules', 'playwright-core', 'lib', 'tools', 'skills', PLAYWRIGHT_SKILL_NAME)]);

/**
 * The skill directories a global npm root would hold, most direct first.
 */
export const playwrightSkillDirsUnderNpmRoot = root => PLAYWRIGHT_SKILL_PACKAGE_DIRS.map(rel => path.join(root, PLAYWRIGHT_SKILL_PACKAGE, rel));

/**
 * Extract the skill directory from `playwright-cli --help` output, which
 * prints a line such as `Agent skill: /path/to/playwright-cli/SKILL.md`. The
 * path may be relative to the working directory the CLI ran in.
 *
 * playwright-core only prints that line when it believes an agent is reading
 * (the CLAUDECODE or COPILOT_CLI environment variable is set), so the probes
 * below set CLAUDECODE=1 for the one call. A plain `playwright-cli --help` in
 * a Docker build or a cron job has no such line — which is exactly how the
 * first image build of this feature failed.
 */
export const parsePlaywrightSkillPathFromHelp = (output, cwd = process.cwd()) => {
  const match = /^\s*Agent skill:\s*(.+?)\s*$/m.exec(String(output || ''));
  if (!match) return null;
  const skillFile = path.resolve(cwd, match[1]);
  return path.dirname(skillFile);
};

const dirHasSkill = async dir => {
  try {
    await fs.access(path.join(dir, 'SKILL.md'));
    return true;
  } catch {
    return false;
  }
};

/**
 * Locate the skill directory bundled with `@playwright/cli`.
 *
 * Order: the package under the global npm root (a plain path check, offline,
 * and what the image build verifies), then the hint the globally installed
 * `playwright-cli --help` prints for agents, then the same hint from
 * `npx -y @playwright/cli@latest` (downloads on first use). The result is
 * cached per process. Returns null when nothing is available.
 */
let cachedSource;
export const resolvePlaywrightSkillSource = async ({ $, log = noopLog, cwd = process.cwd(), force = false } = {}) => {
  if (cachedSource !== undefined && !force) return cachedSource;
  cachedSource = null;
  if (!$) return null;
  const quiet = $({ mirror: false, capture: true });
  const stdoutOf = result => (result?.stdout || '').toString();
  const probes = [
    { label: 'npm root -g', run: () => quiet`npm root -g 2>/dev/null`, dirs: out => (out.trim() ? playwrightSkillDirsUnderNpmRoot(out.trim()) : []) },
    { label: 'playwright-cli --help', run: () => quiet`CLAUDECODE=1 playwright-cli --help 2>/dev/null`, dirs: out => [parsePlaywrightSkillPathFromHelp(out, cwd)] },
    { label: `npx ${PLAYWRIGHT_SKILL_PACKAGE}`, run: () => quiet`CLAUDECODE=1 npx -y ${PLAYWRIGHT_SKILL_PACKAGE}@latest --help 2>/dev/null`, dirs: out => [parsePlaywrightSkillPathFromHelp(out, cwd)] },
  ];
  for (const probe of probes) {
    try {
      const candidates = probe.dirs(stdoutOf(await probe.run())).filter(Boolean);
      for (const dir of candidates) {
        if (await dirHasSkill(dir)) {
          await log(`   Playwright skill: found via ${probe.label} at ${dir}`, { verbose: true });
          cachedSource = dir;
          return dir;
        }
      }
      await log(`   Playwright skill: ${probe.label} did not yield a skill directory`, { verbose: true });
    } catch (error) {
      await log(`   Playwright skill: probe ${probe.label} failed: ${error.message}`, { verbose: true });
    }
  }
  return null;
};

const isTracked = async ({ $, tempDir, relPath }) => {
  if (!$) return false;
  try {
    const result = await $({ cwd: tempDir })`git ls-files --error-unmatch ${relPath} 2>/dev/null`;
    return result.code === 0;
  } catch {
    return false;
  }
};

const resolveExcludePath = async ({ $, tempDir }) => {
  if ($) {
    try {
      const result = await $({ cwd: tempDir })`git rev-parse --git-path info/exclude 2>/dev/null`;
      const rel = (result.stdout || '').toString().trim();
      if (result.code === 0 && rel) return path.isAbsolute(rel) ? rel : path.join(tempDir, rel);
    } catch {
      // fall through
    }
  }
  return path.join(tempDir, '.git', 'info', 'exclude');
};

const updateGitExclude = async ({ $, tempDir, log }) => {
  const excludePath = await resolveExcludePath({ $, tempDir });
  try {
    await fs.access(path.dirname(excludePath));
  } catch {
    await log('   Playwright skill: no .git/info directory; skipping git-exclude update', { verbose: true });
    return false;
  }
  let existing = '';
  try {
    existing = await fs.readFile(excludePath, 'utf8');
  } catch {
    // no exclude file yet
  }
  const entries = PLAYWRIGHT_SKILL_DIRS.map(dir => `/${dir.split(path.sep).join('/')}`);
  const lines = existing.split(/\r?\n/);
  const missing = entries.filter(entry => !lines.includes(entry));
  if (missing.length === 0) return true;
  const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  await fs.writeFile(excludePath, `${existing}${prefix}${existing.includes(GIT_EXCLUDE_HEADER) ? '' : GIT_EXCLUDE_HEADER + '\n'}${missing.join('\n')}\n`, 'utf8');
  return true;
};

const copySkill = async ({ sourceDir, targetDir }) => {
  await fs.rm(targetDir, { recursive: true, force: true });
  await fs.mkdir(path.dirname(targetDir), { recursive: true });
  await fs.cp(sourceDir, targetDir, { recursive: true });
};

const linkOrCopySkill = async ({ tempDir, relLinkDir, primaryAbsDir, sourceDir }) => {
  const absLinkDir = path.join(tempDir, relLinkDir);
  const parent = path.dirname(absLinkDir);
  await fs.mkdir(parent, { recursive: true });
  const relTarget = path.relative(parent, primaryAbsDir);
  try {
    const st = await fs.lstat(absLinkDir);
    if (st.isSymbolicLink() && (await fs.readlink(absLinkDir)) === relTarget) return 'symlink';
    await fs.rm(absLinkDir, { recursive: true, force: true });
  } catch {
    // nothing there yet
  }
  try {
    await fs.symlink(relTarget, absLinkDir, 'dir');
    return 'symlink';
  } catch {
    await copySkill({ sourceDir, targetDir: absLinkDir });
    return 'copy';
  }
};

/**
 * Deploy the Playwright CLI skill into the session working directory.
 *
 * @param {Object} params
 * @param {string} params.tempDir - The repo working directory.
 * @param {Object} params.argv - Parsed CLI args (uses argv.playwrightSkill / argv.playwrightMcp).
 * @param {Function} [params.log]
 * @param {Function} [params.$] - Command runner; needed to locate the CLI and for git checks.
 * @param {string} [params.sourceDir] - Skill directory override (tests).
 * @returns {Promise<{deployed: boolean, reason?: string, mode: string, paths: string[], shared: boolean, source: string|null}>}
 */
export const deployPlaywrightSkill = async ({ tempDir, argv, log = noopLog, $ = null, sourceDir = null } = {}) => {
  const { mode, skill } = resolvePlaywrightMode(argv);
  if (!skill) return { deployed: false, reason: 'disabled', mode, paths: [], shared: false, source: null };
  if (!tempDir) return { deployed: false, reason: 'no-temp-dir', mode, paths: [], shared: false, source: null };

  const source = sourceDir || (await resolvePlaywrightSkillSource({ $, log }));
  if (!source || !(await dirHasSkill(source))) {
    await log(`⚠️  --playwright-skill: the ${PLAYWRIGHT_SKILL_NAME} skill could not be located. Install it with: npm install -g ${PLAYWRIGHT_SKILL_PACKAGE}@latest`);
    return { deployed: false, reason: 'skill-not-found', mode, paths: [], shared: false, source: null };
  }

  const written = [];
  let allShared = true;
  let primaryAbsDir = path.join(tempDir, PLAYWRIGHT_SKILL_PRIMARY_DIR);
  if (await isTracked({ $, tempDir, relPath: path.join(PLAYWRIGHT_SKILL_PRIMARY_DIR, 'SKILL.md') })) {
    await log(`   Playwright skill: ${PLAYWRIGHT_SKILL_PRIMARY_DIR} is tracked by the repo; leaving it untouched`, { verbose: true });
  } else {
    try {
      await copySkill({ sourceDir: source, targetDir: primaryAbsDir });
      written.push(PLAYWRIGHT_SKILL_PRIMARY_DIR);
    } catch (error) {
      await log(`   Playwright skill: failed to deploy ${PLAYWRIGHT_SKILL_PRIMARY_DIR}: ${error.message}`, { verbose: true });
      return { deployed: false, reason: 'write-failed', mode, paths: [], shared: false, source };
    }
  }
  for (const relLinkDir of PLAYWRIGHT_SKILL_LINKED_DIRS) {
    if (await isTracked({ $, tempDir, relPath: path.join(relLinkDir, 'SKILL.md') })) {
      await log(`   Playwright skill: ${relLinkDir} is tracked by the repo; leaving it untouched`, { verbose: true });
      continue;
    }
    try {
      const how = await linkOrCopySkill({ tempDir, relLinkDir, primaryAbsDir, sourceDir: source });
      if (how !== 'symlink') allShared = false;
      written.push(relLinkDir);
    } catch (error) {
      await log(`   Playwright skill: failed to link ${relLinkDir}: ${error.message}`, { verbose: true });
    }
  }
  if (written.length > 0) {
    await updateGitExclude({ $, tempDir, log });
    await log(`🎭 Playwright skill deployed (${mode}): ${written.join(', ')}`, { verbose: true });
  }
  return { deployed: written.length > 0, mode, paths: written, shared: allShared, source };
};

export default {
  PLAYWRIGHT_SKILL_NAME,
  PLAYWRIGHT_SKILL_PACKAGE,
  PLAYWRIGHT_SKILL_PRIMARY_DIR,
  PLAYWRIGHT_SKILL_LINKED_DIRS,
  PLAYWRIGHT_SKILL_DIRS,
  PLAYWRIGHT_SKILL_PACKAGE_DIRS,
  playwrightSkillDirsUnderNpmRoot,
  resolvePlaywrightMode,
  parsePlaywrightSkillPathFromHelp,
  resolvePlaywrightSkillSource,
  deployPlaywrightSkill,
};
