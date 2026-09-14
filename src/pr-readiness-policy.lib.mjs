/**
 * Pull request readiness policy: which mode is hive-mind operating in, and what
 * does that mean for the draft/ready state of the pull request it works on.
 *
 * Issue #2246: a user merged https://github.com/Time0utXC/digitalstructures.pro/pull/4
 * while the AI was still working on it — the pull request was not a draft, its body
 * still said "Work in Progress", it had zero CI checks, and nothing told the reader
 * that hive-mind was going to keep working until the pull request became mergeable.
 * The merge threw away the work that was still running.
 *
 * Two things were missing and both live here:
 *   1. a single definition of the operating mode (nothing else should re-derive it
 *      from `argv.autoMerge || argv.autoRestartUntilMergeable`), and
 *   2. the user-facing text that states the mode and the signal to wait for
 *      (`✅ Ready to merge`), so expectations are managed before the review starts.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2246
 */

import { READY_TO_MERGE_MARKER } from './tool-comments.lib.mjs';
import { tWork } from './i18n.lib.mjs';

export const READINESS_MODES = {
  /** `--auto-merge`: hive-mind verifies mergeability and merges the pull request itself. */
  AUTO_MERGE: 'auto-merge',
  /** `--auto-restart-until-mergeable` (the default): hive-mind verifies mergeability, the human merges. */
  ENSURE_MERGEABLE: 'ensure-mergeable',
  /** `--no-auto-restart-until-mergeable`: one working session, no mergeability monitoring. */
  SINGLE_PASS: 'single-pass',
};

/** Read an option that may arrive in camelCase or kebab-case form. */
const option = (argv, camel, kebab) => argv?.[camel] ?? argv?.[kebab];

/**
 * The mode hive-mind operates in for a given run.
 * @param {Object} argv - Parsed command line arguments
 * @returns {string} one of READINESS_MODES
 */
export const getReadinessMode = argv => {
  if (option(argv, 'autoMerge', 'auto-merge')) return READINESS_MODES.AUTO_MERGE;
  // `--auto-merge` implies `--auto-restart-until-mergeable`; the latter defaults to true.
  if (option(argv, 'autoRestartUntilMergeable', 'auto-restart-until-mergeable')) return READINESS_MODES.ENSURE_MERGEABLE;
  return READINESS_MODES.SINGLE_PASS;
};

/**
 * Is hive-mind responsible for making this pull request mergeable?
 *
 * When true the pull request must stay a draft until the "ready to merge" state is
 * actually verified — see pr-draft-state.lib.mjs's ready hold.
 */
export const isMergeableModeActive = argv => getReadinessMode(argv) !== READINESS_MODES.SINGLE_PASS;

const translate = (key, params = {}) => tWork(`pr.readiness.${key}`, params);

const modeDescription = (mode, flag, key) => ({
  mode,
  flag,
  title: translate(`mode.${key}.title`),
  summary: translate(`mode.${key}.summary`),
  waitFor: translate(`mode.${key}.wait.for`, { marker: READY_TO_MERGE_MARKER }),
});

/**
 * Human-readable description of the active mode.
 * @returns {{mode: string, flag: string, title: string, summary: string, waitFor: string}}
 */
export const describeReadinessMode = argv => {
  const mode = getReadinessMode(argv);
  switch (mode) {
    case READINESS_MODES.AUTO_MERGE:
      return modeDescription(mode, '--auto-merge', 'auto.merge');
    case READINESS_MODES.ENSURE_MERGEABLE:
      return modeDescription(mode, '--auto-restart-until-mergeable', 'ensure.mergeable');
    default:
      return modeDescription(mode, '--no-auto-restart-until-mergeable', 'single.pass');
  }
};

/**
 * The notice that tells a human what to expect from this pull request.
 * Embedded in the pull request body when hive-mind creates it; work-session comments
 * carry the one-line version from buildWorkSessionStatusLine().
 *
 * @param {Object} argv - Parsed command line arguments
 * @param {Object} [options]
 * @param {boolean} [options.includeHeading=true] - Prefix the notice with its heading
 * @param {string} [options.headingLevel='###'] - Markdown heading level
 * @returns {string} markdown block
 */
export const buildPullRequestStatusNotice = (argv, { includeHeading = true, headingLevel = '###' } = {}) => {
  const description = describeReadinessMode(argv);
  const lines = [];

  if (includeHeading) {
    lines.push(`${headingLevel} 🚦 ${translate('heading')}`, '');
  }

  lines.push(`**${translate('mode.label')}:** \`${description.flag}\` — ${description.summary}`, '');

  if (description.mode === READINESS_MODES.SINGLE_PASS) {
    lines.push(translate('notice.single.pass').trim());
    return lines.join('\n');
  }

  lines.push(translate('notice.mergeable', { marker: READY_TO_MERGE_MARKER, waitFor: description.waitFor }).trim());

  if (description.mode === READINESS_MODES.AUTO_MERGE) {
    lines.push(translate('notice.auto.merge'));
  }

  return lines.join('\n');
};

/**
 * One-line version of the notice for work-session comments.
 * @param {Object} argv - Parsed command line arguments
 * @returns {string}
 */
export const buildWorkSessionStatusLine = argv => {
  const description = describeReadinessMode(argv);
  if (description.mode === READINESS_MODES.SINGLE_PASS) {
    return translate('session.single.pass', { flag: description.flag });
  }
  return translate('session.mergeable', { flag: description.flag, marker: READY_TO_MERGE_MARKER });
};

export default {
  READINESS_MODES,
  getReadinessMode,
  isMergeableModeActive,
  describeReadinessMode,
  buildPullRequestStatusNotice,
  buildWorkSessionStatusLine,
};
