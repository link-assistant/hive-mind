#!/usr/bin/env node
// Issue #2246: render the "Preparing pull request" section of a tool prompt so the
// pull request lifecycle instructions can be inspected by hand.
const tool = process.argv[2] || 'claude';
const mod = await import(`../src/${tool}.prompts.lib.mjs`);
const prompt = mod.buildSystemPrompt({ owner: 'o', repo: 'r', issueNumber: 1, prNumber: 2, branchName: 'b', workspaceTmpDir: '/tmp', argv: { autoRestartUntilMergeable: true }, modelSupportsVision: false });
const start = prompt.indexOf('Preparing pull request');
console.log(prompt.slice(start, start + 2600));
