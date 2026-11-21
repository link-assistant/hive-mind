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
    // Issue #3552: argv style through a runner wrapped with the shared loop.
    {
      code: "import { wrapRunnerWithTransientRetry } from './github-operation-retry.lib.mjs';\nconst run = wrapRunnerWithTransientRetry(rawRun);\nawait run('git', ['push', 'origin', 'main']);",
    },
    // A local helper whose body starts the process through a retrying runner.
    {
      code: "import { wrapRunnerWithTransientRetry } from './github-operation-retry.lib.mjs';\nconst retryingRunner = wrapRunnerWithTransientRetry(runner);\nconst soft = (command, args) => retryingRunner(command, args, {});\nawait soft('git', ['ls-remote', '--heads', 'origin']);",
    },
    // A retrying runner handed over as an option: runStrict(..., { runner }).
    {
      code: "import { wrapRunnerWithTransientRetry } from './github-operation-retry.lib.mjs';\nconst retryingRunner = wrapRunnerWithTransientRetry(runner);\nawait runStrict('git', ['fetch', 'origin'], { runner: retryingRunner });\nconst strict = (command, args) => runStrict(command, args, { runner: retryingRunner });\nawait strict('git', ['pull', '--rebase', 'origin', 'main']);",
    },
    // A thunk handed to the shared retry loop.
    {
      code: "import { retryGitHubOperation } from './github-operation-retry.lib.mjs';\nawait retryGitHubOperation(() => runner('git', ['push', 'origin', 'main']));",
    },
    // The synchronous helper for release scripts.
    {
      code: "import { execSyncWithRetry } from './github-operation-retry.lib.mjs';\nexecSyncWithRetry('git fetch origin main', { stdio: 'inherit' });",
    },
    // A local function declaration that calls a retrying executor.
    {
      code: "import { wrapRunnerWithTransientRetry } from './github-operation-retry.lib.mjs';\nconst execFileAsync = wrapRunnerWithTransientRetry(rawExecFile);\nasync function tryExec(cmd, args) { return execFileAsync(cmd, args); }\nawait tryExec('git', ['fetch', 'origin']);",
    },
    // The escape comment, for an operation that must not be retried.
    {
      code: "// github-retry-ok: probing reachability, a failure is the answer\nexecSync('git ls-remote origin');",
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
    {
      // argv style through a raw runner.
      code: "await run('git', ['push', 'origin', 'main']);",
      errors: [unretriedError],
    },
    {
      // A helper handed a raw runner as an option is not retrying.
      code: "const strict = (command, args) => runStrict(command, args, { runner: rawRunner });\nawait strict('git', ['fetch', 'origin']);",
      errors: [unretriedError],
    },
    {
      // $.raw is the unwrapped tag.
      code: "import { wrapDollarWithGhRetry } from './github-rate-limit.lib.mjs';\nconst $ = wrapDollarWithGhRetry(rawDollar);\nawait $.raw`git push origin main`;",
      errors: [unretriedError],
    },
  ],
});

console.log('✅ no-unretried-git-network rule tests passed');
