#!/usr/bin/env node

/**
 * Issue #2119: make the published "Working session summary" comment honest.
 *
 * The Kotlin reproduction run ended with the AI tool answering a single `pwd`
 * and returning, and Hive Mind published exactly that as the session's result:
 *
 *     <!-- hive-mind:working-session-summary -->
 *     ## Working session summary
 *
 *     The `pwd` command completed. Output:
 *
 *     ```text
 *     /tmp/gh-issue-solver-1785421161275
 *     ```
 *
 * (https://github.com/konard/test-hello-world-019fb330-fa49-7c9d-a664-b7ea33bb698a/pull/2#issuecomment-5132013034)
 *
 * Two things are wrong with that comment, and both are Hive Mind's to fix - the
 * tool returning nothing useful is a separate, upstream problem:
 *
 *   1. It reads as a report of completed work. A reader has to open the diff to
 *      discover the pull request is still empty. Stating that in the comment
 *      turns a misleading summary into an accurate one.
 *   2. It publishes the solver's private workspace path. That path is an
 *      implementation detail of the machine the run happened on; it is noise in
 *      a public comment and it tells readers about the host filesystem.
 */

/** Solver workspace directories, as created by solve.repository.lib.mjs. */
const WORKSPACE_PATH_PATTERN = /(?:\/private)?\/(?:tmp|var\/folders\/[^\s/]+\/[^\s/]+\/[^\s/]+)\/gh-issue-solver(?:-resume)?-[A-Za-z0-9._-]+/g;

/** Replacement shown in place of a redacted workspace path. */
export const WORKSPACE_PATH_PLACEHOLDER = '<workspace>';

/**
 * Replace solver workspace paths with a placeholder.
 *
 * Only the solver's own `gh-issue-solver-*` directories are touched: paths the
 * user actually cares about (repository-relative paths, other absolute paths)
 * are left exactly as the AI wrote them.
 *
 * @param {string} text
 * @returns {string}
 */
export const redactWorkspacePaths = text => {
  if (typeof text !== 'string' || !text) return text;
  return text.replace(WORKSPACE_PATH_PATTERN, WORKSPACE_PATH_PLACEHOLDER);
};

/**
 * Fence structured text emitted after a Markdown lead-in ending in `:`.
 * Formal AI plan events use a root record followed by space/tab-indented Lino;
 * GitHub otherwise collapses that layout into ordinary prose. Existing fences
 * and ordinary Markdown are preserved, making this safe to apply at the final
 * GitHub-comment boundary.
 */
export const formatWorkingSessionSummaryMarkdown = text => {
  if (typeof text !== 'string' || !text) return text;

  const lines = text.split('\n');
  const output = [];
  let inFence = false;
  let previousNonEmpty = '';

  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      output.push(line);
      if (line.trim()) previousNonEmpty = line;
      index += 1;
      continue;
    }

    if (!inFence && line.trim() && previousNonEmpty.trimEnd().endsWith(':')) {
      let end = index;
      while (end < lines.length && lines[end].trim()) end += 1;
      const block = lines.slice(index, end);
      const looksStructured = block.length >= 2 && block.some(blockLine => /^(?:\t| {2,})/.test(blockLine));
      if (looksStructured) {
        output.push('```text', ...block, '```');
        previousNonEmpty = '```';
        index = end;
        continue;
      }
    }

    output.push(line);
    if (line.trim()) previousNonEmpty = line;
    index += 1;
  }

  return output.join('\n');
};

/**
 * Issue #2247 (H8): bound what a working session summary publishes.
 *
 * The summary comment republishes the AI tool's last message verbatim. On
 * konard/test-hello-world-019fb330-00e1-73b9-955e-f357a1600d5b#2 that message
 * was a Formal AI plan record whose `goal` field embedded the entire request
 * prompt, so each comment carried ~13 KB of machine text
 * (comment 5284660663 is 13624 bytes), and one was posted per session - six on
 * that single pull request. A reader scrolling the conversation has to page
 * through the run's own input to find its output.
 *
 * The cap is deliberately generous: the 2026-09-13 summaries on the same pull
 * request are 542 bytes and are published unchanged. Only a summary that is
 * already unreadable in a conversation gets folded.
 */

/** Lines shown before the summary is folded. */
export const SUMMARY_VISIBLE_LINES = 16;

/** Characters shown before the summary is folded. */
export const SUMMARY_VISIBLE_CHARACTERS = 1200;

/** Characters kept inside the `<details>` block; the rest lives in the log. */
export const SUMMARY_DETAILS_CHARACTERS = 3000;

/**
 * Pick a fence longer than any backtick run in the quoted text, so a summary
 * that itself contains a code block cannot close the block that quotes it.
 */
const fenceFor = text => {
  const longest = (String(text).match(/`+/gu) || []).reduce((max, run) => Math.max(max, run.length), 0);
  return '```'.padEnd(Math.max(3, longest + 1), '`');
};

/** Close a fence the head opened, so the rest of the comment still renders. */
const closeOpenFence = head => {
  let fence = null;
  for (const line of head.split('\n')) {
    const match = /^\s*(```|~~~)/u.exec(line);
    if (!match) continue;
    if (!fence) fence = match[1];
    else if (line.trimStart().startsWith(fence)) fence = null;
  }
  return fence ? head + '\n' + fence : head;
};

const describeSize = characters => (characters >= 1024 ? Math.round(characters / 1024) + ' KB' : characters + ' characters');

/**
 * Fold an oversized summary into a short head plus a collapsed remainder.
 *
 * @param {string} text - the summary as the AI wrote it
 * @param {Object} [options]
 * @param {string|null} [options.logUrl] - the uploaded session log, when known
 * @param {number} [options.visibleLines]
 * @param {number} [options.visibleCharacters]
 * @param {number} [options.detailsCharacters]
 * @returns {{body: string, folded: boolean, omittedCharacters: number}}
 */
export const capWorkingSessionSummary = (text, { logUrl = null, visibleLines = SUMMARY_VISIBLE_LINES, visibleCharacters = SUMMARY_VISIBLE_CHARACTERS, detailsCharacters = SUMMARY_DETAILS_CHARACTERS } = {}) => {
  if (typeof text !== 'string' || !text) return { body: text, folded: false, omittedCharacters: 0 };
  const lines = text.split('\n');
  if (lines.length <= visibleLines && text.length <= visibleCharacters) return { body: text, folded: false, omittedCharacters: 0 };

  let head = lines.slice(0, visibleLines).join('\n');
  if (head.length > visibleCharacters) head = head.slice(0, visibleCharacters);
  const rest = text.slice(head.length).replace(/^\n+/u, '');
  const shown = rest.slice(0, detailsCharacters);
  const omitted = rest.length - shown.length;
  const fence = fenceFor(shown);

  // What is dropped is never lost: the whole session output, this summary
  // included, is in the log attached to the pull request.
  const whereTheRestIs = logUrl ? 'the full session output is in the [session log](' + logUrl + ').' : 'the full session output is in the session log attached to this pull request.';
  const tail = omitted > 0 ? '\n\n' + describeSize(omitted) + ' more is not shown here; ' + whereTheRestIs : '';

  const body = [closeOpenFence(head), '', '<details>', '<summary>Rest of the working session summary (' + describeSize(rest.length) + ')</summary>', '', fence + 'text', shown, fence + tail, '', '</details>'].join('\n');

  return { body, folded: true, omittedCharacters: omitted };
};

/**
 * The line appended when the pull request still has an empty diff.
 *
 * @param {{measured: boolean, hasChanges: boolean}|null} changeStats - from
 *   `getPullRequestChangeStats`; `null` or unmeasured stats produce no notice,
 *   so a failed diff read never turns into a false "no changes" claim.
 * @returns {string} the notice, or an empty string when none applies
 */
export const buildNoChangesNotice = changeStats => {
  if (!changeStats || !changeStats.measured || changeStats.hasChanges) return '';
  return '> ⚠️ This pull request still contains no changes - nothing was implemented yet.';
};

export default { buildNoChangesNotice, capWorkingSessionSummary, formatWorkingSessionSummaryMarkdown, redactWorkspacePaths, SUMMARY_DETAILS_CHARACTERS, SUMMARY_VISIBLE_CHARACTERS, SUMMARY_VISIBLE_LINES, WORKSPACE_PATH_PLACEHOLDER };
