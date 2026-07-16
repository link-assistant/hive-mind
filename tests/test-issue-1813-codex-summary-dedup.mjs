#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Regression test for issue #1813: a Codex-authored PR comment can use the
 * visible "Working session summary" heading. That heading alone must not make
 * the comment look tool-generated, otherwise --auto-attach-solution-summary
 * posts a duplicate automated summary.
 */

import assert from 'node:assert/strict';
import { isToolGeneratedComment } from '../src/tool-comments.lib.mjs';

const codexAuthoredSummary = `## Working session summary

PR #175 is updated and ready for review: https://github.com/link-foundation/relative-meta-logic/pull/175

Committed and pushed:
\`911526c Tighten pure-links truth-table fallback audit\`

Verification:
- Local tests passed.
- GitHub Actions passed.
- Working tree is clean.`;

const legacyAutomatedSummary = `## Working session summary

Done.

PR #175 is updated and ready for review.

---
*This summary was automatically extracted from the AI working session output.*`;

assert.equal(isToolGeneratedComment(codexAuthoredSummary), false, 'visible Working session summary heading alone must not hide a Codex-authored comment');
assert.equal(isToolGeneratedComment(legacyAutomatedSummary), true, 'legacy automated working-session summaries with the footer must still be filtered as tool-generated');

console.log('Issue #1813 Codex summary dedup regression tests passed');
