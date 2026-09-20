#!/usr/bin/env node
/**
 * Issue #2130 — does `agent --interactive` exit when a piped stdin closes?
 *
 * Formal AI's wrapper injects `--interactive` into headless, piped invocations
 * (see docs/case-studies/issue-2130/data/runs/wrapper-argv.log). Hive Mind's
 * round-2 `agent` run then never terminated and exhausted all 5 auto-restarts.
 * This measures the two shapes against a real Formal AI server.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { prepareFormalAiRuntime } from '../../src/formal-ai-runtime.lib.mjs';

const PROMPT = 'Reply with the single word: ok';
const TIMEOUT_MS = 45_000;

const workdir = await mkdtemp(join(tmpdir(), 'hive-2130-agent-'));
await writeFile(join(workdir, 'README.md'), '# scratch workspace\n');
const runtime = await prepareFormalAiRuntime({ tool: 'agent', workdir, verbose: false, log: async () => {} });

const attempt = async (label, extraArgs) => {
  const args = ['--model', 'formalai/formal-ai', ...extraArgs];
  const started = Date.now();
  const child = spawn('agent', args, { cwd: workdir, env: { ...process.env, PWD: workdir, ...runtime.env }, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  child.stdout.on('data', chunk => (stdout += chunk.toString()));
  child.stderr.on('data', () => {});
  // Write the prompt and close stdin — the caller has nothing more to send.
  child.stdin.end(`${PROMPT}\n`);
  const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS);
  const code = await new Promise(resolve => child.on('close', resolve));
  clearTimeout(timer);
  const seconds = Math.round((Date.now() - started) / 1000);
  const timedOut = code === null || seconds >= Math.floor(TIMEOUT_MS / 1000);
  console.log(`  ${label.padEnd(46)} exit=${String(code).padEnd(6)} ${seconds}s ${timedOut ? 'NEVER EXITED (killed)' : 'exited on its own'} stdout=${stdout.length}B`);
};

console.log(
  `agent ${await new Promise(r => {
    const c = spawn('agent', ['--version']);
    let s = '';
    c.stdout.on('data', d => (s += d));
    c.on('close', () => r(s.trim()));
  })}`
);
console.log('piped stdin, closed immediately after the prompt:');
await attempt('args as Hive Mind sends them', []);
await attempt('+ --interactive (what Formal AI injects)', ['--interactive']);

await runtime.stop?.();
await rm(workdir, { recursive: true, force: true });
