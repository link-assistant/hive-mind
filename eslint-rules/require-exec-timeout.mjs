/**
 * ESLint rule: `docker`, `git` and `gh` child processes must have a timeout.
 *
 * Motivation (issue #3206): a hung `docker pull`, a stalled `git fetch` or a
 * `gh api` waiting on the network never ends on its own. Started from the bot,
 * a synchronous call freezes every chat; an asynchronous one leaks a process
 * and whatever awaits it waits forever.
 *
 * Flags `exec`, `execSync`, `execAsync`, `execFile`, `execFileSync`,
 * `execFileAsync`, `spawn` and `spawnSync` (plain or as `child_process.x`)
 * whose command is `docker`, `git` or `gh` — the first argument as a string
 * literal, a template literal starting with the command, or an array whose
 * first element is one — unless the options object has `timeout` or `signal`.
 *
 * Options passed as a variable or spread (`{ ...opts }`) are accepted; the
 * rule cannot see what they hold.
 *
 * Exceptions: `// hive-exec-timeout-ok: <reason>` on the call's line or the
 * comment line above it, or a per-file `baseline` count for calls that existed
 * before the rule (see hive-rule-support.mjs). The same marker on the
 * declaration of a local wrapper (`const exec = (cmd, opts) => execRaw(cmd,
 * { timeout, ...opts })`) covers every call of that wrapper.
 *
 * command-stream `$` (issue #3278): `$\`git …\`` and `$({ … })\`gh …\`` are
 * checked the same way. command-stream has no `timeout` option, so only
 * `signal` (e.g. `AbortSignal.timeout(ms)`) bounds the process; a `timeout`
 * key is reported as ignored. A marked `$` declaration (a wrapper that adds a
 * signal) covers its calls.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3206
 * @see https://github.com/link-assistant/hive-mind/issues/3278
 */

import { BASELINE_SCHEMA, createBaselineReporter, findVariable, hasReasonedMarker } from './hive-rule-support.mjs';

const EXEC_FUNCTIONS = new Set(['exec', 'execSync', 'execAsync', 'execFile', 'execFileSync', 'execFileAsync', 'spawn', 'spawnSync']);
const SLOW_COMMANDS = new Set(['docker', 'git', 'gh']);
const TIMEOUT_KEYS = new Set(['timeout', 'signal']);
const MARKER = 'hive-exec-timeout-ok';

function calleeName(callee) {
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier') return callee.property.name;
  return null;
}

function leadingWord(text) {
  const word = String(text).trim().split(/\s+/, 1)[0] || '';
  return word.replace(/^.*[\\/]/, '');
}

/** The command a call starts, when it can be read from the source. */
function commandOf(node) {
  if (!node) return null;
  if (node.type === 'Literal' && typeof node.value === 'string') return leadingWord(node.value);
  if (node.type === 'TemplateLiteral') return leadingWord(node.quasis[0]?.value.cooked ?? '');
  if (node.type === 'ArrayExpression') return commandOf(node.elements[0]);
  return null;
}

function propertyName(property) {
  if (property.type !== 'Property' || property.computed) return null;
  if (property.key.type === 'Identifier') return property.key.name;
  if (property.key.type === 'Literal') return String(property.key.value);
  return null;
}

const FUNCTION_TYPES = new Set(['ArrowFunctionExpression', 'FunctionExpression']);

/** The argument holding the options, or undefined when the call passes none. */
function optionsArgument(fn, args) {
  const literal = args.slice(1).find(arg => arg.type === 'ObjectExpression');
  if (literal) return literal;
  // exec(command, options, callback) / execFile(file, args, options, callback)
  const candidate = fn.startsWith('exec') && !fn.startsWith('execFile') ? args[1] : args[2];
  return candidate && !FUNCTION_TYPES.has(candidate.type) ? candidate : undefined;
}

/** true/false: whether a timeout is set; null: the options are a variable and cannot be checked. */
function hasTimeout(fn, args) {
  const options = optionsArgument(fn, args);
  if (!options) return false;
  if (options.type !== 'ObjectExpression') return null;
  if (options.properties.some(property => TIMEOUT_KEYS.has(propertyName(property)))) return true;
  return options.properties.some(property => property.type === 'SpreadElement') ? null : false;
}

/**
 * For a command-stream tag (`$` or `$({ … })`): the `$` identifier and the
 * options node (undefined when none are passed). null for any other tag.
 */
function dollarTag(tag) {
  if (tag.type === 'Identifier' && tag.name === '$') return { dollar: tag, options: undefined };
  if (tag.type === 'CallExpression' && tag.callee.type === 'Identifier' && tag.callee.name === '$') return { dollar: tag.callee, options: tag.arguments[0] };
  return null;
}

/** 'signal', 'timeout' (ignored by command-stream), 'none', or null when the options cannot be read. */
function dollarBound(options) {
  if (!options) return 'none';
  if (options.type !== 'ObjectExpression') return null;
  const names = options.properties.map(propertyName);
  if (names.includes('signal')) return 'signal';
  if (options.properties.some(property => property.type === 'SpreadElement')) return null;
  return names.includes('timeout') ? 'timeout' : 'none';
}

/** True when the called function is a local wrapper declared with the marker. */
function isMarkedWrapper(sourceCode, callee) {
  if (callee.type !== 'Identifier') return false;
  const definition = findVariable(sourceCode, callee)?.defs[0];
  return Boolean(definition && hasReasonedMarker(sourceCode, definition.node, MARKER));
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require a timeout on docker/git/gh child processes',
    },
    schema: [
      {
        type: 'object',
        properties: { baseline: BASELINE_SCHEMA },
        additionalProperties: false,
      },
    ],
    messages: {
      violation: "'{{fn}}' starts '{{command}}' without a `timeout` (or `signal`); a hung {{command}} process never ends. Pass `{ timeout: <ms> }` (for `$`: `$({ signal: AbortSignal.timeout(<ms>) })`, since command-stream ignores `timeout`), or add `// hive-exec-timeout-ok: <reason>`.",
      overBaseline: "'{{fn}}' starts '{{command}}' without a `timeout` (or `signal`). This file may keep {{allowed}} such call(s) until they get one; it has {{count}}. Pass `{ timeout: <ms> }` (for `$`: `$({ signal: AbortSignal.timeout(<ms>) })`, since command-stream ignores `timeout`), or add `// hive-exec-timeout-ok: <reason>`.",
      dollarTimeoutOption: "command-stream ignores `timeout`: this '{{command}}' is still unbounded. Pass `$({ signal: AbortSignal.timeout(<ms>) })`, or add `// hive-exec-timeout-ok: <reason>`.",
    },
  },

  create(context) {
    const { baseline = {} } = context.options[0] || {};
    const reporter = createBaselineReporter(context, baseline);
    return {
      CallExpression(node) {
        const fn = calleeName(node.callee);
        if (!fn || !EXEC_FUNCTIONS.has(fn) || node.arguments.length === 0) return;
        const command = commandOf(node.arguments[0]);
        if (!command || !SLOW_COMMANDS.has(command)) return;
        if (hasTimeout(fn, node.arguments) !== false) return;
        if (hasReasonedMarker(context.sourceCode, node, MARKER) || isMarkedWrapper(context.sourceCode, node.callee)) return;
        reporter.add({ node, data: { fn, command } });
      },
      TaggedTemplateExpression(node) {
        const tag = dollarTag(node.tag);
        if (!tag) return;
        const command = commandOf(node.quasi);
        if (!command || !SLOW_COMMANDS.has(command)) return;
        const bound = dollarBound(tag.options);
        if (bound === 'signal' || bound === null) return;
        if (hasReasonedMarker(context.sourceCode, node, MARKER) || isMarkedWrapper(context.sourceCode, tag.dollar)) return;
        // A `timeout` key is a mistake, not a pre-existing call: never baselined.
        if (bound === 'timeout') context.report({ node, messageId: 'dollarTimeoutOption', data: { command } });
        else reporter.add({ node, data: { fn: '$', command } });
      },
      'Program:exit'() {
        reporter.flush();
      },
    };
  },
};
