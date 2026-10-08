/**
 * @hive-mind-test-suite default
 * Regression: every Telegram AI work producer except /hive uses the shared queue.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createQueueExecuteCallback } from '../src/telegram-solve-queue.lib.mjs';
import { createTestWorkQueue } from './helpers/telegram-work-queue.mjs';
import { registerFixCommand } from '../src/telegram-fix-command.lib.mjs';
import { registerTaskCommands } from '../src/telegram-task-command.lib.mjs';
import { registerOrganizeCommand } from '../src/telegram-organize-command.lib.mjs';
import { initI18n } from '../src/i18n.lib.mjs';
import { submitTelegramWork } from '../src/telegram-work-queue.lib.mjs';
import { spawnAutoResolveSolve } from '../src/telegram-merge-command.lib.mjs';
import { MergeQueueProcessor } from '../src/telegram-merge-queue.lib.mjs';
import { createIsolationAwareQueueCallback } from '../src/telegram-isolation.lib.mjs';

await initI18n('en');

const repository = 'https://github.com/link-assistant/web-capture';
const issue = `${repository}/issues/174`;

function harness(register, handlerName, text) {
  const calls = { executions: [], replies: [], edits: [] };
  const queue = createTestWorkQueue();
  queue.checkSystemResources = async () => ({ ok: false, reasons: ['CPU usage is 67% (threshold: 65%)'] });
  queue.checkApiLimits = async () => ({ ok: true, reasons: [] });
  const ctx = { chat: { id: 100, type: 'supergroup' }, from: { id: 200, username: 'tester' }, message: { message_id: 300, message_thread_id: 400, text }, telegram: { editMessageText: async (...args) => calls.edits.push(args) } };
  const handler = register(
    { command() {} },
    {
      VERBOSE: false,
      fixEnabled: true,
      taskEnabled: true,
      addBreadcrumb: async () => {},
      isOldMessage: () => false,
      isForwardedOrReply: () => false,
      isGroupChat: () => true,
      isTopicAuthorized: () => true,
      isChatStopped: () => false,
      resolveLocale: () => 'en',
      getSolveQueue: () => queue,
      safeReply: async (_ctx, reply) => {
        calls.replies.push(reply);
        return { chat: ctx.chat, message_id: 301 };
      },
      safeEditMessageText: async (_ctx, message, reply) => calls.edits.push([message, reply]),
      executeAndUpdateMessage: async (...args) => {
        calls.executions.push(args);
        return { success: true, sessionName: 'test-session' };
      },
      organizeRepository: async options => {
        calls.executions.push(options);
        return { repository: { url: repository, fullName: 'link-assistant/web-capture' }, dryRun: options.dryRun, counts: { scanned: 0, changed: 0, unchanged: 0, stale: 0, errors: 0 }, entries: [], unsupported: [], verification: { ok: true, errors: [] } };
      },
    }
  )[handlerName];
  return { calls, queue, ctx, run: () => handler(ctx) };
}

async function startHead(queue) {
  queue.checkSystemResources = async () => ({ ok: true, reasons: [] });
  const [startable] = await queue.findStartableItems();
  assert.ok(startable, 'work should be startable after the blocking metric clears');
  const item = queue.getToolQueue(startable.tool).shift();
  item.setStarting();
  queue.processing.set(item.id, item);
  queue.recordStart(item.tool);
  await queue.executeItem(item);
  return item;
}

for (const mode of ['--ci-cd', '--update-all-dependencies']) {
  test(`/fix ${mode} waits for Codex admission and preserves its CLI when dequeued`, { timeout: 5000 }, async () => {
    const h = harness(registerFixCommand, 'handleFixCommand', `/fix ${mode} --tool codex --think xhigh --isolation docker ${repository}`);
    await h.run();
    assert.equal(h.calls.executions.length, 0, 'blocked /fix must not start a session');
    const item = h.queue.getToolQueue('codex')[0];
    assert.ok(item, '/fix must join the Codex queue');
    assert.equal(item.command, 'fix');
    assert.equal(item.perCommandIsolation, 'docker');
    assert.equal(item.locale, 'en');
    assert.equal(item.messageInfo.messageThreadId, 400);
    assert.match(h.calls.replies[0], /codex queue #1/i);
    assert.match(h.calls.replies[0], /CPU usage is 67%/);
    assert.deepEqual(await h.queue.findStartableItems(), [], 'consumer must also wait for CPU to fall');
    await startHead(h.queue);
    assert.equal(h.calls.executions.length, 1);
    assert.equal(h.calls.executions[0][2], 'fix');
    assert.ok(h.calls.executions[0][3].includes(mode));
  });
}

test('/split joins the tool queue before starting task', { timeout: 5000 }, async () => {
  const h = harness(registerTaskCommands, 'handleTaskCommand', `/split ${issue} --tool codex`);
  await h.run();
  assert.equal(h.calls.executions.length, 0, 'blocked /split must not start a session');
  const item = h.queue.getToolQueue('codex')[0];
  assert.ok(item);
  assert.equal(item.command, 'task');
  assert.equal(item.commandAlias, 'split');
  await startHead(h.queue);
  assert.equal(h.calls.executions[0][2], 'task');
  assert.ok(h.calls.executions[0][3].includes('--split'));
});

test('/organize defers its in-process classifier and keeps its final summary', { timeout: 5000 }, async () => {
  const h = harness(registerOrganizeCommand, 'handleOrganizeCommand', `/organize ${repository} --tool codex --dry-run`);
  await h.run();
  assert.equal(h.calls.executions.length, 0, 'blocked /organize must not run its classifier');
  const item = h.queue.getToolQueue('codex')[0];
  assert.ok(item);
  assert.equal(item.command, 'organize');
  await startHead(h.queue);
  assert.equal(h.calls.executions.length, 1);
  assert.equal(h.calls.executions[0].dryRun, true);
  assert.match(h.calls.edits.at(-1)[1], /Dry run/i);
});

for (const tool of ['claude', 'codex', 'agent', 'gemini', 'qwen']) {
  test(`/fix uses the ${tool} queue after operator overrides`, { timeout: 5000 }, async () => {
    const h = harness(registerFixCommand, 'handleFixCommand', `/fix ${repository} --tool codex`);
    // Re-register to exercise locked tool/isolation options before admission.
    const handler = registerFixCommand(
      { command() {} },
      {
        VERBOSE: false,
        fixEnabled: true,
        addBreadcrumb: async () => {},
        isOldMessage: () => false,
        isGroupChat: () => true,
        isTopicAuthorized: () => true,
        isChatStopped: () => false,
        solveOverrides: ['--tool', tool, '--isolation', 'tmux'],
        getSolveQueue: () => h.queue,
        safeReply: async () => ({ chat: h.ctx.chat, message_id: 301 }),
        executeAndUpdateMessage: async () => assert.fail('blocked work must not execute'),
      }
    ).handleFixCommand;
    await handler(h.ctx);
    const item = h.queue.getToolQueue(tool)[0];
    assert.ok(item);
    assert.equal(item.tool, tool);
    assert.equal(item.perCommandIsolation, 'tmux');
    h.queue.cancel(item.id);
  });
}

test('pending work keeps FIFO precedence even after resources clear', { timeout: 5000 }, async () => {
  const h = harness(registerFixCommand, 'handleFixCommand', `/fix ${repository} --tool codex`);
  const first = h.queue.enqueue({ url: issue, args: [issue], tool: 'codex' });
  h.queue.checkSystemResources = async () => ({ ok: true, reasons: [] });
  await h.run();
  assert.equal(h.calls.executions.length, 0);
  assert.equal(h.queue.lastStartTime, null, 'waiting work must not consume a direct-start slot');
  assert.deepEqual(
    h.queue.getToolQueue('codex').map(item => item.command),
    ['solve', 'fix']
  );
  assert.equal((await h.queue.findStartableItems())[0].item, first);
});

test('reject strategy refuses /fix without enqueueing or executing', { timeout: 5000 }, async () => {
  const h = harness(registerFixCommand, 'handleFixCommand', `/fix ${repository} --tool codex`);
  h.queue.checkSystemResources = async () => ({ ok: false, rejected: true, rejectReason: 'Disk threshold exceeded', reasons: [] });
  await h.run();
  assert.equal(h.calls.executions.length, 0);
  assert.equal(h.queue.getStats().queued, 0);
  assert.match(h.calls.replies[0], /Disk threshold exceeded/);
});

test('overlapping direct starts reserve one global slot across tools', { timeout: 5000 }, async () => {
  const queue = createTestWorkQueue();
  const h = harness(registerFixCommand, 'handleFixCommand', `/fix ${repository}`);
  const executions = [];
  const results = await Promise.all(
    ['codex', 'claude'].map(tool =>
      submitTelegramWork({
        ctx: h.ctx,
        command: 'fix',
        args: [repository],
        tool,
        queue,
        safeReply: async () => ({ chat: h.ctx.chat, message_id: 301 }),
        execute: async () => {
          executions.push(tool);
          return { success: true };
        },
      })
    )
  );
  assert.equal(executions.length, 1);
  assert.deepEqual(results.map(result => result.status).sort(), ['queued', 'started']);
});

test('work queued during an asynchronous admission check takes precedence', { timeout: 5000 }, async () => {
  const queue = createTestWorkQueue();
  queue.canStartCommand = async () => {
    queue.enqueue({ url: issue, args: [issue], tool: 'codex' });
    return { canStart: true };
  };
  const check = await queue.reserveStartSlot({ tool: 'claude' });
  assert.equal(check.startReserved, false);
  assert.equal(queue.lastStartTime, null);
});

for (const throws of [false, true]) {
  test(`queued launch failure settles completion (${throws ? 'exception' : 'refusal'})`, { timeout: 5000 }, async () => {
    const queue = createTestWorkQueue();
    const item = queue.enqueue({
      url: repository,
      command: 'fix',
      tool: 'codex',
      executeCallback: async () => {
        if (throws) throw new Error('launch denied');
        return { success: false, error: 'launch denied' };
      },
    });
    await startHead(queue);
    const result = await item.completion;
    assert.equal(result.success, false);
    assert.match(String(result.error), /launch denied/);
    assert.equal(queue.stats.totalCompleted, 0);
    assert.equal(queue.stats.totalFailed, 1);
    assert.equal(queue.processing.size, 0);
  });
}

test('queued organization cancellation releases its repository lock', { timeout: 5000 }, async () => {
  const h = harness(registerOrganizeCommand, 'handleOrganizeCommand', `/organize ${repository} --tool codex`);
  await h.run();
  const first = h.queue.getToolQueue('codex')[0];
  await h.run();
  assert.equal(h.queue.getStats().queued, 1);
  assert.match(h.calls.replies.at(-1), /already active/i);
  h.queue.cancel(first.id);
  assert.equal((await first.completion).success, false);
  await h.run();
  assert.equal(h.queue.getStats().queued, 1);
  h.queue.cancel(h.queue.getToolQueue('codex')[0].id);
  await Promise.resolve();
});

test('consumer rejection releases a queued organization lock', { timeout: 5000 }, async () => {
  const h = harness(registerOrganizeCommand, 'handleOrganizeCommand', `/organize ${repository} --tool codex`);
  await h.run();
  const item = h.queue.getToolQueue('codex')[0];
  await h.queue.rejectAllItemsInQueue('codex', h.queue.getToolQueue('codex'), 'Disk threshold exceeded');
  assert.equal((await item.completion).success, false);
  await h.run();
  assert.equal(h.queue.getStats().queued, 1);
  assert.equal(h.calls.executions.length, 0);
  h.queue.cancel(h.queue.getToolQueue('codex')[0].id);
  await Promise.resolve();
});

test('merge auto-resolve awaits queue admission and uses solve overrides', { timeout: 5000 }, async () => {
  const h = harness(registerFixCommand, 'handleFixCommand', `/fix ${repository}`);
  let settled = false;
  const spawned = spawnAutoResolveSolve(
    { url: `${repository}/pull/175`, owner: 'link-assistant', repo: 'web-capture', prNumber: 175 },
    {
      ctx: h.ctx,
      queue: h.queue,
      solveOverrides: ['--tool', 'codex', '--isolation', 'docker'],
      locale: 'en',
      reply: async () => ({ chat: h.ctx.chat, message_id: 301 }),
      executeAndUpdateMessage: async (...args) => {
        h.calls.executions.push(args);
        return { success: true, sessionName: 'merge-session' };
      },
    }
  ).then(result => {
    settled = true;
    return result;
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  assert.equal(h.calls.executions.length, 0);
  await startHead(h.queue);
  assert.deepEqual(await spawned, { success: true, sessionName: 'merge-session' });
  assert.equal(h.calls.executions[0][2], 'solve');
  assert.ok(h.calls.executions[0][3].includes('--auto-merge'));
  assert.equal(h.calls.executions[0][5], 'docker');
});

test('merge cancellation removes an auto-resolve task still awaiting admission', { timeout: 5000 }, async () => {
  const h = harness(registerFixCommand, 'handleFixCommand', `/fix ${repository}`);
  const processor = new MergeQueueProcessor({ owner: 'link-assistant', repo: 'web-capture' });
  const spawned = spawnAutoResolveSolve({ url: `${repository}/pull/175`, signal: processor.autoResolveAbortController.signal }, { ctx: h.ctx, queue: h.queue, reply: async () => ({ chat: h.ctx.chat, message_id: 301 }), executeAndUpdateMessage: async () => assert.fail('cancelled merge must not launch') });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.queue.getStats().queued, 1);
  processor.cancel();
  assert.equal((await spawned).success, false);
  assert.equal(h.queue.getStats().queued, 0);
});

test('queue callbacks preserve fix/task commands for screen, tmux and docker', { timeout: 5000 }, async () => {
  for (const command of ['fix', 'task']) {
    const calls = [];
    const track = (...args) => calls.push(args);
    const fallback = createQueueExecuteCallback(async (...args) => {
      calls.push(args);
      return { success: true, output: 'session: screen-session' };
    }, track);
    await fallback({ command, args: [repository], tool: 'codex' });
    assert.equal(calls[0][0], command);
    assert.equal(calls[1][1].command, command);
    for (const backend of ['screen', 'tmux', 'docker']) {
      const runner = {
        generateSessionId: () => 'isolated-session',
        executeWithIsolation: async (...args) => {
          calls.push(args);
          return { success: true };
        },
      };
      const execute = createIsolationAwareQueueCallback(backend, runner, track, fallback, false);
      await execute({ command, args: [repository], tool: 'codex' });
      assert.equal(calls.at(-2)[0], command);
      assert.equal(calls.at(-2)[2].backend, backend);
      assert.equal(calls.at(-1)[1].command, command);
    }
  }
});
