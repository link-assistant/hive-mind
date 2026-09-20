#!/usr/bin/env node

import { RuleTester } from 'eslint';
import requireGhPaginate from '../eslint-rules/require-gh-paginate.mjs';

RuleTester.setDefaultConfig({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

const ruleTester = new RuleTester();

const listEndpointError = { messageId: 'missingPaginate' };

ruleTester.run('require-gh-paginate', requireGhPaginate, {
  valid: [
    {
      code: String.raw`const result = await $` + '`gh api repos/${owner}/${repo}/issues/${issueNumber} --jq .title`' + ';',
    },
    {
      code: String.raw`const result = await $` + '`gh api repos/${owner}/${repo}/pulls/${prNumber} --jq .state`' + ';',
    },
    {
      code: String.raw`const result = await $` + '`gh api repos/${owner}/${repo}/issues/${prNumber}/comments --paginate`' + ';',
    },
    {
      code: String.raw`const result = await $` + "`gh api --paginate repos/${owner}/${repo}/branches --jq '.[].name'`" + ';',
    },
    {
      code: String.raw`const result = await $` + '`gh api repos/${owner}/${repo}/issues/comments/${commentId} --method PATCH --field body=@${tempFile}`' + ';',
    },
    {
      code: String.raw`const result = await $` + "`gh api graphql -f query='query { viewer { login } }'`" + ';',
    },
  ],
  invalid: [
    {
      code: String.raw`const result = await $` + "`gh api repos/${owner}/${repo}/issues/${prNumber}/comments --jq '[.[].body]'`" + ';',
      errors: [listEndpointError],
    },
    {
      code: String.raw`const result = await $` + '`gh api repos/${owner}/${repo}/pulls/${prNumber}/reviews`' + ';',
      errors: [listEndpointError],
    },
    {
      code: String.raw`const result = await exec(` + '`gh api "repos/${owner}/${repo}/actions/runs?head_sha=${sha}&per_page=20" --jq \'.workflow_runs[].id\'`' + ');',
      errors: [listEndpointError],
    },
    {
      code: String.raw`const result = await exec(` + "`gh api repos/${owner}/${repo}/actions/runs/${runId}/jobs --jq '.jobs'`" + ');',
      errors: [listEndpointError],
    },
    {
      code: String.raw`const result = await $` + "`gh api repos/${repoPath}/contents --jq '.[].name'`" + ';',
      errors: [listEndpointError],
    },
    {
      code: String.raw`const result = await $` + "`gh api /user/repository_invitations 2>/dev/null || echo '[]'`" + ';',
      errors: [listEndpointError],
    },
  ],
});

console.log('require-gh-paginate ESLint rule tests passed');
