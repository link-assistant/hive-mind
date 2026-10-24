/**
 * ESLint rule: status probes in the bot process run without a login shell.
 *
 * Motivation (issue #3614): command-stream's `$` runs every command as
 * `/bin/sh -l -c '<command>'`, so each `docker inspect`, `pgrep`, `which`,
 * `screen -ls`, `tmux has-session` or `$ --status` the bot ran to poll a task
 * started a login shell (which reads /etc/profile and ~/.profile) on top of the
 * probe itself, dozens of times a minute. Probes take fixed arguments and need
 * no shell: run them with `execFile` (`runProbe` in src/status-probes.lib.mjs),
 * and share the result through `statusCheckCache`.
 *
 * Flags command-stream tagged templates (`$\`…\``, `$({ … })\`…\``, a local
 * bound to either, see require-exec-timeout.mjs) whose command is one of the
 * probe binaries below, or an interpolated binary (`$\`${binPath} --status\``).
 *
 * Exceptions: `// hive-shell-ok: <reason>` on the template's line or the
 * comment line right above it (e.g. a fallback that needs the login shell's
 * PATH), or a per-file `baseline` for calls that existed before the rule.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3614
 */

import { BASELINE_SCHEMA, createBaselineReporter, hasReasonedMarker } from './hive-rule-support.mjs';
import { commandOf, dollarTag } from './require-exec-timeout.mjs';

export const PROBE_COMMANDS = new Set(['docker', 'pgrep', 'pidof', 'ps', 'screen', 'tmux', 'which', 'command']);
const MARKER = 'hive-shell-ok';

/** The probe a template starts, `<interpolated>` for `${binary} …`, or null. */
function probeOf(quasi) {
  const first = quasi.quasis[0]?.value.cooked ?? '';
  if (first.trim() === '' && quasi.expressions.length > 0) return '<interpolated binary>';
  const command = commandOf(quasi);
  return command && PROBE_COMMANDS.has(command) ? command : null;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow command-stream login-shell wrappers around status probes in the Telegram bot process',
    },
    schema: [
      {
        type: 'object',
        properties: { baseline: BASELINE_SCHEMA },
        additionalProperties: false,
      },
    ],
    messages: {
      violation: "command-stream runs '{{command}}' as `/bin/sh -l -c …`: a login shell per probe. Run the binary directly (`runProbe` from status-probes.lib.mjs, i.e. execFile without a shell) and share the result through `statusCheckCache`, or add `// hive-shell-ok: <reason>`.",
      overBaseline: "command-stream runs '{{command}}' as `/bin/sh -l -c …`. This file may keep {{allowed}} such call(s) until they are converted; it has {{count}}. Run the binary directly (`runProbe`), or add `// hive-shell-ok: <reason>`.",
    },
  },

  create(context) {
    const { baseline = {} } = context.options[0] || {};
    const reporter = createBaselineReporter(context, baseline);
    return {
      TaggedTemplateExpression(node) {
        if (!dollarTag(node.tag, context.sourceCode)) return;
        const command = probeOf(node.quasi);
        if (!command || hasReasonedMarker(context.sourceCode, node, MARKER)) return;
        reporter.add({ node, data: { command } });
      },
      'Program:exit'() {
        reporter.flush();
      },
    };
  },
};
