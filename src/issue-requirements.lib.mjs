/** Completion evidence for issue-scoped merges (issue #2335). */
import { createHash } from 'node:crypto';
import { getClosingReferenceText } from './github-linking.lib.mjs';
import { issueKey } from './issue-link-verification.lib.mjs';
import { isToolGeneratedComment } from './tool-comments.lib.mjs';

export const REQUIREMENTS_START = '<!-- hive-mind:requirements:start -->';
export const REQUIREMENTS_END = '<!-- hive-mind:requirements:end -->';
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const normalize = text => String(text).replace(/\s+/g, ' ').trim();

/** Known automation output is not new user feedback and cannot invalidate itself. */
export function requirementFeedback(comments) {
  return (comments || [])
    .filter(comment => {
      if (!nonempty(comment.body)) return false;
      // Quoting an automation phrase in a user's request must not erase it.
      const bookkeeping = isToolGeneratedComment(comment.body) && (/^<!-- hive-mind:working-session-summary -->/.test(comment.body) || (/^## /u.test(comment.body) && /(?:by hive-mind|Now working session is ended|AI work session|automatically extracted)/i.test(comment.body)));
      return !bookkeeping;
    })
    .map(comment => ({ id: comment.id, body: comment.body }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

export function requirementSourceDigest({ title = '', body = '', comments = [], feedback = [] }) {
  return createHash('sha256')
    .update(JSON.stringify({ title, body, comments: requirementFeedback(comments), feedback: requirementFeedback(feedback) }))
    .digest('hex');
}

/** Minimum explicit acceptance criteria; the agent must also inventory prose requirements. */
export function extractExplicitRequirements(text) {
  const requirements = [];
  let sectionLevel = null;
  for (const line of getClosingReferenceText(String(text || '').replace(/`([^`\n]+)`/g, '$1')).split('\n')) {
    const heading = line.match(/^\s*(#{1,6})\s+(.+)/);
    if (heading) {
      if (sectionLevel !== null && heading[1].length <= sectionLevel) sectionLevel = null;
      if (/requirements|acceptance|done when|definition of done|expected (?:behavior|behaviour|result)/i.test(heading[2])) sectionLevel = heading[1].length;
    }
    const checkbox = line.match(/^\s*[-*+]\s+\[[ xX]\]\s+(.+)/);
    const item = checkbox || (sectionLevel !== null && line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.+)/));
    if (item && !requirements.includes(normalize(item[1]))) requirements.push(normalize(item[1]));
  }
  return requirements;
}

export function parseRequirementsReport(body) {
  const text = String(body || '');
  if (text.split(REQUIREMENTS_START).length !== 2 || text.split(REQUIREMENTS_END).length !== 2) return null;
  const start = text.indexOf(REQUIREMENTS_START) + REQUIREMENTS_START.length;
  const end = text.indexOf(REQUIREMENTS_END);
  if (end < start) return null;
  try {
    const report = JSON.parse(
      text
        .slice(start, end)
        .trim()
        .replace(/^```json\s*\n/, '')
        .replace(/\n```$/, '')
    );
    return report?.version === 1 && Array.isArray(report.issues) ? report : null;
  } catch {
    return null;
  }
}

export function formatRequirementsReport(report) {
  return `${REQUIREMENTS_START}\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n${REQUIREMENTS_END}`;
}

/** Start with pending entries; generating a snapshot never certifies completion. */
export function createRequirementsReportTemplate({ headSha, issues }) {
  return { version: 1, headSha, issues: issues.map(({ owner, repo, number, sourceDigest, explicitRequirements }) => ({ owner, repo, number, sourceDigest, requirements: (explicitRequirements.length ? explicitRequirements : ['Inventory every requirement in the issue description and feedback, including prose.']).map(text => ({ text, status: 'pending', evidence: '' })) })) };
}

export function buildRequirementsBlocker(details, reason = 'incomplete_issue_requirements') {
  return { reason, message: 'Issue requirements have not been verified for this pull request.', details, resolution: 'Complete every requested requirement in this pull request and refresh its requirements report with evidence for the current commit and issue feedback.' };
}

/** A report is evidence to review, not proof of arbitrary natural-language correctness. */
export function evaluateRequirementsReport({ prBody, headSha, issues }) {
  const report = parseRequirementsReport(prBody);
  if (!report) return buildRequirementsBlocker(['Missing or malformed requirements report.']);
  if (!/^[a-f0-9]{40}$/i.test(headSha || '') || report.headSha !== headSha) return buildRequirementsBlocker(['The requirements report does not describe the current pull request commit.']);
  const details = [];
  const expected = new Set(issues.map(issueKey));
  if (report.issues.length !== expected.size || report.issues.some(issue => !expected.has(issueKey(issue)))) details.push('The report must inventory exactly every required issue, without duplicates or unrelated issues.');
  for (const issue of issues) {
    const key = issueKey(issue);
    const entries = report.issues.filter(entry => issueKey(entry) === key);
    if (entries.length !== 1) {
      details.push(`${key}: missing or duplicated issue evidence.`);
      continue;
    }
    const entry = entries[0];
    if (entry.sourceDigest !== issue.sourceDigest) details.push(`${key}: issue description or review feedback changed after verification.`);
    const requirements = entry.requirements;
    if (!Array.isArray(requirements) || requirements.length === 0) {
      details.push(`${key}: no requirement inventory.`);
      continue;
    }
    for (const requirement of requirements) {
      if (!nonempty(requirement?.text) || requirement.status !== 'done' || !nonempty(requirement.evidence)) details.push(`${key}: unfinished or unverified requirement: ${requirement?.text || '(missing text)'}.`);
    }
    for (const text of issue.explicitRequirements || []) {
      if (!requirements.some(requirement => normalize(requirement?.text) === normalize(text))) details.push(`${key}: acceptance criterion omitted: ${text}`);
    }
  }
  return details.length ? buildRequirementsBlocker(details) : null;
}

export { issueKey, missingIssueLinks } from './issue-link-verification.lib.mjs';
