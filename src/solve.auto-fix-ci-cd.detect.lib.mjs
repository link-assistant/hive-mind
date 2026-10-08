/** Pure contracts for post-merge CI/CD repair (issue #1782). */
import { buildSolveArgs } from './fix.args.lib.mjs';

export function validateAutoFixCiCd(argv) {
  if ((argv.autoFixCiCd || argv['auto-fix-ci-cd']) && !(argv.autoMerge || argv['auto-merge'])) {
    throw new Error('--auto-fix-ci-cd requires --auto-merge.');
  }
  return true;
}

/** Detect publication intent in workflows and their referenced helper scripts. */
export function detectPublishing(content) {
  const text = String(content || '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(line => !/^\s*(#|\/\/)/.test(line))
    .map(line => line.replace(/\s+#.*$/, ''))
    .join('\n');
  const patterns = {
    'github-release': /gh\s+release\s+create|(?:action-gh-release|gh-release|create-github-release|create-release|release-please-action|semantic-release)|releases[/'"`].*(?:POST|post)|(?:POST|post).*releases[/'"`]/i,
    npm: /(?:npm|pnpm|yarn|bun|changeset)\s+(?:run\s+)?publish|publish[-_]to[-_]npm|publish[-_]npm|changesets\/action|semantic-release/i,
    pypi: /twine\s+upload|(?:poetry|uv)\s+publish|gh-action-pypi-publish/i,
    crates: /cargo\s+publish|cargo-release|publish[-_]to[-_]crates/i,
    pages: /(?:actions\/deploy-pages|peaceiris\/actions-gh-pages|JamesIves\/github-pages-deploy-action)|gh\s+pages|pages\/deployments/i,
    'other-package': /(?:dotnet\s+nuget\s+push|gem\s+push|mvn\s+.*deploy|gradle\s+publish|dart\s+pub\s+publish|composer\s+publish)/i,
  };
  return Object.entries(patterns)
    .filter(([, pattern]) => pattern.test(text))
    .map(([kind]) => kind);
}

/** A successful workflow is insufficient evidence that its outputs exist. */
export function evaluateCiCdHealth({ runs = [], outputs = [], fresh = false, errors = [] }) {
  const failures = runs.filter(run => run.status === 'completed' && !['success', 'skipped', 'neutral'].includes(run.conclusion));
  const pending = runs.some(run => run.status !== 'completed') || !fresh || runs.length === 0;
  const problems = [...errors, ...failures.map(run => `${run.name || run.id || 'Workflow'}: ${run.conclusion || 'unknown'}${run.html_url ? ` (${run.html_url})` : ''}`)];
  if (!pending) {
    if (outputs.length === 0) problems.push('No release or deployment was published.');
    problems.push(...outputs.filter(output => !output.verified).map(output => output.detail || `${output.kind} was not verified.`));
  }
  return { success: !pending && problems.length === 0, pending, runs, outputs, errors: problems };
}

/** Fresh issues must not inherit the old issue URL, checkout, or tool session. */
export function buildRepairSolveArgs(issueUrl, rawArgs = [], originalIssueUrl = null) {
  const valueOptions = new Set(['resume', 'working-directory', 'isolated', 'session-type', 'auto-resume-iteration', 'previous-anthropic-cost', 'log-dir', 'log-file', 'base-branch']);
  const booleanOptions = new Set(['continue', 'continue-only-on-feedback', 'auto-continue', 'auto-fix-ci-cd', 'auto-merge', 'watch', 'only-prepare-command', 'dry-run', 'accept-invites']);
  const forwarded = [];
  const positionalIndex = rawArgs.findIndex(arg => (originalIssueUrl ? arg === originalIssueUrl : /^(?:https?:\/\/)?(?:github\.com\/)?[\w.-]+\/[\w.-]+\/(?:issues|pull)\/\d+\/?$/.test(arg)));
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = String(rawArgs[i]);
    if (i === positionalIndex) continue;
    const name = arg.replace(/^--?/, '').split('=')[0].replace(/^no-/, '');
    const alias = { r: 'resume', d: 'working-directory', c: 'continue', n: 'dry-run', b: 'base-branch' }[name] || name;
    if (valueOptions.has(alias)) {
      if (!arg.includes('=') && rawArgs[i + 1] && !String(rawArgs[i + 1]).startsWith('-')) i++;
      continue;
    }
    if (booleanOptions.has(alias)) continue;
    forwarded.push(arg);
  }
  return buildSolveArgs({ issueUrl, passthrough: [...forwarded, '--no-auto-fix-ci-cd'] });
}
