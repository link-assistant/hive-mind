/**
 * ESLint rule: every `gh` call must run under the shared GitHub retry loop.
 *
 * Issue #1726 introduced this rule for rate limits, #1756/#2168 extended the
 * wrappers to transient 5xx/network faults. Issue #3552 follow-up: the rule
 * used to accept any call in a file that merely *mentioned* a wrapper, and
 * never looked at the `execFile('gh', [...])` argv style, so unretried `gh`
 * calls slipped through. It now decides per call site, using the analysis in
 * eslint-rules/github-operation-detect.mjs, which also documents what counts
 * as "retried".
 *
 * Fixes, in order of preference:
 *   - build the file's executor with a wrap factory:
 *       const $ = wrapDollarWithGhRetry(rawDollar);            // command-stream
 *       const run = wrapRunnerWithGitHubRetry(execFileRunner); // argv runners
 *   - wrap the single call: `await ghWithRateLimitRetry(() => execFile('gh', args))`
 *   - for a genuinely single-shot call (interactive login, a probe whose failure
 *     is the answer): `// github-retry-ok: <reason>` on or above the line.
 */

import { createGitHubOperationAnalyser } from './github-operation-detect.mjs';

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow `gh` calls that do not run under the shared GitHub retry loop (rate limits, 5xx, network faults). See src/github-operation-retry.lib.mjs and issues #1726, #3552.',
      category: 'Possible Errors',
      recommended: true,
    },
    messages: {
      directGhExec: '`{{label}}` is not retried. Run it through a `$`/runner built by wrapDollarWithGhRetry/wrapRunnerWithGitHubRetry, or inside ghWithRateLimitRetry(() => ...) (src/github-rate-limit.lib.mjs). For a deliberately single-shot call add `// github-retry-ok: <reason>`. See issues #1726 and #3552.',
    },
    schema: [],
  },

  create(context) {
    const analyser = createGitHubOperationAnalyser(context);
    const check = node => {
      const operation = analyser.unretriedOperation(node);
      if (operation?.tool === 'gh') context.report({ node, messageId: 'directGhExec', data: { label: operation.label } });
    };
    return { CallExpression: check, TaggedTemplateExpression: check };
  },
};
