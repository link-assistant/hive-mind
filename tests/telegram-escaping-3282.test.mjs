#!/usr/bin/env node
/**
 * Issue #3282: the Telegram helpers CodeQL flags in files this PR touches.
 *
 * - A command argument counts as a GitHub URL only when it names the
 *   github.com host, not when the string merely appears in it.
 * - The merge queue's MarkdownV2 escaping covers `\`, and its CI run links go
 *   through the same link-URL escaping as the PR links.
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mentionsGitHubHost } from '../src/telegram-message-filters.lib.mjs';
import { MergeQueueProcessor, MergeStatus } from '../src/telegram-merge-queue.lib.mjs';

test('a command argument names github.com, or it is not a GitHub URL', () => {
  for (const text of ['https://github.com/o/r/issues/1', 'http://www.github.com/o/r/pull/2', 'github.com/o/r/issues/3', 'GitHub.com/o/r', 'git@github.com:o/r.git', 'https://github.com']) {
    assert.equal(mentionsGitHubHost(text), true, text);
  }
  for (const text of ['https://evilgithub.com/o/r/issues/1', 'https://github.com.example.org/o/r', 'https://example.org/?u=xgithub.com', '--model', '', null, undefined]) {
    assert.equal(mentionsGitHubHost(text), false, String(text));
  }
});

test('MarkdownV2 escaping covers backslashes, and CI run links escape `)` and `\\`', () => {
  const processor = new MergeQueueProcessor({ owner: 'o', repo: 'r' });
  assert.equal(processor.escapeMarkdown('a\\b_c'), 'a\\\\b\\_c');

  processor.items = [];
  processor.stats = { total: 1, merged: 0, failed: 0, skipped: 0 };
  processor.status = MergeStatus.FAILED;
  processor.startedAt = new Date();
  processor.completedAt = new Date();
  processor.branchCIFailedRuns = [{ name: 'CI', html_url: 'https://github.com/o/r/actions/runs/1?q=(a)\\b' }];
  processor.postMergeCIFailedRuns = [{ name: 'CD', html_url: 'https://github.com/o/r/actions/runs/2' }];
  const message = processor.formatFinalMessage();
  assert.ok(message.includes('[View](https://github.com/o/r/actions/runs/1?q=(a\\)\\\\b)'), message);
  assert.ok(message.includes('[View](https://github.com/o/r/actions/runs/2)'), message);
});
