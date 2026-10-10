// Exercise the production Codex adapter without an LLM, GitHub writes or unbounded work.
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { $ } from 'command-stream';
import { executeCodexCommand } from '../../src/codex.lib.mjs';
import { resetRepeatedToolCallState } from '../../src/tool-call-loop-guard.lib.mjs';

const directory = await mkdtemp(join(tmpdir(), 'codex-cancellation-2324-'));
const binary = join(directory, 'codex-fixture.mjs');
const prompt = 'finite cancellation probe | prompt data';
const inputFile = join(directory, 'input.txt');
const children = [];
const messages = [];
const previousStateDir = process.env.HIVE_MIND_STATE_DIR;
process.env.HIVE_MIND_STATE_DIR = join(directory, 'state');
try {
  await writeFile(
    binary,
    `#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
if (process.argv[2] === 'debug' && process.argv[3] === 'models') {
  console.log(JSON.stringify({models:[{slug:'gpt-5',supported_reasoning_levels:[{effort:'none'},{effort:'high'}]}]}));
  process.exit(0);
}
writeFileSync(${JSON.stringify(inputFile)}, readFileSync(0));
let calls = 0;
const timer = setInterval(() => {
  calls++;
  console.log(JSON.stringify({type:'item.completed', item:{id:'item_'+calls,type:'command_execution',command:'echo fixture',aggregated_output:'fixture',exit_code:0,status:'completed'}}));
  if (calls === 40) clearInterval(timer);
}, 50);
`,
    { mode: 0o755 }
  );
  resetRepeatedToolCallState();
  const trackedShell =
    options =>
    (strings, ...values) => {
      const runner = $(options)(strings, ...values);
      const stream = runner.stream.bind(runner);
      runner.stream = async function* () {
        for await (const chunk of stream()) {
          for (const child of process._getActiveHandles().filter(handle => handle?.constructor?.name === 'ChildProcess' && handle.spawnargs?.some(arg => String(arg).includes(binary)))) {
            if (!children.includes(child)) children.push(child);
          }
          yield chunk;
        }
      };
      return runner;
    };
  const result = await executeCodexCommand({
    tempDir: directory,
    branchName: 'fixture',
    prompt,
    systemPrompt: '',
    // The breaker is opt-in since #2395; the probe enables it explicitly.
    argv: { model: 'gpt-5', verbose: true, detectRepeatedToolCalls: true },
    codexPath: binary,
    $: trackedShell,
    formatAligned: (...parts) => parts.join(' '),
    log: async message => messages.push(message),
    // Keep the cancellation/input fixture independent of the host's cgroup budget.
    // Resource prompt composition is covered by codex-process-exit-2745.test.mjs.
    readCgroupMemory: () => null,
    getResourceSnapshot: async () => ({ memory: 'Memory\nfixture', load: 'fixture' }),
    calculatePricing: async () => null,
  });
  const observations = [];
  for (const delay of [0, 50, 500]) {
    await sleep(delay);
    for (const child of children) {
      let exists = true;
      try {
        process.kill(child.pid, 0);
      } catch (error) {
        if (error.code === 'ESRCH') exists = false;
        else throw error;
      }
      observations.push({ delay, exists, activeHandle: process._getActiveHandles().includes(child), exitCode: child.exitCode, signalCode: child.signalCode, killed: child.killed });
    }
  }
  const input = await readFile(inputFile, 'utf8');
  console.log(JSON.stringify({ success: result.success, input, breaker: messages.find(message => String(message).includes('Repeated-tool-call breaker')), observations }, null, 2));
  if (input !== prompt || !observations.length || observations.some(observation => observation.delay === 500 && observation.exists)) process.exitCode = 1;
} finally {
  if (previousStateDir === undefined) delete process.env.HIVE_MIND_STATE_DIR;
  else process.env.HIVE_MIND_STATE_DIR = previousStateDir;
  await rm(directory, { recursive: true, force: true });
  resetRepeatedToolCallState();
}
