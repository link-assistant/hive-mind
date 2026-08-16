#!/usr/bin/env node

/**
 * Real-client reproduction for hive-mind#2158.
 *
 * Runs Codex against the locally installed Formal AI server twice in isolated
 * temporary repositories:
 *   1. Hive Mind's former system-first flattened request.
 *   2. The bounded repository objective used after the fix.
 *
 * No GitHub mutation is requested. Results are written beside this script so a
 * later Formal AI release can be compared with the same reproduction.
 */

import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { prepareFormalAiRuntime, resetFormalAiRuntimeCache } from '../src/formal-ai-runtime.lib.mjs';

const experimentDir = dirname(fileURLToPath(import.meta.url));
const resultPath = process.env.ISSUE_2158_RESULT_PATH || join(experimentDir, 'issue-2158-formal-ai-prompt-boundary-results.json');
const formerObjective = ['Issue to solve: https://github.com/example/example/issues/1', 'Your prepared branch: issue-1-example', 'Your prepared working directory: <workspace>', 'Your prepared Pull Request: https://github.com/example/example/pull/2', '', 'Proceed.', ''].join('\n');
const boundedObjective = ['Resolve the GitHub issue at https://github.com/example/example/issues/1 in this repository.', 'Keep the solution on branch issue-1-example.', 'Update the pull request at https://github.com/example/example/pull/2.', '', 'Implement and verify the solution before reporting completion.', 'Continue.', ''].join('\n');
const workflowPreamble = ['You are an AI issue solver using OpenAI Codex.', 'General guidelines.', '   - When running sudo commands, especially package installations, run them in the background.', 'Initial research.', '   - When you start, create a detailed plan and follow it.', 'Solution development and testing.', '   - When issue is solvable, first create a test, then implement the fix.', ''].join('\n');
let observedFormalAiVersion = null;

const runCodex = async ({ name, prompt }) => {
  const workdir = await mkdtemp(join(tmpdir(), `hive-2158-${name}-`));
  const sourceCodexHome = join(workdir, '.source-codex');
  let runtime;
  try {
    await mkdir(sourceCodexHome, { recursive: true });
    runtime = await prepareFormalAiRuntime({ tool: 'codex', workdir, verbose: false, env: { ...process.env, CODEX_HOME: sourceCodexHome } });
    observedFormalAiVersion = runtime.formalAiVersion;
    const args = ['exec', '--model', 'formal-ai', '--json', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox'];
    const childEnv = { ...process.env, ...runtime.env };
    delete childEnv.RUST_LOG;
    const child = spawn('codex', args, {
      cwd: workdir,
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdin.end(prompt.replace('<workspace>', workdir));

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', chunk => (stderr += chunk));
    const exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });

    return {
      name,
      exitCode,
      promptCharacters: prompt.length,
      stdout: stdout.replaceAll(workdir, '<workspace>'),
      stderr: stderr
        .replaceAll(workdir, '<workspace>')
        .split('\n')
        .filter(line => line && !/\bDEBUG\b/.test(line))
        .slice(-20)
        .join('\n'),
    };
  } finally {
    await runtime?.stop?.();
    resetFormalAiRuntimeCache();
    await rm(workdir, { recursive: true, force: true });
  }
};

const results = [];
results.push(await runCodex({ name: 'before-former-request', prompt: `${workflowPreamble}${formerObjective}` }));
results.push(await runCodex({ name: 'after-bounded-request', prompt: boundedObjective }));

await writeFile(
  resultPath,
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      formalAiVersion: observedFormalAiVersion,
      client: 'codex',
      results,
    },
    null,
    2
  )}\n`
);
console.log(resultPath);
