#!/usr/bin/env node
/**
 * Runtime companion of the no-unescaped-telegram-markdown lint rule: every
 * formatter fixed in issue #3505 must produce text Telegram's legacy Markdown
 * parser accepts, whatever characters its dynamic values contain.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/3505
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { initI18n } from '../src/i18n.lib.mjs';
import { validateTelegramText } from '../src/telegram-markdown-validator.lib.mjs';
import { formatRecoveryLifecycle } from '../src/session-recovery-lifecycle.lib.mjs';
import { formatTokenList } from '../src/telegram-tokens-command.lib.mjs';
import { formatFixProgressMessage, addFixIssueToInfoBlock } from '../src/fix-progress.lib.mjs';
import { formatExecutingWorkSessionMessage, formatSessionCompletionMessage, formatStartingWorkSessionMessage } from '../src/work-session-formatting.lib.mjs';
import { validateTelegramGitHubUrl } from '../src/telegram-url-validation.lib.mjs';
import { buildSolveQueuedMessage, buildTelegramInfoBlock } from '../src/telegram-ui-messages.lib.mjs';
import { escapeMarkdown } from '../src/telegram-markdown.lib.mjs';
import { t } from '../src/i18n.lib.mjs';

await initI18n('en');

// Each one alone opens a legacy-Markdown entity that never closes.
const HOSTILE = ['in_progress', 'a*b', 'x`y', '[label', 'snake_case_name', 'https://github.com/o/my_repo/issues/1', 'one_two*three`four[five'];

const assertParses = (text, label) => {
  const result = validateTelegramText(text, 'Markdown');
  assert.equal(result.valid, true, `${label} must parse as Telegram Markdown:\n${text}\n${JSON.stringify(result)}`);
};

describe('formatters stay valid Telegram Markdown with hostile values (#3505)', () => {
  for (const value of HOSTILE) {
    it(`formatRecoveryLifecycle: ${value}`, () => {
      for (const phase of ['waiting', 'launching', 'running', 'completed', 'failed']) {
        const text = formatRecoveryLifecycle({ phase, attempt: 1, sessionName: value, previousSession: value, executionUuid: value, at: value, startedAt: value, lastOutputAt: value, reason: value, nextSession: value, exitCode: 1, delayMs: 1000 });
        assertParses(text, `recovery ${phase}`);
      }
    });

    it(`formatTokenList: ${value}`, () => {
      assertParses(formatTokenList([{ name: value, source: value, value: 'ghp_abcdefghijklmnop' }]), 'token list');
    });

    it(`/fix progress: ${value}`, () => {
      const infoBlock = addFixIssueToInfoBlock(buildTelegramInfoBlock({ requester: '@user', urlKind: 'url', url: escapeMarkdown(value) }), value);
      for (const phase of ['issue-created', 'waiting-for-ci', 'ci-finished', 'solving']) {
        const event = { phase, branch: value, issueUrl: value, pending: [{ name: value, status: 'in_progress' }], outcome: 'success' };
        assertParses(formatFixProgressMessage({ event, sessionName: 'uuid', sessionInfo: { infoBlock } }), `fix ${phase}`);
      }
    });

    it(`work session messages: ${value}`, () => {
      const infoBlock = buildTelegramInfoBlock({ requester: '@user', urlKind: 'issue', url: escapeMarkdown(value), optionsRaw: escapeMarkdown(value) });
      assertParses(formatStartingWorkSessionMessage({ sessionName: 'uuid', isolationBackend: 'docker', infoBlock }), 'starting');
      assertParses(formatExecutingWorkSessionMessage({ sessionName: 'uuid', infoBlock }), 'executing');
      assertParses(buildSolveQueuedMessage({ tool: 'claude', position: 2, infoBlock, reason: escapeMarkdown(value) }), 'queued');
    });

    it(`completion messages: ${value}`, () => {
      const infoBlock = addFixIssueToInfoBlock(buildTelegramInfoBlock({ requester: '@user', urlKind: 'url', url: escapeMarkdown(value) }), value);
      const sessionInfo = { command: 'fix', infoBlock, executionUuid: 'uuid', isolationBackend: 'docker', stopRequestedBy: value, previousExecutionUuids: ['uuid-2'] };
      for (const [exitCode, extra] of [
        [0, {}],
        [1, {}],
        [137, {}],
        [143, { stopRequestedByUser: true }],
      ]) {
        const text = formatSessionCompletionMessage({ sessionName: 'uuid', sessionInfo: { ...sessionInfo, ...extra }, exitCode, pullRequestUrl: value });
        assertParses(text, `completion ${exitCode}`);
      }
      // Alone, so no other escaped copy of the value can balance a stray `*`.
      const stopped = formatSessionCompletionMessage({ sessionName: 'uuid', sessionInfo: { stopRequestedByUser: true, stopRequestedBy: value }, exitCode: 143 });
      assertParses(stopped, 'stopped by user');
      assert.doesNotMatch(stopped.split('\n')[0], /by user by/);
    });

    it(`queue warning and error lines: ${value}`, () => {
      assertParses(`⚠️ ${escapeMarkdown(value)}\n\nRepository: ${escapeMarkdown(value)}`, 'warning');
    });
  }

  it('"Did you mean" suggestion with a backtick stays inside its code span', () => {
    const validation = validateTelegramGitHubUrl('https://github.com/own`er\\repo\\issues\\1', { allowedTypes: ['issue', 'pull'] });
    assert.equal(validation.valid, false);
    assert.ok(validation.suggestion.includes('%60'), validation.suggestion);
    assertParses(`❌ ${validation.error}\n\n${t('telegram.did_you_mean', { suggestion: validation.suggestion }, { locale: 'en' })}`, 'suggestion');
  });
});
