import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { parseGitHubUrl } from './github.lib.mjs';
import { ghWithRateLimitRetry, wrapRunnerWithGitHubRetry } from './github-rate-limit.lib.mjs';
import { sanitizeForPublication, writeSanitizedPublicationFile } from './token-sanitization.lib.mjs';

export const TASK_ISSUE_TITLE_MAX_LENGTH = 256;

function normalizeNewlines(value) {
  return String(value || '').replace(/\r\n?/g, '\n');
}

function cleanRepositoryCandidate(value) {
  return String(value || '')
    .trim()
    .replace(/^[<([{]+/, '')
    .replace(/[>\])}.,;:]+$/, '');
}

export function stripTaskCommandPrefix(text) {
  const value = normalizeNewlines(text).trimStart();
  return value.replace(/^\/(?:task|split)(?:@\S+)?(?:[ \t]+|\n|$)/i, '').trim();
}

export function resolveTaskIssueCreationInput({ commandText = '', replyText = '' } = {}) {
  const inlineText = stripTaskCommandPrefix(commandText);
  const reply = normalizeNewlines(replyText).trim();
  // When replying to a message, the inline command and the replied-to message
  // are complementary: one often carries the repository URL while the other
  // carries the issue text (issue #1916). Combine both so neither part is lost.
  // Inline text comes first so it takes precedence for title/body ordering.
  if (inlineText && reply) return `${inlineText}\n${reply}`;
  return inlineText || reply;
}

export function parseTaskRepository(value) {
  const candidate = cleanRepositoryCandidate(value);
  const parsed = parseGitHubUrl(candidate);
  if (!parsed.valid || parsed.type !== 'repo') return null;
  return {
    owner: parsed.owner,
    repo: parsed.repo,
    fullName: `${parsed.owner}/${parsed.repo}`,
    url: `https://github.com/${parsed.owner}/${parsed.repo}`,
  };
}

function parseRepositoryDirective(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('--repository')) return { matched: false };

  const match = trimmed.match(/^--repository(?:=(\S+)|\s+(\S+))$/);
  if (!match) {
    return {
      matched: true,
      error: 'Invalid --repository syntax. Use --repository <github-repository-url>.',
    };
  }

  const repository = parseTaskRepository(match[1] || match[2]);
  if (!repository) {
    return {
      matched: true,
      error: '--repository must point to a GitHub repository URL.',
    };
  }

  return { matched: true, repository };
}

function parseRepositoryLine(line) {
  const trimmed = line.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  return parseTaskRepository(trimmed);
}

function setRepository(currentRepository, nextRepository) {
  if (!nextRepository) return { repository: currentRepository };
  if (currentRepository) {
    // The same repository may legitimately appear in both the inline command
    // and the replied-to message once they are combined (issue #1916). Treat
    // identical repositories as a no-op and only reject genuine conflicts.
    if (currentRepository.fullName === nextRepository.fullName) {
      return { repository: currentRepository };
    }
    return {
      repository: currentRepository,
      error: 'Only one GitHub repository may be provided.',
    };
  }
  return { repository: nextRepository };
}

export function buildTaskIssueTitle(issueText, maxLength = TASK_ISSUE_TITLE_MAX_LENGTH) {
  const firstLine = normalizeNewlines(issueText).trim().split('\n')[0]?.trim() || 'New task';
  if (firstLine.length <= maxLength) return firstLine;
  return `${firstLine.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

export function parseTaskIssueCreationInput(input) {
  const normalized = normalizeNewlines(input).trim();
  if (!normalized) {
    return { valid: false, error: 'Missing repository and issue text.' };
  }

  const lines = normalized.split('\n');
  let repository = null;
  let bodyLines = [];

  for (const line of lines) {
    const directive = parseRepositoryDirective(line);
    if (!directive.matched) {
      bodyLines.push(line);
      continue;
    }
    if (directive.error) return { valid: false, error: directive.error };
    const next = setRepository(repository, directive.repository);
    if (next.error) return { valid: false, error: next.error };
    repository = next.repository;
  }

  if (!repository) {
    bodyLines = [];
    for (const line of lines) {
      const lineRepository = parseRepositoryLine(line);
      if (!lineRepository) {
        bodyLines.push(line);
        continue;
      }
      const next = setRepository(repository, lineRepository);
      if (next.error) return { valid: false, error: next.error };
      repository = next.repository;
    }
  }

  if (!repository) {
    return {
      valid: false,
      error: 'Missing GitHub repository URL. Provide it on its own line or with --repository <github-repository-url>.',
    };
  }

  const issueText = bodyLines.join('\n').trim();
  if (!issueText) {
    return { valid: false, error: 'Missing issue text.' };
  }

  return {
    valid: true,
    repository,
    issueText,
    title: buildTaskIssueTitle(issueText),
  };
}

function spawnCommand(command, args, options = {}) {
  return new Promise(resolve => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
      ...options,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', data => {
      stdout += data.toString();
    });
    child.stderr.on('data', data => {
      stderr += data.toString();
    });
    child.on('error', error => {
      resolve({ code: 1, stdout, stderr: stderr || error.message });
    });
    child.on('close', code => {
      resolve({ code, stdout, stderr });
    });
  });
}

// Issue #3552: every gh call of the default runner goes through the shared
// GitHub retry loop; `gh issue create` uses its duplicate-aware variant below.
const runCommand = wrapRunnerWithGitHubRetry(spawnCommand);

export function parseCreatedTaskIssueOutput(output) {
  const tokens = String(output || '')
    .split(/\s+/)
    .filter(Boolean);
  for (const token of tokens) {
    const parsed = parseGitHubUrl(cleanRepositoryCandidate(token));
    if (parsed.valid && parsed.type === 'issue') {
      return {
        owner: parsed.owner,
        repo: parsed.repo,
        number: parsed.number,
        url: parsed.normalized,
      };
    }
  }
  throw new Error(`Could not parse created issue URL from gh output: ${String(output || '').trim()}`);
}

export function buildCreateIssueArgs({ repository, title, bodyFile, issueType = null, labels = [] }) {
  const args = ['issue', 'create', '--repo', repository.fullName, '--title', title, '--body-file', bodyFile];
  if (issueType) args.push('--type', issueType);
  for (const label of labels) args.push('--label', label);
  return args;
}

function commandOutputText(result) {
  return `${result?.stderr?.toString() || ''}${result?.stdout?.toString() || ''}`.trim();
}

function repositoryOwnerAndName(repository) {
  if (repository?.owner && repository?.repo) return { owner: repository.owner, repo: repository.repo };
  const [owner, repo] = String(repository?.fullName || '').split('/');
  return { owner, repo };
}

export const REPOSITORY_ISSUE_TYPES_QUERY = 'query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { issueTypes(first: 100) { nodes { name } } } }';

/**
 * List the issue types a repository accepts, or `null` when that cannot be
 * determined (old `gh`, network error, unexpected payload).
 *
 * Issue types exist only for organization-owned repositories; for user-owned
 * repositories GitHub returns `issueTypes: null`, which maps to `[]` here.
 */
export async function getRepositoryIssueTypes({ repository, run = runCommand }) {
  const { owner, repo } = repositoryOwnerAndName(repository);
  if (!owner || !repo) return null;
  const result = await run('gh', ['api', 'graphql', '-f', `query=${REPOSITORY_ISSUE_TYPES_QUERY}`, '-f', `owner=${owner}`, '-f', `name=${repo}`]);
  if (result?.code !== 0) return null;
  try {
    const payload = JSON.parse(result.stdout?.toString() || '');
    const repositoryData = payload?.data?.repository;
    if (!repositoryData || typeof repositoryData !== 'object') return null;
    const nodes = repositoryData.issueTypes?.nodes;
    if (!Array.isArray(nodes)) return [];
    return nodes.map(node => node?.name).filter(name => typeof name === 'string' && name);
  } catch {
    return null;
  }
}

/**
 * Decide whether `--type <issueType>` may be passed to `gh issue create`.
 *
 * `gh issue create --type` creates the issue first and only afterwards resolves
 * and applies the type. When the type is unavailable, gh exits non-zero
 * *after* the issue already exists and never prints its URL (issue #3326), so a
 * missing type must be detected before creation, not by retrying.
 *
 * Returns `{ issueType, reason }`: the canonical type name to pass (or `null`
 * to skip it) and a human-readable reason when it is skipped. When support
 * cannot be determined the requested type is kept; the post-failure lookup in
 * `createTaskIssue` still prevents duplicates in that case.
 */
export async function resolveSupportedIssueType({ repository, issueType, run = runCommand }) {
  if (!issueType) return { issueType: null, reason: null };
  const types = await getRepositoryIssueTypes({ repository, run });
  if (types === null) return { issueType, reason: null };
  const match = types.find(name => name.toLowerCase() === String(issueType).toLowerCase());
  if (match) return { issueType: match, reason: null };
  const available = types.length > 0 ? types.join(', ') : 'none (issue types are only available for organization-owned repositories)';
  return { issueType: null, reason: `issue type "${issueType}" is not available in ${repository.fullName}; available types: ${available}` };
}

function normalizeIssueText(value) {
  return normalizeNewlines(value).trim();
}

/**
 * Find an issue this process just created, so a failed `gh issue create` is
 * never blindly retried into a duplicate (issue #3326).
 *
 * Matches the exact title (and body when provided) among the most recently
 * created issues, ignoring pull requests and anything created before
 * `createdAfter` minus a small clock-skew allowance.
 */
export async function findRecentlyCreatedIssue({ repository, title, body = null, createdAfter, run = runCommand, clockSkewMs = 2 * 60 * 1000, perPage = 30 }) {
  const result = await run('gh', ['api', `repos/${repository.fullName}/issues?state=all&sort=created&direction=desc&per_page=${perPage}`]);
  if (result?.code !== 0) return null;
  let issues;
  try {
    issues = JSON.parse(result.stdout?.toString() || '');
  } catch {
    return null;
  }
  if (!Array.isArray(issues)) return null;
  const threshold = createdAfter ? new Date(createdAfter).getTime() - clockSkewMs : null;
  const expectedTitle = normalizeIssueText(title);
  const expectedBody = body === null || body === undefined ? null : normalizeIssueText(body);
  for (const issue of issues) {
    if (!issue || issue.pull_request) continue;
    if (normalizeIssueText(issue.title) !== expectedTitle) continue;
    if (expectedBody !== null && normalizeIssueText(issue.body) !== expectedBody) continue;
    if (threshold !== null) {
      const createdAt = Date.parse(issue.created_at || '');
      if (!Number.isFinite(createdAt) || createdAt < threshold) continue;
    }
    if (!issue.html_url) continue;
    try {
      return parseCreatedTaskIssueOutput(issue.html_url);
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * `gh issue create` is not idempotent: a transient failure can arrive *after*
 * GitHub created the issue. Retry it through the shared loop anyway, but look
 * for the issue this process may already have created before every
 * re-attempt, so a retry never produces a duplicate (issues #3326, #3552).
 */
async function createIssueWithRetry({ repository, title, body, createdAfter, run, createArgs }) {
  const create = run.raw ?? run;
  let attempt = 0;
  return ghWithRateLimitRetry(
    async () => {
      if (attempt++ > 0) {
        const existing = await findRecentlyCreatedIssue({ repository, title, body, createdAfter, run });
        if (existing) return { code: 0, stdout: existing.url, stderr: '', existing };
      }
      return create('gh', createArgs);
    },
    { label: 'gh issue create' }
  );
}

/**
 * Create an issue via `gh issue create`.
 *
 * `issueType` and `labels` are optional and best-effort: issue types are
 * configured per organization and labels per repository, so a target repo may
 * not have them (issue #1733).
 *
 * Creating an issue is not idempotent, so a failure is never retried blindly
 * (issue #3326):
 * 1. The issue type is checked before creation and dropped when the repository
 *    does not offer it, because `gh issue create --type` fails only *after* the
 *    issue was created.
 * 2. When `gh issue create` still fails, the most recent issues are checked for
 *    one this call just created; if it exists it is returned instead of being
 *    created a second time.
 * 3. Only when no such issue exists is the create retried once without the
 *    optional metadata (labels are resolved by gh before creation, so a missing
 *    label never leaves an issue behind).
 */
export async function createTaskIssue({ repository, title, body, issueType = null, labels = [], run = runCommand, log = null, verbose = false }) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-mind-task-issue-'));
  const bodyFile = path.join(tempDir, 'body.md');
  const debug = async message => {
    if (verbose) await log?.(`[issue-create] ${message}`);
  };

  try {
    await writeSanitizedPublicationFile(bodyFile, body);
    const sanitizedTitle = await sanitizeForPublication(title);
    const sanitizedBody = await fs.readFile(bodyFile, 'utf8').catch(() => null);

    const typeDecision = await resolveSupportedIssueType({ repository, issueType, run });
    if (issueType && !typeDecision.issueType) {
      await log?.(`⚠️  Creating issue without type: ${typeDecision.reason}`);
    }
    const effectiveIssueType = typeDecision.issueType;
    await debug(`repository=${repository.fullName} requestedType=${issueType || '(none)'} effectiveType=${effectiveIssueType || '(none)'} labels=${labels.join(',') || '(none)'}`);

    const createdAfter = new Date();
    const createOptions = { repository, title: sanitizedTitle, body: sanitizedBody, createdAfter, run };
    const result = await createIssueWithRetry({ ...createOptions, createArgs: buildCreateIssueArgs({ repository, title: sanitizedTitle, bodyFile, issueType: effectiveIssueType, labels }) });
    await debug(`gh issue create exited with code ${result.code}; output: ${commandOutputText(result) || '(empty)'}`);
    if (result.existing) return result.existing;
    if (result.code === 0) return parseCreatedTaskIssueOutput(result.stdout);

    const output = commandOutputText(result);
    const existing = await findRecentlyCreatedIssue({ repository, title: sanitizedTitle, body: sanitizedBody, createdAfter, run });
    if (existing) {
      await log?.(`⚠️  gh issue create reported an error (${output || `exit code ${result.code}`}), but the issue was created: ${existing.url}; not retrying to avoid a duplicate`);
      return existing;
    }

    const usedOptionalMetadata = Boolean(effectiveIssueType) || labels.length > 0;
    if (!usedOptionalMetadata) {
      throw new Error(output || `gh issue create exited with code ${result.code}`);
    }

    await log?.(`⚠️  Could not create issue with type/labels (${output || `exit code ${result.code}`}); retrying without them`);
    const retry = await createIssueWithRetry({ ...createOptions, createArgs: buildCreateIssueArgs({ repository, title: sanitizedTitle, bodyFile }) });
    await debug(`retry gh issue create exited with code ${retry.code}; output: ${commandOutputText(retry) || '(empty)'}`);
    if (retry.existing) return retry.existing;
    if (retry.code !== 0) {
      throw new Error(commandOutputText(retry) || `gh issue create exited with code ${retry.code}`);
    }
    return parseCreatedTaskIssueOutput(retry.stdout);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
