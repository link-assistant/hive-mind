/**
 * ESLint rule: a Telegram update handler must not `await` known-slow work.
 *
 * Motivation (issue #3206): Telegraf polls in batches and waits for every
 * handler of a batch before fetching the next one. A handler that awaits a
 * `docker pull`, a sidecar health wait or a GitHub preflight holds up every
 * other chat until it finishes. Slow work belongs in `detachHandler(...)` or
 * `runInBackground(...)`, which return to Telegraf at once.
 *
 * A handler is any function passed to `<bot>.command/on/hears/action/use/
 * start/help/settings/...` where `<bot>` is an identifier named `bot`,
 * `telegraf` or ending in `Bot`, or `this.bot`. Handlers passed by name are
 * resolved to their declaration through scope analysis (a function
 * declaration, or a variable initialised with a function); a handler built by
 * a call such as `detachHandler(fn)` is the wrapper's responsibility and is not
 * inspected.
 *
 * Inside a handler, `await <slow call>` is reported, where the slow call is one
 * of the known-slow functions below, a name ending in `Maintenance`, `Updater`
 * or `Refresh`, or a `docker` child process (`exec*`/`spawn*` with a `docker`
 * command, or a `$\`docker …\`` template). Nested functions are not entered:
 * work handed to `runInBackground(async () => …)` or a timer is not awaited by
 * the handler. Only direct awaits are seen; a helper that awaits slow work
 * internally is not followed.
 *
 * Exception: `// hive-handler-slow-ok: <reason>` on the await's line or the
 * comment line above it. Extra names can be added with the `slowCalls` option.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3206
 */

import { findVariable, hasReasonedMarker } from './hive-rule-support.mjs';

export const DEFAULT_SLOW_CALLS = Object.freeze(['ensureFormalAiSidecarImage', 'startFormalAiSidecar', 'reconcileFormalAiSidecar', 'withFormalAiSidecarLock', 'waitForFormalAiSidecarHealth', 'refreshTaskImage', 'preflightDockerIsolation', 'validateGitHubEntityExistence', 'executeAndUpdateMessage', 'autoAcceptInviteForRepo', 'preflightRepositoryTarget', 'sleep', 'interruptibleSleep']);

const SLOW_NAME_PATTERN = /(?:Maintenance|Updater|Refresh)$/;
const REGISTRATION_METHODS = new Set(['command', 'on', 'hears', 'action', 'use', 'start', 'help', 'settings', 'inlineQuery', 'gameQuery', 'mention', 'hashtag', 'cashtag', 'entity']);
const BOT_NAME_PATTERN = /^(?:bot|telegraf)$|Bot$/;
const EXEC_FUNCTIONS = new Set(['exec', 'execSync', 'execAsync', 'execFile', 'execFileSync', 'execFileAsync', 'spawn', 'spawnSync']);
const FUNCTION_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

function memberName(node) {
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier') return node.property.name;
  return null;
}

function isBotObject(node) {
  if (node.type === 'Identifier') return BOT_NAME_PATTERN.test(node.name);
  return node.type === 'MemberExpression' && node.object.type === 'ThisExpression' && memberName(node) === 'bot';
}

function startsWithDocker(node) {
  if (!node) return false;
  if (node.type === 'Literal') return typeof node.value === 'string' && /^\s*docker(?:\s|$)/.test(node.value);
  if (node.type === 'TemplateLiteral') return /^\s*docker(?:\s|$)/.test(node.quasis[0]?.value.cooked ?? '');
  if (node.type === 'ArrayExpression') return startsWithDocker(node.elements[0]);
  return false;
}

/** The name to show for a slow awaited expression, or null when it is not slow. */
function slowCallName(node, slowCalls) {
  if (node.type === 'TaggedTemplateExpression') {
    return startsWithDocker(node.quasi) ? 'docker' : null;
  }
  if (node.type !== 'CallExpression') return null;
  const name = memberName(node.callee);
  if (!name) return null;
  if (slowCalls.has(name) || SLOW_NAME_PATTERN.test(name)) return name;
  if (EXEC_FUNCTIONS.has(name) && startsWithDocker(node.arguments[0])) return `${name}('docker …')`;
  return null;
}

/** Resolve a handler argument to the function that runs, or null when it cannot be seen. */
function resolveHandler(sourceCode, node) {
  if (FUNCTION_TYPES.has(node.type)) return node;
  if (node.type !== 'Identifier') return null;
  const variable = findVariable(sourceCode, node);
  const definition = variable?.defs.length === 1 ? variable.defs[0] : null;
  if (!definition) return null;
  if (definition.type === 'FunctionName') return definition.node;
  if (definition.type === 'Variable' && definition.node.init && FUNCTION_TYPES.has(definition.node.init.type)) return definition.node.init;
  return null;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow awaiting known-slow work directly inside a Telegram update handler',
    },
    schema: [
      {
        type: 'object',
        properties: {
          slowCalls: { type: 'array', items: { type: 'string' }, uniqueItems: true },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      slowAwait: "Telegram handler awaits '{{name}}', which can take minutes; every chat waits for it. Run it with detachHandler(...) or runInBackground(...), or add `// hive-handler-slow-ok: <reason>`.",
    },
  },

  create(context) {
    const { slowCalls = [] } = context.options[0] || {};
    const slow = new Set([...DEFAULT_SLOW_CALLS, ...slowCalls]);
    const sourceCode = context.sourceCode;
    const checked = new Set();

    function visit(node) {
      if (node.type === 'AwaitExpression') {
        const name = slowCallName(node.argument, slow);
        if (name && !hasReasonedMarker(sourceCode, node, 'hive-handler-slow-ok')) {
          context.report({ node, messageId: 'slowAwait', data: { name } });
        }
      }
      for (const key of sourceCode.visitorKeys[node.type] || []) {
        const child = node[key];
        for (const item of Array.isArray(child) ? child : [child]) {
          if (item && typeof item.type === 'string' && !FUNCTION_TYPES.has(item.type)) visit(item);
        }
      }
    }

    function checkHandler(fn) {
      if (checked.has(fn)) return;
      checked.add(fn);
      visit(fn.body);
    }

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression' || !REGISTRATION_METHODS.has(memberName(callee)) || !isBotObject(callee.object)) return;
        for (const argument of node.arguments) {
          const fn = resolveHandler(sourceCode, argument);
          if (fn) checkHandler(fn);
        }
      },
    };
  },
};
