#!/usr/bin/env node
/**
 * Experiment 03: Bidirectional streaming test
 *
 * This tests if we can send input to claude while simultaneously receiving output.
 * The goal is to determine if true bidirectional streaming is possible.
 */

import { spawn } from 'child_process';

console.log("=== Experiment 03: Bidirectional Streaming Test ===");
console.log("Testing if input can be sent while output is being received");
console.log("");

// Spawn claude with stream-json input/output
const claude = spawn('claude', [
  '-p',
  '--output-format=stream-json',
  '--input-format=stream-json',
  '--verbose',
  '--dangerously-skip-permissions'
], {
  stdio: ['pipe', 'pipe', 'pipe']
});

let outputBuffer = '';
let messagesSent = 0;
const maxMessages = 3;

// Handle stdout (Claude's output)
claude.stdout.on('data', (data) => {
  const text = data.toString();
  outputBuffer += text;
  console.log('[STDOUT]:', text.substring(0, 200));

  // Try sending another message while receiving output
  if (messagesSent < maxMessages) {
    setTimeout(() => {
      sendMessage(`Follow-up message ${messagesSent + 1}: Continue explaining`);
    }, 500);
  }
});

// Handle stderr
claude.stderr.on('data', (data) => {
  console.log('[STDERR]:', data.toString().substring(0, 200));
});

// Handle process exit
claude.on('close', (code) => {
  console.log(`\n[EXIT] Claude process exited with code ${code}`);
  console.log(`[STATS] Total messages sent: ${messagesSent}`);
  console.log("\n=== Test Complete ===");
});

claude.on('error', (err) => {
  console.error('[ERROR]:', err.message);
});

// Function to send a message to Claude
function sendMessage(text) {
  const message = JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content: [{ type: "text", text }]
    }
  });

  console.log(`[SENDING MESSAGE ${messagesSent + 1}]:`, text.substring(0, 50));
  claude.stdin.write(message + '\n');
  messagesSent++;
}

// Send initial message
sendMessage("What is 2+2? Please explain step by step.");

// Set a timeout to close stdin after some time
setTimeout(() => {
  console.log('[INFO] Closing stdin after timeout');
  claude.stdin.end();
}, 10000);

// Overall timeout
setTimeout(() => {
  console.log('[TIMEOUT] Force killing process');
  claude.kill('SIGTERM');
}, 30000);
