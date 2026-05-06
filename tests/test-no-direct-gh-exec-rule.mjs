#!/usr/bin/env node
/**
 * Tests for the no-direct-gh-exec ESLint rule.
 * Issue #1726.
 */

import { RuleTester } from 'eslint';
import noDirectGhExec from '../eslint-rules/no-direct-gh-exec.mjs';

RuleTester.setDefaultConfig({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

const ruleTester = new RuleTester();

const directExecError = { messageId: 'directGhExec' };

ruleTester.run('no-direct-gh-exec', noDirectGhExec, {
  valid: [
    // Files that import a safe wrapper are exempt — the wrapper is the safety belt.
    {
      code: ["import { ghWithRateLimitRetry } from './github-rate-limit.lib.mjs';", 'const exec = (cmd) => ghWithRateLimitRetry(() => execRaw(cmd));', 'const r = await exec(`gh api repos/o/r/pulls`);'].join('\n'),
    },
    {
      code: ["import { execGhWithRetry } from './github-rate-limit.lib.mjs';", "const r = await execGhWithRetry('gh api rate_limit');"].join('\n'),
    },
    {
      code: ["import { ghCmdRetry } from './lib.mjs';", 'await ghCmdRetry(() => $`gh api repos/o/r/issues`);'].join('\n'),
    },
    // Non-gh exec calls are fine.
    {
      code: "import { exec } from 'child_process'; exec('ls -la');",
    },
    // String literals that don't start with 'gh' are fine.
    {
      code: "exec('git status');",
    },
  ],
  invalid: [
    {
      code: ["import { exec } from 'child_process';", "const r = await exec('gh api rate_limit');"].join('\n'),
      errors: [directExecError],
    },
    {
      code: ["import { promisify } from 'util';", "import { exec as execCallback } from 'child_process';", 'const exec = promisify(execCallback);', 'const r = await exec(`gh api repos/${owner}/${repo}/pulls --paginate`);'].join('\n'),
      errors: [directExecError],
    },
    {
      code: 'await execAsync(`gh pr list --repo ${o}/${r}`);',
      errors: [directExecError],
    },
    {
      // Tagged template `$`gh ...` ` is also flagged.
      code: 'await $`gh api repos/o/r/pulls`;',
      errors: [directExecError],
    },
  ],
});

console.log('✅ no-direct-gh-exec rule tests passed');
