#!/usr/bin/env node

/**
 * Issue #2130 end-to-end check: drive each native CLI against a real
 * `formal-ai serve --agent-mode` through `prepareFormalAiRuntime`, using the
 * exact argument list `src/<tool>.lib.mjs` builds for a hello-world task.
 *
 * Usage: node experiments/issue-2130/e2e-direct-endpoint.mjs claude agent codex qwen gemini opencode
 */

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { prepareFormalAiRuntime } from '../../src/formal-ai-runtime.lib.mjs';

const PROMPT = process.env.HIVE_E2E_PROMPT || 'Create a file named hello.txt in the current directory whose entire content is the single line: Hello World. Then stop.';

const run = (command, args, { cwd, env, stdin = null, timeoutMs = 240_000 }) =>
  new Promise(resolve => {
    const child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', chunk => (stdout += chunk.toString()));
    child.stderr.on('data', chunk => (stderr += chunk.toString()));
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
    if (stdin !== null) child.stdin.end(stdin);
    else child.stdin.end();
  });

const ARGS_BY_TOOL = {
  claude: () => ({ args: ['--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions', '--model', 'formal-ai', '-p'], stdin: PROMPT }),
  agent: () => ({ args: ['--model', 'formalai/formal-ai'], stdin: PROMPT }),
  opencode: () => ({ args: ['run', '--format', 'json', '--model', 'formalai/formal-ai'], stdin: PROMPT }),
  codex: () => ({ args: ['exec', '--json', '--dangerously-bypass-approvals-and-sandbox', '--model', 'formal-ai', '-'], stdin: PROMPT }),
  qwen: () => ({ args: ['--yolo', '--model', 'formal-ai', '-p', PROMPT], stdin: null }),
  gemini: () => ({ args: ['--output-format', 'stream-json', '--model', 'formal-ai', '--approval-mode', 'yolo', '--skip-trust', '-p', PROMPT], stdin: null }),
};

const tools = process.argv.slice(2).filter(tool => ARGS_BY_TOOL[tool]);
if (!tools.length) {
  console.error(`usage: node ${process.argv[1]} <${Object.keys(ARGS_BY_TOOL).join('|')}>...`);
  process.exit(2);
}

const results = [];
for (const tool of tools) {
  const workdir = await mkdtemp(join(tmpdir(), `hive-2130-e2e-${tool}-`));
  await writeFile(join(workdir, 'README.md'), '# scratch workspace\n');
  let runtime = null;
  const started = Date.now();
  try {
    runtime = await prepareFormalAiRuntime({ tool, workdir, verbose: true, log: async message => console.log(`[${tool}] ${message}`) });
    console.log(`[${tool}] baseUrl=${runtime.baseUrl} env=${Object.keys(runtime.env).sort().join(',')}`);
    console.log(`[${tool}] notes=${runtime.notes.join(' | ')}`);

    const { args, stdin } = ARGS_BY_TOOL[tool]();
    const result = await run(tool, args, { cwd: workdir, env: { ...process.env, ...runtime.env }, stdin });
    const helloPath = join(workdir, 'hello.txt');
    const created = existsSync(helloPath);
    const content = created ? await readFile(helloPath, 'utf8') : null;
    const logPath = join('experiments/issue-2130', `e2e-${tool}.log`);
    await writeFile(logPath, `# exit=${result.code} signal=${result.signal}\n## stdout\n${result.stdout}\n## stderr\n${result.stderr}\n`);
    results.push({ tool, exit: result.code, signal: result.signal, created, content, seconds: Math.round((Date.now() - started) / 1000), log: logPath });
    console.log(`[${tool}] exit=${result.code} hello.txt=${created ? JSON.stringify(content) : 'MISSING'} (${logPath})`);
  } catch (error) {
    results.push({ tool, error: error.message, seconds: Math.round((Date.now() - started) / 1000) });
    console.log(`[${tool}] FAILED: ${error.message}`);
  } finally {
    await runtime?.stop?.();
    await rm(workdir, { recursive: true, force: true });
  }
}

console.log('\n=== summary ===');
for (const result of results) console.log(JSON.stringify(result));
