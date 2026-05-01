#!/usr/bin/env node
// Experiment: Test if command-stream can stream Claude CLI output in real-time
// This reproduces the setup used in claude.lib.mjs to check for stuck streaming

if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}
const { $ } = await use('command-stream');

const claudePath = '/workspace/.bun/bin/claude';
const prompt = 'Say "Hello, world!" and nothing else.';
const systemPrompt = 'You are a helpful assistant. Respond briefly.';

console.log('[test] Starting Claude CLI with command-stream...');
console.log(`[test] Time: ${new Date().toISOString()}`);

const execCommand = $({
  cwd: '/tmp',
  stdin: prompt,
  mirror: false,
  env: {
    ...process.env,
    CLAUDE_CODE_MAX_OUTPUT_TOKENS: '1024',
  },
})`${claudePath} --output-format stream-json --verbose --dangerously-skip-permissions --model claude-haiku-4-5-20251001 --append-system-prompt "${systemPrompt}"`;

console.log('[test] Waiting for stream chunks...');

let chunkCount = 0;
const startTime = Date.now();

// Set a timeout to detect stuck behavior
const timeout = setTimeout(() => {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[test] TIMEOUT after ${elapsed}s - stream appears stuck!`);
  console.log(`[test] Chunks received so far: ${chunkCount}`);
  if (execCommand.kill) {
    execCommand.kill('SIGTERM');
  }
  process.exit(1);
}, 60000); // 60 second timeout

try {
  for await (const chunk of execCommand.stream()) {
    chunkCount++;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    if (chunk.type === 'stdout') {
      const output = chunk.data.toString();
      const lines = output.split('\n').filter(l => l.trim());
      for (const line of lines) {
        try {
          const data = JSON.parse(line);
          console.log(`[test] [${elapsed}s] stdout chunk #${chunkCount}: type=${data.type}, subtype=${data.subtype || 'n/a'}`);
          if (data.type === 'system' && data.subtype === 'init') {
            console.log(`[test] Session ID: ${data.session_id}`);
          }
          if (data.type === 'result') {
            console.log(`[test] Result received! Success: ${data.subtype === 'success'}`);
          }
        } catch {
          console.log(`[test] [${elapsed}s] stdout raw: ${line.slice(0, 100)}`);
        }
      }
    } else if (chunk.type === 'stderr') {
      const err = chunk.data.toString().trim();
      if (err) {
        console.log(`[test] [${elapsed}s] stderr: ${err.slice(0, 200)}`);
      }
    } else if (chunk.type === 'exit') {
      console.log(`[test] [${elapsed}s] exit: code=${chunk.code}`);
    }
  }
} catch (e) {
  console.log(`[test] Error: ${e.message}`);
}

clearTimeout(timeout);
const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
console.log(`[test] Done. Total chunks: ${chunkCount}, elapsed: ${totalElapsed}s`);
process.exit(0);
