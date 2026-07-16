#!/usr/bin/env node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const REQUIRED_CLAUDE_QUIET_ENV = Object.freeze({
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
  CLAUDE_CODE_DISABLE_CRON: '1',
  CLAUDE_CODE_DISABLE_TERMINAL_TITLE: '1',
  CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1',
  CLAUDE_CODE_DISABLE_FAST_MODE: '1',
  CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY: '1',
  CLAUDE_CODE_DISABLE_MOUSE: '1',
  CLAUDE_CODE_ENABLE_AWAY_SUMMARY: '0',
  CLAUDE_CODE_ENABLE_TASKS: '1',
  CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY: '4',
  CLAUDE_CODE_RESUME_INTERRUPTED_TURN: '1',
  DISABLE_FEEDBACK_COMMAND: '1',
});

export const REQUIRED_CLAUDE_QUIET_SETTINGS = Object.freeze({
  autoMemoryEnabled: false,
  spinnerTipsEnabled: false,
  awaySummaryEnabled: false,
  feedbackSurveyRate: 0,
  includeCoAuthoredBy: false,
  includeGitInstructions: true,
  prefersReducedMotion: true,
  showThinkingSummaries: false,
  skipDangerousModePermissionPrompt: true,
  viewMode: 'verbose',
});

export const REQUIRED_CLAUDE_QUIET_ATTRIBUTION = Object.freeze({
  commit: '',
  pr: '',
});

export const REQUIRED_CLAUDE_QUIET_PERMISSIONS = Object.freeze({
  defaultMode: 'bypassPermissions',
});

export const buildClaudeQuietEnv = (baseEnv = process.env) => ({
  ...baseEnv,
  ...REQUIRED_CLAUDE_QUIET_ENV,
});

export const formatClaudeQuietConfigSummary = () => {
  const settings = Object.entries(REQUIRED_CLAUDE_QUIET_SETTINGS)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(', ');
  const attribution = `attribution=${JSON.stringify(REQUIRED_CLAUDE_QUIET_ATTRIBUTION)}`;
  const permissions = `permissions=${JSON.stringify(REQUIRED_CLAUDE_QUIET_PERMISSIONS)}`;
  const env = Object.entries(REQUIRED_CLAUDE_QUIET_ENV)
    .map(([key, value]) => `${key}=${value}`)
    .join(', ');
  return `settings[${settings}, ${attribution}, ${permissions}], env[${env}]`;
};

const isPlainObject = value => value && typeof value === 'object' && !Array.isArray(value);

// Map our 2-letter locale to the BCP-47-like language string Claude Code accepts.
// See https://code.claude.com/docs/en/settings#available-settings for the
// supported `language` values.
const LOCALE_TO_CLAUDE_LANGUAGE = Object.freeze({
  en: 'English',
  ru: 'Russian',
  zh: 'Chinese (Simplified)',
  hi: 'Hindi',
});

export function resolveClaudeLanguageSetting(locale) {
  if (!locale) return null;
  return LOCALE_TO_CLAUDE_LANGUAGE[locale] || null;
}

export const ensureClaudeQuietConfig = async ({ settingsPath, log, workLanguage = null } = {}) => {
  const resolvedPath = settingsPath || path.join(os.homedir(), '.claude', 'settings.json');
  let settings;
  try {
    const content = await fs.readFile(resolvedPath, 'utf-8');
    const parsed = JSON.parse(content);
    settings = isPlainObject(parsed) ? parsed : {};
  } catch (err) {
    if (err.code !== 'ENOENT' && log) {
      await log(`⚠️  Could not read ${resolvedPath}: ${err.message}`, { verbose: true });
    }
    settings = {};
  }

  const updatedSettingsKeys = [];
  for (const [key, value] of Object.entries(REQUIRED_CLAUDE_QUIET_SETTINGS)) {
    if (settings[key] !== value) {
      settings[key] = value;
      updatedSettingsKeys.push(key);
    }
  }

  const existingAttribution = isPlainObject(settings.attribution) ? settings.attribution : {};
  const updatedAttributionKeys = [];
  for (const [key, value] of Object.entries(REQUIRED_CLAUDE_QUIET_ATTRIBUTION)) {
    if (existingAttribution[key] !== value) {
      existingAttribution[key] = value;
      updatedAttributionKeys.push(key);
    }
  }
  settings.attribution = existingAttribution;
  if (updatedAttributionKeys.length > 0) {
    updatedSettingsKeys.push('attribution');
  }

  const existingPermissions = isPlainObject(settings.permissions) ? settings.permissions : {};
  const updatedPermissionsKeys = [];
  for (const [key, value] of Object.entries(REQUIRED_CLAUDE_QUIET_PERMISSIONS)) {
    if (existingPermissions[key] !== value) {
      existingPermissions[key] = value;
      updatedPermissionsKeys.push(key);
    }
  }
  settings.permissions = existingPermissions;
  if (updatedPermissionsKeys.length > 0) {
    updatedSettingsKeys.push('permissions');
  }

  const existingEnv = isPlainObject(settings.env) ? settings.env : {};
  const updatedEnvKeys = [];
  for (const [key, value] of Object.entries(REQUIRED_CLAUDE_QUIET_ENV)) {
    if (existingEnv[key] !== value) {
      existingEnv[key] = value;
      updatedEnvKeys.push(key);
    }
  }
  settings.env = existingEnv;

  // Issue #378: write Claude Code's `language` setting from --work-language.
  // When workLanguage is null, we deliberately leave any existing value alone
  // so the user's manual override stays intact between solve invocations.
  const desiredLanguage = resolveClaudeLanguageSetting(workLanguage);
  let updatedLanguage = false;
  if (desiredLanguage && settings.language !== desiredLanguage) {
    settings.language = desiredLanguage;
    updatedSettingsKeys.push('language');
    updatedLanguage = true;
  }

  const changed = updatedSettingsKeys.length > 0 || updatedEnvKeys.length > 0 || updatedLanguage;
  try {
    if (changed) {
      await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
      await fs.writeFile(resolvedPath, JSON.stringify(settings, null, 2));
    }
    if (log) {
      await log(`🧭 Claude Code quiet config ${changed ? 'updated' : 'verified'} at ${resolvedPath}: ${formatClaudeQuietConfigSummary()}`);
    }
  } catch (err) {
    if (log) await log(`⚠️  Could not write ${resolvedPath}: ${err.message}`, { verbose: true });
  }

  return {
    path: resolvedPath,
    changed,
    updatedSettingsKeys,
    updatedEnvKeys,
    updatedAttributionKeys,
    updatedPermissionsKeys,
    settings: { ...REQUIRED_CLAUDE_QUIET_SETTINGS },
    attribution: { ...REQUIRED_CLAUDE_QUIET_ATTRIBUTION },
    permissions: { ...REQUIRED_CLAUDE_QUIET_PERMISSIONS },
    env: { ...REQUIRED_CLAUDE_QUIET_ENV },
  };
};
