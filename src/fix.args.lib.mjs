/**
 * Mode-agnostic `/fix` argument handling (issues #1733 and #2184).
 *
 * `/fix` grew a second mode in issue #2184, so repository parsing, mode
 * selection and the `/solve` handoff moved out of `fix.ci-cd.lib.mjs` and into
 * this module. `fix.ci-cd.lib.mjs` re-exports the names it used to own, so
 * existing importers keep working.
 *
 * Nothing here touches the network or the filesystem.
 */

/** The modes `/fix` supports, in the order they are offered in `--help`. */
export const FIX_MODE_CI_CD = 'ci-cd';
export const FIX_MODE_UPDATE_ALL_DEPENDENCIES = 'update-all-dependencies';

export const FIX_MODES = Object.freeze([Object.freeze({ mode: FIX_MODE_CI_CD, flag: '--ci-cd', description: 'Generate a CI/CD remediation issue and solve it' }), Object.freeze({ mode: FIX_MODE_UPDATE_ALL_DEPENDENCIES, flag: '--update-all-dependencies', description: 'Generate an "update every dependency in every language" issue and solve it' })]);

/**
 * Parse a `/fix` repository argument into a normalized descriptor.
 * Returns null when the value is not a GitHub repository URL/shorthand.
 *
 * Self-contained on purpose: keeping this module free of the heavy
 * `github.lib.mjs` import chain lets the pure helpers be unit-tested without
 * network access. Accepts:
 *   - https://github.com/owner/repo (with optional .git / trailing slash)
 *   - github.com/owner/repo
 *   - owner/repo shorthand
 * Rejects anything that points deeper than a repository (issues, pulls, …),
 * contains whitespace, or is otherwise malformed.
 */
export function parseFixRepository(value) {
  const candidate = String(value || '')
    .trim()
    .replace(/^[<([{]+/, '')
    .replace(/[>\])}.,;:]+$/, '');
  if (!candidate || /\s/.test(candidate)) return null;

  // Normalize away an optional protocol, then require either a github.com host
  // or a bare `owner/repo` shorthand. Any other host is rejected.
  let withoutProtocol = candidate.replace(/^https?:\/\//i, '');
  const hadProtocol = withoutProtocol !== candidate;

  let pathPart;
  if (/^github\.com\//i.test(withoutProtocol)) {
    pathPart = withoutProtocol.replace(/^github\.com\//i, '');
  } else if (!hadProtocol && !withoutProtocol.includes('.com/') && !/[^/]+\.[^/]+\//.test(withoutProtocol)) {
    // Bare shorthand like `owner/repo`.
    pathPart = withoutProtocol;
  } else {
    return null;
  }

  pathPart = pathPart.replace(/\.git$/i, '').replace(/\/+$/, '');

  const segments = pathPart.split('/').filter(Boolean);
  if (segments.length !== 2) return null;

  const [owner, repo] = segments;
  if (!/^[A-Za-z0-9._-]+$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(repo)) return null;

  return {
    owner,
    repo,
    fullName: `${owner}/${repo}`,
    url: `https://github.com/${owner}/${repo}`,
  };
}

/**
 * Flags that `/fix` consumes itself and must NOT be forwarded to `/solve`.
 * Boolean flags only — they never take a value.
 *
 * `--update-all-dependencies` is both a `/fix` mode and a `/solve` option. It is
 * listed here because on `/fix` it selects the mode; the mode then re-adds it to
 * the `/solve` argv itself (see `buildSolveArgs`), so the option still reaches
 * `/solve` exactly once.
 */
export const FIX_OWNED_BOOLEAN_FLAGS = Object.freeze(['--ci-cd', '--update-all-dependencies', '--dry-run', '--no-solve', '--solve', '--no-auto-solve', '--help', '-h', '--version']);

/**
 * Partition raw CLI args into the options `/fix` consumes and the passthrough
 * args forwarded to `/solve`. Unknown flags (and their values) are preserved in
 * order so that `--tool`, `--model`, `--think`, etc. reach `/solve` untouched.
 *
 * `modes` lists every mode flag that was passed. Selecting two at once is an
 * error the caller reports, because each mode creates its own issue and the two
 * issues want different solve options.
 */
export function partitionFixArgs(rawArgs) {
  const args = Array.isArray(rawArgs) ? rawArgs : [];
  const result = {
    repository: null,
    repositoryRaw: null,
    ciCd: false,
    updateAllDependencies: false,
    modes: [],
    mode: null,
    dryRun: false,
    runSolve: true,
    help: false,
    version: false,
    passthrough: [],
  };

  for (const arg of args) {
    if (arg === '--ci-cd') {
      result.ciCd = true;
      if (!result.modes.includes(FIX_MODE_CI_CD)) result.modes.push(FIX_MODE_CI_CD);
      continue;
    }
    if (arg === '--update-all-dependencies') {
      result.updateAllDependencies = true;
      if (!result.modes.includes(FIX_MODE_UPDATE_ALL_DEPENDENCIES)) result.modes.push(FIX_MODE_UPDATE_ALL_DEPENDENCIES);
      continue;
    }
    if (arg === '--dry-run') {
      result.dryRun = true;
      continue;
    }
    if (arg === '--no-solve' || arg === '--no-auto-solve') {
      result.runSolve = false;
      continue;
    }
    if (arg === '--solve') {
      result.runSolve = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      result.help = true;
      continue;
    }
    if (arg === '--version') {
      result.version = true;
      continue;
    }
    // First bare GitHub repository argument becomes the target.
    if (!result.repository && !arg.startsWith('-')) {
      const repository = parseFixRepository(arg);
      if (repository) {
        result.repository = repository;
        result.repositoryRaw = arg;
        continue;
      }
    }
    result.passthrough.push(arg);
  }

  result.mode = result.modes.length === 1 ? result.modes[0] : null;
  return result;
}

/**
 * The options `/fix --ci-cd` always turns on when handing the issue to `/solve`
 * (issue #1733: "do similar to what `/solve --development-log --deep-analysis
 * --auto-merge`"). `--development-log` replaces the superseded case-study
 * workflow, while `--deep-analysis` re-injects the prompt paragraphs
 * `buildCiCdIssueBody` conditionally omits from the issue text.
 */
export const FIX_SOLVE_OPTIONS = Object.freeze(['--development-log', '--deep-analysis', '--auto-merge']);

/**
 * The same three options plus `--update-all-dependencies`, so the solving agent
 * receives the dependency-update sub-prompt on top of the generated issue text
 * (issue #2184).
 */
export const FIX_UPDATE_DEPENDENCIES_SOLVE_OPTIONS = Object.freeze([...FIX_SOLVE_OPTIONS, '--update-all-dependencies']);

/** The `/solve` options each `/fix` mode turns on. */
export function solveOptionsForMode(mode) {
  return mode === FIX_MODE_UPDATE_ALL_DEPENDENCIES ? FIX_UPDATE_DEPENDENCIES_SOLVE_OPTIONS : FIX_SOLVE_OPTIONS;
}

/**
 * Build the argv passed to `solve.mjs`: the created issue URL, the options
 * `/fix` always enables for the selected mode, and every forwarded option. An
 * option the caller already passed through is not duplicated.
 */
export function buildSolveArgs({ issueUrl, passthrough = [], mode = FIX_MODE_CI_CD }) {
  const args = [issueUrl];
  for (const option of solveOptionsForMode(mode)) {
    if (!passthrough.includes(option)) {
      args.push(option);
    }
  }
  args.push(...passthrough);
  return args;
}
