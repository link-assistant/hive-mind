#!/usr/bin/env node

/**
 * Issue #4063: what solve does when a fresh clone already has uncommitted
 * changes.
 *
 * Until #4063 any `git status --porcelain` output right after the clone stopped
 * the run with "Repository has uncommitted changes after clone". A repository
 * that commits a CRLF file marked `text eol=crlf` (see
 * checkout-normalization.lib.mjs) made Hive Mind unusable on that repository,
 * including on the pull request that fixes it.
 *
 * PR #4064 feedback: by default this must not be an error. The run continues,
 * the AI is told about it in the regular (user) prompt so it can fix the cause,
 * and the user is not distracted by it; every other behavior is configurable
 * with --uncommitted-changes-after-clone:
 *
 *   warn-ai          (default) continue; tell the AI; log details only with --verbose
 *   warn-user        continue; log a warning for the user; do not tell the AI
 *   warn-ai-and-user continue; tell the AI and log a warning for the user
 *   ignore           continue; tell nobody (details only with --verbose)
 *   fail             stop the run, as before #4063
 *
 * Independently, --neutralize-checkout-conversion-artifacts (default on) keeps
 * paths whose bytes equal the commit out of `git status` via the clone-local
 * `.git/info/attributes`, so they never reach the pull request in any mode.
 */

import path from 'node:path';

import { CHECKOUT_NORMALIZATION_HEADER, MAX_DESCRIBED_PATHS, formatStatusEntry, resolveCheckoutArtifacts } from './checkout-normalization.lib.mjs';
import { promptText } from './prompt-text.lib.mjs';

export const UNCOMMITTED_CHANGES_AFTER_CLONE_MODES = Object.freeze(['warn-ai', 'warn-user', 'warn-ai-and-user', 'ignore', 'fail']);
export const DEFAULT_UNCOMMITTED_CHANGES_AFTER_CLONE_MODE = 'warn-ai';

/**
 * @param {object} [argv]
 * @returns {{mode: string, notifyAi: boolean, notifyUser: boolean, fail: boolean, neutralize: boolean}}
 */
export const resolveCloneStatusPolicy = argv => {
  const requested = argv?.uncommittedChangesAfterClone ?? argv?.['uncommitted-changes-after-clone'];
  const mode = UNCOMMITTED_CHANGES_AFTER_CLONE_MODES.includes(requested) ? requested : DEFAULT_UNCOMMITTED_CHANGES_AFTER_CLONE_MODE;
  const neutralizeOption = argv?.neutralizeCheckoutConversionArtifacts ?? argv?.['neutralize-checkout-conversion-artifacts'];
  return {
    mode,
    notifyAi: mode === 'warn-ai' || mode === 'warn-ai-and-user',
    notifyUser: mode === 'warn-user' || mode === 'warn-ai-and-user' || mode === 'fail',
    fail: mode === 'fail',
    neutralize: neutralizeOption !== false,
  };
};

const limitList = lines => (lines.length > MAX_DESCRIBED_PATHS ? [...lines.slice(0, MAX_DESCRIBED_PATHS), `… and ${lines.length - MAX_DESCRIBED_PATHS} more`] : lines);

/**
 * Lines for the AI's user prompt. solve passes them to every tool's prompt
 * builder as `cloneStatusLines`, which are included in new and continued
 * sessions alike (unlike `feedbackLines`, which only continued sessions get),
 * and never in the system prompt.
 *
 * @param {{statusLines: string[], neutralized?: string[], unneutralizedArtifacts?: string[], changes?: string[], infoAttributesFile?: string}} details
 * @returns {string[]}
 */
export const buildCloneStatusFeedback = ({ statusLines, neutralized = [], unneutralizedArtifacts = [], changes = [], infoAttributesFile = '.git/info/attributes' }) => {
  const key = name => `prompt.templates.clone-status.buildCloneStatusFeedback.${name}`;
  const lines = ['', promptText(key('title')), promptText(key('intro')), '', '```', ...limitList(statusLines), '```'];
  if (neutralized.length > 0) {
    lines.push('', promptText(key('artifactsIntro')), ...limitList(neutralized).map(file => `- ${file}`));
    lines.push(promptText(key('artifactsHandled'), { infoAttributesFile }));
    lines.push(promptText(key('artifactsFix'), { infoAttributesFile, header: CHECKOUT_NORMALIZATION_HEADER }));
  }
  if (unneutralizedArtifacts.length > 0) {
    lines.push('', promptText(key('artifactsIntro')), ...limitList(unneutralizedArtifacts).map(file => `- ${file}`));
    lines.push(promptText(key('artifactsNotHandled')));
  }
  if (changes.length > 0) {
    lines.push('', promptText(key('changesIntro')), '', '```', ...limitList(changes), '```', promptText(key('changesAction')));
  }
  lines.push('');
  return lines;
};

/**
 * Handle a non-empty `git status` right after the clone.
 *
 * @param {{cwd: string, argv?: object, log: Function, statusOutput: string}} options
 *   statusOutput - the `git status --porcelain` output that was found
 * @returns {Promise<{mode: string, promptLines: string[], neutralized: string[], changes: string[], remaining: string[]}>}
 *   changes - real changes; remaining - everything `git status` still reports
 * @throws {Error} in `fail` mode when anything is still reported as changed
 */
export const handleUncommittedChangesAfterClone = async ({ cwd, argv, log, statusOutput }) => {
  const policy = resolveCloneStatusPolicy(argv);
  const userLog = policy.notifyUser ? { level: 'warning' } : { verbose: true };
  const statusLines = String(statusOutput || '')
    .split('\n')
    .filter(line => line.trim());

  let resolution = null;
  try {
    resolution = await resolveCheckoutArtifacts({ cwd, log, neutralize: policy.neutralize, notifyUser: policy.notifyUser });
  } catch (error) {
    await log(`⚠️  Could not classify the uncommitted changes: ${error.message}`, userLog);
  }
  const neutralized = resolution?.neutralized || [];
  const unneutralizedArtifacts = policy.neutralize ? [] : (resolution?.artifacts || []).map(entry => entry.path);
  const changes = resolution ? resolution.changes.map(formatStatusEntry) : statusLines;
  const remaining = [...changes, ...unneutralizedArtifacts.map(file => ` M ${file}`)];
  const remainingCount = remaining.length;
  await log(`🔍 Uncommitted changes after clone: ${statusLines.length} path(s); ${neutralized.length} neutralized; ${remainingCount} remaining; --uncommitted-changes-after-clone ${policy.mode}`, { verbose: true });

  if (remainingCount > 0) {
    if (policy.fail) {
      await log('Error: Repository has uncommitted changes after clone', { level: 'error' });
      await log(`Status output: ${remaining.join('\n')}`);
      if (unneutralizedArtifacts.length > 0) {
        await log(`   ${unneutralizedArtifacts.length} of these path(s) hold exactly the committed bytes (a .gitattributes/line-ending mismatch in the repository; --no-neutralize-checkout-conversion-artifacts is set): ${unneutralizedArtifacts.join(', ')}`);
      }
      await log('   Use --uncommitted-changes-after-clone warn-ai (the default) to continue and let the AI handle them.');
      const firstChange = ` (${remaining[0].trim()}${remainingCount > 1 ? ` and ${remainingCount - 1} more` : ''})`;
      throw new Error(`Repository has uncommitted changes after clone${firstChange}`);
    }
    await log(`⚠️  Repository has uncommitted changes after clone; continuing (--uncommitted-changes-after-clone ${policy.mode}):`, userLog);
    for (const line of limitList(remaining)) await log(`   ${line}`, userLog);
  }

  const relativeInfoAttributes = resolution?.infoAttributesFile ? path.relative(cwd, resolution.infoAttributesFile) || resolution.infoAttributesFile : '.git/info/attributes';
  const promptLines = policy.notifyAi ? buildCloneStatusFeedback({ statusLines, neutralized, unneutralizedArtifacts, changes, infoAttributesFile: relativeInfoAttributes }) : [];
  if (promptLines.length > 0) await log('   The AI will be told about them in its prompt.', { verbose: true });
  return { mode: policy.mode, promptLines, neutralized, changes, remaining };
};

export default {
  DEFAULT_UNCOMMITTED_CHANGES_AFTER_CLONE_MODE,
  UNCOMMITTED_CHANGES_AFTER_CLONE_MODES,
  buildCloneStatusFeedback,
  handleUncommittedChangesAfterClone,
  resolveCloneStatusPolicy,
};
