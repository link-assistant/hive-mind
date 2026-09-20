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
    // Issue #2189: the streaming sanitizer is an accepted publication boundary.
    {
      code: String.raw`await sanitizeLogFileToFile({ sourcePath: logFile, destPath: bodyFile }); await $` + '`gh pr comment 1 --body-file ${bodyFile}`' + ';',
    },
    {
      code: String.raw`await sanitizeLogFileToFile({ sourcePath: logFile, destPath: bodyFile }); await runCommand('gh', ['issue', 'create', '--body-file', bodyFile]);`,
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
    // Issue #2156: array-argument `gh` invocations.
    {
      code: String.raw`await writeFile(bodyFile, await sanitizeForPublication(body)); await runCommand('gh', ['pr', 'comment', url, '--body-file', bodyFile]);`,
    },
    {
      code: String.raw`await writeSanitizedPublicationFile(bodyFile, body); await runCommand('gh', ['issue', 'create', '--body-file', bodyFile]);`,
    },
    {
      code: String.raw`const [safeTitle, safeBody] = await Promise.all([sanitizeForPublication(title), sanitizeForPublication(body)]); const args = ['issue', 'create', '--title', safeTitle, '--body', safeBody]; await commandOutput('gh', args);`,
    },
    {
      // Reading, not publishing — no sink flag, so no requirement.
      code: String.raw`await runCommand('gh', ['pr', 'view', url, '--json', 'body']);`,
    },
    {
      // A non-gh program that happens to take a --body flag is out of scope.
      code: String.raw`await runCommand('curl', ['issue', 'create', '--body', body]);`,
    },
  ],
  invalid: [
    // Issue #2189: sanitizing a *different* file does not launder this one.
    {
      code: String.raw`await sanitizeLogFileToFile({ sourcePath: logFile, destPath: otherFile }); await runCommand('gh', ['issue', 'create', '--body-file', bodyFile]);`,
      errors: [{ messageId: 'unsanitizedOutput' }],
    },
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
    // Issue #2156: the exact shape postKillRecoveryNotice() used to have — an
    // argv array, so none of the string-based checks above could see it.
    {
      code: String.raw`await writeFile(bodyFile, body); await runCommand('gh', ['pr', 'comment', url, '--body-file', bodyFile]);`,
      errors: [{ messageId: 'unsanitizedOutput' }],
    },
    {
      code: String.raw`await runCommand('gh', ['pr', 'comment', url, '--body-file', bodyFile]);`,
      errors: [{ messageId: 'unsanitizedOutput' }],
    },
    {
      code: String.raw`await commandOutput('gh', ['issue', 'comment', String(n), '--body', body]);`,
      errors: [{ messageId: 'unsanitizedOutput' }],
    },
    {
      code: String.raw`const args = ['issue', 'create', '--title', title, '--body', await sanitizeForPublication(body)]; await commandOutput('gh', args);`,
      errors: [{ messageId: 'unsanitizedOutput' }],
    },
    {
      // Sanitized once, then overwritten with raw content before publishing.
      code: String.raw`await writeFile(bodyFile, await sanitizeForPublication(body)); await writeFile(bodyFile, body); await runCommand('gh', ['pr', 'comment', url, '--body-file', bodyFile]);`,
      errors: [{ messageId: 'unsanitizedOutput' }],
    },
    {
      code: String.raw`const [title, safeBody] = await Promise.all([rawTitle, sanitizeForPublication(body)]); await runCommand('gh', ['issue', 'create', '--title', title, '--body', safeBody]);`,
      errors: [{ messageId: 'unsanitizedOutput' }],
    },
  ],
});

console.log('require-sanitized-output ESLint rule tests passed');
