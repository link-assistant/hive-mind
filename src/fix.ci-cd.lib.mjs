/**
 * Pure helpers for the `/fix --ci-cd` command (issue #1733).
 *
 * `/fix --ci-cd <repository>` automatically:
 *   1. detects the languages used in the target repository,
 *   2. inspects the latest default-branch commit and its CI/CD runs,
 *   3. creates a remediation issue (mirroring the `/task` issue-creation flow)
 *      that links the language-appropriate CI/CD pipeline templates and the
 *      CI/CD best-practices guide, and
 *   4. hands the issue off to
 *      `/solve --development-log --deep-analysis --auto-merge`, forwarding every
 *      option that `/fix` itself does not consume (e.g. --tool, --model,
 *      --think).
 *
 * The issue title and body are taken from the standard prompt in
 * https://github.com/link-assistant/web-capture/issues/139, omitting the
 * its retired case-study paragraph in favor of `--development-log` and omitting
 * paragraphs that `--deep-analysis` already injects into the AI prompt (issue
 * #1733) — see `buildStandardPromptParagraphs` below.
 *
 * Everything that does not touch the network or the filesystem lives here so it
 * can be unit-tested without GitHub access.
 */

import { KEEP_WORKING_PROMPT } from './solve.keep-working.detect.lib.mjs';

// Mode-agnostic `/fix` argument handling moved to fix.args.lib.mjs when `/fix`
// gained its second mode (issue #2184). It is re-exported here so every
// existing importer of this module keeps working unchanged.
export { buildSolveArgs, FIX_MODE_CI_CD, FIX_MODE_UPDATE_ALL_DEPENDENCIES, FIX_MODES, FIX_OWNED_BOOLEAN_FLAGS, FIX_SOLVE_OPTIONS, parseFixRepository, partitionFixArgs, solveOptionsForMode } from './fix.args.lib.mjs';

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

/**
 * Title of the auto-generated remediation issue, taken exactly from the
 * standard template issue https://github.com/link-assistant/web-capture/issues/139
 * (issue #1733: "use title and description exactly"). The issue is created in
 * the target repository itself, so it carries no repository suffix.
 */
export const CI_CD_ISSUE_TITLE = 'Check for all false positives, false negatives, warnings and errors in CI/CD and fix them all';

export function buildCiCdIssueTitle() {
  return CI_CD_ISSUE_TITLE;
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

/**
 * Stable identity of the workflow a run belongs to (issue #2125).
 *
 * `workflow_id` is the authoritative key: two workflow files may share the same
 * display `name`, and one workflow file may be renamed between runs. The name
 * (and `path`) are only fallbacks for payloads that omit the id.
 */
export function runWorkflowKey(run) {
  const workflowId = run?.workflow_id ?? run?.workflowId;
  if (workflowId !== undefined && workflowId !== null && workflowId !== '') return `id:${workflowId}`;
  if (run?.path) return `path:${run.path}`;
  const name = run?.name || run?.workflowName;
  // A run with no identity at all cannot be proven to be a duplicate.
  return name ? `name:${String(name).toLowerCase()}` : null;
}

/** Recency of a run: newest first, using created_at, then attempt, then id. */
function compareRunRecency(a, b) {
  const timeA = Date.parse(a?.created_at || a?.run_started_at || '') || 0;
  const timeB = Date.parse(b?.created_at || b?.run_started_at || '') || 0;
  if (timeA !== timeB) return timeB - timeA;
  const attemptA = Number(a?.run_attempt) || 0;
  const attemptB = Number(b?.run_attempt) || 0;
  if (attemptA !== attemptB) return attemptB - attemptA;
  return (Number(b?.id) || 0) - (Number(a?.id) || 0);
}

/**
 * Keep only the most recent run per workflow (issue #2125).
 *
 * When `/fix --ci-cd` falls back to "recent runs on the default branch" the
 * GitHub API returns every run of every workflow across many commits, so the
 * generated issue listed the same two workflows twenty times. One row per
 * workflow — its latest run — is what makes the table actionable.
 *
 * Order of the surviving rows follows the input (the API returns newest first).
 */
export function dedupeRunsByWorkflow(runs) {
  const list = Array.isArray(runs) ? runs : [];
  const bestByWorkflow = new Map(); // key -> { run, index }
  list.forEach((run, index) => {
    const key = runWorkflowKey(run) ?? `index:${index}`;
    const existing = bestByWorkflow.get(key);
    if (!existing || compareRunRecency(run, existing.run) < 0) {
      bestByWorkflow.set(key, { run, index: existing ? existing.index : index });
    }
  });
  return [...bestByWorkflow.values()].sort((a, b) => a.index - b.index).map(entry => entry.run);
}

/** How many rows `dedupeRunsByWorkflow` would drop (for verbose logging). */
export function countDuplicateRuns(runs) {
  const list = Array.isArray(runs) ? runs : [];
  return list.length - dedupeRunsByWorkflow(list).length;
}

/**
 * Render the CI/CD runs section from the GitHub Actions API payload.
 *
 * Runs are deduplicated per workflow (issue #2125). Pass `includeCommit: true`
 * when the rows may come from different commits (the default-branch fallback)
 * so it stays visible which commit each run belongs to.
 */
export function buildRunsSection(runs, { emptyMessage, includeCommit = false } = {}) {
  const list = dedupeRunsByWorkflow(runs);
  if (list.length === 0) {
    return emptyMessage || 'No CI/CD runs were found for the latest default-branch commit.';
  }
  const header = includeCommit ? '| Workflow | Status | Conclusion | Commit | Run |\n| --- | --- | --- | --- | --- |' : '| Workflow | Status | Conclusion | Run |\n| --- | --- | --- | --- |';
  const rows = list.map(run => {
    const name = run.name || run.workflowName || 'unknown';
    const status = run.status || 'unknown';
    const conclusion = run.conclusion || (status === 'completed' ? 'unknown' : 'in_progress');
    const url = run.html_url || run.url || '';
    const runLabel = url ? `[run](${url})` : '—';
    if (!includeCommit) return `| ${name} | ${status} | ${conclusion} | ${runLabel} |`;
    const sha = shortSha(run.head_sha);
    return `| ${name} | ${status} | ${conclusion} | ${sha ? `\`${sha}\`` : '—'} | ${runLabel} |`;
  });
  return [header, ...rows].join('\n');
}

/**
 * Count the runs that did not pass (failure/cancelled/timed_out/etc.).
 * Counts one run per workflow so the summary matches the rendered table
 * (issue #2125).
 */
export function summarizeRunFailures(runs) {
  const list = dedupeRunsByWorkflow(runs);
  const passing = new Set(['success', 'neutral', 'skipped']);
  const failing = list.filter(run => {
    const conclusion = (run.conclusion || '').toLowerCase();
    return run.status === 'completed' && conclusion && !passing.has(conclusion);
  });
  return { total: list.length, failing: failing.length };
}

/**
 * The `/solve` options that `/fix` always turns on. `--development-log`
 * replaces the retired collection paragraph; `--deep-analysis` provides the
 * remaining instructions omitted from the generated issue body (issue #1733).
 */
export const SOLVE_OPTION_DEVELOPMENT_LOG = '--development-log';
export const SOLVE_OPTION_DEEP_ANALYSIS = '--deep-analysis';
export const FIX_FORWARDED_SOLVE_OPTIONS = Object.freeze([SOLVE_OPTION_DEVELOPMENT_LOG, SOLVE_OPTION_DEEP_ANALYSIS]);

/**
 * Paragraphs of the standard prompt, quoted from
 * https://github.com/link-assistant/web-capture/issues/139.
 *
 * `providedBy` lists the `/solve` options that already inject an equivalent
 * instruction into the AI prompt (see `buildDeepAnalysisPrompt`). A paragraph
 * is dropped from the issue body when every option that provides it is passed
 * to `/solve`.
 *
 * The deep-analysis wording below is the "bug" variant, which `/solve` emits
 * only when the issue type is Bug — `/fix` therefore creates the issue with
 * that type (see CI_CD_ISSUE_TYPE).
 *
 * The old case-study instruction from the upstream template is intentionally
 * not represented here. `--development-log` is its replacement; generated
 * issues must never offer or restore the superseded folder convention, even
 * when callers request an otherwise unabridged prompt (PR #1929 feedback).
 */
export const DEBUG_OUTPUT_PARAGRAPH = 'If there is not enough data to find actual root cause, add debug output and verbose mode if not present, that will allow us to find root cause on next iteration.';
export const REPORT_UPSTREAM_PARAGRAPH = 'If issue related to any other repository/project, where we can report issues on GitHub, please do so. Each issue must contain reproducible examples, workarounds and suggestions for fix the issue in code. Also double check to fully apply requirements to entire codebase, so if we have issue in multiple places, it should be fixed in all them.';

/** Build the ordered, tagged paragraphs of the standard prompt. */
export function buildStandardPromptParagraphs({ templatesSorted } = {}) {
  const templateLinks = (templatesSorted && templatesSorted.length > 0 ? templatesSorted.map(entry => entry.template.repo) : CI_CD_TEMPLATES.map(template => template.repo)).map(repo => `- ${templateUrl(repo)}`).join('\n');

  return [
    {
      providedBy: [],
      text: `Use all the best practices from CI/CD templates (check full file tree to compare for all GitHub workflow and CI/CD scripts file), if the same issue is found in template report issue also in templates:\n\n${templateLinks}`,
    },
    {
      providedBy: [],
      text: "We should compare all files, so we don't have more CI/CD errors in the future and reuse all the best practices from these templates.",
    },
    {
      providedBy: [SOLVE_OPTION_DEEP_ANALYSIS],
      text: DEBUG_OUTPUT_PARAGRAPH,
    },
    {
      providedBy: [SOLVE_OPTION_DEEP_ANALYSIS],
      text: REPORT_UPSTREAM_PARAGRAPH,
    },
    {
      providedBy: [],
      text: `Follow the CI/CD best practices collected in [${CI_CD_BEST_PRACTICES_URL}](${CI_CD_BEST_PRACTICES_URL}).`,
    },
    {
      // Quoted verbatim from the template; identical to the reinforcement
      // prompt /solve --keep-working-... reuses, so share the single constant.
      providedBy: [],
      text: KEEP_WORKING_PROMPT,
    },
  ];
}

/**
 * The standard remediation prompt, quoted from web-capture#139 with the
 * paragraphs that `omittedOptions` already provide removed.
 */
export function buildStandardPrompt({ templatesSorted, omittedOptions = FIX_FORWARDED_SOLVE_OPTIONS } = {}) {
  const omitted = new Set(omittedOptions || []);
  return buildStandardPromptParagraphs({ templatesSorted })
    .filter(paragraph => paragraph.providedBy.length === 0 || !paragraph.providedBy.every(option => omitted.has(option)))
    .map(paragraph => paragraph.text)
    .join('\n\n');
}

/**
 * Issue type and label of the generated issue.
 *
 * `/solve --deep-analysis` only emits the root-cause / debug-output /
 * report-upstream instructions — the paragraphs this body omits — when the
 * issue type is Bug (see `isBugIssueType` in development-log.lib.mjs). Creating
 * the issue as a Bug is therefore what makes the omission lossless.
 */
export const CI_CD_ISSUE_TYPE = 'Bug';
export const CI_CD_ISSUE_LABELS = Object.freeze(['bug']);

/**
 * Build the full Markdown body of the auto-generated remediation issue.
 *
 * The body mirrors the template issue's own description: the CI/CD runs of the
 * latest default-branch commit first, then the standard prompt. The data `/fix`
 * collected to build it (commit, languages, template ranking) follows as a
 * collapsed context block so it stays available without displacing the prompt.
 */
export function buildCiCdIssueBody({ repository, defaultBranch, commit, runs, languages, runsSource = 'commit', omittedOptions = FIX_FORWARDED_SOLVE_OPTIONS }) {
  const { sortedTemplates } = mapLanguagesToTemplates(languages);
  // One row per workflow: the branch fallback returns every run of every
  // workflow across many commits (issue #2125).
  const uniqueRuns = dedupeRunsByWorkflow(runs);
  const { total, failing } = summarizeRunFailures(uniqueRuns);

  const commitLine = commit?.sha ? `\`${shortSha(commit.sha)}\`${commit.url ? ` ([commit](${commit.url}))` : ''}${commit.message ? ` — ${String(commit.message).split('\n')[0]}` : ''}` : 'unknown';

  // When the exact latest commit produced no runs (common for release/tag
  // commits), `/fix` falls back to the most recent runs on the default branch
  // so the issue stays actionable. Label the source honestly.
  const runsHeading = runsSource === 'branch' ? `Recent CI/CD runs on \`${defaultBranch || 'default branch'}\`` : 'Latest default-branch CI/CD runs';
  const runsEmptyMessage = runsSource === 'branch' ? `No recent CI/CD runs were found on \`${defaultBranch || 'the default branch'}\`.` : 'No CI/CD runs were found for the latest default-branch commit.';

  const sections = [`### ${runsHeading}`, '', buildRunsSection(uniqueRuns, { emptyMessage: runsEmptyMessage, includeCommit: runsSource === 'branch' }), '', buildStandardPrompt({ templatesSorted: sortedTemplates, omittedOptions }), '', '---', '', '<details>', '<summary>Context collected by <code>/fix --ci-cd</code></summary>', '', `- **Repository:** [${repository?.fullName}](${repository?.url})`, `- **Default branch:** \`${defaultBranch || 'unknown'}\``, `- **Latest commit:** ${commitLine}`, `- **CI/CD runs found:** ${total} (${failing} not passing)`, '', '**Detected languages**', '', buildLanguagesSection(languages), '', '**Recommended CI/CD templates**', '', buildTemplatesSection(languages), '', '</details>'];

  return sections.join('\n');
}
