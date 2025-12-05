#!/usr/bin/env node
/**
 * Test script for interactive-mode.lib.mjs
 *
 * This script tests the output formatting of the interactive mode handlers
 * without actually posting to GitHub. It simulates the JSON events and
 * prints the formatted markdown output.
 */

import { createInteractiveHandler, utils } from '../src/interactive-mode.lib.mjs';

// Mock $ function that just logs the command
const mock$ = (strings, ...values) => {
  console.log('\n📮 Would post comment to GitHub:');
  console.log('---');
  // The body is the last interpolated value
  const body = values[values.length - 1];
  console.log(body);
  console.log('---\n');
  return Promise.resolve();
};

// Mock log function
const mockLog = (msg, opts) => {
  if (opts?.verbose) {
    console.log(`[VERBOSE] ${msg}`);
  }
  return Promise.resolve();
};

// Create handler with mocks
const handler = createInteractiveHandler({
  owner: 'test-owner',
  repo: 'test-repo',
  prNumber: 123,
  $: mock$,
  log: mockLog,
  verbose: true
});

// Test data based on real JSON examples
const testEvents = [
  // 1. System init event
  {
    type: 'system',
    subtype: 'init',
    cwd: '/tmp/gh-issue-solver-1764803505742',
    session_id: 'faa32ca1-82fb-42ea-8e5b-04bbdfc74d25',
    tools: ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep', 'WebFetch', 'TodoWrite', 'Task']
  },

  // 2. Assistant text event
  {
    type: 'assistant',
    message: {
      model: 'claude-sonnet-4-5-20250929',
      id: 'msg_01GXv2id9iRP2AkB3A6ASNu9',
      type: 'message',
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: 'I\'ll start by reading the issue details and understanding the current state of the PR.\n\nLet me first check what changes need to be made.'
        }
      ],
      stop_reason: 'tool_use',
      usage: {
        input_tokens: 5234,
        output_tokens: 156,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 4500
      }
    }
  },

  // 3. Tool use event (Bash)
  {
    type: 'assistant',
    message: {
      model: 'claude-sonnet-4-5-20250929',
      id: 'msg_01ABC123',
      type: 'message',
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: 'toolu_01ABC123',
          name: 'Bash',
          input: {
            command: 'gh issue view https://github.com/link-assistant/hive-mind/issues/796'
          }
        }
      ],
      stop_reason: 'tool_use',
      usage: {
        input_tokens: 5234,
        output_tokens: 89
      }
    }
  },

  // 4. Tool result event
  {
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_01ABC123',
          content: 'title: Interactive mode\nstate: OPEN\nauthor: konard\nlabels: documentation, enhancement\ncomments: 0\nassignees:\nprojects:\nmilestone:\nnumber: 800\n--\nAdd option `--interactive-mode` for `solve` command...'
        }
      ]
    }
  },

  // 5. Tool use event (Read)
  {
    type: 'assistant',
    message: {
      model: 'claude-sonnet-4-5-20250929',
      id: 'msg_02DEF456',
      type: 'message',
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: 'toolu_02DEF456',
          name: 'Read',
          input: {
            file_path: '/tmp/gh-issue-solver/src/solve.config.lib.mjs',
            offset: 100,
            limit: 50
          }
        }
      ],
      stop_reason: 'tool_use',
      usage: {
        input_tokens: 1234,
        output_tokens: 45
      }
    }
  },

  // 6. Tool use event (Edit)
  {
    type: 'assistant',
    message: {
      model: 'claude-sonnet-4-5-20250929',
      id: 'msg_03GHI789',
      type: 'message',
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: 'toolu_03GHI789',
          name: 'Edit',
          input: {
            file_path: '/tmp/gh-issue-solver/src/interactive-mode.lib.mjs',
            old_string: 'const oldCode = true;',
            new_string: 'const newCode = false;\n// Updated code'
          }
        }
      ],
      stop_reason: 'tool_use',
      usage: {
        input_tokens: 2000,
        output_tokens: 100
      }
    }
  },

  // 7. Tool use event (TodoWrite)
  {
    type: 'assistant',
    message: {
      model: 'claude-sonnet-4-5-20250929',
      id: 'msg_04JKL012',
      type: 'message',
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: 'toolu_04JKL012',
          name: 'TodoWrite',
          input: {
            todos: [
              { content: 'Read issue details', status: 'completed' },
              { content: 'Implement handleSystemInit', status: 'completed' },
              { content: 'Implement handleAssistantText', status: 'in_progress' },
              { content: 'Implement handleToolUse', status: 'pending' },
              { content: 'Run tests', status: 'pending' },
              { content: 'Commit changes', status: 'pending' },
              { content: 'Push to remote', status: 'pending' }
            ]
          }
        }
      ],
      stop_reason: 'tool_use',
      usage: {
        input_tokens: 500,
        output_tokens: 80
      }
    }
  },

  // 8. Unrecognized event
  {
    type: 'custom_event',
    subtype: 'unknown',
    data: {
      foo: 'bar',
      baz: 123
    }
  },

  // 9. Result event (success)
  {
    type: 'result',
    subtype: 'success',
    is_error: false,
    duration_ms: 727021,
    duration_api_ms: 603394,
    num_turns: 68,
    result: 'Perfect! Let me create a final summary of what was accomplished:\n\n## Summary\n\nI\'ve successfully implemented the interactive mode feature...',
    session_id: 'faa32ca1-82fb-42ea-8e5b-04bbdfc74d25',
    total_cost_usd: 1.6043104499999998,
    usage: {
      input_tokens: 98000,
      output_tokens: 45678,
      cache_creation_input_tokens: 1234,
      cache_read_input_tokens: 56789
    }
  }
];

// Test utility functions
console.log('=== Testing Utility Functions ===\n');

// Test truncateMiddle
const longText = Array(100).fill('Line of text here').join('\n');
console.log('truncateMiddle (100 lines -> truncated):');
console.log(utils.truncateMiddle(longText, { maxLines: 30, keepStart: 10, keepEnd: 10 }).split('\n').length, 'lines');

// Test formatDuration
console.log('\nformatDuration:');
console.log('  727021ms =>', utils.formatDuration(727021));
console.log('  60000ms =>', utils.formatDuration(60000));
console.log('  3661000ms =>', utils.formatDuration(3661000));

// Test formatCost
console.log('\nformatCost:');
console.log('  1.6043 =>', utils.formatCost(1.6043));
console.log('  0.05 =>', utils.formatCost(0.05));

// Test createCollapsible
console.log('\ncreateCollapsible:');
console.log(utils.createCollapsible('Summary', 'Hidden content here'));

// Run handler tests
console.log('\n\n=== Testing Event Handlers ===\n');

async function runTests() {
  for (let i = 0; i < testEvents.length; i++) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Test Event ${i + 1}: ${testEvents[i].type}${testEvents[i].subtype ? '.' + testEvents[i].subtype : ''}`);
    console.log('='.repeat(60));

    await handler.processEvent(testEvents[i]);

    // Small delay to allow async processing
    await new Promise(r => setTimeout(r, 100));
  }

  // Final state
  console.log('\n\n=== Handler State ===');
  console.log(JSON.stringify(handler.getState(), null, 2));
}

runTests().catch(console.error);
