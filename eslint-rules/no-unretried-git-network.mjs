/**
 * ESLint rule: network-facing git commands (`push`/`fetch`/`pull`/`ls-remote`)
 * must run under the shared GitHub retry loop.
 *
 * Issue #2168: a session died on a transient GitHub failure because the call
 * site had no retry. The `gh` half is `gh-rate-limit/no-direct-gh-exec`; this
 * rule is the git half. Issue #3552 (`remote: fatal error in commit_refs` on a
 * release push from scripts/) showed that scripts/ needs it as much as src/,
 * and that the file-level "a wrapper is mentioned somewhere" exemption let
 * argv-style `spawn('git', ['push', ...])` calls through. The rule now decides
 * per call site - see eslint-rules/github-operation-detect.mjs.
 *
 * Fixes:
 *   - const $ = wrapDollarWithGitRetry(rawDollar);        // or wrapDollarWithGhRetry
 *   - const run = wrapRunnerWithTransientRetry(runner);   // argv runners (scripts/)
 *   - await gitCmdRetry(() => $`git push origin main`);   // one call
 *   - `// github-retry-ok: <reason>` for a deliberately single-shot call.
 *
 * `git clone` is not covered on purpose: retrying a clone into a partially
 * written directory fails with "already exists and is not an empty directory",
 * replacing the real diagnosis with a confusing one.
 */

import { createGitHubOperationAnalyser } from './github-operation-detect.mjs';

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow network-facing git commands (push/fetch/pull/ls-remote) that do not run under the shared GitHub retry loop. See src/github-operation-retry.lib.mjs and issues #2168, #3552.',
      category: 'Possible Errors',
      recommended: true,
    },
    messages: {
      unretriedGitNetwork: '`{{label}}` is not retried. Run it through a `$`/runner built by wrapDollarWithGitRetry/wrapDollarWithGhRetry/wrapRunnerWithTransientRetry, or inside gitCmdRetry(() => ...). For a deliberately single-shot call add `// github-retry-ok: <reason>`. See issues #2168 and #3552.',
    },
    schema: [],
  },

  create(context) {
    const analyser = createGitHubOperationAnalyser(context);
    const check = node => {
      const operation = analyser.unretriedOperation(node);
      if (operation?.tool === 'git') context.report({ node, messageId: 'unretriedGitNetwork', data: { label: operation.label } });
    };
    return { CallExpression: check, TaggedTemplateExpression: check };
  },
};
