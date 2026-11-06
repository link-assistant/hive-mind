/** Deterministic production prompt corpus for a behavior-preserving catalog migration. */
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath, URL } from 'node:url';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import console from 'node:console';
import './issue-3837-installed-dependencies.mjs';
import { initI18n } from '../src/i18n.lib.mjs';
import { promptText } from '../src/prompt-text.lib.mjs';

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
      let output = builders[`build${kind}Prompt`](params);
      if (kind === 'System' && process.argv.includes('--without-geolocation-policy')) {
        // Issue #4023 intentionally appends this policy; retain the historical corpus for everything before it.
        const suffix = `\n\n${promptText('prompt.system.geolocation.private')}`;
        assert.ok(output.endsWith(suffix), `${backend}: missing location policy suffix`);
        output = output.slice(0, -suffix.length);
      }
      output = output.replaceAll(root, '/REPO/').replaceAll(process.execPath, '/NODE');
      corpus.push({ backend, profile, kind, bytes: Buffer.byteLength(output), sha256: createHash('sha256').update(output).digest('hex') });
    }
  }
}
console.log(JSON.stringify(corpus, null, 2));
