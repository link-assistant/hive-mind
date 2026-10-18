/**
 * ESLint rule: dynamic text interpolated into a legacy-Markdown Telegram
 * message must be escaped (issue #3505).
 *
 * Background — the failure this rule prevents:
 *
 *   Legacy Markdown has four entity openers: `_`, `*`, `` ` `` and `[`. A raw
 *   value such as a workflow status (`in_progress`), a branch, a URL or an error
 *   message that contains one of them opens an entity that never closes, and
 *   Telegram rejects the whole message ("can't parse entities"). The safe send
 *   funnel then shows the message as plain text behind a "Formatting error
 *   detected" warning (issue #3505: `Waiting for CI/CD … Checks and release
 *   (in_progress)`), or the message is lost entirely (issues #580, #2166).
 *
 * What is checked:
 *   The text argument of `safeReply(ctx, text)`, `safeSendMessage(tg, chat,
 *   text)` and `safeEditMessageText(tg, chat, msg, inline, text)` — unless the
 *   options literal selects another `parse_mode` — and the return values of
 *   functions whose JSDoc carries `@telegram-markdown`. The text is followed
 *   through local variables (`=`, `+=`), same-file helper functions and the
 *   parameters of same-file wrappers (`const edit = text => safeEdit…(text)`).
 *
 *   Inside a template literal, an interpolation placed at the top level of the
 *   message must be provably safe:
 *     - a literal, a number, arithmetic, `.length`;
 *     - a call to an escaper/formatter: `escapeMarkdown()`, `codeSpan()`,
 *       `format*()`, `build*()`, `t()`/`text()` (whose `{{vars}}` are checked
 *       the same way), …;
 *     - a value whose name says it is already Markdown (`…Message`, `…Block`,
 *       `…Line`, `…Text`, `…Mention`, `escaped…`, …) or a number (`…Count`, …);
 *     - a nested template, conditional or `+` whose parts are all safe.
 *   Interpolations inside a code span (`` `${x}` ``) or a link URL
 *   (`[label](${url})`) are verbatim and therefore not reported.
 *
 * How to satisfy the rule:
 *   - wrap the value: `${escapeMarkdown(value)}`, or `${codeSpan(value)}`;
 *   - or mark a known-safe line: `// telegram-markdown-ok: <reason>`.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3505
 * @see https://core.telegram.org/bots/api#markdown-style
 */

import { BASELINE_SCHEMA, createBaselineReporter, findVariable, hasReasonedMarker } from './hive-rule-support.mjs';

const MARKER = 'telegram-markdown-ok';
const ANNOTATION = /@telegram-markdown\b/;

// Index of the text argument of each safe-send funnel function.
const SINK_TEXT_ARGUMENT = new Map([
  ['safeReply', 1],
  ['safeSendMessage', 2],
  ['safeEditMessageText', 4],
]);
const SINK_OPTIONS_OFFSET = 1;

// Calls that return Markdown-ready (escaped or formatted) text.
const SAFE_CALL = /^(escape\w*|codeSpan|inlineCode|format\w*|build\w*|render\w*|create\w*(Message|Text|Link|Mention|Block|Line)s?|get\w*(Message|Link|Mention|Block|Line|Usage|Help|Label|Title|Hint|Header)s?|\w*(Markdown|Mention|Link|Message|Messages|Block|Line|Lines|Hint)|t|text|lt|translate|Number|parseInt|parseFloat|toFixed|toPrecision|toLocaleString|toLocaleDateString|toLocaleTimeString|toISOString|toUTCString|round|floor|ceil|max|min|abs)$/;
// Translation helpers: their interpolation variables land in the message.
const TRANSLATION_CALL = /^(t|text|lt|translate)$/;
// String methods that keep (part of) the receiver's text.
const PASSTHROUGH_METHODS = new Set(['String', 'padStart', 'padEnd', 'repeat', 'trim', 'trimStart', 'trimEnd', 'slice', 'substring', 'substr', 'toUpperCase', 'toLowerCase', 'concat', 'at', 'replace', 'replaceAll', 'join', 'split', 'filter', 'flat']);
// Names that already hold Markdown text, or a number.
const FORMATTED_NAME = /(^|_)(escaped|formatted|safe|md|markdown)|(Message|Messages|Msg|Text|Texts|Block|Blocks|Line|Lines|Section|Sections|Markdown|Md|Mention|Mentions|Header|Footer|Hint|Hints|Suffix|Prefix|Note|Notice|Report|Summary|Details|Body|Display|Emoji|Icon|Link|Links|Label|Indicator|Bar|Sep|Separator|Escaped|Formatted|Safe)$|^(message|messages|msg|text|block|line|lines|section|header|footer|hint|suffix|prefix|note|report|summary|details|body|display|emoji|icon|link|links|label|indicator|bar|separator|nl|newline|indent|mention|response|reply|caption|content|output)$/;
const NUMBER_NAME = /(^|[a-z])(count|Count|total|Total|num|Num|number|Number|ms|Ms|seconds|Seconds|secs|Secs|minutes|Minutes|mins|Mins|hours|Hours|days|Days|percent|Percent|pct|Pct|size|Size|length|Length|index|Index|idx|Idx|pid|Pid|port|Port|limit|Limit|attempt|Attempt|attempts|Attempts|position|Position|pos|Pos|exitCode|ExitCode|code|Code|width|Width|height|Height|bytes|Bytes|depth|Depth|level|Level|page|Page|elapsed|Elapsed|duration|Duration|remaining|Remaining|tokens|Tokens|cost|Cost|usd|Usd|uptime|Uptime|delay|Delay|timeout|Timeout|max|Max|min|Min)$|^(i|j|k|n|x|y)$/;
const NUMBER_PROPERTIES = new Set(['length', 'size', 'count', 'total', 'pid', 'port', 'exitCode', 'status_code', 'statusCode', 'number', 'id', 'update_id', 'message_id', 'message_thread_id', 'chat_id', 'user_id', 'messageId', 'chatId', 'userId', 'updateId', 'threadId', 'topicId', 'issueNumber', 'prNumber']);

// `error.message`, `err.stderr`, …: raw text of an error, however it is named.
const ERROR_OBJECT = /^(e|err|error|ex|exception|cause|failure|result|res|response)$|Error$/;
const ERROR_TEXT_PROPERTIES = new Set(['message', 'stderr', 'stdout', 'output', 'stack', 'details', 'body', 'text']);

// In Telegram-only modules (`telegram-*.mjs`), exported functions with a
// formatter name produce message text and are checked without an annotation.
const TELEGRAM_MODULE = /(^|[\\/])telegram-[^\\/]*$/;
const FORMATTER_NAME = /^(format|build|render|create|get|compose|describe)\w*(Message|Messages|Text|Status|Block|Line|Lines|Header|Notice|Report|Hint|Usage|Help|Reply|Response|Error|Summary)$/;

const MAX_DEPTH = 24;

const calleeName = callee => {
  if (!callee) return null;
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier') return callee.property.name;
  return null;
};

const propertyName = node => {
  if (!node) return null;
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'Literal') return String(node.value);
  return null;
};

const valueName = node => {
  if (!node) return null;
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression' && !node.computed) return propertyName(node.property);
  if (node.type === 'ChainExpression') return valueName(node.expression);
  return null;
};

/**
 * Where the text right after `prefix` lands in legacy Markdown: at the top
 * level (`'top'`), inside a code span / pre block (`'code'`) or inside a link
 * URL (`'url'`). Backslash escapes are honoured at the top level only.
 *
 * @param {string} prefix - Message text up to the interpolation.
 * @returns {'top'|'code'|'url'|'entity'}
 */
export function markdownContextAt(prefix) {
  let state = 'top';
  for (let i = 0; i < prefix.length; i++) {
    const c = prefix[i];
    if (state === 'top') {
      if (c === '\\' && i + 1 < prefix.length && '_*`['.includes(prefix[i + 1])) {
        i++;
      } else if (prefix.startsWith('```', i)) {
        state = 'pre';
        i += 2;
      } else if (c === '`') {
        state = 'code';
      } else if (c === '_' || c === '*') {
        state = c;
      } else if (c === '[') {
        state = 'label';
      }
    } else if (state === 'pre') {
      if (prefix.startsWith('```', i)) {
        state = 'top';
        i += 2;
      }
    } else if (state === 'code') {
      if (c === '`') state = 'top';
    } else if (state === '_' || state === '*') {
      if (c === state) state = 'top';
    } else if (state === 'label') {
      if (c === ']') state = prefix[i + 1] === '(' ? 'url' : 'top';
      if (state === 'url') i++;
    } else if (state === 'url') {
      if (c === ')') state = 'top';
    }
  }
  if (state === 'pre') return 'code';
  if (state === 'code' || state === 'url') return state;
  return state === 'top' ? 'top' : 'entity';
}

const quasiText = quasi => quasi.value.cooked ?? quasi.value.raw;

const isStringLiteral = node => node.type === 'TemplateLiteral' || (node.type === 'Literal' && typeof node.value === 'string');

// The operands of `a + b + c`, left to right.
const concatenated = node => (node.type === 'BinaryExpression' && node.operator === '+' ? [...concatenated(node.left), ...concatenated(node.right)] : [node]);

export const _testing = { markdownContextAt, SAFE_CALL, FORMATTED_NAME, NUMBER_NAME };

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require dynamic text in legacy-Markdown Telegram messages to be escaped. See issue #3505.',
      category: 'Possible Errors',
      recommended: true,
    },
    messages: {
      violation: '`{{expression}}` is interpolated unescaped into a Telegram Markdown message: a `_`, `*`, `` ` `` or `[` in it breaks the whole message ("can\'t parse entities", issue #3505). Wrap it in escapeMarkdown()/codeSpan(), or mark the line `// telegram-markdown-ok: <reason>`.',
      overBaseline: '`{{expression}}` is interpolated unescaped into a Telegram Markdown message. This file is allowed {{allowed}} such interpolation(s) by the baseline but has {{count}} (issue #3505).',
    },
    schema: [
      {
        type: 'object',
        properties: { baseline: BASELINE_SCHEMA },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const { baseline = {} } = context.options[0] || {};
    const reporter = createBaselineReporter(context, baseline);
    const sourceCode = context.sourceCode;
    const functions = new Map(); // name -> function node (same-file declarations)
    const calls = []; // every CallExpression, for wrapper propagation
    const annotated = [];
    const reported = new Set();

    const report = node => {
      if (reported.has(node)) return;
      reported.add(node);
      if (hasReasonedMarker(sourceCode, node, MARKER)) return;
      reporter.add({ node, data: { expression: sourceCode.getText(node).slice(0, 80) } });
    };

    const functionFor = identifier => {
      if (!identifier || identifier.type !== 'Identifier') return null;
      return functions.get(identifier.name) || null;
    };

    // Expressions a function hands back to its caller.
    const returnedExpressions = fn => {
      if (fn.body.type !== 'BlockStatement') return [fn.body];
      const found = [];
      const visit = node => {
        if (!node || typeof node.type !== 'string') return;
        if (node.type === 'ReturnStatement') {
          if (node.argument) found.push(node.argument);
          return;
        }
        if (/Function/.test(node.type)) return;
        for (const key of Object.keys(node)) {
          if (key === 'parent') continue;
          const child = node[key];
          if (Array.isArray(child)) child.forEach(visit);
          else if (child && typeof child.type === 'string') visit(child);
        }
      };
      visit(fn.body);
      return found;
    };

    const functionName = fn => fn.id?.name || (fn.parent?.type === 'VariableDeclarator' && fn.parent.id.type === 'Identifier' ? fn.parent.id.name : null);
    const isExported = fn => fn.parent?.type === 'ExportNamedDeclaration' || (fn.parent?.type === 'VariableDeclarator' && fn.parent.parent?.parent?.type === 'ExportNamedDeclaration');

    /**
     * The values a same-file, non-exported function receives for a parameter
     * (`function f(x)` or `function f({ x })`), or null when a caller is unknown.
     */
    const argumentsFor = variable => {
      const definition = variable.defs.find(def => def.type === 'Parameter');
      const fn = definition?.node;
      const name = fn && functionName(fn);
      if (!name || isExported(fn) || functions.get(name) !== fn) return null;
      let position = -1;
      let key = null;
      fn.params.forEach((param, index) => {
        const pattern = param.type === 'AssignmentPattern' ? param.left : param;
        if (pattern.type === 'Identifier' && pattern.name === variable.name) position = index;
        if (pattern.type !== 'ObjectPattern') return;
        for (const property of pattern.properties) {
          const value = property.type === 'Property' && (property.value.type === 'AssignmentPattern' ? property.value.left : property.value);
          if (value?.type === 'Identifier' && value.name === variable.name) {
            position = index;
            key = propertyName(property.key);
          }
        }
      });
      if (position < 0) return null;
      const passed = [];
      for (const call of calls) {
        if (call.callee.type !== 'Identifier' || call.callee.name !== name) continue;
        const argument = call.arguments[position];
        if (!argument) continue;
        if (key === null) {
          passed.push(argument);
          continue;
        }
        if (argument.type !== 'ObjectExpression') return null;
        const property = argument.properties.find(prop => prop.type === 'Property' && propertyName(prop.key) === key);
        if (property) passed.push(property.value);
        else if (argument.properties.some(prop => prop.type === 'SpreadElement')) return null;
      }
      return passed.length ? passed : null;
    };

    // Every value written to a local variable (initialiser, `=`, `+=`).
    const writesOf = variable => {
      const writes = [];
      for (const definition of variable.defs) {
        if (definition.type === 'Variable' && definition.node.init && definition.node.id.type === 'Identifier') writes.push(definition.node.init);
      }
      for (const reference of variable.references) {
        const parent = reference.identifier.parent;
        if (parent?.type === 'AssignmentExpression' && parent.left === reference.identifier) writes.push(parent.right);
      }
      return writes;
    };

    /**
     * Report every unsafe top-level interpolation reachable from `node`.
     * `top` says whether `node`'s own text lands at the top level.
     */
    const check = (node, top, depth, seen) => {
      if (!node || depth > MAX_DEPTH) return;
      switch (node.type) {
        case 'TemplateLiteral': {
          let prefix = '';
          node.expressions.forEach((expression, index) => {
            prefix += quasiText(node.quasis[index]);
            const where = top ? markdownContextAt(prefix) : 'code';
            if (where === 'top') checkValue(expression, depth, seen);
            prefix += 'x';
          });
          return;
        }
        case 'ConditionalExpression':
          check(node.consequent, top, depth, seen);
          check(node.alternate, top, depth, seen);
          return;
        case 'LogicalExpression':
          check(node.left, top, depth, seen);
          check(node.right, top, depth, seen);
          return;
        case 'BinaryExpression': {
          if (node.operator !== '+') return;
          const operands = concatenated(node);
          // `'❌ ' + reason`: next to string literals, the other parts are
          // interpolations, placed where the literal text before them ends.
          if (!operands.some(isStringLiteral)) {
            operands.forEach(operand => check(operand, top, depth, seen));
            return;
          }
          let prefix = '';
          for (const operand of operands) {
            if (isStringLiteral(operand)) {
              if (operand.type === 'TemplateLiteral') check(operand, top && markdownContextAt(prefix) === 'top', depth, seen);
              prefix += operand.type === 'Literal' ? operand.value : operand.quasis.map(quasiText).join('x');
              continue;
            }
            if (top && markdownContextAt(prefix) === 'top') checkValue(operand, depth, seen);
            prefix += 'x';
          }
          return;
        }
        case 'AwaitExpression':
        case 'ChainExpression':
          check(node.argument || node.expression, top, depth, seen);
          return;
        case 'ArrayExpression':
          node.elements.forEach(element => element && check(element.type === 'SpreadElement' ? element.argument : element, top, depth, seen));
          return;
        case 'Identifier': {
          const variable = findVariable(sourceCode, node);
          if (!variable || seen.has(variable)) return;
          seen.add(variable);
          for (const write of writesOf(variable)) check(write, top, depth + 1, seen);
          for (const reference of variable.references) {
            // arr.push(`…`) on a local array that is joined into the message.
            const member = reference.identifier.parent;
            const call = member?.parent;
            if (member?.type === 'MemberExpression' && member.object === reference.identifier && call?.type === 'CallExpression' && call.callee === member && ['push', 'unshift'].includes(propertyName(member.property))) {
              call.arguments.forEach(argument => check(argument, top, depth + 1, seen));
            }
          }
          return;
        }
        case 'CallExpression': {
          const fn = functionFor(node.callee);
          if (fn && !seen.has(fn)) {
            seen.add(fn);
            for (const returned of returnedExpressions(fn)) check(returned, top, depth + 1, seen);
            return;
          }
          const name = calleeName(node.callee);
          if (name && TRANSLATION_CALL.test(name)) {
            // The first object argument holds the `{{vars}}`; a later one is options.
            const vars = node.arguments.find(argument => argument.type === 'ObjectExpression');
            for (const property of vars?.properties || []) {
              if (property.type === 'Property' && propertyName(property.key) !== 'locale') checkValue(property.value, depth, seen);
            }
            return;
          }
          if (node.callee.type === 'MemberExpression' && ['join', 'map', 'concat', 'filter', 'flat', 'flatMap'].includes(name)) {
            check(node.callee.object, top, depth + 1, seen);
            if (name === 'map' || name === 'flatMap') {
              const callback = node.arguments[0];
              if (callback && /Function/.test(callback.type)) for (const returned of returnedExpressions(callback)) check(returned, top, depth + 1, seen);
            }
            return;
          }
          if (top) followFormatterInputs(node, depth, seen);
          return;
        }
        default:
      }
    };

    /**
     * A formatter from another module embeds its Markdown-named inputs
     * (`{ header, infoBlock, lines }`) as they are, so they are followed like
     * the message itself (issue #3505: the CI status reached the message as
     * `formatExecutingWorkSessionMessage({ header: status })`).
     */
    const followFormatterInputs = (call, depth, seen) => {
      for (const argument of call.arguments) {
        if (argument.type !== 'ObjectExpression') continue;
        for (const property of argument.properties) {
          const key = property.type === 'Property' ? propertyName(property.key) : null;
          if (key && key !== 'locale' && FORMATTED_NAME.test(key)) check(property.value, true, depth + 1, seen);
        }
      }
    };

    /** An interpolated value placed at the top level: must be provably safe. */
    const checkValue = (node, depth, seen) => {
      if (!node) return;
      switch (node.type) {
        case 'Literal':
        case 'UnaryExpression':
        case 'UpdateExpression':
          return;
        case 'TemplateLiteral':
          check(node, true, depth + 1, seen);
          return;
        case 'ConditionalExpression':
          checkValue(node.consequent, depth, seen);
          checkValue(node.alternate, depth, seen);
          return;
        case 'LogicalExpression':
          checkValue(node.left, depth, seen);
          checkValue(node.right, depth, seen);
          return;
        case 'ArrayExpression':
          node.elements.forEach(element => element && checkValue(element.type === 'SpreadElement' ? element.argument : element, depth, seen));
          return;
        case 'BinaryExpression':
          if (node.operator === '+') {
            checkValue(node.left, depth, seen);
            checkValue(node.right, depth, seen);
          }
          return;
        case 'AwaitExpression':
          checkValue(node.argument, depth, seen);
          return;
        case 'ChainExpression':
          checkValue(node.expression, depth, seen);
          return;
        case 'CallExpression': {
          const fn = functionFor(node.callee);
          if (fn) {
            check(node, true, depth + 1, seen);
            return;
          }
          const name = calleeName(node.callee);
          if (name && TRANSLATION_CALL.test(name)) {
            check(node, true, depth + 1, seen);
            return;
          }
          if (name && SAFE_CALL.test(name)) {
            followFormatterInputs(node, depth, seen);
            return;
          }
          // Text cleaners keep their input's Markdown characters.
          if (node.callee.type === 'Identifier' && (name === 'String' || /^(sanitize|strip|clean|redact|mask|truncate)/.test(name))) {
            node.arguments.forEach(argument => checkValue(argument, depth, seen));
            return;
          }
          if (node.callee.type === 'MemberExpression' && PASSTHROUGH_METHODS.has(name)) {
            if (name === 'join' || name === 'filter' || name === 'flat' || name === 'concat') check(node, true, depth + 1, seen);
            else checkValue(node.callee.object, depth, seen);
            return;
          }
          report(node);
          return;
        }
        case 'Identifier': {
          if (NUMBER_NAME.test(node.name) || FORMATTED_NAME.test(node.name)) {
            check(node, true, depth + 1, seen);
            return;
          }
          const variable = findVariable(sourceCode, node);
          const writes = variable ? writesOf(variable) : [];
          const isParameter = variable?.defs.some(definition => definition.type === 'Parameter');
          const isImport = variable?.defs.some(definition => definition.type === 'ImportBinding');
          if (isImport) return;
          if (writes.length && !isParameter) {
            if (seen.has(variable)) return;
            seen.add(variable);
            for (const write of writes) checkValue(write, depth + 1, seen);
            return;
          }
          const passed = isParameter ? argumentsFor(variable) : null;
          if (passed) {
            if (seen.has(variable)) return;
            seen.add(variable);
            for (const argument of passed) checkValue(argument, depth + 1, seen);
            return;
          }
          report(node);
          return;
        }
        case 'MemberExpression': {
          const name = valueName(node);
          // `error.message`: raw text, whatever the property is called.
          if (ERROR_TEXT_PROPERTIES.has(name) && ERROR_OBJECT.test(valueName(node.object) || '')) {
            report(node);
            return;
          }
          if (name && (NUMBER_PROPERTIES.has(name) || NUMBER_NAME.test(name) || FORMATTED_NAME.test(name))) return;
          // `titles[phase]` on a local object or array literal: one of its values.
          const table = node.object.type === 'Identifier' ? findVariable(sourceCode, node.object) : null;
          const init = table && !table.defs.some(definition => definition.type === 'Parameter') && writesOf(table).length === 1 ? writesOf(table)[0] : null;
          if (init?.type === 'ObjectExpression' && init.properties.every(property => property.type === 'Property')) {
            init.properties.forEach(property => checkValue(property.value, depth, seen));
            return;
          }
          if (init?.type === 'ArrayExpression') {
            checkValue(init, depth, seen);
            return;
          }
          report(node);
          return;
        }
        default:
          report(node);
      }
    };

    const nonMarkdownOptions = options => {
      if (!options || options.type !== 'ObjectExpression') return false;
      for (const property of options.properties) {
        if (property.type !== 'Property' || propertyName(property.key) !== 'parse_mode') continue;
        const value = property.value;
        return !(value.type === 'Literal' && value.value === 'Markdown');
      }
      return false;
    };

    // Sinks: [expression, origin]. Wrappers whose parameter reaches a sink
    // turn their own call sites into sinks.
    const collectSinks = () => {
      const sinks = [];
      const pending = [];
      for (const call of calls) {
        const name = call.callee.type === 'Identifier' ? call.callee.name : null;
        if (!name || !SINK_TEXT_ARGUMENT.has(name)) continue;
        const index = SINK_TEXT_ARGUMENT.get(name);
        if (nonMarkdownOptions(call.arguments[index + SINK_OPTIONS_OFFSET])) continue;
        if (call.arguments[index]) pending.push(call.arguments[index]);
      }
      const wrapped = new Set();
      while (pending.length) {
        const expression = pending.pop();
        sinks.push(expression);
        if (expression.type !== 'Identifier') continue;
        const variable = findVariable(sourceCode, expression);
        const parameter = variable?.defs.find(definition => definition.type === 'Parameter');
        if (!parameter) continue;
        const fn = parameter.node;
        const position = fn.params.findIndex(param => param.type === 'Identifier' && param.name === expression.name);
        const fnName = functionName(fn);
        if (position < 0 || !fnName || wrapped.has(fnName)) continue;
        wrapped.add(fnName);
        for (const call of calls) {
          if (call.callee.type === 'Identifier' && call.callee.name === fnName && call.arguments[position]) pending.push(call.arguments[position]);
        }
      }
      return sinks;
    };

    const telegramModule = TELEGRAM_MODULE.test(context.filename || '');
    const register = (name, fn) => {
      if (name && !functions.has(name)) functions.set(name, fn);
    };
    // `@telegram-markdown` in the JSDoc, or an exported formatter of a Telegram module.
    const collectFormatter = (fn, statement) => {
      const comment = sourceCode.getCommentsBefore(statement.parent?.type === 'ExportNamedDeclaration' ? statement.parent : statement).at(-1);
      if (comment && ANNOTATION.test(comment.value)) annotated.push(fn);
      else if (telegramModule && isExported(fn) && FORMATTER_NAME.test(functionName(fn) || '')) annotated.push(fn);
    };

    return {
      FunctionDeclaration(node) {
        register(node.id?.name, node);
        collectFormatter(node, node);
      },
      VariableDeclarator(node) {
        if (node.id.type !== 'Identifier' || !node.init || !/Function/.test(node.init.type)) return;
        register(node.id.name, node.init);
        collectFormatter(node.init, node.parent);
      },
      CallExpression(node) {
        calls.push(node);
      },
      'Program:exit'() {
        for (const sink of collectSinks()) check(sink, true, 0, new Set());
        for (const fn of annotated) for (const returned of returnedExpressions(fn)) check(returned, true, 0, new Set());
        reporter.flush();
      },
    };
  },
};
