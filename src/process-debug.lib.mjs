/**
 * Pure process/session correlation helpers for cleanup process diagnostics
 * (issue #1851).
 *
 * This module intentionally avoids /proc, screen, filesystem, and network
 * access. The OS layer supplies process records and start-command session
 * metadata; this file only parses, matches, redacts, and formats.
 */

import path from 'node:path';

import { extractTaskRefsFromCommand } from './cleanup.lib.mjs';

const AGENT_KINDS = ['claude', 'codex', 'gemini', 'qwen', 'opencode'];
const RUNNING_STATUSES = new Set(['executing', 'running']);
const TERMINAL_STATUSES = new Set(['executed', 'completed', 'failed', 'cancelled', 'canceled', 'error']);

function taskUrlFromRef(ref) {
  if (!ref) return null;
  const kind = ref.type === 'pull' ? 'pull' : 'issues';
  return `https://github.com/${ref.owner}/${ref.repo}/${kind}/${ref.number}`;
}

function firstTaskUrl(text) {
  const refs = extractTaskRefsFromCommand(text || '');
  return taskUrlFromRef(refs[0]);
}

function normalizeWhitespace(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toPositiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function normalizeProcessIds(value) {
  const out = {};
  if (!value || typeof value !== 'object') return out;
  for (const [key, raw] of Object.entries(value)) {
    const number = toPositiveInteger(raw);
    if (number) out[key] = number;
  }
  return out;
}

function normalizePath(value) {
  if (!value || typeof value !== 'string') return null;
  return value.trim().replace(/\/+$/, '') || null;
}

function isPathInside(candidate, parent) {
  const child = normalizePath(candidate);
  const root = normalizePath(parent);
  if (!child || !root) return false;
  return child === root || child.startsWith(root + path.sep);
}

function containsToken(text, token) {
  return Boolean(text && token && String(text).includes(String(token)));
}

function readFlagValue(command, flag) {
  if (!command) return null;
  const re = new RegExp(`(?:^|\\s)${flag}(?:=|\\s+)("([^"]+)"|'([^']+)'|\\S+)`, 'i');
  const match = command.match(re);
  return match ? (match[2] || match[3] || match[1] || '').replace(/^["']|["']$/g, '') : null;
}

function extractWorkspace(text) {
  if (!text) return null;
  const clean = value => {
    const raw = String(value || '')
      .trim()
      .replace(/^["']|["']$/g, '');
    const tmpMatch = raw.match(/\/tmp\/gh-issue-solver-[A-Za-z0-9._-]+/);
    if (tmpMatch) return normalizePath(tmpMatch[0]);
    return normalizePath(raw.split(/\\n|\s/)[0]);
  };
  const patterns = [/Your prepared working directory:\s*([^\r\n]+)/i, /Creating temporary directory:\s*([^\r\n]+)/i, /Cloning into ['"]([^'"]+)['"]/i, /\bworking directory:\s*([^\r\n]+)/i, /\bworkspace(?: directory)?:\s*([^\r\n]+)/i, /\((?:cd|pushd)\s+["']?([^"')\s]+)["']?\s+&&/i, /(\/tmp\/gh-issue-solver-[A-Za-z0-9._-]+)/];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = match?.[1] ? clean(match[1]) : null;
    if (value) return normalizePath(value);
  }
  return null;
}

function detectTool(command, text) {
  const fromFlag = readFlagValue(command, '--tool');
  if (fromFlag) return String(fromFlag).toLowerCase();
  const haystack = `${command || ''}\n${text || ''}`.toLowerCase();
  for (const kind of AGENT_KINDS) {
    if (new RegExp(`\\b${kind}\\b`, 'i').test(haystack)) return kind;
  }
  return null;
}

export function detectAgentKind(processRecord) {
  const commandName = String(processRecord?.commandName || '').toLowerCase();
  const exeBase = path.basename(String(processRecord?.exe || '')).toLowerCase();
  const cmdline = String(processRecord?.cmdline || '').toLowerCase();
  const combined = `${commandName} ${exeBase} ${cmdline}`;

  for (const kind of AGENT_KINDS) {
    if (commandName === kind || exeBase === kind) return kind;
    if (new RegExp(`(?:^|[\\s/.-])${kind}(?:$|[\\s/.-])`).test(combined)) return kind;
  }
  return null;
}

/**
 * Synchronous redaction for process command lines and log snippets. Process
 * debugging runs inside cleanup, so it cannot rely on async full-log
 * sanitizers. Keep this conservative and token-shape based.
 *
 * @param {string} text
 * @returns {string}
 */
export function redactProcessText(text) {
  let out = String(text ?? '');
  out = out.replace(/\b(\d{6,12}):([A-Za-z0-9_-]{20,})\b/g, '$1:[REDACTED]');
  out = out.replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, 'github_pat_[REDACTED]');
  out = out.replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, match => `${match.slice(0, 4)}[REDACTED]`);
  out = out.replace(/\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, 'sk-ant-[REDACTED]');
  out = out.replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, 'sk-[REDACTED]');
  out = out.replace(/\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g, match => `${match.slice(0, 5)}[REDACTED]`);
  out = out.replace(/\bnpm_[A-Za-z0-9]{20,}\b/g, 'npm_[REDACTED]');
  out = out.replace(/\bhf_[A-Za-z0-9]{20,}\b/g, 'hf_[REDACTED]');
  out = out.replace(/(Authorization:\s*Bearer\s+)([A-Za-z0-9._~+/=-]{10,})/gi, '$1[REDACTED]');
  out = out.replace(/((?:api[_-]?key|token|secret|password|bot[_-]?token)\s*[:=]\s*['"]?)([A-Za-z0-9._~+/:=-]{12,})(['"]?)/gi, '$1[REDACTED]$3');
  return out;
}

/**
 * Extract useful metadata from a start-command isolation log. The logs commonly
 * contain the original command, the temporary worktree path, and the command
 * that launches the selected agent.
 *
 * @param {{logPath?: string|null, text?: string|null, sessionId?: string|null}} input
 * @returns {{sessionId: string|null, command: string|null, taskUrl: string|null, workspace: string|null, tool: string|null, logPath: string|null}}
 */
export function parseStartCommandLogMetadata(input = {}) {
  const logPath = input.logPath || null;
  const text = String(input.text || '');
  const command = text.match(/^Command:\s*(.+)$/im)?.[1]?.trim() || null;
  const sessionId = input.sessionId || (logPath ? path.basename(logPath).replace(/\.[^.]+$/, '') : null) || null;

  const taskUrl = firstTaskUrl(command) || firstTaskUrl(text);
  const workspace = extractWorkspace(text);
  const tool = detectTool(command, text);

  return {
    sessionId,
    command: command ? redactProcessText(command) : null,
    taskUrl,
    workspace,
    tool,
    logPath,
  };
}

function normalizeSession(input) {
  const command = input?.command ? String(input.command) : null;
  const status = input?.status ? String(input.status).toLowerCase() : null;
  const processIds = normalizeProcessIds(input?.processIds);
  const sessionId = input?.sessionId || input?.uuid || input?.id || null;
  const sessionName = input?.sessionName || input?.screenSessionName || sessionId || null;
  const taskUrl = input?.taskUrl || firstTaskUrl(command);
  const live = input?.live === true || RUNNING_STATUSES.has(status);

  return {
    ...input,
    sessionId,
    uuid: input?.uuid || sessionId,
    sessionName,
    screenSessionName: input?.screenSessionName || sessionName,
    status,
    command,
    taskUrl,
    workspace: normalizePath(input?.workspace || input?.workingDirectory || null),
    tool: input?.tool ? String(input.tool).toLowerCase() : detectTool(command, command),
    logPath: input?.logPath || null,
    processIds,
    live,
  };
}

function normalizeProcess(input) {
  return {
    ...input,
    pid: toPositiveInteger(input?.pid),
    ppid: toPositiveInteger(input?.ppid),
    pgid: toPositiveInteger(input?.pgid) || null,
    sid: toPositiveInteger(input?.sid) || null,
    state: input?.state || null,
    commandName: input?.commandName || null,
    cmdline: normalizeWhitespace(input?.cmdline || input?.command || ''),
    cwd: normalizePath(input?.cwd || null),
    exe: input?.exe || null,
    screenSessionName: input?.screenSessionName || null,
  };
}

function scoreSessionMatch(processRecord, session) {
  const reasons = [];
  const processIdValues = new Set(Object.values(session.processIds || {}).filter(Boolean));

  if (processIdValues.has(processRecord.pid)) reasons.push('pid-session-process');
  if (processIdValues.has(processRecord.ppid)) reasons.push('parent-session-process');
  if (processIdValues.has(processRecord.pgid)) reasons.push('process-group-session-process');
  if (processIdValues.has(processRecord.sid)) reasons.push('session-id-session-process');

  if (processRecord.screenSessionName) {
    const names = new Set([session.screenSessionName, session.sessionName, session.sessionId].filter(Boolean));
    if (names.has(processRecord.screenSessionName)) reasons.push('screen-session');
  }

  if (session.workspace && processRecord.cwd && isPathInside(processRecord.cwd, session.workspace)) {
    reasons.push('cwd-workspace');
  }
  if (session.workspace && containsToken(processRecord.cmdline, session.workspace)) {
    reasons.push('cmd-workspace');
  }
  if (session.taskUrl && containsToken(processRecord.cmdline, session.taskUrl)) {
    reasons.push('cmd-task-url');
  }

  const agentKind = detectAgentKind(processRecord);
  if (agentKind && session.tool && agentKind === session.tool) reasons.push('agent-tool');
  if (reasons.length === 1 && reasons[0] === 'agent-tool') {
    return { score: 0, reasons: [] };
  }

  const weights = {
    'pid-session-process': 100,
    'parent-session-process': 90,
    'process-group-session-process': 80,
    'session-id-session-process': 80,
    'screen-session': 75,
    'cwd-workspace': 60,
    'cmd-workspace': 50,
    'cmd-task-url': 45,
    'agent-tool': 10,
  };
  const score = reasons.reduce((sum, reason) => sum + (weights[reason] || 1), 0);
  return { score, reasons };
}

function chooseSession(processRecord, sessions) {
  let best = null;
  for (const session of sessions) {
    const match = scoreSessionMatch(processRecord, session);
    if (match.score <= 0) continue;
    if (!best || match.score > best.score) {
      best = { session, score: match.score, reasons: match.reasons };
    }
  }
  return best;
}

function isOrphanedAgent(processRecord, session, agentKind, currentPid) {
  if (!agentKind || !session || processRecord.pid === currentPid) return false;
  const status = String(session.status || '').toLowerCase();
  const terminal = TERMINAL_STATUSES.has(status);
  if (!terminal) return false;
  if (session.live) return false;
  return processRecord.ppid === 1 || processRecord.ppid == null;
}

/**
 * Correlate process records with start-command session/task records.
 *
 * @param {{processes: Array, sessions: Array, currentPid?: number|null}} input
 * @returns {{items: Array, orphans: Array, sessions: Array}}
 */
export function correlateProcesses(input = {}) {
  const sessions = (input.sessions || []).map(normalizeSession).filter(session => session.sessionId || session.taskUrl || session.workspace);
  const currentPid = toPositiveInteger(input.currentPid) || null;
  const targetPids = new Set((input.targetPids || []).map(toPositiveInteger).filter(Boolean));
  const items = [];

  for (const rawProcess of input.processes || []) {
    const processRecord = normalizeProcess(rawProcess);
    if (!processRecord.pid) continue;

    const agentKind = detectAgentKind(processRecord);
    const match = chooseSession(processRecord, sessions);
    const targeted = targetPids.has(processRecord.pid);
    const strongMatch = match?.reasons?.some(reason => !['cwd-workspace', 'cmd-workspace', 'agent-tool'].includes(reason));
    if (!agentKind && !targeted && !strongMatch) continue;

    const session = match?.session || null;
    const orphaned = isOrphanedAgent(processRecord, session, agentKind, currentPid);
    items.push({
      ...processRecord,
      agentKind,
      sessionId: session?.sessionId || null,
      sessionName: session?.sessionName || null,
      screenSessionName: processRecord.screenSessionName || session?.screenSessionName || null,
      sessionStatus: session?.status || null,
      sessionLive: session?.live === true,
      taskUrl: session?.taskUrl || firstTaskUrl(processRecord.cmdline),
      workspace: session?.workspace || processRecord.cwd || null,
      logPath: session?.logPath || null,
      matchReasons: match?.reasons || [],
      orphaned,
    });
  }

  items.sort((a, b) => {
    if (a.orphaned !== b.orphaned) return a.orphaned ? -1 : 1;
    return a.pid - b.pid;
  });

  return {
    items,
    orphans: items.filter(item => item.orphaned),
    sessions,
  };
}

function yesNo(value) {
  return value ? 'yes' : 'no';
}

/**
 * Render a console-safe diagnostic report. All command lines are redacted.
 *
 * @param {{items?: Array, orphans?: Array}} report
 * @returns {string}
 */
export function formatProcessDebugReport(report = {}) {
  const items = report.items || [];
  const orphans = report.orphans || [];
  const lines = ['Process debug report', '====================', `Matched processes: ${items.length}`, `Orphaned terminal-session agents: ${orphans.length}`];

  if (items.length === 0) {
    lines.push('', 'No claude/codex/gemini/qwen/opencode processes were linked to hive-mind tasks.');
    return lines.join('\n');
  }

  for (const item of items) {
    lines.push('');
    lines.push(`PID ${item.pid} ppid=${item.ppid ?? '?'} state=${item.state || '?'} agent=${item.agentKind || 'unknown'} orphan=${yesNo(item.orphaned)}`);
    if (item.sessionId || item.sessionStatus) {
      lines.push(`  session: ${item.sessionId || '(unknown)'} status=${item.sessionStatus || '?'} live=${yesNo(item.sessionLive)}`);
    }
    if (item.taskUrl) lines.push(`  task: ${item.taskUrl}`);
    if (item.workspace) lines.push(`  workspace: ${item.workspace}`);
    if (item.logPath) lines.push(`  log: ${item.logPath}`);
    if (item.matchReasons?.length) lines.push(`  match: ${item.matchReasons.join(', ')}`);
    if (item.cmdline) lines.push(`  cmd: ${redactProcessText(item.cmdline)}`);
  }

  return lines.join('\n');
}
