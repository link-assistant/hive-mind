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
      code: String.raw`await $` + '`gh pr comment 1 --body ${await sanitizeForPublication(body)}`' + ';',
    },
    {
      code: String.raw`await writeSanitizedPublicationFile(bodyFile, body); await $` + '`gh pr edit 1 --body-file ${bodyFile}`' + ';',
    },
    {
      code: String.raw`await postTrackedComment({ $, owner, repo, targetNumber: 1, body });`,
    },
    {
      code: String.raw`await exec(` + '`gh api repos/${owner}/${repo}/issues/${n}/comments -X POST --input -`' + `, { input: JSON.stringify({ body: await sanitizeForPublication(body) }) });`,
    },
    {
      code: String.raw`const safeTitle = await sanitizeForPublication(title); await writeSanitizedPublicationFile(bodyFile, body); await $` + '`gh issue create --title ${safeTitle} --body-file ${bodyFile}`' + ';',
    },
    {
      code: String.raw`const safeBody = await sanitizeForPublication(body); const payload = JSON.stringify({ body: safeBody }); await $({ stdin: payload })` + '`gh api repos/o/r/issues/1/comments -X POST --input -`' + ';',
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
    {
      code: String.raw`await $` + '`gh pr edit 1 --body-file ${bodyFile}`' + ';',
      errors: [{ messageId: 'unsanitizedOutput' }],
    },
    {
      code: String.raw`await exec(` + '`gh api repos/${owner}/${repo}/issues/${n}/comments -X POST --input -`' + `, { input: JSON.stringify({ body }) });`,
      errors: [{ messageId: 'unsanitizedOutput' }],
    },
    {
      code: String.raw`await $` + '`gh pr close 1 --comment ${message}`' + ';',
      errors: [{ messageId: 'unsanitizedOutput' }],
    },
    {
      code: String.raw`await $` + '`gh release create v1 --notes-file ${notesFile}`' + ';',
      errors: [{ messageId: 'unsanitizedOutput' }],
    },
    {
      code: String.raw`await $` + '`gh issue create --title ${title} --body ${body}`' + ';',
      errors: [{ messageId: 'unsanitizedOutput' }],
    },
    {
      code: String.raw`const payload = JSON.stringify({ body }); await $({ stdin: payload })` + '`gh api repos/o/r/issues/1/comments -X POST --input -`' + ';',
      errors: [{ messageId: 'unsanitizedOutput' }],
    },
    {
      code: String.raw`let payload = await sanitizeForPublication(body); payload = JSON.stringify({ body }); await $({ stdin: payload })` + '`gh api repos/o/r/issues/1/comments -X POST --input -`' + ';',
      errors: [{ messageId: 'unsanitizedOutput' }],
    },
    {
      code: String.raw`const payload = JSON.stringify({ safe: await sanitizeForPublication(body), unsafe: rawOutput }); await $({ stdin: payload })` + '`gh api repos/o/r/issues/1/comments -X POST --input -`' + ';',
      errors: [{ messageId: 'unsanitizedOutput' }],
    },
  ],
});

console.log('require-sanitized-output ESLint rule tests passed');
