// Replays one real SDK debug cycle (tests/fixtures/issue-4077) through the stdout capture rule of
// src/claude.lib.mjs and prints which line would become the published failure reason after a SIGKILL.
// Works on both the unfixed and the fixed source tree.
// Usage: node experiments/issue-4077/replay-stdout-capture.mjs
import { readFileSync } from 'node:fs';
import { createClaudeUsageLimitEvidence } from '../../src/claude.usage-limit-sources.lib.mjs';
import * as errorText from '../../src/error-text.lib.mjs';
import { formatToolExecutionFailure, buildToolErrorMessage } from '../../src/lib.mjs';

const lines = readFileSync(new URL('../../tests/fixtures/issue-4077/claude-stdout-sdk-debug-cycle.txt', import.meta.url), 'utf8')
  .replace(/\n$/, '')
  .split('\n');
const isFragment = errorText.isSourceFragmentErrorText || (() => false);
const evidence = createClaudeUsageLimitEvidence();
let lastMessage = '';
const captured = [];
for (const line of lines) {
  if (!evidence.observeRawLine(line).isDebugOutput && !isFragment(line)) {
    lastMessage = line;
    captured.push(line);
  }
}
console.log(`lines replayed: ${lines.length}; lines captured as lastMessage: ${captured.length}`);
for (const line of captured.slice(-3)) console.log(`  captured: ${line}`);
const message = buildToolErrorMessage({ lastMessage, exitCode: 137, fallback: 'Claude command failed with exit code 137', toolLabel: 'Claude' });
console.log(`published: ${formatToolExecutionFailure({ tool: 'claude', toolResult: { success: false, errorInfo: { message, exitCode: 137 } } })}`);
