#!/usr/bin/env node
import { ensureUseM } from './use-m-bootstrap.lib.mjs';

/**
 * Detect terminal GitHub entity states for long-running watch/merge loops.
 *
 * These checks intentionally treat 404-style repository, PR, and branch
 * responses as terminal. In a solver loop, deleted entities and lost access are
 * not transient CI states; retrying them indefinitely wastes time and tokens.
 *
 * Issue #2144: the linked *issue* is deliberately NOT terminal. A closed or
 * deleted issue does not stop the pull request from becoming mergeable, so the
 * watch/auto-restart loop must keep working. Those states are reported as
 * `mergeBlockers` instead: they only block the final automatic merge, and the
 * caller asks the user to reopen the issue or merge manually.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1931
 * @see https://github.com/link-assistant/hive-mind/issues/2144
 */

let defaultCommandRunner = null;

const getDefaultCommandRunner = async () => {
  if (defaultCommandRunner) return defaultCommandRunner;
  if (typeof globalThis.use === 'undefined') {
    await ensureUseM();
  }
  const use = globalThis.use;
  const { $: rawDollar } = await use('command-stream');
  const { wrapDollarWithGhRetry } = await import('./github-rate-limit.lib.mjs');
  const { QUIET_PROBE } = await import('./quiet-probe.lib.mjs');
  // Issue #2130: these are existence probes. Their raw payloads (a ~33 KB pull
  // request object, once per watch iteration) and their expected "gh: Not Found
  // (HTTP 404)" answers were mirrored into the attached log, where a handled
  // probe reads as an unexplained error. Every outcome is reported by the
  // caller in words, so the raw output is captured but never mirrored.
  defaultCommandRunner = wrapDollarWithGhRetry(rawDollar(QUIET_PROBE));
  return defaultCommandRunner;
};

const textFrom = value => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value instanceof Error) {
    return [value.message, value.stdout?.toString?.(), value.stderr?.toString?.()].filter(Boolean).join('\n');
  }
  return [value.message, value.stdout?.toString?.(), value.stderr?.toString?.(), value.output?.toString?.()].filter(Boolean).join('\n');
};

export const getGitHubCommandOutput = result => [result?.stdout?.toString?.() || '', result?.stderr?.toString?.() || '', result?.output?.toString?.() || ''].filter(Boolean).join('\n');

export const isTerminalGitHubEntityError = value => {
  const text = textFrom(value);
  if (!text) return false;

  return [/\bHTTP\s+404\b/i, /\bHTTP\s+410\b/i, /\b404\s+Not Found\b/i, /\b410\s+Gone\b/i, /\bNot Found\s+\(HTTP 404\)/i, /"status"\s*:\s*"404"/i, /"status"\s*:\s*"410"/i, /\bstatus['"]?\s*:\s*404\b/i, /\bstatus['"]?\s*:\s*410\b/i, /Could not resolve to a Repository/i, /Could not resolve to a PullRequest/i, /Could not resolve to an Issue/i, /Could not resolve to a Branch/i, /Could not resolve to a Repository with the name/i, /GraphQL:.*Could not resolve.*Repository/i, /\brepository not found\b/i, /\bgh:\s*Not Found\b/i].some(pattern => pattern.test(text));
};

export const getTerminalGitHubEntityErrorMessage = (value, fallback = 'GitHub entity is no longer accessible') => {
  const text = textFrom(value)
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .join(' ');
  return text || fallback;
};

const terminal = ({ reason, message, details = [], success = false, data = null }) => ({
  terminal: true,
  success,
  reason,
  message,
  details,
  data,
  mergeBlockers: [],
});

const ok = (data = {}, mergeBlockers = []) => ({
  terminal: false,
  success: null,
  reason: null,
  message: null,
  details: [],
  data,
  mergeBlockers,
});

/**
 * Issue #2144: a non-terminal state that still prevents an *automatic* merge.
 *
 * The watch/auto-restart loop must keep making the pull request mergeable; only
 * the final `--auto-merge` step is gated, and the user is asked to reopen the
 * issue or merge manually.
 */
const mergeBlocker = ({ reason, message, details = [], resolution }) => ({
  reason,
  message,
  details,
  resolution,
});

const safeJsonParse = value => {
  const text = value?.toString?.().trim() || '';
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const commandFailedTerminally = result => {
  const code = result?.code ?? 0;
  return code !== 0 && isTerminalGitHubEntityError(getGitHubCommandOutput(result));
};

const toTemplateStrings = strings => Object.assign([...strings], { raw: [...strings] });

const runCommand = async (commandRunner, strings, ...values) => {
  try {
    return await commandRunner(toTemplateStrings(strings), ...values);
  } catch (error) {
    return {
      code: error.code || 1,
      stdout: error.stdout || '',
      stderr: error.stderr || error.message || '',
      output: textFrom(error),
    };
  }
};

const checkBranch = async ({ commandRunner, repoFullName, branchName, reason, label }) => {
  if (!repoFullName || !branchName) {
    return ok();
  }

  const encodedBranchName = encodeURIComponent(branchName);
  const branchResult = await runCommand(commandRunner, ['gh api repos/', '/branches/', ''], repoFullName, encodedBranchName);

  if (commandFailedTerminally(branchResult)) {
    return terminal({
      reason,
      message: `${label} branch '${branchName}' is no longer accessible in ${repoFullName}.`,
      details: [getTerminalGitHubEntityErrorMessage(branchResult)],
    });
  }

  return ok();
};

/**
 * Check whether the GitHub entities watched by a long-running operation reached
 * a terminal state.
 *
 * @param {Object} options
 * @param {string} options.owner
 * @param {string} options.repo
 * @param {number|string|null} [options.issueNumber]
 * @param {number|string|null} [options.prNumber]
 * @param {string|null} [options.sourceBranchName]
 * @param {string|null} [options.targetBranchName]
 * @param {Function} [options.commandRunner] command-stream tagged template
 * @returns {Promise<{terminal: boolean, success: boolean|null, reason: string|null, message: string|null, details: string[], data?: Object}>}
 */
export const checkGitHubTerminalState = async ({ owner, repo, issueNumber = null, prNumber = null, sourceBranchName = null, targetBranchName = null, commandRunner = null }) => {
  const runner = commandRunner || (await getDefaultCommandRunner());
  const repoResult = await runCommand(runner, ['gh api repos/', '/', " --jq '{full_name: .full_name, default_branch: .default_branch}'"], owner, repo);
  if (commandFailedTerminally(repoResult)) {
    return terminal({
      reason: 'repository_unavailable',
      message: `Repository ${owner}/${repo} is no longer accessible.`,
      details: [getTerminalGitHubEntityErrorMessage(repoResult)],
    });
  }

  const repoData = safeJsonParse(repoResult.stdout) || {};

  if (prNumber) {
    const prResult = await runCommand(runner, ['gh api repos/', '/', '/pulls/', ''], owner, repo, prNumber);
    if (commandFailedTerminally(prResult)) {
      return terminal({
        reason: 'pull_request_unavailable',
        message: `Pull request #${prNumber} in ${owner}/${repo} is no longer accessible.`,
        details: [getTerminalGitHubEntityErrorMessage(prResult)],
      });
    }

    const prData = safeJsonParse(prResult.stdout);
    if (prData) {
      const prState = String(prData.state || '').toLowerCase();
      if (prData.merged === true) {
        return terminal({
          reason: 'pull_request_merged',
          message: `Pull request #${prNumber} has been merged.`,
          success: true,
          data: { pr: prData, repo: repoData },
        });
      }
      if (prState === 'closed') {
        return terminal({
          reason: 'pull_request_closed',
          message: `Pull request #${prNumber} has been closed without merging.`,
          data: { pr: prData, repo: repoData },
        });
      }

      const headRepo = prData.head?.repo?.full_name || null;
      const headRef = prData.head?.ref || sourceBranchName;
      if (!headRepo && headRef) {
        return terminal({
          reason: 'source_branch_unavailable',
          message: `Source repository for branch '${headRef}' is no longer accessible.`,
          details: ['GitHub returned no head repository for the open pull request.'],
          data: { pr: prData, repo: repoData },
        });
      }

      const sourceBranchState = await checkBranch({
        commandRunner: runner,
        repoFullName: headRepo,
        branchName: headRef,
        reason: 'source_branch_unavailable',
        label: 'Source',
      });
      if (sourceBranchState.terminal) return sourceBranchState;

      const baseRepo = prData.base?.repo?.full_name || `${owner}/${repo}`;
      const baseRef = prData.base?.ref || targetBranchName || repoData.default_branch;
      if (!baseRepo && baseRef) {
        return terminal({
          reason: 'target_branch_unavailable',
          message: `Target repository for branch '${baseRef}' is no longer accessible.`,
          details: ['GitHub returned no base repository for the open pull request.'],
          data: { pr: prData, repo: repoData },
        });
      }

      const targetBranchState = await checkBranch({
        commandRunner: runner,
        repoFullName: baseRepo,
        branchName: baseRef,
        reason: 'target_branch_unavailable',
        label: 'Target',
      });
      if (targetBranchState.terminal) return targetBranchState;
    }
  } else {
    const sourceBranchState = await checkBranch({
      commandRunner: runner,
      repoFullName: `${owner}/${repo}`,
      branchName: sourceBranchName,
      reason: 'source_branch_unavailable',
      label: 'Source',
    });
    if (sourceBranchState.terminal) return sourceBranchState;

    const targetBranchState = await checkBranch({
      commandRunner: runner,
      repoFullName: `${owner}/${repo}`,
      branchName: targetBranchName,
      reason: 'target_branch_unavailable',
      label: 'Target',
    });
    if (targetBranchState.terminal) return targetBranchState;
  }

  // Issue #2144: issue-scoped problems never stop the loop. They are collected
  // as merge blockers so the pull request still gets made mergeable.
  const mergeBlockers = [];

  if (issueNumber && String(issueNumber) !== String(prNumber)) {
    const issueResult = await runCommand(runner, ['gh api repos/', '/', '/issues/', ''], owner, repo, issueNumber);
    if (commandFailedTerminally(issueResult)) {
      mergeBlockers.push(
        mergeBlocker({
          reason: 'issue_unavailable',
          message: `Issue #${issueNumber} in ${owner}/${repo} is no longer accessible.`,
          details: [getTerminalGitHubEntityErrorMessage(issueResult)],
          resolution: `Restore or re-create issue #${issueNumber}, or merge this pull request manually.`,
        })
      );
      return ok({ repo: repoData }, mergeBlockers);
    }

    const issueData = safeJsonParse(issueResult.stdout);
    if (String(issueData?.state || '').toLowerCase() === 'closed') {
      mergeBlockers.push(
        mergeBlocker({
          reason: 'issue_closed',
          message: `Issue #${issueNumber} has been closed.`,
          details: [],
          resolution: `Reopen issue #${issueNumber} so auto-merge can complete, or merge this pull request manually.`,
        })
      );
      return ok({ issue: issueData, repo: repoData }, mergeBlockers);
    }

    return ok({ issue: issueData, repo: repoData }, mergeBlockers);
  }

  return ok({ repo: repoData }, mergeBlockers);
};

export default {
  checkGitHubTerminalState,
  getGitHubCommandOutput,
  getTerminalGitHubEntityErrorMessage,
  isTerminalGitHubEntityError,
};
