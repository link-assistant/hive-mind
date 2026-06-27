/**
 * Guard PR base branch changes made during an agent session.
 *
 * The solve command creates or continues work against a target base branch.
 * When --base-branch is explicit, that target is a user request, not a
 * suggestion for the agent to retarget later.
 */

import { ghWithRateLimitRetry } from './github-rate-limit.lib.mjs';

function normalizeBranchName(value) {
  return String(value || '').trim();
}

function commandOutput(result) {
  return [result?.stderr, result?.stdout]
    .filter(Boolean)
    .map(output => output.toString().trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function fallbackFormatAligned(icon, label, value) {
  return [icon, label, value].filter(Boolean).join(' ');
}

function stripShellTokenPunctuation(value) {
  const token = String(value || '');
  if (isCommandBoundary(token)) return token;
  return token.replace(/^(?:\(|\{|\[)+|(?:;|\)|&|\||\])+$/g, '');
}

function tokenizeShellCommand(command) {
  const tokens = [];
  const pattern = /"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|(\S+)/g;
  let match;
  while ((match = pattern.exec(String(command || ''))) !== null) {
    const rawToken = match[1] ?? match[2] ?? match[3] ?? '';
    const token = stripShellTokenPunctuation(rawToken);
    if (token) tokens.push(token);
  }
  return tokens;
}

function isCommandBoundary(token) {
  return token === '&&' || token === '||' || token === ';' || token === '|';
}

function isGhToken(token) {
  return token === 'gh' || token.endsWith('/gh');
}

function commandTargetsPullRequest(target, prNumber) {
  if (!prNumber || !target) return true;
  const normalizedTarget = String(target);
  const normalizedPrNumber = String(prNumber);
  return normalizedTarget === normalizedPrNumber || normalizedTarget.endsWith(`/pull/${normalizedPrNumber}`) || normalizedTarget.endsWith(`/pulls/${normalizedPrNumber}`);
}

function parseGhPrEditBaseChange(tokens, startIndex, prNumber) {
  if (tokens[startIndex + 1] !== 'pr' || tokens[startIndex + 2] !== 'edit') return null;

  let targetPullRequest = null;
  let attemptedBaseBranch = null;
  const optionsWithValues = new Set(['--repo', '-R', '--title', '--body', '--body-file', '--add-label', '--remove-label', '--add-assignee', '--remove-assignee', '--milestone', '--project']);
  for (let index = startIndex + 3; index < tokens.length; index++) {
    const token = tokens[index];
    if (isCommandBoundary(token)) break;

    if (token === '--base' || token === '-B') {
      attemptedBaseBranch = normalizeBranchName(tokens[index + 1]);
      index++;
      continue;
    }
    if (token.startsWith('--base=')) {
      attemptedBaseBranch = normalizeBranchName(token.slice('--base='.length));
      continue;
    }
    if (optionsWithValues.has(token)) {
      index++;
      continue;
    }
    if (!targetPullRequest && !token.startsWith('-')) {
      targetPullRequest = token;
    }
  }

  if (!attemptedBaseBranch || !commandTargetsPullRequest(targetPullRequest, prNumber)) return null;
  return { attemptedBaseBranch, commandKind: 'gh_pr_edit' };
}

function parseGhApiPullRequestBaseChange(tokens, startIndex, prNumber) {
  if (tokens[startIndex + 1] !== 'api') return null;

  let endpointTargetsPullRequest = false;
  let attemptedBaseBranch = null;
  for (let index = startIndex + 2; index < tokens.length; index++) {
    const token = tokens[index];
    if (isCommandBoundary(token)) break;

    if (commandTargetsPullRequest(token, prNumber) && token.includes('/pulls/')) {
      endpointTargetsPullRequest = true;
    }
    if (token === '-f' || token === '--field' || token === '-F' || token === '--raw-field') {
      const field = tokens[index + 1] || '';
      if (field.startsWith('base=')) {
        attemptedBaseBranch = normalizeBranchName(field.slice('base='.length));
      }
      index++;
      continue;
    }
    if (token.startsWith('-fbase=') || token.startsWith('--field=base=')) {
      attemptedBaseBranch = normalizeBranchName(token.split('base=').at(-1));
    }
  }

  if (!endpointTargetsPullRequest || !attemptedBaseBranch) return null;
  return { attemptedBaseBranch, commandKind: 'gh_api_pull_update' };
}

export function getExpectedPullRequestBaseBranch({ argv = {} } = {}) {
  const requestedBaseBranch = normalizeBranchName(argv?.baseBranch);
  return requestedBaseBranch || null;
}

export function detectForbiddenPullRequestBaseChangeCommand(command, { expectedBaseBranch, prNumber } = {}) {
  const normalizedExpectedBaseBranch = normalizeBranchName(expectedBaseBranch);
  if (!normalizedExpectedBaseBranch || typeof command !== 'string' || !command.trim()) return null;

  const tokens = tokenizeShellCommand(command);
  for (let index = 0; index < tokens.length; index++) {
    if (!isGhToken(tokens[index])) continue;
    const parsed = parseGhPrEditBaseChange(tokens, index, prNumber) || parseGhApiPullRequestBaseChange(tokens, index, prNumber);
    if (!parsed) continue;
    if (parsed.attemptedBaseBranch === normalizedExpectedBaseBranch) continue;
    return {
      command,
      commandKind: parsed.commandKind,
      attemptedBaseBranch: parsed.attemptedBaseBranch,
      expectedBaseBranch: normalizedExpectedBaseBranch,
      prNumber: prNumber || null,
    };
  }

  return null;
}

export function extractToolCommandTextsFromStreamEvent(event) {
  const commands = [];
  const seen = new Set();
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    if (typeof value.command === 'string' && value.command.trim() && !seen.has(value.command)) {
      seen.add(value.command);
      commands.push(value.command);
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    for (const child of Object.values(value)) {
      visit(child);
    }
  };
  visit(event);
  return commands;
}

export function buildPullRequestBaseBranchInterventionMessage({ prNumber, expectedBaseBranch, attemptedBaseBranch, command } = {}) {
  const expected = normalizeBranchName(expectedBaseBranch);
  const attempted = normalizeBranchName(attemptedBaseBranch);
  const pullRequestLabel = prNumber ? `PR #${prNumber}` : 'the pull request';
  const attemptedText = attempted ? ` to ${attempted}` : '';
  const commandText = command ? `\nForbidden command observed: ${command}` : '';

  return `The user requested --base-branch ${expected}. ${pullRequestLabel} must keep that base branch. Do not change ${pullRequestLabel}'s base${attemptedText}. Restore or keep the base as ${expected}, then continue finishing the pull request and make it ready for review.${commandText}`;
}

export function buildPullRequestBaseBranchMismatchMessage({ prNumber, currentBaseBranch, expectedBaseBranch, operation = 'verify' } = {}) {
  const action = operation === 'auto-merge' ? 'auto-merge' : 'continue';
  return `Cannot ${action} PR #${prNumber} because its base branch changed to ${currentBaseBranch}. The user requested --base-branch ${expectedBaseBranch}; restore the PR base to ${expectedBaseBranch} before ${action}.`;
}

export async function getPullRequestBaseBranch({ owner, repo, prNumber, $, log }) {
  if (typeof $ !== 'function') {
    throw new Error('Cannot verify pull request base branch without a command runner');
  }

  const result = await ghWithRateLimitRetry(() => $`gh pr view ${prNumber} --repo ${owner}/${repo} --json baseRefName --jq .baseRefName`, {
    label: 'gh pr view baseRefName',
    log,
  });
  if (result.code !== 0) {
    const details = commandOutput(result) || 'unknown error';
    throw new Error(`Could not verify pull request base branch for #${prNumber}: ${details}`);
  }

  const baseBranch = normalizeBranchName(result.stdout);
  if (!baseBranch) {
    throw new Error(`Could not verify pull request base branch for #${prNumber}: gh returned an empty baseRefName`);
  }

  return baseBranch;
}

export async function ensurePullRequestBaseBranch({ owner, repo, prNumber, argv = {}, log = async () => {}, formatAligned = fallbackFormatAligned, $, onMismatch = 'restore', operation = 'verify' }) {
  const expectedBaseBranch = getExpectedPullRequestBaseBranch({ argv });
  if (!expectedBaseBranch) {
    return { checked: false, restored: false, reason: 'no_explicit_base_branch' };
  }

  if (!owner || !repo || !prNumber) {
    return { checked: false, restored: false, reason: 'missing_pull_request_context' };
  }

  const currentBaseBranch = await getPullRequestBaseBranch({ owner, repo, prNumber, $, log });
  if (currentBaseBranch === expectedBaseBranch) {
    await log(formatAligned('🎯', 'Base branch locked:', `${expectedBaseBranch} (verified)`, 2), { verbose: true });
    return {
      checked: true,
      restored: false,
      currentBaseBranch,
      expectedBaseBranch,
    };
  }

  await log(formatAligned('⚠️', 'Base branch changed:', `PR #${prNumber} targets ${currentBaseBranch}, expected ${expectedBaseBranch}`, 2), { level: 'warning' });

  if (onMismatch === 'throw' || onMismatch === 'fail') {
    throw new Error(
      buildPullRequestBaseBranchMismatchMessage({
        prNumber,
        currentBaseBranch,
        expectedBaseBranch,
        operation,
      })
    );
  }

  await log(formatAligned('🔁', 'Restoring PR base:', expectedBaseBranch, 2));

  const editResult = await ghWithRateLimitRetry(() => $`gh pr edit ${prNumber} --repo ${owner}/${repo} --base ${expectedBaseBranch}`, {
    label: 'gh pr edit base',
    log,
  });
  if (editResult.code !== 0) {
    const details = commandOutput(editResult) || 'unknown error';
    throw new Error(`Could not restore pull request #${prNumber} base branch to ${expectedBaseBranch}: ${details}`);
  }

  const restoredBaseBranch = await getPullRequestBaseBranch({ owner, repo, prNumber, $, log });
  if (restoredBaseBranch !== expectedBaseBranch) {
    throw new Error(`Pull request #${prNumber} still targets ${restoredBaseBranch} after attempting to restore ${expectedBaseBranch}`);
  }

  await log(formatAligned('✅', 'Base branch restored:', `PR #${prNumber} now targets ${expectedBaseBranch}`, 2));

  return {
    checked: true,
    restored: true,
    previousBaseBranch: currentBaseBranch,
    currentBaseBranch: restoredBaseBranch,
    expectedBaseBranch,
  };
}
