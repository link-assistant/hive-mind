#!/usr/bin/env node
/**
 * Shared reader/merger for the Gemini-family CLI settings files.
 *
 * Gemini CLI and Qwen Code both keep their user configuration in a single JSON
 * file, and hive-mind has more than one policy to write into it: cross-task
 * memory (issue #2178) and non-essential auxiliary model calls (issue #2236).
 * Both need the same three properties — merge rather than overwrite, so an
 * operator's own settings survive; never throw, because a settings file that
 * cannot be written costs inference, not correctness; and be idempotent, so a
 * compliant file is not rewritten on every run.
 *
 * Keeping that in one place means the two policies cannot disagree about what
 * "merge" means, and a third policy does not have to reimplement it a third time.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2178
 * @see https://github.com/link-assistant/hive-mind/issues/2236
 */

import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** Where each Gemini-family CLI keeps its user settings. */
export const GEMINI_FAMILY_SETTINGS_PATHS = Object.freeze({
  gemini: Object.freeze(['.gemini', 'settings.json']),
  qwen: Object.freeze(['.qwen', 'settings.json']),
});

export const isPlainObject = value => !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * Merge `desired` into `target` in place, returning the dotted paths that changed.
 *
 * Arrays are unioned rather than replaced so an operator's own `tools.exclude`
 * entries survive; scalars are overwritten, because the whole point is that the
 * policy wins.
 *
 * `__proto__`, `constructor` and `prototype` are skipped outright. Today this
 * function is only ever handed frozen literals whose keys are all ordinary, so
 * none of them can occur — but that is a fact about the callers, not about the
 * function, and callers change (CodeQL `js/prototype-pollution-utility`). The
 * guard is written as explicit comparisons rather than a lookup in a shared set
 * because that is the shape the query recognises as a barrier, and a guard a
 * scanner cannot see is one that gets reported again every time someone touches
 * the file.
 */
export const mergeSettings = (target, desired, prefix = '') => {
  const changed = [];
  for (const [key, value] of Object.entries(desired)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    const dotted = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value)) {
      if (!isPlainObject(target[key])) target[key] = {};
      changed.push(...mergeSettings(target[key], value, dotted));
      continue;
    }
    if (Array.isArray(value)) {
      const existing = Array.isArray(target[key]) ? target[key] : [];
      const merged = [...existing];
      let added = false;
      for (const entry of value) {
        if (!merged.includes(entry)) {
          merged.push(entry);
          added = true;
        }
      }
      if (added || !Array.isArray(target[key])) {
        target[key] = merged;
        changed.push(dotted);
      }
      continue;
    }
    if (target[key] !== value) {
      target[key] = value;
      changed.push(dotted);
    }
  }
  return changed;
};

/**
 * Resolve the settings file a Gemini-family CLI reads.
 *
 * @param {'gemini'|'qwen'} tool
 * @param {Object} [options]
 * @param {string} [options.homeDir]
 * @returns {string|null} null when the tool has no Gemini-family settings file.
 */
export const resolveGeminiFamilySettingsPath = (tool, { homeDir = os.homedir() } = {}) => {
  const segments = GEMINI_FAMILY_SETTINGS_PATHS[tool];
  if (!segments) return null;
  return path.join(homeDir, ...segments);
};

/**
 * Merge `settings` into a Gemini-family settings file, preserving what is there.
 *
 * Never throws. A task that cannot write the settings file is still a task worth
 * running; the caller logs the failure and carries on.
 *
 * @param {Object} [params]
 * @param {'gemini'|'qwen'} params.tool
 * @param {Object} params.settings - Frozen policy literal to merge in.
 * @param {string} [params.settingsPath] - Overrides the tool's default location (tests).
 * @param {string} [params.homeDir]
 * @param {Function} [params.log]
 * @param {string} [params.describe] - What to call this write in the log line.
 * @param {Object} [params.fsImpl] - `node:fs/promises`-shaped, for tests.
 * @returns {Promise<{applied: boolean, path: string|null, changed: string[], error: string|null}>}
 */
export const ensureGeminiFamilySettings = async ({ tool, settings: desired = {}, settingsPath, homeDir = os.homedir(), log, describe = 'settings', fsImpl = fsPromises } = {}) => {
  const resolvedPath = settingsPath || resolveGeminiFamilySettingsPath(tool, { homeDir });
  if (!resolvedPath) return { applied: false, path: null, changed: [], error: null };

  let settings = {};
  try {
    const parsed = JSON.parse(await fsImpl.readFile(resolvedPath, 'utf-8'));
    if (isPlainObject(parsed)) settings = parsed;
  } catch (error) {
    if (error?.code !== 'ENOENT' && log) {
      await log(`⚠️  Could not read ${resolvedPath}: ${error.message}`, { verbose: true });
    }
  }

  const changed = mergeSettings(settings, desired);
  try {
    if (changed.length > 0) {
      await fsImpl.mkdir(path.dirname(resolvedPath), { recursive: true });
      await fsImpl.writeFile(resolvedPath, JSON.stringify(settings, null, 2));
    }
    if (log) {
      await log(`⚙️  ${describe} ${changed.length > 0 ? 'applied' : 'already applied'} for ${tool} in ${resolvedPath}`, { verbose: true });
    }
    return { applied: true, path: resolvedPath, changed, error: null };
  } catch (error) {
    const message = error?.message || String(error);
    if (log) await log(`⚠️  Could not write ${resolvedPath}: ${message}`, { verbose: true });
    return { applied: false, path: resolvedPath, changed: [], error: message };
  }
};

export default {
  GEMINI_FAMILY_SETTINGS_PATHS,
  ensureGeminiFamilySettings,
  isPlainObject,
  mergeSettings,
  resolveGeminiFamilySettingsPath,
};
