#!/usr/bin/env node

/**
 * Regression tests for issue #1900 interactive system events.
 *
 * @hive-mind-test-suite default
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const { createInteractiveHandler } = await import(join(__dirname, '..', 'src', 'interactive-mode.lib.mjs'));

let testsPassed = 0;
let testsFailed = 0;
let mockCommentIdCounter = 1900;

async function runTest(name, testFn) {
  process.stdout.write(`Testing ${name}... `);
  try {
    await testFn();
    console.log('PASSED');
    testsPassed++;
  } catch (error) {
    console.log(`FAILED: ${error.message}`);
    testsFailed++;
  }
}

function makeHandler({ owner = 'test-owner', repo = 'test-repo', prNumber = 123, verbose = false } = {}) {
  const comments = [];
  const edits = [];
  const logs = [];

  const mockExecFile = async (cmd, args, options) => {
    const argsStr = args.join(' ');
    const inputBody = options?.input ? JSON.parse(options.input).body : '';

    if (argsStr.includes('-X PATCH')) {
      edits.push({ args: argsStr, body: inputBody });
      return { stdout: JSON.stringify({ id: mockCommentIdCounter, body: inputBody }) };
    }

    const commentId = ++mockCommentIdCounter;
    comments.push({ args: argsStr, body: inputBody });
    return { stdout: JSON.stringify({ id: commentId, html_url: `https://github.com/${owner}/${repo}/pull/${prNumber}#issuecomment-${commentId}` }) };
  };

  const mock$ = (...args) => {
    const body = args[0].reduce((acc, str, i) => acc + str + (args[i + 1] || ''), '');
    comments.push({ args: body, body: '' });
    const commentId = ++mockCommentIdCounter;
    return Promise.resolve({ stdout: Buffer.from(`https://github.com/${owner}/${repo}/pull/${prNumber}#issuecomment-${commentId}\n`) });
  };

  const mockLog = msg => {
    logs.push(msg);
    return Promise.resolve();
  };

  const handler = createInteractiveHandler({ owner, repo, prNumber, $: mock$, log: mockLog, verbose, execFile: mockExecFile });
  return { handler, comments, edits, logs };
}

async function withMockedNow(startMs, testFn) {
  const originalNow = Date.now;
  let now = startMs;
  Date.now = () => now;
  try {
    await testFn({
      advance(ms) {
        now += ms;
      },
      set(ms) {
        now = ms;
      },
      get() {
        return now;
      },
    });
  } finally {
    Date.now = originalNow;
  }
}

console.log('\n=== Testing Issue #1900 Interactive System Events ===\n');

await runTest('processEvent groups system.thinking_tokens into one editable comment', async () => {
  await withMockedNow(1_000_000, async clock => {
    const { handler, comments, edits } = makeHandler({ verbose: true });

    await handler.processEvent({
      type: 'system',
      subtype: 'thinking_tokens',
      estimated_tokens: 50,
      estimated_tokens_delta: 50,
      uuid: 'thinking-1',
      session_id: 's1',
    });

    if (comments.length !== 1) throw new Error(`Expected one Thinking comment, got ${comments.length}`);
    if (!comments[0].body.includes('Thinking...')) throw new Error('Expected initial Thinking comment');
    if (comments[0].body.includes('Unrecognized Event')) throw new Error('Expected thinking_tokens not to be unrecognized');

    clock.advance(10_000);
    await handler.processEvent({
      type: 'system',
      subtype: 'thinking_tokens',
      estimated_tokens: 150,
      estimated_tokens_delta: 100,
      uuid: 'thinking-2',
      session_id: 's1',
    });

    if (comments.length !== 1) throw new Error('Expected second thinking event to reuse the first comment');
    if (edits.length !== 0) throw new Error(`Expected no edit before the update interval, got ${edits.length}`);

    clock.advance(60_000);
    await handler.processEvent({
      type: 'system',
      subtype: 'thinking_tokens',
      estimated_tokens: 350,
      estimated_tokens_delta: 200,
      uuid: 'thinking-3',
      session_id: 's1',
    });

    if (comments.length !== 1) throw new Error('Expected third thinking event to reuse the first comment');
    if (edits.length !== 1) throw new Error(`Expected one throttled live edit, got ${edits.length}`);
    if (!edits[0].body.includes('Thinking...')) throw new Error('Expected live edit to keep Thinking status');
    if (!edits[0].body.includes('3 thinking-token events')) throw new Error('Expected live edit to summarize all thinking events');
    if (!edits[0].body.includes('350 estimated thinking tokens')) throw new Error('Expected live edit to show latest estimated token count');
    if (!edits[0].body.includes('"uuid": "thinking-1"') || !edits[0].body.includes('"uuid": "thinking-3"')) {
      throw new Error('Expected live edit raw JSON to include grouped thinking events');
    }

    clock.advance(1_000);
    await handler.processEvent({
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'Done thinking.' }],
      },
      session_id: 's1',
    });

    if (comments.length !== 2) throw new Error(`Expected assistant message to create a second comment, got ${comments.length}`);
    if (edits.length !== 2) throw new Error(`Expected final thinking edit plus live edit, got ${edits.length}`);
    if (!edits[1].body.includes('Thought for 1 minute.')) throw new Error('Expected final edit to show elapsed thinking duration');
    if (!edits[1].body.includes('"uuid": "thinking-1"') || !edits[1].body.includes('"uuid": "thinking-3"')) {
      throw new Error('Expected final edit raw JSON to include grouped thinking events');
    }

    const unrecognized = [...comments, ...edits].filter(c => c.body.includes('Unrecognized Event'));
    if (unrecognized.length > 0) throw new Error(`Expected no unrecognized comments/edits, got ${unrecognized.length}`);
  });
});

await runTest('processEvent handles observed low-volume system subtypes without unrecognized comments', async () => {
  await withMockedNow(2_000_000, async clock => {
    const { handler, comments, edits } = makeHandler({ verbose: true });

    await handler.processEvent({
      type: 'system',
      subtype: 'status',
      status: 'compacting',
      session_id: 's1',
      uuid: 'status-1',
    });

    clock.advance(6_000);
    await handler.processEvent({
      type: 'system',
      subtype: 'compact_boundary',
      compact_metadata: {
        trigger: 'auto',
        pre_tokens: 117063,
        post_tokens: 8499,
        duration_ms: 84620,
      },
      session_id: 's1',
      uuid: 'compact-1',
    });

    clock.advance(6_000);
    await handler.processEvent({
      type: 'system',
      subtype: 'task_updated',
      task_id: 'missing-task',
      patch: { is_backgrounded: true },
      session_id: 's1',
      uuid: 'task-update-1',
    });

    const unrecognized = [...comments, ...edits].filter(c => c.body.includes('Unrecognized Event'));
    if (unrecognized.length > 0) throw new Error(`Expected no unrecognized comments/edits, got ${unrecognized.length}`);
    if (!comments.some(c => c.body.includes('Context compacted'))) throw new Error('Expected compact_boundary to produce a context compaction comment');
  });
});

console.log('\n=== Issue #1900 Test Results ===');
console.log(`Passed: ${testsPassed}`);
console.log(`Failed: ${testsFailed}`);

if (testsFailed > 0) process.exit(1);
