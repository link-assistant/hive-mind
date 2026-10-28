/** Compare rendered English prompts against the original issue baseline, without running AI tools. */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFileSync, spawnSync } from 'node:child_process';
import { log } from 'node:console';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import './issue-3837-installed-dependencies.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const backends = ['agent', 'claude', 'codex', 'gemini', 'opencode', 'qwen'];
const baseline = '976a5a95a10a74f3f85feca2ef94a22afe80e2ca';
const base = { owner: 'example', repo: 'project', issueNumber: 1, prNumber: 2, branchName: 'issue-1', issueUrl: 'https://github.com/example/project/issues/1', tempDir: '/tmp/work', argv: {} };
const profiles = {
  default: base,
  'workspace-visual': { ...base, workspaceTmpDir: '/tmp/work', modelSupportsVision: true, argv: { promptPlaywrightMcp: true, promptEnsureAllRequirementsAreMet: true } },
  'all-options': { ...base, workspaceTmpDir: '/tmp/logs', modelSupportsVision: true, forkedRepo: 'fork/project', forkActionsUrl: 'https://github.com/fork/project/actions', prUrl: 'https://github.com/example/project/pull/2', isContinueMode: true, feedbackLines: ['Payload: $& {{branchName}} `echo no`'], argv: { fork: true, baseBranch: 'develop', promptPlaywrightMcp: true, promptEnsureAllRequirementsAreMet: true, promptArchitectureCare: true, useHandoff: true, updateAllDependencies: true, reportDependenciesIssues: true, deepAnalysis: true, developmentLog: true } },
};

if (process.argv[2] === '--render') {
  const directory = path.resolve(process.argv[3]);
  const { initI18n } = await import(pathToFileURL(path.join(directory, 'src/i18n.lib.mjs')));
  await initI18n('en');
  const corpus = [];
  for (const backend of backends) {
    const builders = await import(pathToFileURL(path.join(directory, `src/${backend}.prompts.lib.mjs`)));
    for (const [profile, params] of Object.entries(profiles)) {
      for (const kind of ['System', 'User']) {
        const output = builders[`build${kind}Prompt`](params).replaceAll(`${directory}/`, '/REPO/').replaceAll(process.execPath, '/NODE');
        corpus.push({ backend, profile, kind, output });
      }
    }
  }
  log(JSON.stringify(corpus));
} else {
  const destination = path.resolve(process.argv[2] || '/tmp/issue-3837-before-after');
  const temporary = await mkdtemp(path.join(root, 'experiments/.issue-3837-before-after-'));
  try {
    // Keep historical files inside this checkout's dependency lookup tree; never alter the checkout.
    execFileSync('tar', ['-x', '-C', temporary], { input: execFileSync('git', ['archive', baseline, 'src'], { cwd: root, maxBuffer: 32 * 1024 * 1024 }) });
    const render = directory => JSON.parse(execFileSync(process.execPath, ['--max-old-space-size=96', fileURLToPath(import.meta.url), '--render', directory], { cwd: root, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 }));
    const before = render(temporary);
    const after = render(root);
    const originalSizes = JSON.parse(await readFile(new URL('../docs/case-studies/issue-3837/data/prompt-size-before.json', import.meta.url), 'utf8'));
    const previousCorpus = JSON.parse(await readFile(new URL('../docs/case-studies/issue-3837/data/prompt-corpus-before.json', import.meta.url), 'utf8'));
    const measure = output => ({ bytes: Buffer.byteLength(output), sha256: createHash('sha256').update(output).digest('hex') });
    const comparisons = [];
    await mkdir(destination, { recursive: true });
    for (const backend of backends) {
      const diffs = [];
      for (let index = 0; index < before.length; index++) {
        const original = before[index];
        if (original.backend !== backend) continue;
        const current = after[index];
        const { profile, kind } = original;
        assert.deepEqual([current.backend, current.profile, current.kind], [backend, profile, kind]);
        const originalSize = originalSizes.find(entry => entry.backend === backend && entry.profile === profile);
        if (originalSize && kind === 'System') assert.deepEqual(measure(original.output), { bytes: originalSize.bytes, sha256: originalSize.sha256 });
        const previous = previousCorpus.find(entry => entry.backend === backend && entry.profile === profile && entry.kind === kind);
        if (previous) assert.deepEqual(measure(current.output), { bytes: previous.bytes, sha256: previous.sha256 }, 'follow-up preserves the pre-extraction English corpus');
        if (kind === 'User') assert.equal(current.output, original.output, 'user prompt wording stays unchanged');
        const beforeFile = path.join(temporary, 'before.txt');
        const afterFile = path.join(temporary, 'after.txt');
        await writeFile(beforeFile, original.output);
        await writeFile(afterFile, current.output);
        const diff = spawnSync('diff', ['-U0', '--label', `${backend}/${profile}/${kind.toLowerCase()}/before`, '--label', `${backend}/${profile}/${kind.toLowerCase()}/after`, beforeFile, afterFile], { encoding: 'utf8' });
        assert.ok(diff.status === 0 || diff.status === 1, diff.error?.message || diff.stderr);
        const lines = diff.stdout.split('\n');
        const addedLines = lines.filter(line => line.startsWith('+') && !line.startsWith('+++')).length;
        const removedLines = lines.filter(line => line.startsWith('-') && !line.startsWith('---')).length;
        comparisons.push({ backend, profile, kind, before: measure(original.output), after: measure(current.output), addedLines, removedLines });
        diffs.push(diff.stdout || `# ${backend}/${profile}/${kind.toLowerCase()}: identical before and after\n`);
      }
      await writeFile(path.join(destination, `${backend}.diff`), diffs.join('\n'));
    }
    await writeFile(path.join(destination, 'summary.json'), JSON.stringify({ baseline, comparisons }, null, 2) + '\n');
    log(`Compared ${comparisons.length} prompt renderings; user wording and ${previousCorpus.length} pre-extraction hashes match. Evidence: ${destination}`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
