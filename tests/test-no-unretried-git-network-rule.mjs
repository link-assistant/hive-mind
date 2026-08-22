#!/usr/bin/env node
/**
 * Tests for the no-unretried-git-network ESLint rule.
 * Issue #2168.
 */

import { RuleTester } from 'eslint';
import noUnretriedGitNetwork from '../eslint-rules/no-unretried-git-network.mjs';

RuleTester.setDefaultConfig({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

const ruleTester = new RuleTester();

const unretriedError = { messageId: 'unretriedGitNetwork' };

ruleTester.run('no-unretried-git-network', noUnretriedGitNetwork, {
  valid: [
    // The file installs the retry on its own `$`.
    {
      code: ["import { wrapDollarWithGitRetry } from './git-retry.lib.mjs';", 'const $ = wrapDollarWithGitRetry(rawDollar);', 'await $({ cwd })`git push origin main 2>&1`;'].join('\n'),
    },
    // The gh wrapper covers git network commands too.
    {
      code: ["import { wrapDollarWithGhRetry } from './github-rate-limit.lib.mjs';", 'const $ = wrapDollarWithGhRetry(rawDollar);', 'await $`git fetch upstream`;'].join('\n'),
    },
    // Explicit per-call form.
    {
      code: ["import { gitCmdRetry } from './lib.mjs';", 'await gitCmdRetry(() => $`git push origin main`);'].join('\n'),
    },
    // A lazily imported wrapper inside a function still counts.
    {
      code: ['async function run() {', "  const { wrapDollarWithGhRetry } = await import('./github-rate-limit.lib.mjs');", '  const $ = wrapDollarWithGhRetry(raw);', '  await $`git pull origin main`;', '}'].join('\n'),
    },
    // `$` handed in by the caller — the caller owns the wrapper.
    {
      code: 'export const push = async ({ $, tempDir, branchName }) => $({ cwd: tempDir })`git push origin ${branchName} 2>&1`;',
    },
    // The same, via `const { $ } = params`.
    {
      code: ['export const push = async params => {', '  const { $, tempDir, branchName } = params;', '  return $({ cwd: tempDir })`git push origin ${branchName} 2>&1`;', '};'].join('\n'),
    },
    // Local git plumbing never reaches the network.
    {
      code: 'await $`git commit -m "wip"`;',
    },
    {
      code: 'await $`git status --porcelain`;',
    },
    // `git clone` is out of scope on purpose (see the rule header).
    {
      code: 'await $`git clone https://github.com/o/r /tmp/x`;',
    },
    // Not a git command at all.
    {
      code: "exec('ls -la');",
    },
  ],
  invalid: [
    {
      code: "const { $ } = await use('command-stream');\nawait $({ cwd })`git push origin main 2>&1`;",
      errors: [unretriedError],
    },
    {
      code: "const { $ } = await use('command-stream');\nawait $`git fetch upstream`;",
      errors: [unretriedError],
    },
    {
      code: "import { execSync } from 'node:child_process';\nexecSync('git ls-remote origin');",
      errors: [unretriedError],
    },
    {
      // `git -C <dir> push` must be recognised through the leading option.
      code: "const { $ } = await use('command-stream');\nawait $`git -C ${dir} push origin main`;",
      errors: [unretriedError],
    },
  ],
});

console.log('✅ no-unretried-git-network rule tests passed');
