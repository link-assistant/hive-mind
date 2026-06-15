/**
 * Pure helpers for the `/fix --ci-cd` command (issue #1733).
 *
 * `/fix --ci-cd <repository>` automatically:
 *   1. detects the languages used in the target repository,
 *   2. inspects the latest default-branch commit and its CI/CD runs,
 *   3. creates a remediation issue (mirroring the `/task` issue-creation flow)
 *      that links the language-appropriate CI/CD pipeline templates and the
 *      CI/CD best-practices guide, and
 *   4. hands the issue off to `/solve --auto-merge`, forwarding every option
 *      that `/fix` itself does not consume (e.g. --tool, --model, --think).
 *
 * Everything that does not touch the network or the filesystem lives here so it
 * can be unit-tested without GitHub access.
 */

/**
 * Canonical mapping from GitHub Linguist language names to the
 * link-foundation AI-driven-development pipeline templates.
 *
 * Order in this array is the stable tie-breaker when two languages contribute
 * an equal number of bytes. The PHP template was added per issue #1733.
 */
export const CI_CD_TEMPLATES = Object.freeze([
  {
    key: 'javascript',
    label: 'JavaScript / TypeScript',
    languages: ['JavaScript', 'TypeScript'],
    repo: 'link-foundation/js-ai-driven-development-pipeline-template',
  },
  {
    key: 'rust',
    label: 'Rust',
    languages: ['Rust'],
    repo: 'link-foundation/rust-ai-driven-development-pipeline-template',
  },
  {
    key: 'python',
    label: 'Python',
    languages: ['Python'],
    repo: 'link-foundation/python-ai-driven-development-pipeline-template',
  },
  {
    key: 'go',
    label: 'Go',
    languages: ['Go'],
    repo: 'link-foundation/go-ai-driven-development-pipeline-template',
  },
  {
    key: 'csharp',
    label: 'C#',
    languages: ['C#'],
    repo: 'link-foundation/csharp-ai-driven-development-pipeline-template',
  },
  {
    key: 'java',
    label: 'Java',
    languages: ['Java'],
    repo: 'link-foundation/java-ai-driven-development-pipeline-template',
  },
  {
    key: 'php',
    label: 'PHP',
    languages: ['PHP'],
    repo: 'link-foundation/php-ai-driven-development-pipeline-template',
  },
]);

export const CI_CD_BEST_PRACTICES_URL = 'https://github.com/link-assistant/hive-mind/blob/main/docs/CI-CD-BEST-PRACTICES.md';

/** Build a browser URL for a `owner/repo` slug. */
export function templateUrl(repo) {
  return `https://github.com/${repo}`;
}

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
 * Normalize the GitHub `/languages` response (a `{ "JavaScript": bytes }` map)
 * or an array of names into a byte-sorted array of `{ name, bytes }`.
 */
export function normalizeLanguages(input) {
  let entries = [];
  if (Array.isArray(input)) {
    entries = input.map(name => [String(name), 0]);
  } else if (input && typeof input === 'object') {
    entries = Object.entries(input).map(([name, bytes]) => [String(name), Number(bytes) || 0]);
  }
  return entries
    .filter(([name]) => name)
    .map(([name, bytes]) => ({ name, bytes }))
    .sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));
}

/**
 * Map detected languages to CI/CD templates, sorted so that the templates for
 * the most-used languages come first (issue #1733: "links to CI/CD templates
 * should be sorted by detected languages in the target repository").
 *
 * Returns:
 *   - sortedTemplates: matched templates ordered by aggregate detected bytes
 *   - unmatchedLanguages: detected languages with no template (informational)
 */
export function mapLanguagesToTemplates(languages) {
  const normalized = normalizeLanguages(languages);

  const templateByLanguage = new Map();
  for (const template of CI_CD_TEMPLATES) {
    for (const language of template.languages) {
      templateByLanguage.set(language.toLowerCase(), template);
    }
  }

  const aggregate = new Map(); // template.key -> { template, bytes, languages: [] }
  const unmatchedLanguages = [];

  for (const { name, bytes } of normalized) {
    const template = templateByLanguage.get(name.toLowerCase());
    if (!template) {
      unmatchedLanguages.push(name);
      continue;
    }
    const existing = aggregate.get(template.key) || { template, bytes: 0, languages: [] };
    existing.bytes += bytes;
    existing.languages.push(name);
    aggregate.set(template.key, existing);
  }

  const templateOrder = new Map(CI_CD_TEMPLATES.map((template, index) => [template.key, index]));
  const sortedTemplates = [...aggregate.values()].sort((a, b) => b.bytes - a.bytes || templateOrder.get(a.template.key) - templateOrder.get(b.template.key));

  return { sortedTemplates, unmatchedLanguages };
}

/** Title for the auto-generated remediation issue. */
export function buildCiCdIssueTitle(repository) {
  const name = repository?.fullName || repository?.repo || 'repository';
  return `Check for all false positives and errors in CI/CD and fix them all (${name})`;
}

function shortSha(sha) {
  return String(sha || '').slice(0, 7);
}

/** Render the detected-languages section. */
export function buildLanguagesSection(languages) {
  const normalized = normalizeLanguages(languages);
  if (normalized.length === 0) {
    return 'No languages were reported by the GitHub Linguist API for this repository.';
  }
  const total = normalized.reduce((sum, { bytes }) => sum + bytes, 0) || 1;
  const lines = normalized.map(({ name, bytes }) => {
    const percent = ((bytes / total) * 100).toFixed(1);
    return `- **${name}** — ${percent}%`;
  });
  return lines.join('\n');
}

/** Render the recommended-templates section, sorted by detected languages. */
export function buildTemplatesSection(languages) {
  const { sortedTemplates, unmatchedLanguages } = mapLanguagesToTemplates(languages);
  const lines = [];

  if (sortedTemplates.length === 0) {
    lines.push('No language-specific template matched the detected languages. Review all templates and apply the closest match:');
    lines.push('');
    for (const template of CI_CD_TEMPLATES) {
      lines.push(`- ${template.label}: [${template.repo}](${templateUrl(template.repo)})`);
    }
  } else {
    lines.push('Apply the best practices from these templates, in priority order (most-used language first):');
    lines.push('');
    sortedTemplates.forEach((entry, index) => {
      const detected = entry.languages.join(', ');
      lines.push(`${index + 1}. **${entry.template.label}** — [${entry.template.repo}](${templateUrl(entry.template.repo)}) _(detected: ${detected})_`);
    });
  }

  if (unmatchedLanguages.length > 0) {
    lines.push('');
    lines.push(`Other detected languages without a dedicated template: ${unmatchedLanguages.join(', ')}.`);
  }

  return lines.join('\n');
}

/** Render the CI/CD runs section from the GitHub Actions API payload. */
export function buildRunsSection(runs, { emptyMessage } = {}) {
  const list = Array.isArray(runs) ? runs : [];
  if (list.length === 0) {
    return emptyMessage || 'No CI/CD runs were found for the latest default-branch commit.';
  }
  const header = '| Workflow | Status | Conclusion | Run |\n| --- | --- | --- | --- |';
  const rows = list.map(run => {
    const name = run.name || run.workflowName || 'unknown';
    const status = run.status || 'unknown';
    const conclusion = run.conclusion || (status === 'completed' ? 'unknown' : 'in_progress');
    const url = run.html_url || run.url || '';
    const runLabel = url ? `[run](${url})` : '—';
    return `| ${name} | ${status} | ${conclusion} | ${runLabel} |`;
  });
  return [header, ...rows].join('\n');
}

/** Count the runs that did not pass (failure/cancelled/timed_out/etc.). */
export function summarizeRunFailures(runs) {
  const list = Array.isArray(runs) ? runs : [];
  const passing = new Set(['success', 'neutral', 'skipped']);
  const failing = list.filter(run => {
    const conclusion = (run.conclusion || '').toLowerCase();
    return run.status === 'completed' && conclusion && !passing.has(conclusion);
  });
  return { total: list.length, failing: failing.length };
}

/**
 * The standard remediation prompt, adapted from
 * https://github.com/link-assistant/web-capture/issues/139.
 */
export function buildStandardPrompt({ repository, templatesSorted }) {
  const templateLinks = (templatesSorted && templatesSorted.length > 0 ? templatesSorted.map(entry => entry.template.repo) : CI_CD_TEMPLATES.map(template => template.repo)).map(repo => `- ${templateUrl(repo)}`).join('\n');

  return `Use all the best practices from the CI/CD templates (check the full file tree to compare all GitHub workflow and CI/CD script files). If the same issue is found in a template, report the issue in the template repository too:

${templateLinks}

We should compare all files, so we don't have more CI/CD errors in the future and reuse all the best practices from these templates.

Download all logs and data related to this issue into this repository, and compile that data into the \`./docs/case-studies/issue-{id}\` folder. Use it to do a deep case-study analysis (search online for additional facts and data) in which you reconstruct the timeline/sequence of events, list each and every requirement from the issue, find the root cause of each problem, and propose possible solutions and solution plans for each requirement (also check known existing components/libraries that solve a similar problem or can help).

If there is not enough data to find the actual root cause, add debug output and a verbose mode (if not already present) so the root cause can be found on the next iteration.

If the issue is related to any other repository/project where we can report issues on GitHub, please do so. Each issue must contain reproducible examples, workarounds, and suggestions for fixing the issue in code. Double-check that the requirements are fully applied to the entire codebase: if an issue exists in multiple places, fix it in all of them.

Reference: [CI/CD Best Practices for AI-Driven Development](${CI_CD_BEST_PRACTICES_URL}).

Target repository: ${repository?.fullName || 'the target repository'}.`;
}

/**
 * Build the full Markdown body of the auto-generated remediation issue.
 */
export function buildCiCdIssueBody({ repository, defaultBranch, commit, runs, languages, runsSource = 'commit' }) {
  const { sortedTemplates } = mapLanguagesToTemplates(languages);
  const { total, failing } = summarizeRunFailures(runs);

  const commitLine = commit?.sha ? `\`${shortSha(commit.sha)}\`${commit.url ? ` ([commit](${commit.url}))` : ''}${commit.message ? ` — ${String(commit.message).split('\n')[0]}` : ''}` : 'unknown';

  // When the exact latest commit produced no runs (common for release/tag
  // commits), `/fix` falls back to the most recent runs on the default branch
  // so the issue stays actionable. Label the source honestly.
  const runsHeading = runsSource === 'branch' ? `Recent CI/CD runs on \`${defaultBranch || 'default branch'}\`` : 'Latest default-branch CI/CD runs';
  const runsEmptyMessage = runsSource === 'branch' ? `No recent CI/CD runs were found on \`${defaultBranch || 'the default branch'}\`.` : 'No CI/CD runs were found for the latest default-branch commit.';

  const sections = [`## Automatic CI/CD Remediation for ${repository?.fullName || 'repository'}`, '', 'This issue was generated automatically by `/fix --ci-cd` to detect and fix CI/CD false positives and errors.', '', '### Target', '', `- **Repository:** [${repository?.fullName}](${repository?.url})`, `- **Default branch:** \`${defaultBranch || 'unknown'}\``, `- **Latest commit:** ${commitLine}`, `- **CI/CD runs found:** ${total} (${failing} not passing)`, '', `### ${runsHeading}`, '', buildRunsSection(runs, { emptyMessage: runsEmptyMessage }), '', '### Detected languages', '', buildLanguagesSection(languages), '', '### Recommended CI/CD templates', '', buildTemplatesSection(languages), '', `See [CI/CD Best Practices for AI-Driven Development](${CI_CD_BEST_PRACTICES_URL}) for the full guidance behind these templates.`, '', '### Task', '', buildStandardPrompt({ repository, templatesSorted: sortedTemplates })];

  return sections.join('\n');
}

/**
 * Flags that `/fix` consumes itself and must NOT be forwarded to `/solve`.
 * Boolean flags only — they never take a value.
 */
export const FIX_OWNED_BOOLEAN_FLAGS = Object.freeze(['--ci-cd', '--dry-run', '--no-solve', '--solve', '--no-auto-solve', '--help', '-h', '--version']);

/**
 * Partition raw CLI args into the options `/fix` consumes and the passthrough
 * args forwarded to `/solve`. Unknown flags (and their values) are preserved in
 * order so that `--tool`, `--model`, `--think`, etc. reach `/solve` untouched.
 */
export function partitionFixArgs(rawArgs) {
  const args = Array.isArray(rawArgs) ? rawArgs : [];
  const result = {
    repository: null,
    repositoryRaw: null,
    ciCd: false,
    dryRun: false,
    runSolve: true,
    help: false,
    version: false,
    passthrough: [],
  };

  for (const arg of args) {
    if (arg === '--ci-cd') {
      result.ciCd = true;
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

  return result;
}

/**
 * Build the argv passed to `solve.mjs`: the created issue URL, `--auto-merge`,
 * and every forwarded option. `--auto-merge` is not duplicated if already
 * present in the passthrough args.
 */
export function buildSolveArgs({ issueUrl, passthrough = [] }) {
  const args = [issueUrl];
  if (!passthrough.includes('--auto-merge')) {
    args.push('--auto-merge');
  }
  args.push(...passthrough);
  return args;
}
