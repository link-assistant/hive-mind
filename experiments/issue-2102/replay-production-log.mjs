/**
 * Issue #2102 — replay the two production logs of CEHR2005/GCS-TS PR #6 through
 * the shipped Codex output parser and the new provisioning health gate.
 *
 * The logs are solve's own transcripts, so every codex line carries a
 * `[timestamp] [LEVEL] ` prefix that codex itself never emits. The prefix is
 * stripped here to reconstruct the byte stream `parseCodexExecJsonOutput` sees.
 *
 *   node experiments/issue-2102/replay-production-log.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';

import { getCodexPluginProvisioningHealth, parseCodexExecJsonOutput } from '../../src/codex.lib.mjs';

const rawDir = path.join(import.meta.dirname, '..', '..', 'docs', 'case-studies', 'issue-2102', 'raw');
const logs = ['solution-draft-log-pr-1784809014365.txt', 'solution-draft-log-pr-1784812579100.txt'];
const SOLVE_PREFIX = /^\[\d{4}-\d{2}-\d{2}T[^\]]+\]\s+\[(?:INFO|STDOUT|STDERR|WARNING|ERROR)\]\s?/u;

for (const name of logs) {
  const text = await fs.readFile(path.join(rawDir, name), 'utf8');
  const stream = text
    .split(/\r?\n/u)
    .map(line => line.replace(SOLVE_PREFIX, ''))
    .join('\n');

  const state = parseCodexExecJsonOutput(stream);
  const health = getCodexPluginProvisioningHealth(state, { capabilityPreflight: { required: false, plugins: [] } });

  console.log(`=== ${name}`);
  console.log(
    `  events: ${Object.entries(state.eventCounts)
      .map(([event, count]) => `${event}=${count}`)
      .join(', ')}`
  );
  console.log(`  fileChanges=${state.fileChanges.length}`);
  console.log(`  pluginInstallRejections=${state.pluginInstallRejections.length}`);
  for (const rejection of state.pluginInstallRejections) {
    console.log(`    ↳ source=${rejection.source} pluginId=${rejection.pluginId ?? '-'} callId=${rejection.callId ?? '-'}`);
  }
  console.log(`  provisioning healthy=${health.healthy} detected=${health.detected} producedWork=${health.producedWork}`);
  console.log(`  requestedPlugins=${health.requestedPlugins.join(', ') || 'none'}`);
  for (const reason of health.reasons) console.log(`    • ${reason}`);
  for (const hint of health.guidance) console.log(`    💡 ${hint}`);
}
