/**
 * ESLint rule for issue #1745: outbound GitHub comment/description bodies that
 * contain generated output must flow through the fail-closed publication
 * sanitizer or a shared helper that sanitizes internally.
 */

const SANITIZER_NAMES = new Set(['sanitizeForPublication', 'writeSanitizedPublicationFile']);
const SAFE_HELPERS = new Set(['postTrackedComment', 'postTrackedCommentFromFile', 'uploadLogWithGhUploadLog', 'createTaskIssue']);
const COMMAND_EXECUTOR_NAMES = new Set(['$', 'command', 'commandRunner', 'exec', 'execSync', 'execGhWithRetry', 'gh$']);

const containsGeneratedOutputSink = str => {
  if (typeof str !== 'string') return false;
  return /\bgh\s+(?:pr|issue)\s+(?:create|edit|comment|review|close|reopen)\b/.test(str) || /\bgh\s+(?:gist|release)\s+(?:create|edit)\b/.test(str) || /\bgh\s+api\b[\s\S]*(?:\/comments\b|issues\/comments\/|\bpulls\/[^/\s]+(?:\/comments)?\b|\/releases(?:\/|\b))/.test(str);
};

const GENERATED_OUTPUT_ARGUMENT = /(?:--body(?:-file)?\b|\s-b\b|--title\b|--comment\b|--notes(?:-file)?\b|--field\s+body=|\s-f\s+body=|--input\s+-|body\s*\$\{\.\.\.\})/;

const flattenTemplateLiteral = node => {
  if (!node || node.type !== 'TemplateLiteral') return '';
  return node.quasis.map(q => q.value.raw).join('${...}');
};

const calleeName = node => {
  if (!node) return null;
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression' && node.property?.type === 'Identifier') return node.property.name;
  return null;
};

const isSanitizerCall = node => node?.type === 'CallExpression' && SANITIZER_NAMES.has(calleeName(node.callee));

const isSafeHelperCall = node => node?.type === 'CallExpression' && SAFE_HELPERS.has(calleeName(node.callee));

const expressionIsSanitized = (node, sanitizedIdentifiers = new Set()) => {
  if (!node || typeof node.type !== 'string') return false;
  if (node.type === 'Identifier') return sanitizedIdentifiers.has(node.name);
  if (node.type === 'Literal') return true;
  if (isSanitizerCall(node) || isSafeHelperCall(node)) return true;
  if (node.type === 'AwaitExpression' || node.type === 'ChainExpression' || node.type === 'UnaryExpression') {
    return expressionIsSanitized(node.argument || node.expression, sanitizedIdentifiers);
  }
  if (node.type === 'TemplateLiteral') {
    return node.expressions.every(expression => expressionIsSanitized(expression, sanitizedIdentifiers));
  }
  if (node.type === 'ArrayExpression') {
    return node.elements.every(element => !element || expressionIsSanitized(element, sanitizedIdentifiers));
  }
  if (node.type === 'ObjectExpression') {
    return node.properties.every(property => {
      if (property.type === 'SpreadElement') return expressionIsSanitized(property.argument, sanitizedIdentifiers);
      return property.type === 'Property' && expressionIsSanitized(property.value, sanitizedIdentifiers);
    });
  }
  if (node.type === 'BinaryExpression' || node.type === 'LogicalExpression') {
    return expressionIsSanitized(node.left, sanitizedIdentifiers) && expressionIsSanitized(node.right, sanitizedIdentifiers);
  }
  if (node.type === 'ConditionalExpression') {
    return expressionIsSanitized(node.consequent, sanitizedIdentifiers) && expressionIsSanitized(node.alternate, sanitizedIdentifiers);
  }
  if (node.type === 'CallExpression' && calleeName(node.callee) === 'stringify' && node.callee?.object?.name === 'JSON') {
    return node.arguments.every(argument => expressionIsSanitized(argument, sanitizedIdentifiers));
  }
  return false;
};

const expressionContainsSanitizer = (node, sanitizedIdentifiers = new Set()) => {
  if (!node || typeof node.type !== 'string') return false;
  if (node.type === 'Identifier' && sanitizedIdentifiers.has(node.name)) return true;
  if (isSanitizerCall(node) || isSafeHelperCall(node)) return true;
  for (const [key, value] of Object.entries(node)) {
    if (key === 'parent') continue;
    if (!value) continue;
    if (Array.isArray(value)) {
      if (value.some(item => item && typeof item.type === 'string' && expressionContainsSanitizer(item, sanitizedIdentifiers))) return true;
    } else if (typeof value === 'object' && typeof value.type === 'string' && expressionContainsSanitizer(value, sanitizedIdentifiers)) {
      return true;
    }
  }
  return false;
};

const findOptionExpression = (nodes, optionNames) => {
  for (const node of nodes || []) {
    if (node?.type !== 'ObjectExpression') continue;
    for (const property of node.properties) {
      if (property.type !== 'Property') continue;
      const name = property.key?.name ?? property.key?.value;
      if (optionNames.has(name)) return property.value;
    }
  }
  return null;
};

const templateHasUnsafeExpression = (node, sanitizedIdentifiers = new Set()) => {
  const flattened = flattenTemplateLiteral(node);
  if (!containsGeneratedOutputSink(flattened)) return false;
  if (!GENERATED_OUTPUT_ARGUMENT.test(flattened)) return false;

  for (let index = 0; index < node.expressions.length; index++) {
    const preceding = node.quasis[index]?.value?.raw || '';
    if (/(?:--body(?:-file)?|\s-b|--title|--comment|--notes(?:-file)?|--field\s+body=|-f\s+body=)\s*["']?$/.test(preceding) && !expressionIsSanitized(node.expressions[index], sanitizedIdentifiers)) {
      return true;
    }
  }
  return false;
};

// ---------------------------------------------------------------------------
// Issue #2156 — array-argument `gh` invocations
// ---------------------------------------------------------------------------
// `postKillRecoveryNotice()` published an unsanitized pull-request comment for
// two releases because it spawns gh as `runCommand('gh', ['pr', 'comment', url,
// '--body-file', bodyFile])`. There is no shell string and no tagged template,
// so every check above looked straight past it. These helpers read the argv
// array instead: find a body/title flag, then require the element after it to
// be sanitized.
// ---------------------------------------------------------------------------

/** argv flags whose following element is generated, publishable content. */
const ARGV_SINK_FLAGS = new Set(['--body', '-b', '--body-file', '-F', '--title', '-t', '--notes', '--notes-file', '--comment']);

/** argv[0] values that identify a gh subcommand group that publishes content. */
const ARGV_SUBJECTS = new Set(['issue', 'pr', 'gist', 'release']);

/** argv[1] values that identify a publishing (rather than reading) action. */
const ARGV_ACTIONS = new Set(['create', 'comment', 'edit', 'review']);

const literalStringOf = node => (node?.type === 'Literal' && typeof node.value === 'string' ? node.value : null);

/** True when a call names `gh` as the program to spawn. */
const spawnsGh = node => {
  const program = literalStringOf(node.arguments?.[0]);
  return program === 'gh' || (typeof program === 'string' && program.endsWith('/gh'));
};

/**
 * Report on an argv array such as `['pr', 'comment', url, '--body-file', file]`.
 *
 * @returns {boolean} true when a sink flag is followed by an unsanitized value
 */
const argvHasUnsafeSink = (arrayNode, sanitizedIdentifiers = new Set()) => {
  const elements = arrayNode?.elements || [];
  if (!ARGV_SUBJECTS.has(literalStringOf(elements[0]))) return false;
  if (!ARGV_ACTIONS.has(literalStringOf(elements[1]))) return false;
  for (let index = 0; index < elements.length - 1; index++) {
    if (!ARGV_SINK_FLAGS.has(literalStringOf(elements[index]))) continue;
    if (!expressionIsSanitized(elements[index + 1], sanitizedIdentifiers)) return true;
  }
  return false;
};

const callHasUnsafeStringSink = (node, sanitizedIdentifiers = new Set()) => {
  if (!COMMAND_EXECUTOR_NAMES.has(calleeName(node.callee))) return false;
  const firstArg = node.arguments?.[0];
  if (!firstArg) return false;
  if (firstArg.type === 'Literal' && containsGeneratedOutputSink(firstArg.value)) {
    if (!GENERATED_OUTPUT_ARGUMENT.test(firstArg.value)) return false;
    const input = findOptionExpression(node.arguments.slice(1), new Set(['input', 'stdin']));
    return input ? !expressionIsSanitized(input, sanitizedIdentifiers) : !node.arguments.slice(1).some(argument => expressionIsSanitized(argument, sanitizedIdentifiers));
  }
  if (firstArg.type === 'TemplateLiteral' && containsGeneratedOutputSink(flattenTemplateLiteral(firstArg))) {
    if (/--input\s+-/.test(flattenTemplateLiteral(firstArg))) {
      const input = findOptionExpression(node.arguments.slice(1), new Set(['input', 'stdin']));
      return input ? !expressionIsSanitized(input, sanitizedIdentifiers) : true;
    }
    return templateHasUnsafeExpression(firstArg, sanitizedIdentifiers);
  }
  return false;
};

export const _testing = {
  containsGeneratedOutputSink,
  flattenTemplateLiteral,
  expressionContainsSanitizer,
  expressionIsSanitized,
  argvHasUnsafeSink,
  spawnsGh,
};

/**
 * Writers that make the path in their first argument safe to publish, provided
 * the content in their second argument is itself sanitized. Issue #2156: a
 * `--body-file` is only as clean as whatever wrote the file, and
 * `writeSanitizedPublicationFile` is not the only way that file gets written.
 */
const FILE_WRITER_NAMES = new Set(['writeFile', 'writeFileSync', 'outputFile']);

/**
 * Unwrap `await`/`Promise.all(...)` down to the array whose elements line up
 * positionally with an array destructuring pattern.
 *
 * `const [safeTitle, safeBody] = await Promise.all([sanitizeForPublication(a),
 * sanitizeForPublication(b)])` is the idiomatic way to sanitize two values at
 * once in this codebase, and without this the rule saw two untracked names.
 *
 * @returns {Object|null} the ArrayExpression, or null when it cannot be resolved
 */
const destructuredSourceArray = node => {
  let current = node;
  while (current?.type === 'AwaitExpression') current = current.argument;
  if (current?.type === 'ArrayExpression') return current;
  if (current?.type === 'CallExpression' && calleeName(current.callee) === 'all' && current.callee?.object?.name === 'Promise') {
    const first = current.arguments?.[0];
    return first?.type === 'ArrayExpression' ? first : null;
  }
  return null;
};

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require fail-closed publication sanitization for generated output sent to GitHub.',
      recommended: true,
    },
    messages: {
      unsanitizedOutput: 'Generated output sent to GitHub must pass through sanitizeForPublication (or a helper that sanitizes internally).',
    },
    schema: [],
  },

  create(context) {
    const sanitizedIdentifiers = new Set();
    // Issue #2156: argv arrays are routinely built into a `const args = [...]`
    // and only then handed to the spawner, so the array literal and the `'gh'`
    // that gives it meaning are two different nodes.
    const argvArraysByName = new Map();
    return {
      VariableDeclarator(node) {
        if (node.id?.type === 'Identifier') {
          if (node.init?.type === 'ArrayExpression') argvArraysByName.set(node.id.name, node.init);
          if (expressionIsSanitized(node.init, sanitizedIdentifiers)) sanitizedIdentifiers.add(node.id.name);
          else sanitizedIdentifiers.delete(node.id.name);
          return;
        }
        if (node.id?.type === 'ArrayPattern') {
          const source = destructuredSourceArray(node.init);
          node.id.elements.forEach((element, index) => {
            if (element?.type !== 'Identifier') return;
            if (source && expressionIsSanitized(source.elements?.[index], sanitizedIdentifiers)) sanitizedIdentifiers.add(element.name);
            else sanitizedIdentifiers.delete(element.name);
          });
        }
      },

      AssignmentExpression(node) {
        if (node.left?.type === 'Identifier') {
          if (expressionIsSanitized(node.right, sanitizedIdentifiers)) sanitizedIdentifiers.add(node.left.name);
          else sanitizedIdentifiers.delete(node.left.name);
        }
      },

      'CallExpression:exit'(node) {
        const callee = calleeName(node.callee);
        if (callee === 'writeSanitizedPublicationFile' && node.arguments?.[0]?.type === 'Identifier') {
          sanitizedIdentifiers.add(node.arguments[0].name);
        }
        if (FILE_WRITER_NAMES.has(callee) && node.arguments?.[0]?.type === 'Identifier') {
          if (expressionIsSanitized(node.arguments[1], sanitizedIdentifiers)) sanitizedIdentifiers.add(node.arguments[0].name);
          else sanitizedIdentifiers.delete(node.arguments[0].name);
        }
        if (callHasUnsafeStringSink(node, sanitizedIdentifiers)) {
          context.report({ node, messageId: 'unsanitizedOutput' });
          return;
        }
        // Issue #2156: `runCommand('gh', ['pr', 'comment', url, '--body-file', f])`.
        if (spawnsGh(node)) {
          for (const argument of node.arguments.slice(1)) {
            const argv = argument.type === 'ArrayExpression' ? argument : argument.type === 'Identifier' ? argvArraysByName.get(argument.name) : null;
            if (argv && argvHasUnsafeSink(argv, sanitizedIdentifiers)) {
              context.report({ node, messageId: 'unsanitizedOutput' });
              return;
            }
          }
        }
      },

      TaggedTemplateExpression(node) {
        const flattened = flattenTemplateLiteral(node.quasi);
        const stdin = node.tag?.type === 'CallExpression' ? findOptionExpression(node.tag.arguments, new Set(['stdin', 'input'])) : null;
        const hasUnsafeStdin = containsGeneratedOutputSink(flattened) && /--input\s+-/.test(flattened) && (!stdin || !expressionIsSanitized(stdin, sanitizedIdentifiers));
        if (hasUnsafeStdin || templateHasUnsafeExpression(node.quasi, sanitizedIdentifiers)) {
          context.report({ node, messageId: 'unsanitizedOutput' });
        }
      },
    };
  },
};
