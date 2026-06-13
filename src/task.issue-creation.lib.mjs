import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { parseGitHubUrl } from './github.lib.mjs';

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

function runCommand(command, args, options = {}) {
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

export async function createTaskIssue({ repository, title, body, run = runCommand }) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-mind-task-issue-'));
  const bodyFile = path.join(tempDir, 'body.md');

  try {
    await fs.writeFile(bodyFile, body);
    const result = await run('gh', ['issue', 'create', '--repo', repository.fullName, '--title', title, '--body-file', bodyFile]);
    if (result.code !== 0) {
      const output = `${result.stderr || ''}${result.stdout || ''}`.trim();
      throw new Error(output || `gh issue create exited with code ${result.code}`);
    }
    return parseCreatedTaskIssueOutput(result.stdout);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
