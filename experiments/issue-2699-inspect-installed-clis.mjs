#!/usr/bin/env node
// Issue #2699: compare each Bun-installed CLI's `--version` with Bun's install
// list on this host, read-only (no registry calls, no installs).
// Usage: node experiments/issue-2699-inspect-installed-clis.mjs
import { AGENTIC_CLI_TARGETS, describeBinaryVersionMismatch, inspectInstalledCli } from '../src/agentic-cli-updater.lib.mjs';

for (const target of AGENTIC_CLI_TARGETS) {
  const inspection = await inspectInstalledCli(target, { timeoutMs: 30_000 });
  const note = describeBinaryVersionMismatch(target, inspection);
  console.log(`${target.id.padEnd(22)} version=${inspection.version ?? '-'} source=${inspection.source ?? '-'} --version=${inspection.binaryVersion ?? '-'}${note ? `\n  ℹ️ ${note}` : ''}`);
}
