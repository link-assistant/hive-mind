/** One-off, deterministic AST extraction; production has no parser dependency. */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import { formatLinoCatalog } from 'lino-i18n';
import { loadLocaleTree } from '../src/locale-catalogs.lib.mjs';

const root = new URL('../', import.meta.url);
const catalogues = await loadLocaleTree(fileURLToPath(new URL('../locales', import.meta.url)), { compatibilityAliases: ['collapseTail', 'parentLabel'] });
const existing = new Map(
  Object.entries(catalogues.en)
    .filter(([key]) => key.startsWith('prompt.'))
    .map(([key, value]) => [value, key])
);
const constantNames = new Set(['RESOURCE_AWARE_SOLVER_IDENTITY', 'ISSUE_COMPLETION_GOAL', 'REPORT_DEPENDENCIES_ISSUES_PARAGRAPH', 'KEEP_WORKING_PROMPT', 'ENSURE_SUB_ISSUES_PROMPT', 'DEBUG_OUTPUT_PARAGRAPH', 'REPORT_UPSTREAM_PARAGRAPH', 'ORGANIZE_SYSTEM_PROMPT', 'HANDOFF_SKILL_DESCRIPTION', 'TOOL_KILL_RESUME_FEEDBACK']);
const targets = {
  'thinking-prompt.lib.mjs': ['THINK_PROMPT_MESSAGES'],
  'deep-analysis.lib.mjs': ['buildDeepAnalysisPrompt'],
  'development-log.lib.mjs': ['buildDevelopmentLogPrompt'],
  'task.split.lib.mjs': ['buildTaskSplitSystemPrompt', 'buildTaskSplitPrompt'],
  'solve.minimal-restart-prompt.lib.mjs': ['generateMinimalRestartPrompt', 'generateFullRestartPrompt'],
  'solve.keep-working.detect.lib.mjs': ['KEEP_WORKING_PROMPT', 'buildKeepWorkingFeedback'],
  'solve.ensure-sub-issues.detect.lib.mjs': ['ENSURE_SUB_ISSUES_PROMPT', 'buildEnsureSubIssuesFeedback', 'buildMissingClosingReferencesBlocker'],
  'uncommitted-changes-feedback.lib.mjs': ['buildUncommittedChangesFeedback'],
  'ci-pre-existing-failure.lib.mjs': ['buildCiFailureGuidance', 'buildPreExistingCiFeedback'],
  'session-progress.lib.mjs': ['buildRepeatedSessionFeedback'],
  'repeated-tool-call-breaker.lib.mjs': ['describeRepeatedToolCall', 'buildRepeatedToolCallFeedback'],
  'fix.update-dependencies.lib.mjs': ['buildStandardPromptParagraphs', 'buildEcosystemsSection', 'buildAutomationSection', 'buildUpdateDependenciesIssueBody'],
  'fix.ci-cd.lib.mjs': ['DEBUG_OUTPUT_PARAGRAPH', 'REPORT_UPSTREAM_PARAGRAPH', 'buildStandardPromptParagraphs', 'buildCiCdIssueBody', 'buildLanguagesSection', 'buildTemplatesSection', 'buildRunsSection'],
};
const additional = process.argv.includes('--additional');
const remaining = process.argv.includes('--remaining');
const remainingTargets = { 'solve.restart-shared.lib.mjs': ['buildAutoRestartInstructions'], 'solve.auto-merge-guards.lib.mjs': ['buildDeliberateDraftFeedback'], 'solve.tool-kill-resume.lib.mjs': ['TOOL_KILL_RESUME_FEEDBACK'], 'codex.process-exit.lib.mjs': ['buildCodexMemoryBudgetPrompt'], 'claude.print-turn.lib.mjs': ['buildIncompleteTurnContinuationPrompt'], 'issue-requirements.lib.mjs': ['createRequirementsReportTemplate', 'buildRequirementsBlocker', 'evaluateRequirementsReport'] };
if (remaining) Object.assign(targets, remainingTargets);
const extraNames = ['review.mjs', 'task.mjs', 'solve.feedback.lib.mjs', 'solve.issue-completion.lib.mjs', 'solve.auto-merge.lib.mjs', 'agent-commander.lib.mjs'];
const names = remaining ? Object.keys(remainingTargets) : additional ? extraNames : (await readdir(new URL('../src', import.meta.url))).filter(name => name.endsWith('.prompts.lib.mjs') || Object.hasOwn(targets, name));
const additions = { system: {}, user: {} };
const report = [];
for (const name of names) {
  const file = new URL(`../src/${name}`, import.meta.url);
  const source = await readFile(file, 'utf8');
  const ast = parse(source, { sourceType: 'module' });
  const ranges = [];
  function collect(node) {
    if (!node?.type) return;
    if (node.type === 'VariableDeclarator' && ['review.mjs', 'task.mjs'].includes(name) && ['prompt', 'systemPrompt'].includes(node.id.name)) ranges.push(node.init);
    if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && node.callee.object.name === 'feedbackLines' && node.callee.property.name === 'push') ranges.push(node);
    if (node.type === 'CallExpression' && node.callee.name === 'runAgentPrompt' && node.arguments[1]?.type === 'StringLiteral') ranges.push(node.arguments[1]);
    if (node.type === 'ObjectProperty' && node.key.name === 'feedbackLines') ranges.push(node.value);
    if (name === 'agent-commander.lib.mjs' && node.type === 'ObjectProperty' && node.key.name === 'prompt' && node.value.type === 'StringLiteral') ranges.push(node.value);
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach(collect);
      else if (child?.type) collect(child);
    }
  }
  if (additional) collect(ast.program);
  let sequence = 0;
  const moduleName = name.replace(/\.lib\.mjs$|\.mjs$/g, '').replaceAll('.', '-');
  function scopeName(node, parent, current) {
    if (node.type === 'FunctionDeclaration' && node.id) return node.id.name;
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && !current) return node.id.name;
    return current;
  }
  function isProse(value) {
    return /[A-Za-z]{2,}/.test(value) && (/\s+[A-Za-z]/.test(value) || /[.!?]$/.test(value));
  }
  function category(scope) {
    return /buildUserPrompt|buildRequestedBaseBranchDirective|buildDeepAnalysisPrompt|buildDevelopmentLogPrompt|buildTaskSplitPrompt|RestartPrompt|Feedback|buildMissingClosingReferencesBlocker|buildCiFailureGuidance/.test(scope) || /buildEcosystemsSection|buildAutomationSection|buildUpdateDependenciesIssueBody|buildCiCdIssueBody|buildLanguagesSection|buildTemplatesSection|buildRunsSection/.test(scope) || name === 'thinking-prompt.lib.mjs' ? 'user' : 'system';
  }
  function selected(scope, node) {
    return additional ? ranges.some(range => node.start >= range.start && node.end <= range.end) : !targets[name] || targets[name].includes(scope);
  }
  function render(node, parent, scope = '', top = false) {
    scope = scopeName(node, parent, scope);
    if (node.type === 'TaggedTemplateExpression' || node.type === 'ImportDeclaration' || (node.type.startsWith('Export') && !node.declaration)) return source.slice(node.start, node.end);
    if (node.type === 'Identifier' && constantNames.has(node.name) && scope && scope !== node.name && !(parent.type === 'VariableDeclarator' && parent.id === node) && !(parent.type === 'ObjectProperty' && parent.key === node && !parent.computed) && !(parent.type === 'MemberExpression' && parent.property === node && !parent.computed) && !(parent.type === 'AssignmentPattern' && parent.left === node)) {
      return `localizePromptConstant(${node.name})`;
    }
    const propertyKey = parent && (parent.type === 'ObjectProperty' || parent.type === 'ObjectMethod') && parent.key === node && !parent.computed;
    if (selected(scope, node) && !propertyKey && (node.type === 'TemplateLiteral' || node.type === 'StringLiteral')) {
      const values = {};
      let value;
      if (node.type === 'StringLiteral') value = node.value;
      else {
        value = node.quasis[0].value.cooked;
        node.expressions.forEach((expression, index) => {
          let parameter = expression.type === 'Identifier' ? expression.name : `value${index + 1}`;
          if (Object.hasOwn(values, parameter)) parameter = `value${index + 1}`;
          values[parameter] = `String(${render(expression, node, scope)})`;
          value += `{{${parameter}}}` + node.quasis[index + 1].value.cooked;
        });
      }
      if (isProse(value) && !(parent?.type === 'CallExpression' && parent.callee.type === 'Identifier' && /Error$/.test(parent.callee.name))) {
        const kind = remaining ? 'user' : additional ? (node.start >= ranges.find(range => range === node && name === 'task.mjs')?.start || scope === 'systemPrompt' ? 'system' : 'user') : category(scope);
        let key = existing.get(value);
        if (!key || (kind === 'system') !== key.startsWith('prompt.system.')) {
          key = `prompt.${kind === 'system' ? 'system.' : ''}templates.${moduleName}.${scope || 'module'}.text${++sequence}`;
          additions[kind][key] = value;
        }
        const parameters = Object.keys(values).length
          ? `, { ${Object.entries(values)
              .map(([key, expression]) => `${key}: ${expression}`)
              .join(', ')} }`
          : '';
        const englishConstant = constantNames.has(scope) || scope === 'THINK_PROMPT_MESSAGES';
        return `promptText(${JSON.stringify(key)}${parameters || (englishConstant ? ', {}' : '')}${englishConstant ? ", { locale: 'en' }" : ''})`;
      }
    }
    const children = [];
    for (const [key, child] of Object.entries(node)) {
      if (key === 'loc' || key === 'extra' || key === 'comments' || key.endsWith('Comments')) continue;
      if (Array.isArray(child)) children.push(...child.filter(item => item?.type && Number.isInteger(item.start)));
      else if (child?.type && Number.isInteger(child.start)) children.push(child);
    }
    children.sort((a, b) => a.start - b.start);
    let position = node.start;
    let result = '';
    for (const child of children) {
      if (child.start < position) continue;
      result += source.slice(position, child.start) + render(child, node, scope);
      position = child.end;
    }
    return result + source.slice(position, node.end);
  }
  let transformed = render(ast.program, null);
  if (transformed !== source) {
    const imports = [];
    if (/\bpromptText\(/.test(transformed)) imports.push('promptText');
    if (/\blocalizePromptConstant\(/.test(transformed)) imports.push('localizePromptConstant');
    const declaration = `import { ${imports.join(', ')} } from './prompt-text.lib.mjs';\n`;
    transformed = transformed.startsWith('#!') ? transformed.replace(/^(#![^\n]*\n)/, '$1' + declaration) : declaration + transformed;
    await writeFile(file, transformed);
    report.push({ name, templates: sequence });
  }
}
for (const [kind, values] of Object.entries(additions)) {
  const folder = kind === 'system' ? 'locales/prompts/system' : 'locales/prompts';
  // Existing translations remain authoritative; newly extracted templates fall back to English.
  await writeFile(new URL(`${folder}/${remaining ? 'recovery' : additional ? 'additional' : 'templates'}.en.lino`, root), formatLinoCatalog('en', values));
}
console.log(JSON.stringify(report, null, 2));
