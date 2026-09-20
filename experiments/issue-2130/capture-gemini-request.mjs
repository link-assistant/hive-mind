#!/usr/bin/env node
/**
 * Issue #2130 — capture the exact request the gemini CLI sends to Formal AI.
 *
 * Builds the real runtime (so gemini's settings/auth are valid), then puts
 * proxy-capture.mjs between the CLI and the server by rewriting the base URL.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { prepareFormalAiRuntime } from '../../src/formal-ai-runtime.lib.mjs';

const PROMPT = process.env.HIVE_E2E_PROMPT || 'Write a hello world program in Python.';
const CAPTURE = process.env.HIVE_CAPTURE_FILE || '/tmp/gemini-capture.txt';
const PROXY_PORT = Number(process.env.HIVE_PROXY_PORT || 8141);

const workdir = await mkdtemp(join(tmpdir(), 'hive-2130-capture-'));
await writeFile(join(workdir, 'README.md'), '# scratch workspace\n');
const runtime = await prepareFormalAiRuntime({ tool: 'gemini', workdir, verbose: true, log: async message => console.log(`[gemini] ${message}`) });

const proxy = spawn(process.execPath, [join(import.meta.dirname, 'proxy-capture.mjs'), String(PROXY_PORT), runtime.baseUrl, CAPTURE], { stdio: 'inherit' });
await new Promise(resolve => setTimeout(resolve, 500));

const env = { ...process.env, PWD: workdir, ...runtime.env };
// Send gemini through the recorder instead of straight at the server.
env.GOOGLE_GEMINI_BASE_URL = `http://127.0.0.1:${PROXY_PORT}/api/gemini`;

const child = spawn('gemini', ['--output-format', 'stream-json', '--model', 'formal-ai', '--approval-mode', 'yolo', '--skip-trust', '-p', PROMPT], { cwd: workdir, env, stdio: ['ignore', 'inherit', 'inherit'] });
const code = await new Promise(resolve => child.on('close', resolve));
console.log(`[gemini] exit=${code}`);

proxy.kill();
await runtime.stop?.();
await rm(workdir, { recursive: true, force: true });
