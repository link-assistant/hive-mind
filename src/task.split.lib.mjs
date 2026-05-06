import { parseGitHubUrl } from './github.lib.mjs';

export const TASK_SPLIT_MARKER_START = '<!-- hive-mind-task-split:start -->';
export const TASK_SPLIT_MARKER_END = '<!-- hive-mind-task-split:end -->';
export const GITHUB_SUB_ISSUES_API_VERSION = '2026-03-10';

export function parseTaskIssueUrl(url) {
  const parsed = parseGitHubUrl(url);
  if (!parsed.valid) {
    return parsed;
  }
  if (parsed.type !== 'issue') {
    return {
      valid: false,
      error: parsed.type === 'pull' ? 'The task command accepts GitHub issues, not pull requests' : 'The task command requires a specific GitHub issue URL',
      parsed,
    };
  }
  return parsed;
}

export function buildTaskSplitSystemPrompt() {
  return ['You split GitHub issues into smaller GitHub issues.', 'Read only the issue details supplied by the user.', 'Do not clone repositories, create branches, edit files, create GitHub issues, or execute shell commands.', 'Return only valid JSON matching the requested schema.'].join('\n');
}

export function buildTaskSplitPrompt({ issue, splitCount }) {
  return `Split this GitHub issue into exactly ${splitCount} smaller GitHub issues.

Source issue:
- Repository: ${issue.owner}/${issue.repo}
- Issue number: ${issue.number}
- URL: ${issue.url}
- Title: ${issue.title}

Issue body:
${issue.body || '(empty)'}

Return only this JSON shape:
{
  "tasks": [
    {
      "title": "short issue title",
      "body": "complete issue body with objective, scope, deliverables, and acceptance criteria",
      "dependencies": [1]
    }
  ]
}

Rules:
- The tasks array must contain exactly ${splitCount} items.
- Each task must be independently actionable.
- Together the tasks must cover the full source issue.
- Dependencies must be 1-based task numbers and should be empty when none are needed.
- Do not include Markdown fences, prose, comments, or extra top-level keys.`;
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractFencedBlocks(text) {
  const blocks = [];
  const regex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match;
  while ((match = regex.exec(text)) !== null) {
    blocks.push(match[1].trim());
  }
  return blocks;
}

function findBalancedJsonCandidates(text) {
  const candidates = [];
  const stack = [];
  let start = -1;
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (char === '\\') escape = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{' || char === '[') {
      if (stack.length === 0) start = i;
      stack.push(char);
    } else if ((char === '}' || char === ']') && stack.length > 0) {
      const open = stack.pop();
      if ((open === '{' && char !== '}') || (open === '[' && char !== ']')) {
        stack.length = 0;
        start = -1;
        continue;
      }
      if (stack.length === 0 && start >= 0) {
        candidates.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return candidates;
}

function collectStringValues(value, out = []) {
  if (typeof value === 'string') {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStringValues(item, out);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectStringValues(item, out);
  }
  return out;
}

export function extractTaskSplitJson(output) {
  const candidates = [output.trim(), ...extractFencedBlocks(output), ...findBalancedJsonCandidates(output)];

  for (const candidate of candidates) {
    const parsed = tryParseJson(candidate);
    if (parsed && (Array.isArray(parsed) || Array.isArray(parsed.tasks))) return parsed;
  }

  for (const line of output.split('\n')) {
    const parsedLine = tryParseJson(line.trim());
    if (!parsedLine) continue;
    for (const value of collectStringValues(parsedLine)) {
      for (const candidate of [value, ...extractFencedBlocks(value), ...findBalancedJsonCandidates(value)]) {
        const parsed = tryParseJson(candidate.trim());
        if (parsed && (Array.isArray(parsed) || Array.isArray(parsed.tasks))) return parsed;
      }
    }
  }

  throw new Error('AI output did not contain valid task split JSON');
}

export function normalizeSplitTasks(parsed, splitCount) {
  const tasks = Array.isArray(parsed) ? parsed : parsed?.tasks;
  if (!Array.isArray(tasks)) {
    throw new Error('Split JSON must contain a tasks array');
  }
  if (tasks.length !== splitCount) {
    throw new Error(`Expected exactly ${splitCount} split tasks, received ${tasks.length}`);
  }

  return tasks.map((task, index) => {
    const title = String(task?.title || '').trim();
    const body = String(task?.body || task?.description || '').trim();
    if (!title) throw new Error(`Split task ${index + 1} is missing a title`);
    if (!body) throw new Error(`Split task ${index + 1} is missing a body`);

    const dependencies = Array.isArray(task.dependencies) ? task.dependencies.map(value => Number(value)).filter(value => Number.isInteger(value) && value >= 1 && value <= splitCount && value !== index + 1) : [];

    return {
      title: title.slice(0, 256),
      body,
      dependencies: [...new Set(dependencies)],
    };
  });
}

export function formatChildIssueBody({ parentIssue, task, index, splitCount }) {
  const dependencyText = task.dependencies.length > 0 ? task.dependencies.map(number => `Task ${number}`).join(', ') : 'None';
  return `${task.body}

---

Split from: ${parentIssue.url}
Parent issue: #${parentIssue.number}
Split task: ${index + 1} of ${splitCount}
Dependencies: ${dependencyText}`;
}

export function formatParentSplitSection({ childIssues }) {
  const lines = [TASK_SPLIT_MARKER_START, '## Split Tasks', '', ...childIssues.map((issue, index) => `- [ ] #${issue.number} ${issue.title || `Split task ${index + 1}`}`), TASK_SPLIT_MARKER_END];
  return lines.join('\n');
}

export function appendOrReplaceParentSplitSection(body, childIssues) {
  const section = formatParentSplitSection({ childIssues });
  const currentBody = body || '';
  const start = currentBody.indexOf(TASK_SPLIT_MARKER_START);
  const end = currentBody.indexOf(TASK_SPLIT_MARKER_END);

  if (start >= 0 && end > start) {
    return `${currentBody.slice(0, start).trimEnd()}\n\n${section}\n\n${currentBody.slice(end + TASK_SPLIT_MARKER_END.length).trimStart()}`.trim();
  }

  return `${currentBody.trimEnd()}\n\n${section}`.trim();
}

export function parseCreatedIssueUrl(url) {
  const parsed = parseGitHubUrl(url);
  if (!parsed.valid || parsed.type !== 'issue') {
    throw new Error(`Could not parse created issue URL: ${url}`);
  }
  return parsed;
}

export function buildIssueRestIdApiArgs(issue) {
  return ['api', `repos/${issue.owner}/${issue.repo}/issues/${issue.number}`, '--jq', '.id'];
}

export function buildAddSubIssueApiArgs({ parentIssue, subIssueId }) {
  const numericId = Number(subIssueId);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    throw new Error(`Invalid sub-issue REST id: ${subIssueId}`);
  }

  return ['api', '-X', 'POST', `repos/${parentIssue.owner}/${parentIssue.repo}/issues/${parentIssue.number}/sub_issues`, '-H', 'Accept: application/vnd.github+json', '-H', `X-GitHub-Api-Version: ${GITHUB_SUB_ISSUES_API_VERSION}`, '-F', `sub_issue_id=${numericId}`];
}
