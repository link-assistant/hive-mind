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

import { normalizePluginSelector } from './codex-capability-preflight.lib.mjs';
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

// Issue #2102: `request_plugin_install` can never succeed under `codex exec`.
// The tool validates its `plugin_id` against the server-driven
// `<recommended_plugins>` list with an exact string comparison, and `codex exec`
// auto-cancels the elicitation it would raise, so a model that reaches for it is
// stuck in a loop it cannot exit. In the captured GCS-TS#5 runs that produced no
// work at all, the only trace was in codex's OTEL text stream (the tool is a
// builtin, so there is no NDJSON `mcp_tool_call` item to inspect):
//
//   INFO codex_otel.log_only: event.name="codex.tool_result"
//     tool_name=request_plugin_install call_id=… arguments={"plugin_id":"…"}
//     … success=false output=plugin_id must match one of the entries in the
//     <recommended_plugins> list
//   ERROR codex_core::tools::router: error=plugin_id must match one of the
//     entries in the <recommended_plugins> list
//
// Both patterns are anchored at the beginning of the line rather than matched
// anywhere in it: codex echoes the stdout of every command it runs back into its
// own stream (issue #1955), and this repository's own case-study logs contain
// these very lines. An echoed copy is always preceded by the emitting tool's own
// prefix (`tool_name=shell … output=…`), so requiring `request_plugin_install` to
// be the tool of the line's *own* event, and the router error to open the line,
// keeps replayed text from being read as a live rejection.
const PLUGIN_INSTALL_MESSAGE_TEXT = 'plugin_id must match one of the entries in the <recommended_plugins> list';
const PLUGIN_INSTALL_MESSAGE_PATTERN = /plugin_id must match one of the entries in the <recommended_plugins> list/;
const PLUGIN_INSTALL_TOOL_RESULT = /^(?:\S+\s+)?(?:TRACE|DEBUG|INFO|WARN|ERROR)\s+codex_otel\.log_only:\s+event\.name="codex\.tool_result"\s+tool_name=request_plugin_install\b/;
const PLUGIN_INSTALL_ROUTER_ERROR = /^(?:\S+\s+)?ERROR\s+codex_core::tools::router:\s+error=plugin_id must match one of the entries in the <recommended_plugins> list/;
const PLUGIN_INSTALL_CALL_ID = /\bcall_id=(\S+)/;
const PLUGIN_INSTALL_PLUGIN_ID = /"plugin_id"\s*:\s*"([^"]+)"/;
const PLUGIN_INSTALL_SUCCESS = /\bsuccess=(true|false)\b/;

export const matchCodexPluginInstallRejection = line => {
  const text = String(line || '');
  if (PLUGIN_INSTALL_ROUTER_ERROR.test(text)) return { source: 'router', callId: null, pluginId: null, message: PLUGIN_INSTALL_MESSAGE_TEXT };
  if (!PLUGIN_INSTALL_TOOL_RESULT.test(text)) return null;
  if (!PLUGIN_INSTALL_MESSAGE_PATTERN.test(text)) return null;
  if (PLUGIN_INSTALL_SUCCESS.exec(text)?.[1] === 'true') return null;
  return { source: 'tool_result', callId: PLUGIN_INSTALL_CALL_ID.exec(text)?.[1] || null, pluginId: PLUGIN_INSTALL_PLUGIN_ID.exec(text)?.[1] || null, message: PLUGIN_INSTALL_MESSAGE_TEXT };
};

// Issue #2102: a rejected runtime install means the capability preflight did not
// provision what the task needs, so the run cannot do the work it was asked to
// do. It is reported as a failure only when nothing was produced: a model may
// probe `request_plugin_install` and then complete the task without the plugin,
// and failing that run retroactively would discard real output.
export const getCodexPluginProvisioningHealth = (codexJsonState, { capabilityPreflight = null } = {}) => {
  const rejections = codexJsonState?.pluginInstallRejections || [];
  const requestedPlugins = [...new Set(rejections.map(entry => entry.pluginId).filter(Boolean))].sort();
  const fileChanges = codexJsonState?.fileChanges || [];
  const producedWork = fileChanges.length > 0;
  const detected = rejections.length > 0;

  const reasons = [];
  const guidance = [];
  if (detected) {
    reasons.push(`Codex called request_plugin_install${requestedPlugins.length > 0 ? ` for ${requestedPlugins.join(', ')}` : ''} and codex rejected it: ${PLUGIN_INSTALL_MESSAGE_TEXT}. Under codex exec this tool can never install a plugin, so the model cannot recover on its own.`);
    reasons.push(capabilityPreflight?.required ? `The Hive Mind Codex capability preflight ran for ${(capabilityPreflight.plugins || []).join(', ') || 'no plugins'}, so the plugin the model asked for was not among the requirements it discovered.` : 'The Hive Mind Codex capability preflight detected no requirements for this task, so nothing was provisioned before codex exec.');
    for (const plugin of requestedPlugins.length > 0 ? requestedPlugins : ['<plugin>@<marketplace>']) {
      // Issue #2102: the model asks for `@openai-curated-remote`, which is a
      // synthesized namespace that `codex plugin add` cannot install; the
      // preflight's normalization maps it onto the installable `@openai-curated`
      // marketplace, so the guidance must quote the selector that actually works.
      guidance.push(`Declare the requirement so the preflight provisions it: --require-codex-plugin ${normalizePluginSelector(plugin)} (or HIVE_MIND_CODEX_REQUIRED_PLUGINS).`);
    }
    guidance.push('Requirements declared in the target repository AGENTS.md / CLAUDE.md are discovered automatically; run with --verbose to see the sources the preflight scanned.');
  }

  return {
    healthy: !detected || producedWork,
    detected,
    producedWork,
    requestedPlugins,
    rejections,
    message: detected ? reasons[0] : null,
    reasons,
    guidance,
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
// Issue #2136: the count comparison above is only sound when every counted
// `turn.started` is codex's own. It is not: under `--verbose` codex's stderr
// carries OTEL records that dump the raw stdout of each command it ran, so a task
// that drives another agent CLI replays that agent's `turn.started` into our
// stream. One echoed line was enough to make turn.started=2 vs turn.completed=1
// and fail a run that had finished successfully (formal-ai PR #913 was open with
// green CI). codex.lib.mjs now keeps stderr out of the protocol counters, and the
// gate itself asks the order-aware question — "was the LAST lifecycle event a
// start?" — so a stray extra `turn.started` from any future echo path can no
// longer flip a completed session to failed, while a genuine cut-off mid-turn
// (the #1990 shape: the stream ends on `turn.started`) still fails.
const isIncompleteTurnLifecycle = (turnLifecycle, { turnStarted, turnCompleted, turnFailed }) => {
  if (!Array.isArray(turnLifecycle) || turnLifecycle.length === 0) {
    // Callers that hand-build a state without an ordered lifecycle keep the
    // original count rule.
    return turnCompleted + turnFailed < Math.max(turnStarted, 1);
  }
  return turnLifecycle.at(-1) === 'turn.started';
};

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
  const incompleteSession = hadActivity && isIncompleteTurnLifecycle(codexJsonState?.turnLifecycle, { turnStarted, turnCompleted, turnFailed });

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

// Reporting helpers for the run gates in codex.lib.mjs. They live here with the
// analysis they narrate so codex.lib.mjs stays inside the 1500-line budget
// (issues #1730 / #1990).
export const logCodexResourceSnapshot = async ({ getResourceSnapshot, log }) => {
  const resourcesAfter = await getResourceSnapshot();
  await log('\n📈 System resources after execution:', { verbose: true });
  await log(`   Memory: ${resourcesAfter.memory.split('\n')[1]}`, { verbose: true });
  await log(`   Load: ${resourcesAfter.load}`, { verbose: true });
};

export const reportCodexCompletionFailure = async ({ completionHealth, log, getResourceSnapshot }) => {
  await log('\n\n❌ Codex exited 0 but the run did not complete — treating as failure', { level: 'error' });
  for (const reason of completionHealth.reasons) {
    await log(`   • ${reason}`, { level: 'error' });
  }
  await log(`   📊 turn.started=${completionHealth.turnStarted}, turn.completed=${completionHealth.turnCompleted}, turn.failed=${completionHealth.turnFailed}`, { verbose: true });
  if (completionHealth.diskPressureDetected) {
    await log('   💽 Disk-exhaustion evidence (diagnostic):', { level: 'error' });
    for (const evidence of completionHealth.diskEvidence.slice(0, 5)) {
      await log(`      ↳ [${evidence.source}] ${evidence.text}`, { level: 'error' });
    }
    await log('   💡 Free disk space before retrying. Under docker isolation the container is preserved on failure for inspection.', { level: 'error' });
  }
  await logCodexResourceSnapshot({ getResourceSnapshot, log });
};

export const reportCodexPluginProvisioning = async ({ pluginProvisioning, log }) => {
  if (!pluginProvisioning.detected) return;
  if (!pluginProvisioning.healthy) {
    await log('\n\n❌ Codex could not obtain a required plugin at runtime — treating as failure', { level: 'error' });
    for (const reason of pluginProvisioning.reasons) {
      await log(`   • ${reason}`, { level: 'error' });
    }
    for (const hint of pluginProvisioning.guidance) {
      await log(`   💡 ${hint}`, { level: 'error' });
    }
    return;
  }
  await log(`\n⚠️ Codex asked to install ${pluginProvisioning.requestedPlugins.join(', ') || 'a plugin'} at runtime and was rejected, but the run still produced changes`, { level: 'warning' });
  for (const hint of pluginProvisioning.guidance) {
    await log(`   💡 ${hint}`, { level: 'warning', verbose: true });
  }
};
