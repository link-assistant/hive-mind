#!/usr/bin/env node

import crypto from 'crypto';
import path from 'path';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { buildStartAgentArgs, resolveStartAgentCommand } from './task.agent-command.lib.mjs';
import { getDefaultTaskModel, parseTaskArguments } from './task.config.lib.mjs';
import { validateModelName } from './models/index.mjs';
import { appendOrReplaceParentSplitSection, buildAddSubIssueApiArgs, buildIssueRestIdApiArgs, buildTaskSplitPrompt, buildTaskSplitSystemPrompt, extractTaskSplitJson, formatChildIssueBody, normalizeSplitTasks, parseCreatedIssueUrl, parseTaskIssueUrl } from './task.split.lib.mjs';

const earlyArgs = process.argv.slice(2);

if (earlyArgs.includes('--version')) {
  const { getVersion } = await import('./version.lib.mjs');
  try {
    console.log(await getVersion());
  } catch {
    console.error('Error: Unable to determine version');
    process.exit(1);
  }
  process.exit(0);
}

if (earlyArgs.length === 0 || earlyArgs.includes('--help') || earlyArgs.includes('-h')) {
  console.log('Usage: task.mjs <task-description> [options]');
  console.log('\nOptions:');
  console.log('  --version          Show version number');
  console.log('  --help, -h         Show help');
  console.log('  --clarify          Enable clarification mode [default: true]');
  console.log('  --decompose        Enable decomposition mode [default: true]');
  console.log('  --only-clarify     Only run clarification mode');
  console.log('  --only-decompose   Only run decomposition mode');
  console.log('  --split            Split a GitHub issue into smaller issues');
  console.log('  --split-count      Number of issues to split into [default: 2]');
  console.log('  --tool             AI tool for agent-commander read-only mode (claude, codex, opencode, agent, qwen, gemini) [default: claude]');
  console.log('  --model, -m        Model to use');
  console.log('  --isolation        agent-commander isolation mode [default: screen]');
  console.log('  --dry-run          Print split output without creating GitHub issues');
  console.log('  --verbose, -v      Enable verbose logging');
  console.log('  --output-format    Output format (text or json) [default: text]');
  process.exit(earlyArgs.length === 0 ? 1 : 0);
}

let argv;
try {
  argv = parseTaskArguments(process.argv);
} catch (error) {
  console.error(error.message || String(error));
  process.exit(1);
}

// Initialize i18n based on --language (or detected system locale)
const { initI18n } = await import('./i18n.lib.mjs');
await initI18n(argv.language);

const taskInput = argv['task-input'] || argv.taskInput || argv._[0];
const selectedModel = argv.model || getDefaultTaskModel(argv.tool);
const modelValidation = validateModelName(selectedModel, argv.tool);
if (!modelValidation.valid) {
  console.error(modelValidation.message);
  process.exit(1);
}

const scriptDir = path.dirname(process.argv[1]);
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const logFile = path.join(scriptDir, `task-${timestamp}.log`);

async function log(message, options = {}) {
  const { level = 'info', verbose = false } = options;
  if (verbose && !argv.verbose) return;
  await fs.appendFile(logFile, `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}\n`).catch(() => {});
  if (level === 'error') console.error(message);
  else if (level === 'warning' || level === 'warn') console.warn(message);
  else console.log(message);
}

function formatAligned(icon, label, value, indent = 0) {
  const spaces = ' '.repeat(indent);
  const labelWidth = 25 - indent;
  return `${spaces}${icon} ${label.padEnd(labelWidth)} ${value || ''}`;
}

function runCommand(command, args, options = {}) {
  return new Promise(resolve => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
      ...options,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', data => {
      stdout += data.toString();
    });
    child.stderr.on('data', data => {
      stderr += data.toString();
    });
    child.on('error', error => {
      resolve({ code: 1, stdout, stderr: stderr || error.message });
    });
    child.on('close', code => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function commandOutput(command, args, options = {}) {
  const result = await runCommand(command, args, options);
  if (result.code !== 0) {
    const output = `${result.stderr || ''}${result.stdout || ''}`.trim();
    throw new Error(output || `${command} exited with code ${result.code}`);
  }
  return result.stdout.trim();
}

function buildScreenName(issue) {
  const base = issue ? `task-split-${issue.owner}-${issue.repo}-${issue.number}` : 'task-agent';
  return `${base}-${crypto.randomUUID().slice(0, 8)}`.replace(/[^A-Za-z0-9_.-]/g, '-');
}

async function runAgentPrompt(prompt, systemPrompt, issue = null) {
  const startAgent = await resolveStartAgentCommand({ runCommand });
  if (!startAgent) {
    throw new Error('agent-commander start-agent binary not found. Run npm install so the agent-commander dependency is available, or install start-agent on PATH.');
  }

  const args = buildStartAgentArgs({
    tool: argv.tool,
    workingDirectory: process.cwd(),
    prompt,
    systemPrompt,
    model: selectedModel,
    isolation: argv.isolation,
    screenName: argv.isolation === 'screen' ? argv.screenName || buildScreenName(issue) : null,
    verbose: argv.verbose,
  });

  await log(`Running agent-commander with tool=${argv.tool}, model=${selectedModel}, isolation=${argv.isolation}, readOnly=true`, { verbose: true });
  const result = await runCommand(startAgent, args);
  const output = `${result.stdout || ''}${result.stderr ? `\n${result.stderr}` : ''}`.trim();
  if (result.code !== 0) {
    throw new Error(output || `start-agent exited with code ${result.code}`);
  }
  return output;
}

async function fetchIssue(issue) {
  const issueJson = await commandOutput('gh', ['issue', 'view', String(issue.number), '--repo', `${issue.owner}/${issue.repo}`, '--json', 'title,body,number,url,labels']);
  const data = JSON.parse(issueJson);
  return {
    owner: issue.owner,
    repo: issue.repo,
    number: data.number,
    url: data.url,
    title: data.title,
    body: data.body || '',
    labels: Array.isArray(data.labels) ? data.labels.map(label => label.name).filter(Boolean) : [],
  };
}

async function fetchIssueRestId(issue) {
  const id = Number(await commandOutput('gh', buildIssueRestIdApiArgs(issue)));
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`Could not resolve REST id for issue #${issue.number}`);
  }
  return id;
}

async function createChildIssue(parentIssue, task, index, splitCount) {
  const args = ['issue', 'create', '--repo', `${parentIssue.owner}/${parentIssue.repo}`, '--title', task.title, '--body', formatChildIssueBody({ parentIssue, task, index, splitCount })];
  if (parentIssue.labels.length > 0) {
    args.push('--label', parentIssue.labels.join(','));
  }

  const url = await commandOutput('gh', args);
  const parsed = parseCreatedIssueUrl(url);
  const restId = await fetchIssueRestId(parsed);
  return {
    owner: parsed.owner,
    repo: parsed.repo,
    number: parsed.number,
    restId,
    url,
    title: task.title,
  };
}

async function linkChildIssue(parentIssue, childIssue) {
  await commandOutput('gh', buildAddSubIssueApiArgs({ parentIssue, subIssueId: childIssue.restId }));
}

async function updateParentIssue(parentIssue, childIssues) {
  const body = appendOrReplaceParentSplitSection(parentIssue.body, childIssues);
  await commandOutput('gh', ['issue', 'edit', String(parentIssue.number), '--repo', `${parentIssue.owner}/${parentIssue.repo}`, '--body', body]);
  const childList = childIssues.map(issue => `- #${issue.number} ${issue.title}`).join('\n');
  await commandOutput('gh', ['issue', 'comment', String(parentIssue.number), '--repo', `${parentIssue.owner}/${parentIssue.repo}`, '--body', `Split into ${childIssues.length} tasks:\n\n${childList}`]);
}

async function runSplitMode() {
  const parsedIssue = parseTaskIssueUrl(taskInput);
  if (!parsedIssue.valid) {
    throw new Error(parsedIssue.error || 'Invalid GitHub issue URL');
  }

  const parentIssue = await fetchIssue(parsedIssue);
  const prompt = buildTaskSplitPrompt({ issue: parentIssue, splitCount: argv.splitCount });
  const output = await runAgentPrompt(prompt, buildTaskSplitSystemPrompt(), parentIssue);
  const tasks = normalizeSplitTasks(extractTaskSplitJson(output), argv.splitCount);

  if (argv.dryRun) {
    return {
      parentIssue,
      tasks,
      createdIssues: [],
      dryRun: true,
    };
  }

  const createdIssues = [];
  for (let i = 0; i < tasks.length; i++) {
    createdIssues.push(await createChildIssue(parentIssue, tasks[i], i, tasks.length));
  }
  for (const childIssue of createdIssues) {
    await linkChildIssue(parentIssue, childIssue);
  }
  await updateParentIssue(parentIssue, createdIssues);

  return {
    parentIssue,
    tasks,
    createdIssues,
    dryRun: false,
  };
}

async function runClarifyOrDecomposeMode() {
  const results = {
    task: taskInput,
    timestamp: new Date().toISOString(),
    clarification: null,
    decomposition: null,
  };

  if (argv.clarify) {
    const prompt = `Task: "${taskInput}"

Please help clarify this task by:
1. Identifying ambiguous aspects of the task
2. Asking 3-5 specific clarifying questions
3. Suggesting assumptions that could be made if these questions are not answered
4. Identifying missing context or requirements`;
    results.clarification = await runAgentPrompt(prompt, 'Return a concise clarification analysis. Do not modify files or run commands.');
  }

  if (argv.decompose) {
    const prompt = `Task: "${taskInput}"

${results.clarification ? `Clarification analysis:\n${results.clarification}\n\n` : ''}Please decompose this task into actionable subtasks with dependencies, complexity, risks, and success criteria.`;
    results.decomposition = await runAgentPrompt(prompt, 'Return a concise decomposition. Do not modify files or run commands.');
  }

  return results;
}

try {
  await fs.writeFile(logFile, `# Task Log - ${new Date().toISOString()}\n\n`);
  await log(`📁 Log file: ${logFile}`);
  await log('\n🎯 Task Processing Started');
  await log(formatAligned('📝', 'Task input:', taskInput));
  await log(formatAligned('🛠', 'Tool:', argv.tool));
  await log(formatAligned('🤖', 'Model:', selectedModel));
  await log(formatAligned('🔒', 'Isolation:', argv.isolation));
  await log(formatAligned('✂️', 'Split mode:', argv.split ? `enabled (count: ${argv.splitCount})` : 'disabled'));

  const result = argv.split ? await runSplitMode() : await runClarifyOrDecomposeMode();

  if (argv.outputFormat === 'json') {
    console.log(JSON.stringify(result, null, 2));
  } else if (argv.split) {
    if (result.dryRun) {
      console.log('\nPlanned split issues:');
      result.tasks.forEach((task, index) => console.log(`${index + 1}. ${task.title}`));
    } else {
      console.log('\nCreated split issues:');
      result.createdIssues.forEach(issue => console.log(`- #${issue.number} ${issue.url}`));
    }
  } else {
    if (result.clarification) console.log(`\nClarification Results:\n${result.clarification}`);
    if (result.decomposition) console.log(`\nDecomposition Results:\n${result.decomposition}`);
  }

  await log('\n🎉 Task processing completed successfully');
} catch (error) {
  await log(`❌ Error processing task: ${error.message}`, { level: 'error' });
  process.exit(1);
}
