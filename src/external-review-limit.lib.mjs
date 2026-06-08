#!/usr/bin/env node

/**
 * Helpers for external review services whose checks fail because the service
 * could not run, not because repository code failed.
 */

const EXTERNAL_REVIEW_SERVICE_PATTERNS = [/coderabbit/i, /code\s*rabbit/i];

const EXTERNAL_REVIEW_LIMIT_PATTERNS = [/insufficient\s+(?:review\s+)?credits?/i, /review\s+limit\s+reached/i, /rate\s+limit(?:ed|s)?/i, /run\s+out\s+of\s+usage\s+credits?/i, /out\s+of\s+usage\s+credits?/i, /usage\s+credits?\s+(?:exhausted|reached|insufficient)/i, /insufficient\s+(?:balance|limits?)/i, /no\s+(?:credits?|balance)\s+(?:left|remaining)/i];

const checkText = check => {
  if (!check || typeof check !== 'object') return '';
  return [check.name, check.context, check.description, check.summary, check.text, check.html_url, check.details_url].filter(Boolean).join('\n');
};

export const isExternalReviewLimitCheck = check => {
  const text = checkText(check);
  if (!text) return false;
  return EXTERNAL_REVIEW_SERVICE_PATTERNS.some(pattern => pattern.test(text)) && EXTERNAL_REVIEW_LIMIT_PATTERNS.some(pattern => pattern.test(text));
};

export const splitExternalReviewLimitChecks = checks => {
  const limitedChecks = [];
  const actionableFailedChecks = [];

  for (const check of checks || []) {
    if (isExternalReviewLimitCheck(check)) {
      limitedChecks.push(check);
    } else {
      actionableFailedChecks.push(check);
    }
  }

  return { limitedChecks, actionableFailedChecks };
};

export const formatExternalReviewLimitCheck = check => {
  const name = check?.name || check?.context || 'External review';
  const description = check?.description && check.description !== name ? ` — ${check.description}` : '';
  const url = check?.html_url || check?.details_url;
  return `${name}${description}${url ? ` — ${url}` : ''}`;
};

const formatList = items => items.map(item => `- ${item}`).join('\n');

export const buildReadyForReviewComment = ({ blocker, ciStatus } = {}) => {
  const skippedChecks = blocker?.details?.length ? blocker.details : (blocker?.checks || []).map(formatExternalReviewLimitCheck);
  const skippedList = skippedChecks.length > 0 ? skippedChecks : ['External review check — blocked by service credits/rate limits'];
  const passedChecks = (ciStatus?.passedChecks || []).map(formatExternalReviewLimitCheck);
  const passedSection = passedChecks.length > 0 ? `\n\n**Checks completed successfully:**\n${formatList(passedChecks)}` : '';

  return `## 🟡 Ready for review

Hive Mind stopped automatic restart because the remaining failed check is an external review quota/credit limit, not a code failure it can fix.

**Checks not executed:**
${formatList(skippedList)}${passedSection}

**Action required:**
- Restore the external review credits/rate limit and rerun the review, or decide manually whether this PR can proceed.
- No new AI session was started for this blocker.

---
*Monitored by hive-mind with --auto-restart-until-mergeable flag.*`;
};
