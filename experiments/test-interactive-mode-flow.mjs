#!/usr/bin/env node
/**
 * Test the interactive mode flow to verify the fix for tool use comment merging.
 * This simulates the actual event flow that Claude CLI produces.
 */

import { createInteractiveHandler } from '../src/interactive-mode.lib.mjs';

// Mock the command-stream $ function
const createdComments = [];
const editedComments = [];
let nextCommentId = 1000000;

const mock$ = async (strings, ...values) => {
  // Build the command string
  let command = strings[0];
  for (let i = 0; i < values.length; i++) {
    command += values[i] + strings[i + 1];
  }

  const commandPreview = command.substring(0, 80).replace(/\n/g, ' ') + '...';

  if (command.includes('gh pr comment')) {
    // Simulate posting a comment
    const commentId = nextCommentId++;
    createdComments.push({ id: commentId, body: command });
    console.log(`📤 POSTING comment #${commentId}: ${commandPreview}`);

    return {
      stdout: `https://github.com/test/repo/pull/1#issuecomment-${commentId}\n`,
      stderr: '',
      code: 0
    };
  } else if (command.includes('gh api') && command.includes('-X PATCH')) {
    // Extract comment ID from the command
    const match = command.match(/comments\/(\d+)/);
    const commentId = match ? match[1] : 'unknown';
    editedComments.push({ id: commentId, body: command });
    console.log(`✏️ EDITING comment #${commentId}`);
    return { stdout: '', stderr: '', code: 0 };
  }

  return { stdout: '', stderr: '', code: 0 };
};

const mockLog = async (msg) => {
  console.log(`📝 [LOG] ${msg}`);
};

async function simulateFlow() {
  console.log('=== Testing Interactive Mode Fix ===\n');
  console.log('This test simulates rapid Claude events to verify tool use/result merging.\n');

  const handler = createInteractiveHandler({
    owner: 'test',
    repo: 'repo',
    prNumber: 1,
    $: mock$,
    log: mockLog,
    verbose: true
  });

  // Simulate Claude events with minimal delays (like real production)
  console.log('--- Event 1: System init ---');
  await handler.processEvent({
    type: 'system',
    subtype: 'init',
    session_id: 'test-session-123',
    model: 'claude-sonnet-4-5',
    claude_code_version: '2.0.59',
    permissionMode: 'default',
    cwd: '/test',
    tools: ['Bash', 'Read', 'Write'],
    mcp_servers: [],
    slash_commands: [],
    agents: []
  });

  console.log('\n--- Event 2: Assistant text (immediate) ---');
  await handler.processEvent({
    type: 'assistant',
    message: {
      content: [{ type: 'text', text: "I'll help you with that. Let me start by running a command." }]
    }
  });

  console.log('\n--- Event 3: Tool use - Bash (immediate) ---');
  await handler.processEvent({
    type: 'assistant',
    message: {
      content: [{
        type: 'tool_use',
        id: 'toolu_test123',
        name: 'Bash',
        input: { command: 'echo hello' }
      }]
    }
  });

  // Check state before tool result
  console.log('\n--- State check before tool result ---');
  const stateBefore = handler.getState();
  console.log(`pendingToolCalls size: ${stateBefore.pendingToolCalls.size}`);
  console.log(`pendingToolCalls keys: ${[...stateBefore.pendingToolCalls.keys()]}`);
  const pending = stateBefore.pendingToolCalls.get('toolu_test123');
  if (pending) {
    console.log(`  commentId: ${pending.commentId}`);
    console.log(`  has commentIdPromise: ${!!pending.commentIdPromise}`);
  }

  console.log('\n--- Event 4: Tool result (immediate) ---');
  await handler.processEvent({
    type: 'user',
    message: {
      content: [{
        type: 'tool_result',
        tool_use_id: 'toolu_test123',
        content: 'hello\n',
        is_error: false
      }]
    }
  });

  // Final state
  console.log('\n=== Final Summary ===');
  const finalState = handler.getState();
  console.log(`Total comments created: ${createdComments.length}`);
  console.log(`Total comments edited: ${editedComments.length}`);
  console.log(`pendingToolCalls remaining: ${finalState.pendingToolCalls.size}`);

  console.log('\n--- Analysis ---');
  if (editedComments.length > 0) {
    console.log('✅ SUCCESS: Tool result was merged by editing the tool use comment!');
    console.log(`   Edited comment ID: ${editedComments[0].id}`);
  } else if (createdComments.length === 4) {
    console.log('❌ FAILED: Tool result was posted as a separate comment (not merged)');
  } else {
    console.log(`⚠️ Unexpected result: ${createdComments.length} comments created, ${editedComments.length} edited`);
  }

  // Show what was posted
  console.log('\n--- Comment sequence ---');
  createdComments.forEach((c, i) => {
    const title = c.body.match(/## [^\n]+/)?.[0] || 'Unknown';
    console.log(`${i + 1}. Comment #${c.id}: ${title}`);
  });
  editedComments.forEach((c, i) => {
    console.log(`E${i + 1}. Edited #${c.id}`);
  });
}

simulateFlow().catch(console.error);
