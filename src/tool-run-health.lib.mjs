// Tool-agnostic run-health analysis (Issue #1990).
//
// Background: under docker isolation two long-running `solve --tool codex` tasks
// reported SUCCESS (Exit Code: 0) while their containers had run out of disk —
// the AI session was cut off mid-run, no commits were produced, yet the process
// exited 0. Reporting that as success also discarded the container filesystem we
// needed to inspect and retry from.
//
// codex.lib.mjs gets a bespoke gate (paired turn.started/turn.completed lifecycle
// — see codex-health.lib.mjs) and claude.lib.mjs already requires its final
// `result` event (shouldFailClaudeStreamWithoutResult). This module provides the
// equivalent gate for the tools whose stream-json output (adopted from the Claude
// Agent SDK schema) ends with a single terminal `result` event: gemini-cli and
// qwen-code. An exit-0 run that clearly began work but never emitted that
// terminal event was interrupted and must NOT be reported as success.
//
// opencode is deliberately NOT gated here: its `step_finish` terminal event is
// not reliably flushed before a clean exit on some versions (upstream bug
// anomalyco/opencode#26855), so gating on it would convert genuine successes into
// failures. See docs/case-studies/issue-1990 for the analysis.
//
// Disk-exhaustion strings ("No space left on device", ENOSPC) are surfaced only
// as supporting *diagnostics* — never an independent failure gate — to avoid the
// issue #1955 class of false positive where a tool echoes a command's stdout that
// merely mentions the phrase.

import { isENOSPC } from './lib.mjs';

export const getTerminalEventCompletionHealth = ({ eventCounts = {}, terminalEventTypes = ['result'], hadActivity = false, diskEvidenceTexts = [] } = {}) => {
  const terminalCount = terminalEventTypes.reduce((sum, type) => sum + (eventCounts[type] || 0), 0);

  // Only flag a run that did work but never reached its terminal event. A run
  // with no activity at all is handled separately by each tool (e.g. gemini's
  // emittedNoEvents check) and must not be double-counted here.
  const incompleteSession = hadActivity && terminalCount === 0;

  const diskEvidence = [];
  for (const { source, text } of diskEvidenceTexts) {
    if (text && isENOSPC(text)) {
      diskEvidence.push({ source, text: String(text).replace(/\s+/g, ' ').trim().slice(0, 300) });
    }
  }
  const diskPressureDetected = diskEvidence.length > 0;

  const reasons = [];
  if (incompleteSession) {
    reasons.push(`The tool exited 0 but never emitted its terminal completion event (${terminalEventTypes.join('/')}); the session was cut off mid-run.`);
    if (diskPressureDetected) {
      reasons.push(`Disk-exhaustion signals were present in ${diskEvidence.length} location(s) (e.g. "No space left on device") — the likely cause of the interrupted session.`);
    }
  }

  return {
    healthy: !incompleteSession,
    incompleteSession,
    diskPressureDetected,
    diskEvidence,
    terminalCount,
    reasons,
  };
};
