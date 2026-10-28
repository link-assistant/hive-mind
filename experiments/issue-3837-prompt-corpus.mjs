/** Deterministic production prompt corpus for a behavior-preserving catalog migration. */
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import './issue-3837-installed-dependencies.mjs';
import { initI18n } from '../src/i18n.lib.mjs';

await initI18n('en');
const root = fileURLToPath(new URL('../', import.meta.url));
const base = { owner: 'example', repo: 'project', issueNumber: 1, prNumber: 2, branchName: 'issue-1', issueUrl: 'https://github.com/example/project/issues/1', tempDir: '/tmp/work', argv: {} };
const all = { ...base, workspaceTmpDir: '/tmp/logs', modelSupportsVision: true, forkedRepo: 'fork/project', forkActionsUrl: 'https://github.com/fork/project/actions', prUrl: 'https://github.com/example/project/pull/2', isContinueMode: true, feedbackLines: ['Payload: $& {{branchName}} `echo no`'], argv: { fork: true, baseBranch: 'develop', promptPlaywrightMcp: true, promptEnsureAllRequirementsAreMet: true, promptArchitectureCare: true, useHandoff: true, updateAllDependencies: true, reportDependenciesIssues: true, deepAnalysis: true, developmentLog: true } };
const corpus = [];
for (const backend of ['agent', 'claude', 'codex', 'gemini', 'opencode', 'qwen']) {
  const builders = await import(`../src/${backend}.prompts.lib.mjs`);
  for (const [profile, params] of [
    ['default', base],
    ['all-options', all],
  ]) {
    for (const kind of ['System', 'User']) {
      const output = builders[`build${kind}Prompt`](params).replaceAll(root, '/REPO/').replaceAll(process.execPath, '/NODE');
      corpus.push({ backend, profile, kind, bytes: Buffer.byteLength(output), sha256: createHash('sha256').update(output).digest('hex') });
    }
  }
}
console.log(JSON.stringify(corpus, null, 2));
