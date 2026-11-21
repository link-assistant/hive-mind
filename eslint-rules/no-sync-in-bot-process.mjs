/**
 * ESLint rule: no synchronous calls in modules the Telegram bot process loads.
 *
 * Motivation (issue #3206): the bot serves every chat from one event loop. A
 * `statSync` + `appendFileSync` per log line, or an `execFileSync('du')` over a
 * large workspace, stops polling, timers and every other handler while it runs.
 *
 * Detection is `n/no-sync` from eslint-plugin-n (every call of a `*Sync`
 * function). On top of it this rule adds what the bot needs:
 *
 * - An explicit, reasoned exception: `// hive-sync-ok: <reason>` on the same
 *   line as the call or on the comment line right above it. Use it for
 *   one-time startup work before polling starts and for `process.on('exit')`
 *   handlers, which must be synchronous.
 * - A per-file baseline (`baseline: { 'src/x.mjs': 3 }`) for code that is not
 *   converted yet. A file within its count passes; one more call fails, and
 *   then every unmarked call in that file is listed.
 *
 * Which files the rule applies to is decided by the ESLint config (the import
 * closure of src/telegram-bot.mjs), not by the rule.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3206
 */

import nPlugin from 'eslint-plugin-n';
import { BASELINE_SCHEMA, createBaselineReporter, hasReasonedMarker } from './hive-rule-support.mjs';

const nNoSync = nPlugin.rules['no-sync'];

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow synchronous calls in modules loaded by the Telegram bot process',
    },
    schema: [
      {
        type: 'object',
        properties: { baseline: BASELINE_SCHEMA },
        additionalProperties: false,
      },
    ],
    messages: {
      violation: "Synchronous call '{{name}}' blocks the bot's event loop (every chat waits). Use the async API, or mark one-time startup / exit-handler code with `// hive-sync-ok: <reason>`.",
      overBaseline: "Synchronous call '{{name}}' blocks the bot's event loop. This file may keep {{allowed}} unmarked sync call(s) until they are converted; it has {{count}}. Use the async API, or mark startup / exit-handler code with `// hive-sync-ok: <reason>`.",
    },
  },

  create(context) {
    const { baseline = {} } = context.options[0] || {};
    const sourceCode = context.sourceCode;
    const reporter = createBaselineReporter(context, baseline);
    // Run n/no-sync with its default options and collect what it reports.
    const nContext = Object.create(context, {
      options: { value: [] },
      report: {
        value: ({ node }) => {
          if (!node || hasReasonedMarker(sourceCode, node, 'hive-sync-ok')) return;
          reporter.add({ node, data: { name: node.name || sourceCode.getText(node) } });
        },
      },
    });
    const visitor = nNoSync.create(nContext);
    return {
      ...visitor,
      'Program:exit'(node) {
        if (typeof visitor['Program:exit'] === 'function') visitor['Program:exit'](node);
        reporter.flush();
      },
    };
  },
};
