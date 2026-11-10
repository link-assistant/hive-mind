/** Offline, bounded Claude stream replay used by the issue 3759 regressions. */
import fs from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

process.env.HIVE_MIND_MAX_TRANSIENT_ERROR_RETRIES = '1';
process.env.HIVE_MIND_INITIAL_TRANSIENT_ERROR_DELAY_MS = '1';
process.env.HIVE_MIND_MAX_TRANSIENT_ERROR_DELAY_MS = '1';
process.env.HIVE_MIND_RETRY_BACKOFF_MULTIPLIER = '1';
process.env.HIVE_MIND_RESULT_STREAM_CLOSE_MS = '1000';
process.env.HIVE_MIND_STREAM_ACTIVITY_MS = '0';
process.env.HIVE_MIND_STREAM_STARTUP_MS = '5000';

globalThis.use = async name => {
  const packageName = name.replace(/@\d[^/]*$/, '');
  if (packageName === 'command-stream') return { $: () => ({ stream: async function* noopStream() {} }) };
  if (packageName === 'fs') return { ...fs, default: fs };
  if (packageName === 'os') return { ...os, default: os };
  if (packageName === 'path') return { ...path, default: path };
  if (packageName === 'getenv') return (key, fallback) => process.env[key] ?? fallback;
  return import(packageName);
};

const { executeClaudeCommand } = await import('../../src/claude.lib.mjs');
const { resetCumulativeAnthropicCost } = await import('../../src/anthropic-cost-accumulator.lib.mjs');

export const SESSION_ID = '84101e53-d3a4-4b69-a82a-b20b2819f791';

async function writeTranscript(homeDir, tempDir, lines) {
  const dir = path.join(homeDir, '.claude', 'projects', tempDir.replace(/\//g, '-'));
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${SESSION_ID}.jsonl`), lines.join('\n') + '\n');
}

export async function replay({ events = [], rawLines = [], transcript = null, exitCode = 1, newline = true, stderr = false }) {
  resetCumulativeAnthropicCost();
  const root = await mkdtemp(path.join(os.tmpdir(), 'hive-mind-3759-'));
  const tempDir = path.join(root, 'repo');
  const homeDir = path.join(root, 'home');
  await mkdir(tempDir, { recursive: true });
  if (transcript) await writeTranscript(homeDir, tempDir, transcript);
  const previous = { CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR };
  process.env.CLAUDE_CONFIG_DIR = path.join(homeDir, '.claude');
  let logFile = path.join(root, 'current.log');
  await writeFile(logFile, '');
  const logs = [];
  let calls = 0;
  const fakeDollar = () => () => {
    calls++;
    const output = [...events.map(event => JSON.stringify(event)), ...rawLines].join('\n') + (newline ? '\n' : '');
    return {
      result: { code: exitCode },
      kill() {},
      async *stream() {
        for (let offset = 0; offset < output.length; offset += 73) yield { type: stderr ? 'stderr' : 'stdout', data: Buffer.from(output.slice(offset, offset + 73)) };
        yield { type: 'exit', code: exitCode };
      },
    };
  };
  try {
    const result = await executeClaudeCommand({
      tempDir,
      branchName: 'issue-3759-test',
      prompt: 'Continue.',
      systemPrompt: 'Solve the issue.',
      argv: { model: 'opus', tool: 'claude', url: 'https://github.com/konard/konard.github.io/issues/7', verbose: true, fallbackModel: null, disable1mContext: false, uselessToolsDisabled: false },
      log: async message => logs.push(String(message)),
      getLogFile: () => logFile,
      setLogFile: value => {
        logFile = value;
      },
      formatAligned: (_icon, label, value = '') => `${label} ${value}`.trim(),
      getResourceSnapshot: async () => ({ memory: 'Mem:\nMemAvailable: 1 GB', load: '0.00' }),
      forkedRepo: null,
      feedbackLines: [],
      claudePath: 'claude',
      $: fakeDollar,
      owner: 'konard',
      repo: 'konard.github.io',
      prNumber: 8,
      issueNumber: 7,
    });
    return { result, logs, calls };
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
}
