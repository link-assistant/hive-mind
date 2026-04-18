#!/usr/bin/env node

/**
 * `configure-claude` — reusable bin that resets Hive-Mind's quiet,
 * deterministic Claude Code defaults (env, settings, attribution,
 * permissions.defaultMode, and the disallowedTools block-list) in a
 * target `settings.json`, or verifies that they are already in place.
 *
 * Users and system administrators can run this manually after installing
 * `@link-assistant/hive-mind` to reset Claude Code configuration; both
 * Dockerfiles invoke the same code path via the shared runner to keep
 * the image baseline in lock-step with the published bin.
 *
 * See issues #1627 and #1642.
 */

import { CONFIGURE_CLAUDE_HELP, formatVerifyReport, parseConfigureClaudeArgs, resolveSettingsPath, runConfigureClaude, verifyConfigureClaude } from './configure-claude.lib.mjs';

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
