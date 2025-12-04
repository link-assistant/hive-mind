#!/usr/bin/env node
/**
 * Experiment 05: Concurrent I/O test
 *
 * This is a more rigorous test to determine if Claude truly supports
 * bidirectional streaming where we can send input WHILE receiving output,
 * not just sequentially.
 */

import { spawn } from 'child_process';

console.log("=== Experiment 05: Concurrent I/O Streaming Test ===");
console.log("Goal: Determine if input can be sent WHILE output is being generated");
console.log("");

const claude = spawn('claude', [
  '-p',
  '--output-format=stream-json',
  '--input-format=stream-json',
  '--replay-user-messages'
], {
  stdio: ['pipe', 'pipe', 'pipe']
});

let outputLines = [];
let inputCount = 0;
let outputCount = 0;
let receivingOutput = false;
let inputSentDuringOutput = false;

// Track when output starts
claude.stdout.on('data', (data) => {
  const lines = data.toString().split('\n').filter(l => l.trim());
  lines.forEach(line => {
    outputCount++;
    outputLines.push({
      timestamp: Date.now(),
      type: 'output',
      data: line.substring(0, 100)
    });
    console.log(`[OUT ${outputCount}]:`, line.substring(0, 80));

    // Mark that we're receiving output
    if (!receivingOutput) {
      receivingOutput = true;
      console.log('[INFO] Started receiving output - now testing if we can send input');

      // Try to send input while receiving output
      setTimeout(() => {
        if (receivingOutput) {
          inputSentDuringOutput = true;
          sendInput("INTERRUPT: This message sent while receiving output");
        }
      }, 100);
    }
  });
});

claude.stderr.on('data', (data) => {
  console.log('[STDERR]:', data.toString().substring(0, 100));
});

claude.on('close', (code) => {
  console.log(`\n[EXIT] Process exited with code ${code}`);
  console.log("\n=== ANALYSIS ===");
  console.log(`Total inputs sent: ${inputCount}`);
  console.log(`Total output lines received: ${outputCount}`);
  console.log(`Input sent during output: ${inputSentDuringOutput}`);

  // Analyze if concurrent I/O happened
  const inputs = outputLines.filter(l => l.type === 'input');
  const outputs = outputLines.filter(l => l.type === 'output');

  if (inputs.length > 1 && outputs.length > 0) {
    // Check if any input was sent between outputs
    console.log("\nConcurrency analysis: checking if inputs were interleaved with outputs...");
  }

  console.log("\n=== Test Complete ===");
});

function sendInput(text) {
  inputCount++;
  const message = JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content: [{ type: "text", text }]
    }
  });

  outputLines.push({
    timestamp: Date.now(),
    type: 'input',
    data: text.substring(0, 50)
  });

  console.log(`[IN ${inputCount}]:`, text.substring(0, 50));
  claude.stdin.write(message + '\n');
}

// Send initial prompt that will generate a longer response
sendInput("Please count from 1 to 20, saying each number on a new line with a brief pause between each.");

// Set timeout to end the test
setTimeout(() => {
  console.log('[INFO] Closing stdin');
  claude.stdin.end();
}, 15000);

setTimeout(() => {
  console.log('[TIMEOUT] Force ending test');
  claude.kill('SIGTERM');
}, 30000);
