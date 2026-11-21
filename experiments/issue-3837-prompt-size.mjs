/** Render twelve fixed prompts without invoking any AI tool or build. */
import { createHash } from 'node:crypto';
import './issue-3837-installed-dependencies.mjs';

const params = { owner: 'example', repo: 'project', issueNumber: 1, prNumber: 2, branchName: 'issue-1', argv: {} };
const results = [];
for (const backend of ['agent', 'claude', 'codex', 'gemini', 'opencode', 'qwen']) {
  const { buildSystemPrompt } = await import(`../src/${backend}.prompts.lib.mjs`);
  for (const profile of ['default', 'workspace-visual']) {
    const options = profile === 'default' ? {} : { workspaceTmpDir: '/tmp/work', modelSupportsVision: true, argv: { promptPlaywrightMcp: true, promptEnsureAllRequirementsAreMet: true } };
    const prompt = buildSystemPrompt({ ...params, ...options });
    const bullets = prompt
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('- When '));
    results.push({ backend, profile, bytes: Buffer.byteLength(prompt), characters: [...prompt].length, words: prompt.trim().split(/\s+/).length, duplicateBullets: bullets.filter((line, index) => bullets.indexOf(line) !== index), sha256: createHash('sha256').update(prompt).digest('hex') });
  }
}
console.log(JSON.stringify(results, null, 2));
