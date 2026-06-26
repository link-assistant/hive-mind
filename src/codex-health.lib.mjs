// Codex run-health analysis helpers.
//
// Extracted from codex.lib.mjs (which exceeded the 1500-line max-lines budget).
// These functions inspect the parsed `codex exec --json` event state and decide
// whether a run genuinely succeeded:
//   - getCodexErrorEventSummary: classifies stray error events, suppressing the
//     #1955 echoed-fixture false positives once a turn has completed.
//   - getCodexCompletionHealth: the #1990 turn-lifecycle gate that flags exit-0
//     runs cut off mid-turn (e.g. by docker disk exhaustion) as unhealthy.
//
// Both are re-exported from codex.lib.mjs for backward compatibility, so existing
// importers (and tests) can keep importing them from either module.

import { isENOSPC } from './lib.mjs';

const unwrapCodexErrorMessage = value => {
  if (!value) return '';
  if (typeof value !== 'string') {
    if (typeof value?.error?.message === 'string') return unwrapCodexErrorMessage(value.error.message);
    if (typeof value?.message === 'string') return unwrapCodexErrorMessage(value.message);
    return String(value);
  }

  let text = value.trim();
  for (let i = 0; i < 3; i++) {
    if (!text.startsWith('{') && !text.startsWith('[')) break;
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed?.error?.message === 'string') return unwrapCodexErrorMessage(parsed.error.message);
      if (typeof parsed?.message === 'string') {
        text = parsed.message.trim();
        continue;
      }
      return JSON.stringify(parsed);
    } catch {
      break;
    }
  }
  return text;
};

const isNonFatalCodexItemErrorMessage = message => /^in-process app-server event stream lagged; dropped \d+ events?$/i.test(message || '');

export const getCodexErrorEventSummary = codexJsonState => {
  const events = [];
  const ignoredEvents = [];

  // Issue #1955: When the codex turn genuinely completed (a `turn.completed`
  // event was observed) and codex never emitted a `turn.failed`, the session
  // SUCCEEDED. Any stray top-level `error` (stream) or nested item `error` event
  // in that case is non-fatal and must not fail the run. Two things produce such
  // strays:
  //   1. A transient error codex itself retried/recovered from before completing
  //      the turn (e.g. a momentary stream blip).
  //   2. Echoed content that merely *looks* like a codex protocol event. The
  //      codex CLI prints OTEL telemetry (`codex_otel.log_only`,
  //      event.name="codex.tool_result") containing a raw `Output:` dump of each
  //      command's stdout. When a command prints a line shaped like a protocol
  //      event — e.g. a printed NDJSON fixture line
  //      `{"type":"error","message":"Network lookup skipped in fixture"}` — our
  //      line-by-line parser misreads it as a genuine codex stream error and
  //      fails an otherwise-successful run. This was the exact false positive in
  //      issue #1955 (codex finished, working tree clean, CI passed, yet the run
  //      was reported failed).
  // `turn.failed` is the authoritative failure signal, so it is NEVER suppressed
  // here; only non-`turn` error events are gated on turn completion.
  const turnCompleted = (codexJsonState?.eventCounts?.['turn.completed'] || 0) > 0;
  const turnFailed = (codexJsonState?.turnFailures?.length || 0) > 0;
  const sessionSucceeded = turnCompleted && !turnFailed;

  const addEvents = (type, items = []) => {
    for (const item of items) {
      const message = unwrapCodexErrorMessage(item?.message);
      const event = { type, message: message || 'Codex emitted an error event' };
      if (type === 'item' && isNonFatalCodexItemErrorMessage(message)) {
        ignoredEvents.push({
          ...event,
          reason: 'Codex app-server backpressure warning; the turn can still complete successfully',
        });
        continue;
      }
      if (type !== 'turn' && sessionSucceeded) {
        ignoredEvents.push({
          ...event,
          reason: 'Codex turn completed successfully with no turn.failed; stray non-turn error event is non-fatal (Issue #1955)',
        });
        continue;
      }
      events.push(event);
    }
  };

  addEvents('item', codexJsonState?.itemErrors);
  addEvents('turn', codexJsonState?.turnFailures);
  addEvents('stream', codexJsonState?.streamErrors);

  const countByType = items => ({
    item: items.filter(item => item.type === 'item').length,
    turn: items.filter(item => item.type === 'turn').length,
    stream: items.filter(item => item.type === 'stream').length,
  });

  return {
    hasError: events.length > 0,
    message: events[0]?.message || null,
    events,
    ignoredEvents,
    counts: countByType(events),
    ignoredCounts: countByType(ignoredEvents),
    observedCounts: {
      item: codexJsonState?.itemErrors?.length || 0,
      turn: codexJsonState?.turnFailures?.length || 0,
      stream: codexJsonState?.streamErrors?.length || 0,
    },
  };
};

// Issue #1990: A Codex run can exit 0 with no fatal `turn.failed`/error event yet
// still be fundamentally broken. Under docker isolation two long-running
// `solve --tool codex` tasks reported SUCCESS (Exit Code: 0) while their
// containers had run out of disk: cargo builds died with "No space left on
// device" / exit 101, no commits were produced, and — critically — the codex
// turn was never completed (the process was cut off mid-turn). Because the exit
// code was 0 and codex emitted no `turn.failed`, executeCodexCommand declared
// success, which under docker isolation also discarded the container filesystem
// we needed to inspect and retry from.
//
// The authoritative, echo-proof signal is codex's own turn lifecycle: `codex
// exec` emits a paired `turn.started`/`turn.completed` for every turn (a failed
// turn emits `turn.failed`). When the process ends with started turns that
// neither completed nor failed, the session is INCOMPLETE regardless of the exit
// code. Both captured failures had turn.started=1, turn.completed=0,
// turn.failed=0 (see docs/case-studies/issue-1990).
//
// Disk-exhaustion strings ("No space left on device", ENOSPC) are deliberately
// NOT used as an independent failure gate: codex echoes the stdout of every
// command it runs back into its own stream (see issue #1955), so a target repo
// that merely prints or works on that phrase (e.g. a `sed`/`cat` of a saved log,
// both observed in the captured runs at exit_code 0) would be wrongly failed.
// Disk pressure is surfaced only as supporting *diagnostics* explaining why a
// session was likely cut off, never as the sole reason to fail a completed turn.
export const getCodexCompletionHealth = (codexJsonState, { lastMessage = '' } = {}) => {
  const eventCounts = codexJsonState?.eventCounts || {};
  const turnStarted = eventCounts['turn.started'] || 0;
  const turnCompleted = eventCounts['turn.completed'] || 0;
  const turnFailed = codexJsonState?.turnFailures?.length || 0;
  const commandExecutions = codexJsonState?.commandExecutions || [];

  // hadActivity = codex actually began doing work, so a genuinely empty stream
  // (no turns, no commands) is never spuriously flagged — we only fail when work
  // started but never finished.
  const hadActivity = turnStarted > 0 || commandExecutions.length > 0 || (eventCounts['item.completed'] || 0) > 0;

  // A started turn that never completed or failed = the process was cut off
  // mid-turn (OOM / disk-full / container teardown) even though it exited 0.
  const incompleteSession = hadActivity && turnCompleted + turnFailed < Math.max(turnStarted, 1);

  // Diagnostic-only disk-pressure hints (never an independent failure gate).
  const diskEvidence = [];
  const addDiskEvidence = (source, text) => {
    if (text && isENOSPC(text)) {
      diskEvidence.push({ source, text: String(text).replace(/\s+/g, ' ').trim().slice(0, 300) });
    }
  };
  for (const exec of commandExecutions) addDiskEvidence(`command:${exec.command || exec.id || 'unknown'}`, exec.aggregatedOutput);
  for (const streamError of codexJsonState?.streamErrors || []) addDiskEvidence('stream-error', streamError.message);
  for (const itemError of codexJsonState?.itemErrors || []) addDiskEvidence('item-error', itemError.message);
  for (const turnFailure of codexJsonState?.turnFailures || []) addDiskEvidence('turn-failure', turnFailure.message);
  addDiskEvidence('last-message', lastMessage);
  addDiskEvidence('result-summary', codexJsonState?.resultSummary);
  const diskPressureDetected = diskEvidence.length > 0;

  const reasons = [];
  if (incompleteSession) {
    reasons.push(`Codex session ended without completing its turn (turn.started=${turnStarted}, turn.completed=${turnCompleted}, turn.failed=${turnFailed}); the process exited 0 but was cut off mid-turn.`);
    if (diskPressureDetected) {
      reasons.push(`Disk-exhaustion signals were present in ${diskEvidence.length} location(s) (e.g. "No space left on device") — the likely cause of the interrupted session.`);
    }
  }

  return {
    healthy: !incompleteSession,
    incompleteSession,
    diskPressureDetected,
    diskEvidence,
    turnStarted,
    turnCompleted,
    turnFailed,
    reasons,
  };
};
