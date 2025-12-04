#!/usr/bin/env node
/**
 * Experiment 08: True Bidirectional Streaming Test
 *
 * This experiment tests if we can send a new user message WHILE Claude is
 * actively streaming a response. The key question is:
 * - Can we interrupt an ongoing response with a new message?
 * - Or does Claude wait for the response to complete before processing new input?
 */

import { spawn } from 'child_process';

console.log("=== Experiment 08: True Bidirectional Streaming Test ===");
console.log("Testing if we can send input WHILE output is being streamed");
console.log("");

const claude = spawn('claude', [
  '-p',
  '--output-format=stream-json',
  '--input-format=stream-json',
  '--include-partial-messages',
  '--replay-user-messages',
  '--verbose',
  '--dangerously-skip-permissions'
], {
  stdio: ['pipe', 'pipe', 'pipe']
});

let streamEventCount = 0;
let messageSentDuringStream = false;
let contentDeltasBeforeInterrupt = 0;
let contentDeltasAfterInterrupt = 0;
let interruptSent = false;

// Handle stdout
claude.stdout.on('data', (data) => {
  const lines = data.toString().split('\n').filter(l => l.trim());

  lines.forEach(line => {
    try {
      const json = JSON.parse(line);
      streamEventCount++;

      // Check for content_block_delta (streaming text)
      if (json.type === 'stream_event' && json.event?.type === 'content_block_delta') {
        if (!interruptSent) {
          contentDeltasBeforeInterrupt++;
        } else {
          contentDeltasAfterInterrupt++;
        }

        const text = json.event?.delta?.text || '';
        console.log(`[DELTA ${streamEventCount}]: "${text.substring(0, 30)}..."`);

        // After seeing some content, try to interrupt
        if (contentDeltasBeforeInterrupt === 2 && !interruptSent) {
          console.log("\n>>> SENDING INTERRUPT MESSAGE NOW <<<\n");
          sendMessage("STOP! I have a new question: What is 3+3?");
          interruptSent = true;
          messageSentDuringStream = true;
        }
      }

      // Check for user message replay (our interrupt being acknowledged)
      if (json.type === 'user' && json.isReplay) {
        console.log(`[USER MESSAGE REPLAYED]: ${JSON.stringify(json.message?.content).substring(0, 50)}...`);
      }

      // Check for result (turn complete)
      if (json.type === 'result') {
        console.log(`[TURN COMPLETE] num_turns: ${json.num_turns}`);
      }

    } catch (e) {
      // Not JSON, just log it
      console.log(`[RAW]: ${line.substring(0, 50)}`);
    }
  });
});

claude.stderr.on('data', (data) => {
  console.log('[STDERR]:', data.toString().substring(0, 100));
});

claude.on('close', (code) => {
  console.log(`\n[EXIT] Process exited with code ${code}`);
  console.log("\n=== ANALYSIS ===");
  console.log(`Total stream events: ${streamEventCount}`);
  console.log(`Content deltas before interrupt: ${contentDeltasBeforeInterrupt}`);
  console.log(`Content deltas after interrupt: ${contentDeltasAfterInterrupt}`);
  console.log(`Interrupt sent during stream: ${messageSentDuringStream}`);

  if (contentDeltasAfterInterrupt > 0 && messageSentDuringStream) {
    console.log("\n>>> FINDING: Claude continued streaming after interrupt was sent.");
    console.log(">>> This suggests the interrupt is QUEUED, not immediately processed.");
  }

  console.log("\n=== Test Complete ===");
});

function sendMessage(text) {
  const message = JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content: [{ type: "text", text }]
    }
  });
  claude.stdin.write(message + '\n');
}

// Send initial prompt that will generate a longer response
sendMessage("Write a short poem about the ocean. Make it at least 8 lines long.");

// Set timeouts
setTimeout(() => {
  console.log('[INFO] Closing stdin after timeout');
  claude.stdin.end();
}, 20000);

setTimeout(() => {
  console.log('[TIMEOUT] Force ending test');
  claude.kill('SIGTERM');
}, 45000);
