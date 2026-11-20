// Issue #4081: measure the review-app section against the issue #3837 prompt budget.
import { readFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import console from 'node:console';
import { promptText } from '../src/prompt-text.lib.mjs';
import { getReviewBotsSubPrompt } from '../src/review-bots.prompts.lib.mjs';
const baseline = JSON.parse(await readFile(new URL('../docs/case-studies/issue-3837/data/prompt-size-before.json', import.meta.url), 'utf8'));
const params = { owner: 'example', repo: 'project', issueNumber: 1, prNumber: 2, branchName: 'issue-1', argv: {} };
const policy = `\n\n${promptText('prompt.system.geolocation.private')}`;
console.log('section bytes', Buffer.byteLength(getReviewBotsSubPrompt(params)));
for (const backend of ['agent', 'claude', 'codex', 'gemini', 'opencode', 'qwen']) {
  const { buildSystemPrompt } = await import(`../src/${backend}.prompts.lib.mjs`);
  for (const options of [{}, { workspaceTmpDir: '/tmp/work', modelSupportsVision: true, argv: { promptPlaywrightMcp: true, promptEnsureAllRequirementsAreMet: true } }]) {
    const profile = options.workspaceTmpDir ? 'workspace-visual' : 'default';
    const bytes = Buffer.byteLength(buildSystemPrompt({ ...params, ...options }).slice(0, -policy.length));
    const limit = baseline.find(e => e.backend === backend && e.profile === profile).bytes;
    console.log(backend, profile, bytes, '/', limit, 'headroom', limit - bytes);
  }
}
