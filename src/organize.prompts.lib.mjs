import { promptText, localizePromptConstant } from './prompt-text.lib.mjs';
/**
 * Trusted instructions for the issue-organization classifier.
 *
 * Keep this string static. Repository data and operator instructions belong in
 * the user message built below because issue bodies and comments are untrusted.
 */
export const ORGANIZE_SYSTEM_PROMPT = promptText('prompt.system.templates.organize-prompts.ORGANIZE_SYSTEM_PROMPT.text1', {}, { locale: 'en' });

export const ORGANIZE_PLAN_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['issues'],
  properties: {
    issues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['issue', 'expectedUpdatedAt', 'type', 'addLabels', 'removeLabels', 'documentationImpact', 'confidence', 'reason'],
        properties: {
          issue: { type: 'integer', minimum: 1 },
          expectedUpdatedAt: { type: 'string', minLength: 1 },
          type: { anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
          addLabels: { type: 'array', uniqueItems: true, items: { type: 'string', minLength: 1 } },
          removeLabels: { type: 'array', uniqueItems: true, items: { type: 'string', minLength: 1 } },
          documentationImpact: { type: 'boolean' },
          confidence: { enum: ['high', 'medium', 'low'] },
          reason: { type: 'string', minLength: 1, maxLength: 1000 },
        },
      },
    },
  },
});

const serializedLength = value => JSON.stringify(value).length;

/** Split the complete open-issue set into bounded prompts without overlap. */
export function chunkOrganizationIssues({ repository, issueTypes, labels, issues, maxIssues = 75, maxCharacters = 120_000 }) {
  if (!Array.isArray(issues)) throw new TypeError('issues must be an array');
  if (!Number.isInteger(maxIssues) || maxIssues < 1) throw new TypeError('maxIssues must be a positive integer');
  if (!Number.isInteger(maxCharacters) || maxCharacters < 1) throw new TypeError('maxCharacters must be a positive integer');

  const shared = { repository, issueTypes: issueTypes || [], labels: labels || [] };
  const baseLength = serializedLength(shared);
  const chunks = [];
  let current = [];
  let currentLength = baseLength;

  for (const issue of issues) {
    const issueLength = serializedLength(issue) + 1;
    if (current.length > 0 && (current.length >= maxIssues || currentLength + issueLength > maxCharacters)) {
      chunks.push({ ...shared, issues: current });
      current = [];
      currentLength = baseLength;
    }
    current.push(issue);
    currentLength += issueLength;
  }
  if (current.length > 0) chunks.push({ ...shared, issues: current });
  return chunks;
}

/** Build a fixed system message and a separately-delimited untrusted message. */
export function buildOrganizationPrompts({ repository, issueTypes, labels, issues, operatorInstructions = '', chunk = null, chunkCount = null }) {
  const payload = {
    repository: {
      fullName: repository.fullName,
      url: repository.url,
      description: repository.description || '',
      readme: repository.readme || '',
    },
    scope: promptText('prompt.templates.organize-prompts.buildOrganizationPrompts.text5'),
    chunk: chunk === null ? null : { index: chunk, count: chunkCount },
    issueTypes: issueTypes || [],
    labels: labels || [],
    issues: issues || [],
    schema: ORGANIZE_PLAN_SCHEMA,
  };

  return {
    system: localizePromptConstant(ORGANIZE_SYSTEM_PROMPT),
    user: ['<UNTRUSTED_OPERATOR_INSTRUCTIONS>', operatorInstructions || '(none)', '</UNTRUSTED_OPERATOR_INSTRUCTIONS>', '<UNTRUSTED_REPOSITORY_CONTEXT_AND_TAXONOMY>', JSON.stringify({ ...payload, issues: undefined }), '</UNTRUSTED_REPOSITORY_CONTEXT_AND_TAXONOMY>', '<UNTRUSTED_ISSUES>', JSON.stringify(payload.issues), '</UNTRUSTED_ISSUES>', promptText('prompt.templates.organize-prompts.buildOrganizationPrompts.text6')].join('\n'),
  };
}
