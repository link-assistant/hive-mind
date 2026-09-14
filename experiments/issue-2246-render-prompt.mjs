#!/usr/bin/env node
// Issue #2246: render the "Preparing pull request" section of a tool prompt so the
// pull request lifecycle instructions can be inspected by hand, in both modes, and
// list the candidate phrasings with their sizes.
//
//   node experiments/issue-2246-render-prompt.mjs [claude|agent|codex|gemini|opencode|qwen]
//   node experiments/issue-2246-render-prompt.mjs --variants
const arg = process.argv[2] || 'claude';
const { ACTIVE_VARIANT_ID, PULL_REQUEST_LIFECYCLE_PROMPT_VARIANTS, SINGLE_PASS_VARIANT_ID, getPullRequestLifecycleSubPrompt, isVariantComplete, selectActiveVariantId } = await import('../src/pr-lifecycle.prompts.lib.mjs');

if (arg === '--variants') {
  const rows = PULL_REQUEST_LIFECYCLE_PROMPT_VARIANTS.map(variant => ({
    id: variant.id,
    style: variant.style,
    chars: variant.text.length,
    complete: isVariantComplete(variant),
    missing: Object.entries(variant.covers)
      .filter(([, covered]) => !covered)
      .map(([fact]) => fact)
      .join(','),
  })).sort((a, b) => a.chars - b.chars);
  console.table(rows);
  console.log(`active: ${ACTIVE_VARIANT_ID} (selection rule picks: ${selectActiveVariantId()}), single pass: ${SINGLE_PASS_VARIANT_ID}`);
  for (const variant of PULL_REQUEST_LIFECYCLE_PROMPT_VARIANTS) {
    console.log(`\n[${variant.id}] ${variant.note}\n${getPullRequestLifecycleSubPrompt({ variantId: variant.id, prNumber: 2, repoSuffix: '' })}`);
  }
  process.exit(0);
}

const mod = await import(`../src/${arg}.prompts.lib.mjs`);
const modes = [
  ['--auto-restart-until-mergeable (default)', { autoRestartUntilMergeable: true }],
  ['--auto-merge', { autoMerge: true }],
  ['--no-auto-restart-until-mergeable', {}],
];
for (const [label, argv] of modes) {
  const prompt = mod.buildSystemPrompt({ owner: 'o', repo: 'r', issueNumber: 1, prNumber: 2, branchName: 'b', workspaceTmpDir: '/tmp', argv, modelSupportsVision: false });
  const start = prompt.indexOf('Preparing pull request');
  const end = prompt.indexOf('Workflow and collaboration.');
  console.log(`\n=== ${arg} — ${label} (system prompt: ${prompt.length} characters) ===\n`);
  console.log(prompt.slice(start, end === -1 ? start + 2600 : end).trimEnd());
}
