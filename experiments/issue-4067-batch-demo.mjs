#!/usr/bin/env node
/**
 * Issue #4067 demo: replay the screenshot reply (`/codex —think medium —auto-merge`
 * to a message with 25 links) through the batch planner and runner, without
 * Telegram or GitHub. Every reply the bot would send is printed with the time
 * since start; the 10–15 s pauses are scaled down 1000× (10–15 ms).
 *
 * Run: node experiments/issue-4067-batch-demo.mjs
 */

import { parseGitHubUrl } from '../src/github.lib.mjs';
import { initI18n } from '../src/i18n.lib.mjs';
import { mentionsGitHubHost } from '../src/telegram-message-filters.lib.mjs';
import { cleanNonPrintableChars } from '../src/telegram-markdown.lib.mjs';
import { parseCommandArgs } from '../src/telegram-solve-command.lib.mjs';
import { pickSolveBatchDelayMs, planSolveTargets, runSolveBatch, summarizeRejection } from '../src/telegram-solve-batch.lib.mjs';
import { validateTelegramGitHubUrl } from '../src/telegram-url-validation.lib.mjs';

await initI18n('en');

const replyText = `https://github.com/link-assistant/legal/issues/5
https://github.com/link-assistant/image-to-number/issues/4
https://github.com/link-assistant/trader-bot/issues/12
https://github.com/link-assistant/web-capture/issues/190
https://github.com/link-foundation/gh-download-gist/issues/3
https://github.com/link-foundation/gh-upload-image/issues/3
https://github.com/link-foundation/set-process-name/issues/3
https://github.com/link-foundation/lino-cache/issues/5
https://github.com/link-foundation/lino-objects-codec/issues/88
https://github.com/link-foundation/links-client/issues/26
https://github.com/link-foundation/links-queue/issues/55
https://github.com/link-foundation/linksql/issues/4
https://github.com/link-foundation/linksql/issues/5
https://github.com/link-foundation/meta-notation/issues/5
https://github.com/link-foundation/meta-ontology/issues/8
https://github.com/link-foundation/relative-meta-logic/issues/189
https://github.com/link-foundation/relative-meta-logic/issues/188
https://github.com/link-foundation/rust-web-box/issues/46
https://github.com/link-foundation/universal-translator/issues/2
https://github.com/link-foundation/use-m/issues/88
https://github.com/link-foundation/link-cli/issues/181
https://github.com/link-foundation/gh-uncommitted/issues/3
https://github.com/linksplatform/doublets-rs/issues/92
https://github.com/linksplatform/doublets-web/issues/34
https://github.com/linksplatform/doublets-web/pull/35
https://github.com/link-foundation/use-m/issues/88
https://github.com/linksplatform/doublets-web`;

const deps = { parseGitHubUrl, cleanNonPrintableChars, mentionsGitHubHost };
const userArgs = parseCommandArgs('/codex —think medium —auto-merge');
const plan = planSolveTargets({ userArgs, commandHasUrl: false, replyMessage: { message_id: 1, text: replyText }, deps });
console.log(`plan: ${plan.mode}, ${plan.urls.length} links, invalid: ${plan.invalidLinks.join(', ') || 'none'}, duplicates: ${plan.duplicates.join(', ') || 'none'}, options: ${plan.optionArgs.join(' ')}`);

// Pretend two links fail like the real single-link flow would fail them.
const alreadyRunning = 'https://github.com/link-foundation/linksql/issues/5';
const notFound = 'https://github.com/link-foundation/meta-ontology/issues/8';
const startedAt = Date.now();
const stamp = () => `+${String(Date.now() - startedAt).padStart(4)} ms`;

const result = await runSolveBatch({
  ...plan,
  launch: async ([url, ...options], reject) => {
    if (url === alreadyRunning) return reject('❌ This issue already has an active session: 1a2b3c4d');
    if (url === notFound) return reject('❌ Issue #8 not found in link-foundation/meta-ontology\n\nCheck the link');
    console.log(`${stamp()} reply: 🚀 Starting solve command (${url} ${options.join(' ')})`);
    return { started: true };
  },
  reply: async text => console.log(`${stamp()} reply:\n${text}`),
  validateLink: link => summarizeRejection(validateTelegramGitHubUrl(link).error),
  pickDelayMs: () => Math.round(pickSolveBatchDelayMs() / 1000),
  // The bot's default sleep does not hold the process open (its polling does); this script has no polling.
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
});
console.log(`started ${result.started.length}, not started ${result.notStarted.length}`);
