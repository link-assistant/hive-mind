#!/usr/bin/env node

/**
 * Shared runner for the `configure-claude` bin command and the internal
 * Dockerfile/dev wrapper script. Applies or verifies the quiet Claude Code
 * defaults in a target `settings.json` by reusing the canonical maps and
 * idempotent merge helpers from:
 *   - src/claude-quiet-config.lib.mjs (quiet env + settings + attribution
 *     + permissions)
 *   - src/useless-tools.lib.mjs      (disallowedTools block-list)
 *
 * See issues #1627 and #1642.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { REQUIRED_CLAUDE_QUIET_ENV, REQUIRED_CLAUDE_QUIET_SETTINGS, REQUIRED_CLAUDE_QUIET_ATTRIBUTION, REQUIRED_CLAUDE_QUIET_PERMISSIONS, ensureClaudeQuietConfig } from './claude-quiet-config.lib.mjs';
import { buildDisallowedToolsList, ensureDisallowedToolsInSettings } from './useless-tools.lib.mjs';

export const resolveSettingsPath = settingsPath => settingsPath || path.join(os.homedir(), '.claude', 'settings.json');

export const parseConfigureClaudeArgs = argv => {
  const args = { settingsPath: null, verify: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--settings-path' || arg === '-s') {
      args.settingsPath = argv[++i];
    } else if (arg.startsWith('--settings-path=')) {
      args.settingsPath = arg.slice('--settings-path='.length);
    } else if (arg === '--verify') {
      args.verify = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    }
  }
  return args;
};

export const CONFIGURE_CLAUDE_HELP = `Usage: configure-claude [options]

Apply or verify Hive-Mind's quiet, deterministic Claude Code defaults in
a target ~/.claude/settings.json (env vars, settings, attribution,
permissions.defaultMode, and the disallowedTools block-list).

Options:
  -s, --settings-path <path>  Path to settings.json (default: ~/.claude/settings.json)
      --verify                Report configuration status without writing; exit 1 if incorrect
  -h, --help                  Show this help and exit

Examples:
  configure-claude                           # apply defaults to ~/.claude/settings.json
  configure-claude --verify                  # check only, non-zero exit if drift detected
  configure-claude -s /workspace/.claude/settings.json

Reference: https://github.com/link-assistant/hive-mind/issues/1642
`;

const isPlainObject = value => value && typeof value === 'object' && !Array.isArray(value);

const readSettings = async settingsPath => {
  try {
    const content = await fs.readFile(settingsPath, 'utf-8');
    const parsed = JSON.parse(content);
    return isPlainObject(parsed) ? parsed : {};
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
};

export const verifyConfigureClaude = async ({ settingsPath } = {}) => {
  const resolvedPath = resolveSettingsPath(settingsPath);
  const settings = await readSettings(resolvedPath);
  const missing = {
    file: settings === null,
    settings: [],
    env: [],
    attribution: [],
    permissions: [],
    disallowedTools: [],
  };
  const current = settings || {};
  for (const [key, value] of Object.entries(REQUIRED_CLAUDE_QUIET_SETTINGS)) {
    if (current[key] !== value) missing.settings.push(key);
  }
  const envSection = isPlainObject(current.env) ? current.env : {};
  for (const [key, value] of Object.entries(REQUIRED_CLAUDE_QUIET_ENV)) {
    if (envSection[key] !== value) missing.env.push(key);
  }
  const attributionSection = isPlainObject(current.attribution) ? current.attribution : {};
  for (const [key, value] of Object.entries(REQUIRED_CLAUDE_QUIET_ATTRIBUTION)) {
    if (attributionSection[key] !== value) missing.attribution.push(key);
  }
  const permissionsSection = isPlainObject(current.permissions) ? current.permissions : {};
  for (const [key, value] of Object.entries(REQUIRED_CLAUDE_QUIET_PERMISSIONS)) {
    if (permissionsSection[key] !== value) missing.permissions.push(key);
  }
  const existingDisallowed = Array.isArray(current.disallowedTools) ? current.disallowedTools : [];
  for (const required of buildDisallowedToolsList()) {
    if (!existingDisallowed.includes(required)) missing.disallowedTools.push(required);
  }
  const ok = !missing.file && missing.settings.length === 0 && missing.env.length === 0 && missing.attribution.length === 0 && missing.permissions.length === 0 && missing.disallowedTools.length === 0;
  return { ok, path: resolvedPath, missing };
};

export const runConfigureClaude = async ({ settingsPath, log } = {}) => {
  const resolvedPath = resolveSettingsPath(settingsPath);
  const logger = log || (async line => console.log(line));
  const quietResult = await ensureClaudeQuietConfig({ settingsPath: resolvedPath, log: logger });
  const disallowedResult = await ensureDisallowedToolsInSettings({ settingsPath: resolvedPath, log: logger });
  return { quietResult, disallowedResult, path: resolvedPath };
};

export const formatVerifyReport = ({ ok, path: resolvedPath, missing }) => {
  if (ok) {
    return `✅ Quiet Claude Code configuration is up to date in ${resolvedPath}`;
  }
  const sections = [];
  if (missing.file) sections.push('  - settings.json missing');
  if (missing.settings.length) sections.push(`  - settings: ${missing.settings.join(', ')}`);
  if (missing.env.length) sections.push(`  - env: ${missing.env.join(', ')}`);
  if (missing.attribution.length) sections.push(`  - attribution: ${missing.attribution.join(', ')}`);
  if (missing.permissions.length) sections.push(`  - permissions: ${missing.permissions.join(', ')}`);
  if (missing.disallowedTools.length) sections.push(`  - disallowedTools: ${missing.disallowedTools.join(', ')}`);
  return `❌ Quiet Claude Code configuration drift detected in ${resolvedPath}\n${sections.join('\n')}`;
};
