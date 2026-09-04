/**
 * Guard the package manager this repository is versioned and released with.
 *
 * Why this exists (issue #2198):
 *   `@changesets/cli` 3.x formats the files it rewrites through
 *   `@changesets/format`, which asks `package-manager-detector` which package
 *   manager to shell out to and then runs `<agent> x prettier ...`. The
 *   detector's `lockfile` strategy walks a fixed table (LOCKS in
 *   node_modules/package-manager-detector/dist/constants.mjs) in which
 *   `bun.lock` is checked *before* `package-lock.json`:
 *
 *     const LOCKS = { ..., "bun.lock": "bun", ..., "package-lock.json": "npm", ... };
 *
 *   A stale `bun.lock` next to `package-lock.json` therefore made the release
 *   job run `bun x prettier`, and GitHub runners have no bun:
 *
 *     Error: spawn bun ENOENT
 *
 *   Two independent things have to hold for that never to happen again:
 *     1. package.json declares the package manager (`packageManager` or
 *        `devEngines.packageManager`), which the detector honours *before*
 *        falling back to the lockfile table.
 *     2. No lockfile belonging to a different package manager sits at the root,
 *        so the fallback is right even where the declaration is not read.
 *
 *   Both are checked here rather than in one ad-hoc shell line so the rules are
 *   unit-testable without touching the working tree.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2198
 */

/**
 * Lockfile -> package manager, mirroring `package-manager-detector`'s LOCKS
 * table. Key order is the detector's probe order and is what makes a stray
 * lockfile win over `package-lock.json`; keep it in sync when the detector is
 * upgraded (the tests pin the entries this repository cares about).
 */
export const LOCKFILE_AGENTS = Object.freeze({
  'aube-lock.yaml': 'aube',
  'aube-workspace.yaml': 'aube',
  'bun.lock': 'bun',
  'bun.lockb': 'bun',
  'deno.lock': 'deno',
  'nub.lock': 'nub',
  'pnpm-lock.yaml': 'pnpm',
  'pnpm-workspace.yaml': 'pnpm',
  'yarn.lock': 'yarn',
  'package-lock.json': 'npm',
  'npm-shrinkwrap.json': 'npm',
});

/**
 * The package manager package.json declares, or null when it declares none.
 *
 * Mirrors `getNameAndVer()` in package-manager-detector: the `packageManager`
 * string wins over `devEngines.packageManager.name`.
 *
 * @param {object} packageJson
 * @returns {string|null}
 */
export function readDeclaredAgent(packageJson) {
  const pkg = packageJson || {};

  if (typeof pkg.packageManager === 'string' && pkg.packageManager.trim()) {
    return pkg.packageManager.replace(/^\^/, '').split('@')[0] || null;
  }

  const name = pkg.devEngines?.packageManager?.name;
  return typeof name === 'string' && name.trim() ? name : null;
}

/**
 * The package manager a lockfile-only detection would pick, or null when the
 * directory holds no known lockfile.
 *
 * @param {string[]} files File names present in the directory (not paths).
 * @returns {string|null}
 */
export function detectAgentFromLockfiles(files) {
  const present = new Set(files || []);

  for (const [lockfile, agent] of Object.entries(LOCKFILE_AGENTS)) {
    if (present.has(lockfile)) {
      return agent;
    }
  }

  return null;
}

/**
 * @typedef {object} PackageManagerProblem
 * @property {'missing-declaration'|'ambiguous-lockfiles'|'foreign-lockfile'} kind
 * @property {string} message Human-readable, already explains the consequence.
 * @property {string} [file] The offending file, when the problem is one.
 */

/**
 * @typedef {object} PackageManagerReport
 * @property {string|null} declared
 * @property {string|null} lockfileAgent What a lockfile-only detection returns.
 * @property {string[]} lockfiles Known lockfiles present, in probe order.
 * @property {string[]} foreignLockfiles Lockfiles of a manager other than the declared one.
 * @property {PackageManagerProblem[]} problems
 */

/**
 * Check a project root against both rules above.
 *
 * @param {object} input
 * @param {string[]} input.files File names at the project root.
 * @param {object} input.packageJson Parsed package.json.
 * @returns {PackageManagerReport}
 */
export function inspectPackageManager({ files, packageJson }) {
  const present = new Set(files || []);
  const lockfiles = Object.keys(LOCKFILE_AGENTS).filter(lockfile => present.has(lockfile));

  const declared = readDeclaredAgent(packageJson);
  const lockfileAgent = detectAgentFromLockfiles(files);
  const problems = [];

  if (!declared) {
    problems.push({
      kind: 'missing-declaration',
      message: 'package.json declares no package manager. Add `devEngines.packageManager.name` (or `packageManager`) so tools that shell out to a package manager — @changesets/format among them — cannot guess it from a stray lockfile (issue #2198).',
    });

    const agents = [...new Set(lockfiles.map(lockfile => LOCKFILE_AGENTS[lockfile]))];
    if (agents.length > 1) {
      problems.push({
        kind: 'ambiguous-lockfiles',
        message: `Lockfiles for more than one package manager are present (${lockfiles.join(', ')}). With no declaration to break the tie, package-manager-detector picks ${lockfileAgent} — the first match in its probe order, not the manager this project is actually installed with.`,
      });
    }
  }

  const foreignLockfiles = declared ? lockfiles.filter(lockfile => LOCKFILE_AGENTS[lockfile] !== declared) : [];

  for (const lockfile of foreignLockfiles) {
    const agent = LOCKFILE_AGENTS[lockfile];
    const wins = lockfileAgent === agent;
    problems.push({
      kind: 'foreign-lockfile',
      file: lockfile,
      message: `${lockfile} belongs to ${agent}, but this project declares ${declared}.` + (wins ? ` package-manager-detector probes ${lockfile} first, so any tool that resolves the manager from lockfiles alone spawns "${agent} x <command>" — and ${agent} is not installed on GitHub runners (issue #2198).` : ` It is not the manager this project is installed with, and it goes stale silently.`) + ` Delete it, or switch the project to ${agent}.`,
    });
  }

  return { declared, lockfileAgent, lockfiles, foreignLockfiles, problems };
}
