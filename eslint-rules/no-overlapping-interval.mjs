/**
 * ESLint rule: no `setInterval` in modules the Telegram bot process loads.
 *
 * Motivation (issue #3614): `setInterval(asyncTick, ms)` starts the next tick
 * every `ms` whether or not the previous one finished. When the tick waits on
 * Docker or start-command and the daemon is slow, the copies pile up and each
 * one starts its own processes. Poll with `startSerialPoller` from
 * src/serial-poller.lib.mjs (a self-rescheduling `setTimeout`), which starts
 * the next tick only after the current one settled.
 *
 * Flags every reference to the global `setInterval`: calls and default
 * parameters that inject it (`setIntervalImpl = setInterval`).
 *
 * Exceptions: `// hive-interval-ok: <reason>` on the reference's line or the
 * comment line right above it (a synchronous tick cannot overlap; an async one
 * guarded by an in-flight flag skips overdue ticks), or a per-file `baseline`
 * for uses that existed before the rule.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3614
 */

import { BASELINE_SCHEMA, createBaselineReporter, hasReasonedMarker } from './hive-rule-support.mjs';

const MARKER = 'hive-interval-ok';

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow setInterval (overlapping ticks) in modules loaded by the Telegram bot process',
    },
    schema: [
      {
        type: 'object',
        properties: { baseline: BASELINE_SCHEMA },
        additionalProperties: false,
      },
    ],
    messages: {
      violation: '`setInterval` starts a new tick even while the previous one is still running, so slow Docker/status checks pile up. Use `startSerialPoller` (serial-poller.lib.mjs), or add `// hive-interval-ok: <reason>`.',
      overBaseline: '`setInterval` starts a new tick even while the previous one is still running. This file may keep {{allowed}} such use(s) until they are converted; it has {{count}}. Use `startSerialPoller`, or add `// hive-interval-ok: <reason>`.',
    },
  },

  create(context) {
    const { baseline = {} } = context.options[0] || {};
    const sourceCode = context.sourceCode;
    const reporter = createBaselineReporter(context, baseline);
    return {
      'Program:exit'() {
        // The global `setInterval`: a configured global variable, or an
        // unresolved reference when the config does not declare it.
        const globalScope = sourceCode.scopeManager.globalScope;
        const references = [...(globalScope.set.get('setInterval')?.references || []), ...globalScope.through.filter(reference => reference.identifier.name === 'setInterval')];
        for (const { identifier } of references) {
          if (!hasReasonedMarker(sourceCode, identifier, MARKER)) reporter.add({ node: identifier, data: {} });
        }
        reporter.flush();
      },
    };
  },
};
