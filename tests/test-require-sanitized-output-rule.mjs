#!/usr/bin/env node

import { RuleTester } from 'eslint';
import requireSanitizedOutput from '../eslint-rules/require-sanitized-output.mjs';

RuleTester.setDefaultConfig({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

const ruleTester = new RuleTester();

ruleTester.run('require-sanitized-output', requireSanitizedOutput, {
  valid: [
    {
      code: String.raw`await $` + '`gh pr comment 1 --body ${await sanitizeOutput(body)}`' + ';',
    },
    {
      code: String.raw`await $` + '`gh pr edit 1 --body-file ${bodyFile}`' + ';',
    },
    {
      code: String.raw`await postTrackedComment({ $, owner, repo, targetNumber: 1, body });`,
    },
    {
      code: String.raw`await exec(` + '`gh api repos/${owner}/${repo}/issues/${n}/comments -X POST --input -`' + `, { input: JSON.stringify({ body: await sanitizeOutput(body) }) });`,
    },
  ],
  invalid: [
    {
      code: String.raw`await $` + '`gh pr comment 1 --body ${body}`' + ';',
      errors: [{ messageId: 'unsanitizedOutput' }],
    },
    {
      code: String.raw`await $` + '`gh issue comment 1 --body ${body}`' + ';',
      errors: [{ messageId: 'unsanitizedOutput' }],
    },
    {
      code: String.raw`await $` + '`gh pr edit 1 --body ${summary}`' + ';',
      errors: [{ messageId: 'unsanitizedOutput' }],
    },
  ],
});

console.log('require-sanitized-output ESLint rule tests passed');
