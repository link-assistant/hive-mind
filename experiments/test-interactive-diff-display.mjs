#!/usr/bin/env node
/**
 * Test script to verify diff code block formatting in interactive mode
 * This tests the changes made for issue #869
 */

import { createInteractiveHandler } from '../src/interactive-mode.lib.mjs';

// Mock command-stream $ function that doesn't actually post to GitHub
const mockDollar = async (strings, ...values) => {
  const command = String.raw(strings, ...values);
  console.log(`[MOCK] Would execute: ${command}`);
  return {
    stdout: Buffer.from('https://github.com/owner/repo/pull/123#issuecomment-9999999'),
    toString: () => 'https://github.com/owner/repo/pull/123#issuecomment-9999999'
  };
};

// Mock log function
const mockLog = async (message, options = {}) => {
  if (options.verbose) {
    console.log(`[LOG] ${message}`);
  }
};

// Create handler with mock functions
const handler = createInteractiveHandler({
  owner: 'test-owner',
  repo: 'test-repo',
  prNumber: 123,
  $: mockDollar,
  log: mockLog,
  verbose: true
});

console.log('='.repeat(80));
console.log('Testing Write tool with diff formatting');
console.log('='.repeat(80));

// Test 1: Write tool event
const writeToolEvent = {
  type: 'assistant',
  message: {
    content: [
      {
        type: 'tool_use',
        id: 'write_test_001',
        name: 'Write',
        input: {
          file_path: '/tmp/test-file.js',
          content: `function hello() {\n  console.log('Hello, world!');\n  return 'success';\n}`
        }
      }
    ]
  }
};

await handler.processEvent(writeToolEvent);

console.log('\n' + '='.repeat(80));
console.log('Testing Edit tool with diff formatting');
console.log('='.repeat(80));

// Test 2: Edit tool event
const editToolEvent = {
  type: 'assistant',
  message: {
    content: [
      {
        type: 'tool_use',
        id: 'edit_test_001',
        name: 'Edit',
        input: {
          file_path: '/tmp/test-file.js',
          old_string: `function hello() {\n  console.log('Hello, world!');\n}`,
          new_string: `function hello() {\n  console.log('Hello, universe!');\n  return 'success';\n}`
        }
      }
    ]
  }
};

await handler.processEvent(editToolEvent);

console.log('\n' + '='.repeat(80));
console.log('Testing multi-line Write tool with diff formatting');
console.log('='.repeat(80));

// Test 3: Multi-line Write tool event
const multiLineWriteEvent = {
  type: 'assistant',
  message: {
    content: [
      {
        type: 'tool_use',
        id: 'write_test_002',
        name: 'Write',
        input: {
          file_path: '/tmp/config.json',
          content: `{\n  "name": "test-project",\n  "version": "1.0.0",\n  "description": "A test project",\n  "main": "index.js"\n}`
        }
      }
    ]
  }
};

await handler.processEvent(multiLineWriteEvent);

console.log('\n' + '='.repeat(80));
console.log('All tests completed!');
console.log('='.repeat(80));

// Display state for debugging
const state = handler.getState();
console.log('\nHandler state:');
console.log(`- Tool use count: ${state.toolUseCount}`);
console.log(`- Pending tool calls: ${state.pendingToolCalls.size}`);
console.log(`- Comment queue length: ${state.commentQueue.length}`);
