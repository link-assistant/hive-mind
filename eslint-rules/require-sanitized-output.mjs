/**
 * ESLint rule for issue #1745: outbound GitHub comment/description bodies that
 * contain generated output must flow through sanitizeOutput or a shared helper
 * that sanitizes internally.
 */

const SANITIZER_NAMES = new Set(['sanitizeOutput', 'sanitizeLogContent', 'sanitizeCommentBody']);
const SAFE_HELPERS = new Set(['postTrackedComment', 'postTrackedCommentFromFile']);

const containsGeneratedOutputSink = str => {
  if (typeof str !== 'string') return false;
  return /\bgh\s+(?:pr|issue)\s+comment\b/.test(str) || /\bgh\s+pr\s+edit\b/.test(str) || /\bgh\s+api\b[\s\S]*(?:\/comments\b|issues\/comments\/|\bpulls\/[^/\s]+\/comments\b)/.test(str);
};

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

const expressionContainsSanitizer = node => {
  if (!node || typeof node.type !== 'string') return false;
  if (isSanitizerCall(node) || isSafeHelperCall(node)) return true;
  for (const [key, value] of Object.entries(node)) {
    if (key === 'parent') continue;
    if (!value) continue;
    if (Array.isArray(value)) {
      if (value.some(item => item && typeof item.type === 'string' && expressionContainsSanitizer(item))) return true;
    } else if (typeof value === 'object' && typeof value.type === 'string' && expressionContainsSanitizer(value)) {
      return true;
    }
  }
  return false;
};

const templateHasUnsafeExpression = node => {
  const flattened = flattenTemplateLiteral(node);
  if (!containsGeneratedOutputSink(flattened)) return false;
  if (/\b--body-file\b/.test(flattened) || /\b--input\s+-\b/.test(flattened) || !/(?:\b--body\b|\s-b\b|\b--field\s+body=|\s-f\s+body=|body\s*\$\{\.\.\.\})/.test(flattened)) return false;
  return node.expressions.some(expr => !expressionContainsSanitizer(expr));
};

const callHasUnsafeStringSink = node => {
  const firstArg = node.arguments?.[0];
  if (!firstArg) return false;
  if (firstArg.type === 'Literal' && containsGeneratedOutputSink(firstArg.value)) {
    if (/\b--body-file\b/.test(firstArg.value) || /\b--input\s+-\b/.test(firstArg.value) || !/(?:\b--body\b|\s-b\b|\b--field\s+body=|\s-f\s+body=|body\s*\$\{\.\.\.\})/.test(firstArg.value)) return false;
    return !node.arguments.some(expressionContainsSanitizer);
  }
  if (firstArg.type === 'TemplateLiteral' && containsGeneratedOutputSink(flattenTemplateLiteral(firstArg))) {
    return templateHasUnsafeExpression(firstArg);
  }
  return false;
};

export const _testing = {
  containsGeneratedOutputSink,
  flattenTemplateLiteral,
  expressionContainsSanitizer,
};

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require sanitizeOutput/safe helpers for generated output posted to GitHub comments or PR descriptions.',
      recommended: true,
    },
    messages: {
      unsanitizedOutput: 'Generated output passed to GitHub comments or PR descriptions must be sanitized with sanitizeOutput (or posted through a helper that sanitizes internally).',
    },
    schema: [],
  },

  create(context) {
    return {
      TaggedTemplateExpression(node) {
        if (templateHasUnsafeExpression(node.quasi)) {
          context.report({ node, messageId: 'unsanitizedOutput' });
        }
      },

      CallExpression(node) {
        if (callHasUnsafeStringSink(node)) {
          context.report({ node, messageId: 'unsanitizedOutput' });
        }
      },
    };
  },
};
