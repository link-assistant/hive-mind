/**
 * Issue #4079: a Codex turn that never ends, and one that ends in garbage.
 *
 * `codex exec` runs the whole task as one turn. In the incident that turn ran
 * for ten hours, spent its last 43 minutes generating one tool call whose
 * arguments degenerated into 63,437 lines of `.`, and ended with
 * `Incomplete response returned, reason: max_output_tokens`, which failed the
 * run although the thread could simply have been resumed. This module:
 *
 * - detects degenerate model output (a run of identical or empty/punctuation
 *   lines in text the model wrote, not in tool output) and stops the turn;
 * - bounds one turn by wall time and by cumulative input tokens, stopping it
 *   between tool calls so no command is cut off half-way;
 * - decides whether a stopped or truncated turn is resumed (`codex exec
 *   resume` with a short continuation prompt) instead of failing the run.
 *
 * The working tree is never touched: a resumed turn continues from it.
 *
 * Environment (non-negative integers; 0 disables the check):
 * - HIVE_MIND_CODEX_DEGENERATE_LINE_LIMIT (200): run length that counts as degenerate;
 * - HIVE_MIND_CODEX_MAX_TURN_MINUTES (240): wall time of one turn;
 * - HIVE_MIND_CODEX_MAX_TURN_INPUT_TOKENS (100000000): input tokens sent in one
 *   turn, summed over its model responses (Codex reports them on stderr
 *   telemetry, so this one only applies to `--verbose` runs);
 * - HIVE_MIND_CODEX_MAX_TRUNCATION_RESUMES (3): resumes after max_output_tokens
 *   or degenerate output, per run;
 * - HIVE_MIND_CODEX_MAX_TURN_SPLITS (20): resumes after a time or token split, per run.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/4079
 */

import { promptText } from './prompt-text.lib.mjs';

export const CODEX_TURN_GUARD_ENV = Object.freeze({
  degenerateLineLimit: 'HIVE_MIND_CODEX_DEGENERATE_LINE_LIMIT',
  maxTurnMinutes: 'HIVE_MIND_CODEX_MAX_TURN_MINUTES',
  maxTurnInputTokens: 'HIVE_MIND_CODEX_MAX_TURN_INPUT_TOKENS',
  maxTruncationResumes: 'HIVE_MIND_CODEX_MAX_TRUNCATION_RESUMES',
  maxTurnSplits: 'HIVE_MIND_CODEX_MAX_TURN_SPLITS',
});

export const CODEX_TURN_GUARD_DEFAULTS = Object.freeze({
  degenerateLineLimit: 200,
  maxTurnMinutes: 240,
  maxTurnInputTokens: 100_000_000,
  maxTruncationResumes: 3,
  maxTurnSplits: 20,
});

/** Kinds that mean the last response was lost, and kinds that only split a healthy turn. */
const TRUNCATION_KINDS = new Set(['max-output-tokens', 'degenerate-output']);
const SPLIT_KINDS = new Set(['turn-time', 'turn-tokens']);

const parseLimit = value => {
  const text = String(value ?? '').trim();
  return /^\d+$/.test(text) ? Number(text) : null;
};

/** @returns {typeof CODEX_TURN_GUARD_DEFAULTS} */
export const resolveCodexTurnLimits = ({ env = process.env } = {}) => Object.fromEntries(Object.entries(CODEX_TURN_GUARD_DEFAULTS).map(([key, fallback]) => [key, parseLimit(env?.[CODEX_TURN_GUARD_ENV[key]]) ?? fallback]));

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;
const TRACING_LINE = /^\S*?\d{4}-\d{2}-\d{2}T[\d:.]+Z\s+(?:TRACE|DEBUG|INFO|WARN|ERROR)\s/;
const TOOL_RESULT_ARGUMENTS = /event\.name="codex\.tool_result".*?\barguments=(.*)$/;
const OUTPUT_FIELD = /(?:^|\s)output=/;

/** A line with no letter or digit: blank, `.`, `---`, `)))`. */
export const isFillerLine = line => !/[\p{L}\p{N}]/u.test(line);

/**
 * Counts runs of identical lines and of filler lines in model-authored text.
 * @param {{limit: number}} options - 0 disables detection
 * @returns {{reset: () => void, push: (line: string) => {line: string, count: number}|null}}
 */
export const createDegenerateRunCounter = ({ limit }) => {
  let last = null;
  let same = 0;
  let filler = 0;
  return {
    reset: () => {
      last = null;
      same = 0;
      filler = 0;
    },
    push: rawLine => {
      if (!limit) return null;
      const line = rawLine.trim();
      same = line === last ? same + 1 : 1;
      filler = isFillerLine(line) ? filler + 1 : 0;
      last = line;
      const count = Math.max(same, filler);
      return count >= limit ? { line: line.slice(0, 80), count } : null;
    },
  };
};

const parseJsonLines = text => {
  const events = [];
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('{')) continue;
    try {
      const data = JSON.parse(line);
      if (data && typeof data === 'object') events.push(data);
    } catch {
      // Not a protocol line.
    }
  }
  return events;
};

/** Text the model wrote in a protocol item: messages, reasoning, commands, tool arguments (never tool output). */
const modelAuthoredTexts = item => {
  if (!item || typeof item !== 'object') return [];
  const texts = [item.text, item.command];
  if (item.arguments !== undefined) texts.push(typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments, null, 1));
  return texts.filter(text => typeof text === 'string' && text);
};

/**
 * Issue #4079: degenerate output in what the model writes. On stdout that is
 * the text of protocol items; on stderr (verbose runs) it is the arguments of
 * Codex's `codex.tool_result` telemetry record, the only place a custom tool
 * call's arguments appear (the incident's 63,437 `.` lines were there).
 */
export const createDegenerateOutputDetector = ({ limit = CODEX_TURN_GUARD_DEFAULTS.degenerateLineLimit } = {}) => {
  const stdoutRun = createDegenerateRunCounter({ limit });
  const stderrRun = createDegenerateRunCounter({ limit });
  let inArguments = false;
  let found = null;
  const feed = (run, text, source) => {
    for (const line of text.split('\n')) {
      const hit = run.push(line);
      if (hit) return (found = { ...hit, source });
    }
    return null;
  };
  return {
    /** @param {string} text - whole NDJSON lines */
    observeStdout: text => {
      if (found || !limit) return null;
      for (const event of parseJsonLines(text)) {
        for (const value of modelAuthoredTexts(event.item)) {
          stdoutRun.reset();
          if (feed(stdoutRun, value, 'stdout')) return found;
        }
      }
      return null;
    },
    /** @param {string} text - whole stderr lines */
    observeStderr: text => {
      if (found || !limit) return null;
      for (const raw of String(text ?? '').split('\n')) {
        const line = raw.replace(ANSI, '');
        if (TRACING_LINE.test(line)) {
          const start = line.match(TOOL_RESULT_ARGUMENTS);
          inArguments = !!start;
          stderrRun.reset();
          if (!start) continue;
          const [argumentsText] = start[1].split(OUTPUT_FIELD);
          if (OUTPUT_FIELD.test(start[1])) inArguments = false;
          if (feed(stderrRun, argumentsText, 'stderr')) return found;
          continue;
        }
        if (!inArguments) continue;
        if (/^\s*output=/.test(line)) {
          inArguments = false;
          continue;
        }
        if (feed(stderrRun, line, 'stderr')) return found;
      }
      return null;
    },
    getFinding: () => found,
  };
};

// Items that act on the working tree; a split never stops one half-way.
const WORKING_TREE_ITEM_TYPES = new Set(['command_execution', 'file_change', 'mcp_tool_call']);

/**
 * Issue #4079: the size of the current turn. Its clock starts at
 * `turn.started`; input tokens are summed from Codex's `response.completed`
 * telemetry (logged twice, by `log_only` and `trace_safe`, so deduplicated).
 */
export const createCodexTurnBudget = ({ maxTurnMinutes = CODEX_TURN_GUARD_DEFAULTS.maxTurnMinutes, maxTurnInputTokens = CODEX_TURN_GUARD_DEFAULTS.maxTurnInputTokens, now = Date.now } = {}) => {
  let turnStartedAt = null;
  let inputTokens = 0;
  const openItems = new Set();
  const counted = new Set();
  return {
    observeStdout: text => {
      for (const event of parseJsonLines(text)) {
        if (event.type === 'turn.started') {
          turnStartedAt = now();
          inputTokens = 0;
          openItems.clear();
        } else if (event.type === 'turn.completed' || event.type === 'turn.failed') turnStartedAt = null;
        else if (event.type === 'item.started' && WORKING_TREE_ITEM_TYPES.has(event.item?.type)) openItems.add(event.item.id);
        else if (event.type === 'item.completed') openItems.delete(event.item?.id);
      }
    },
    observeStderr: text => {
      for (const line of String(text ?? '').split('\n')) {
        if (!line.includes('event.kind=response.completed')) continue;
        const tokens = line.match(/\binput_token_count=(\d+)/);
        if (!tokens) continue;
        const key = `${line.match(/\bevent\.timestamp=(\S+)/)?.[1]} ${tokens[1]} ${line.match(/\boutput_token_count=(\d+)/)?.[1]}`;
        if (counted.has(key)) continue;
        if (counted.size > 64) counted.clear();
        counted.add(key);
        inputTokens += Number(tokens[1]);
      }
    },
    /** @returns {{kind: 'turn-time'|'turn-tokens', minutes: number, tokens: number}|null} */
    check: () => {
      if (turnStartedAt === null || openItems.size > 0) return null;
      const minutes = Math.floor((now() - turnStartedAt) / 60_000);
      if (maxTurnMinutes && minutes >= maxTurnMinutes) return { kind: 'turn-time', minutes, tokens: inputTokens };
      if (maxTurnInputTokens && inputTokens >= maxTurnInputTokens) return { kind: 'turn-tokens', minutes, tokens: inputTokens };
      return null;
    },
  };
};

/**
 * One guard per `codex exec`: feeds both detectors, stops the session once.
 *
 * @param {Object} options
 * @param {ReturnType<typeof resolveCodexTurnLimits>} options.limits
 * @param {{truncation: number, splits: number}} options.counters - resumes already used in this run
 * @param {Function} options.stopSession - async () => void, e.g. SIGTERM to codex
 * @param {Function} options.log
 * @param {Function} [options.now]
 * @param {number} [options.checkIntervalMs] - a turn can be silent for an hour while the model writes
 */
export const createCodexTurnGuard = ({ limits, counters, stopSession, log, now = Date.now, checkIntervalMs = 60_000 }) => {
  const canResumeTruncation = counters.truncation < limits.maxTruncationResumes;
  const canSplit = counters.splits < limits.maxTurnSplits;
  const degenerate = createDegenerateOutputDetector({ limit: limits.degenerateLineLimit });
  const budget = createCodexTurnBudget({ maxTurnMinutes: canSplit ? limits.maxTurnMinutes : 0, maxTurnInputTokens: canSplit ? limits.maxTurnInputTokens : 0, now });
  let stopReason = null;
  let degenerateLogged = false;
  let timer = null;

  const stop = async reason => {
    stopReason = reason;
    if (timer) clearInterval(timer);
    await stopSession();
  };
  const afterDegenerate = async finding => {
    if (!finding || degenerateLogged || stopReason) return;
    degenerateLogged = true;
    await log(`\n⚠️ Codex output degenerated: ${finding.count} consecutive repeated or empty lines (${JSON.stringify(finding.line)}) in the model's ${finding.source === 'stderr' ? 'tool call arguments' : 'output'} (issue #4079)`, { level: 'warning' });
    if (canResumeTruncation) await stop({ kind: 'degenerate-output', ...finding });
    else await log(`   Not stopping: the ${limits.maxTruncationResumes} automatic resume(s) for truncated output are used up (${CODEX_TURN_GUARD_ENV.maxTruncationResumes})`, { level: 'warning' });
  };
  const checkBudget = async () => {
    if (stopReason) return;
    const reason = budget.check();
    if (!reason) return;
    await log(`\n⏱️ Codex turn is ${reason.kind === 'turn-time' ? `${reason.minutes} minutes long` : `${reason.tokens.toLocaleString('en-US')} input tokens long`}; ending it between tool calls to resume in a new turn (issue #4079, ${reason.kind === 'turn-time' ? CODEX_TURN_GUARD_ENV.maxTurnMinutes : CODEX_TURN_GUARD_ENV.maxTurnInputTokens})`, { level: 'warning' });
    await stop(reason);
  };

  return {
    start: () => {
      if (!canSplit || !(limits.maxTurnMinutes || limits.maxTurnInputTokens)) return;
      timer = setInterval(() => checkBudget().catch(() => {}), checkIntervalMs);
      timer.unref?.();
    },
    observeStdout: async text => {
      if (stopReason) return;
      budget.observeStdout(text);
      await afterDegenerate(degenerate.observeStdout(text));
      await checkBudget();
    },
    observeStderr: async text => {
      if (stopReason) return;
      budget.observeStderr(text);
      await afterDegenerate(degenerate.observeStderr(text));
      await checkBudget();
    },
    end: () => {
      if (timer) clearInterval(timer);
      timer = null;
    },
    getStopReason: () => stopReason,
  };
};

/** Did the turn end because the model's response hit its output token limit? */
export const isMaxOutputTokensFailure = state => [...(state?.turnFailures ?? []), ...(state?.streamErrors ?? [])].some(entry => /max_output_tokens/i.test(String(entry?.message ?? '')));

/** The prompt a resumed turn starts with. */
export const buildCodexContinuationPrompt = ({ kind, line = '', count = 0, minutes = 0, tokens = 0 }) => {
  const key = name => `prompt.templates.codex-turn-guard.buildCodexContinuationPrompt.${name}`;
  const reason = {
    'max-output-tokens': () => promptText(key('maxOutputTokens')),
    'degenerate-output': () => promptText(key('degenerateOutput'), { count: String(count), line: JSON.stringify(line) }),
    'turn-time': () => promptText(key('turnTime'), { minutes: String(minutes) }),
    'turn-tokens': () => promptText(key('turnTokens'), { tokens: Number(tokens).toLocaleString('en-US') }),
  }[kind];
  return [promptText(key('intro')), reason(), TRUNCATION_KINDS.has(kind) ? promptText(key('shorterSteps')) : null, promptText(key('next'))].filter(Boolean).join(' ');
};

/**
 * Issue #4079: resume instead of failing? Called once a `codex exec` has
 * ended. A stop by the guard explains itself; otherwise only a
 * `max_output_tokens` failure is resumable. A `turn.failed` for any other
 * reason wins over both.
 *
 * @returns {null|{resume: boolean, kind: string, message: string, prompt?: string}}
 */
export const decideCodexContinuation = ({ stopReason = null, state = null, sessionId = null, counters, limits }) => {
  // A turn that failed for another reason (an outage, a 401) is left to the
  // error handling, which retries and resumes it on its own terms.
  const otherFailure = (state?.turnFailures ?? []).some(entry => !/max_output_tokens/i.test(String(entry?.message ?? '')));
  const reason = otherFailure ? null : (stopReason ?? (isMaxOutputTokensFailure(state) ? { kind: 'max-output-tokens' } : null));
  if (!reason) return null;
  const isTruncation = TRUNCATION_KINDS.has(reason.kind);
  if (!isTruncation && !SPLIT_KINDS.has(reason.kind)) return null;
  const counter = isTruncation ? 'truncation' : 'splits';
  const limit = isTruncation ? limits.maxTruncationResumes : limits.maxTurnSplits;
  const label = { 'max-output-tokens': 'the response hit max_output_tokens', 'degenerate-output': 'the output degenerated', 'turn-time': 'the turn reached its time limit', 'turn-tokens': 'the turn reached its input token limit' }[reason.kind];
  if (!sessionId) return { resume: false, kind: reason.kind, message: `⚠️ Codex ${label}, but there is no session id to resume (issue #4079)` };
  if (counters[counter] >= limit) return { resume: false, kind: reason.kind, message: `⚠️ Codex ${label}; the ${limit} automatic resume(s) for this are used up (${isTruncation ? CODEX_TURN_GUARD_ENV.maxTruncationResumes : CODEX_TURN_GUARD_ENV.maxTurnSplits}, issue #4079)` };
  counters[counter]++;
  return { resume: true, kind: reason.kind, prompt: buildCodexContinuationPrompt(reason), message: `\n🔄 Resuming Codex session ${sessionId}: ${label} (${counters[counter]}/${limit}, issue #4079)...` };
};

export default { CODEX_TURN_GUARD_DEFAULTS, CODEX_TURN_GUARD_ENV, buildCodexContinuationPrompt, createCodexTurnBudget, createCodexTurnGuard, createDegenerateOutputDetector, createDegenerateRunCounter, decideCodexContinuation, isFillerLine, isMaxOutputTokensFailure, resolveCodexTurnLimits };
