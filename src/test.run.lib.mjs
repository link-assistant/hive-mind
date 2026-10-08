/** GitHub task creation and agent handoff for `/test`. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { buildTestIssueBody, buildTestSolveArgs, partitionTestArgs, selectDocumentationFiles } from './test.lib.mjs';
import { getDefaultBranch, getLatestCommit, getRepositoryFiles, runCommand } from './fix.github.lib.mjs';
import { createTaskIssue } from './task.issue-creation.lib.mjs';
import { describeChildExit } from './child-exit.lib.mjs';
import { ghWithRateLimitRetry } from './github-rate-limit.lib.mjs';

async function runTestGitHubCommand(command, args) {
  return ghWithRateLimitRetry(
    async () => {
      const result = await runCommand(command, args);
      if (result.code !== 0) throw new Error(result.stderr?.toString() || describeChildExit({ command, code: result.code, signal: result.signal }));
      return result;
    },
    { label: `manual testing: ${command} ${args[0]}` }
  );
}

export async function prepareTestIssue({ repository, run = runTestGitHubCommand, warn = console.warn }) {
  const defaultBranch = await getDefaultBranch(repository, run, warn);
  // Fail before creating an issue when the target cannot be read.
  if (!defaultBranch) throw new Error(`Could not access the default branch of ${repository.fullName}.`);
  const commit = await getLatestCommit(repository, defaultBranch, run, warn);
  const { files, truncated } = await getRepositoryFiles(repository, commit?.sha || defaultBranch, run, warn);
  return {
    repository,
    defaultBranch,
    commit,
    documentationFiles: selectDocumentationFiles(files),
    title: 'Manual testing of README and documentation',
    body: buildTestIssueBody({ repository, defaultBranch, commit, files, filesTruncated: truncated }),
  };
}

export async function createTestIssue({ repository, prepared, run = runTestGitHubCommand }) {
  return createTaskIssue({ repository, title: prepared.title, body: prepared.body, run });
}

export function startTestSolve(args, { spawnProcess = spawn } = {}) {
  const solvePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'solve.mjs');
  return new Promise((resolve, reject) => {
    const child = spawnProcess(process.execPath, [solvePath, ...args], { stdio: 'inherit', env: process.env });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(describeChildExit({ command: 'solve', code, signal })));
    });
  });
}

export async function runTestCommand(rawArgs, { prepare = prepareTestIssue, create = createTestIssue, solve = startTestSolve, validate = null, log = console.log } = {}) {
  const parsed = partitionTestArgs(rawArgs);
  if (!parsed.repository) throw new Error('Missing or invalid GitHub repository URL. Usage: hive-test <github-repository-url> [options]');
  // Share strict solve-option validation with Telegram; reject typos before
  // creating a public task that the agent would subsequently fail to start.
  const validator = validate || (await import('./telegram-test-command.lib.mjs')).validateTestCommandOptions;
  const optionsError = await validator(rawArgs);
  if (optionsError) throw new Error(optionsError);

  log(`🧪 Manual testing of ${parsed.repository.fullName}`);
  const prepared = await prepare({ repository: parsed.repository });
  if (parsed.dryRun) {
    log(`Title: ${prepared.title}\n\n${prepared.body}`);
    return { prepared, issue: null };
  }
  const issue = await create({ repository: parsed.repository, prepared });
  log(`Created testing task: ${issue.url}`);
  const solveArgs = buildTestSolveArgs({ issueUrl: issue.url, passthrough: parsed.passthrough });
  if (parsed.runSolve) {
    log(`Starting tester for ${issue.url}`);
    await solve(solveArgs);
  } else {
    log(`Run the tester with: solve ${solveArgs.join(' ')}`);
  }
  return { prepared, issue, solveArgs };
}
