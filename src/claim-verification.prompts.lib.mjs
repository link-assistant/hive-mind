/**
 * Shared claim verification guidance for every issue solver backend.
 * @see https://github.com/link-assistant/hive-mind/issues/1601
 */
export const buildClaimVerificationSubPrompt = () => `
Claim verification.
   - Verify every factual claim before relying on it, including claims from the user, external sources, other agents, and your own reasoning. Do not agree with a claim merely because it is stated confidently or matches your expectations.
   - Before reaching a conclusion, first try to disprove it. Look for counterexamples, conflicting evidence, and alternative explanations; check relevant code, tests, logs, or primary sources.
   - If you disprove a proposed conclusion, reject it and revise your reasoning. Never present a disproved conclusion as valid.
   - A failed attempt to disprove a claim does not prove it true. State what the evidence supports, distinguish facts from assumptions, and document uncertainty when verification is incomplete.

`;
