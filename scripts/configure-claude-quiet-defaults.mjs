#!/usr/bin/env node

/**
 * Configure quiet, deterministic Claude Code defaults in a target
 * `settings.json` (typically `~/.claude/settings.json` or the pre-seeded
 * `/workspace/.claude/settings.json` inside our Docker images).
 *
 * Replaces the long inline `node -e "..."` block that used to live in both
 * Dockerfiles. Reuses the canonical required env/settings/attribution/
 * permissions maps and the idempotent merge helpers from:
 *   - src/claude-quiet-config.lib.mjs (quiet env + settings)
 *   - src/useless-tools.lib.mjs      (disallowedTools block-list)
 *
 * Usage:
 *   node scripts/configure-claude-quiet-defaults.mjs [--settings-path <path>]
 *
 * Defaults `--settings-path` to `${HOME}/.claude/settings.json`.
 *
 * See issues #1627 and #1642.
 */

import path from 'node:path';
import os from 'node:os';

import { ensureClaudeQuietConfig } from '../src/claude-quiet-config.lib.mjs';
import { ensureDisallowedToolsInSettings } from '../src/useless-tools.lib.mjs';

const parseArgs = argv => {
  const args = { settingsPath: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--settings-path' || arg === '-s') {
      args.settingsPath = argv[++i];
    } else if (arg.startsWith('--settings-path=')) {
      args.settingsPath = arg.slice('--settings-path='.length);
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    }
  }
  return args;
};

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log('Usage: node scripts/configure-claude-quiet-defaults.mjs [--settings-path <path>]');
  process.exit(0);
}

const settingsPath = args.settingsPath || path.join(os.homedir(), '.claude', 'settings.json');

const log = async line => console.log(line);

const quietResult = await ensureClaudeQuietConfig({ settingsPath, log });
const disallowedResult = await ensureDisallowedToolsInSettings({ settingsPath, log });

console.log(`Configured quiet Claude Code defaults and ${disallowedResult.total} disallowedTools in ${quietResult.path}`);
