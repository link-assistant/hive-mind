#!/usr/bin/env node

/**
 * Thin wrapper kept for the Dockerfile baseline — delegates to the shared
 * `configure-claude` bin runner so the Docker image, the published CLI
 * command, and the solve runtime stay in lock-step.
 *
 * Users installing `@link-assistant/hive-mind` should prefer running
 * `configure-claude` directly (see `src/configure-claude.mjs`); this
 * script only exists so the Dockerfiles can invoke the same logic from
 * a COPY'd subset of files before the package is globally installed.
 *
 * See issues #1627 and #1642.
 */

import { CONFIGURE_CLAUDE_HELP, formatVerifyReport, parseConfigureClaudeArgs, resolveSettingsPath, runConfigureClaude, verifyConfigureClaude } from '../src/configure-claude.lib.mjs';

const args = parseConfigureClaudeArgs(process.argv.slice(2));

if (args.help) {
  console.log(CONFIGURE_CLAUDE_HELP);
  process.exit(0);
}

const settingsPath = resolveSettingsPath(args.settingsPath);

if (args.verify) {
  const report = await verifyConfigureClaude({ settingsPath });
  console.log(formatVerifyReport(report));
  process.exit(report.ok ? 0 : 1);
}

const { quietResult, disallowedResult } = await runConfigureClaude({ settingsPath });
console.log(`Configured quiet Claude Code defaults and ${disallowedResult.total} disallowedTools in ${quietResult.path}`);
