#!/usr/bin/env node

/**
 * @hive-mind-test-suite default
 */

import assert from 'assert/strict';
import { applyTaskCommandDefaults, buildTaskCommandArgs, findTaskIssueUrl, getTaskCommandNameFromText, getTaskToolFromArgs, registerTaskCommands } from '../src/telegram-task-command.lib.mjs';
import { buildTaskIssueTitle, parseTaskIssueCreationInput, resolveTaskIssueCreationInput, stripTaskCommandPrefix } from '../src/task.issue-creation.lib.mjs';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (error) {
    console.log(`FAIL: ${name}`);
    console.log(`  ${error.message}`);
    failed++;
  }
}

const issueUrl = 'https://github.com/link-assistant/hive-mind/issues/501';

await test('/task command is recognized', () => {
  assert.equal(getTaskCommandNameFromText(`/task ${issueUrl}`), 'task');
  assert.equal(getTaskCommandNameFromText(`/split@SwarmMindBot ${issueUrl}`), 'split');
  assert.equal(getTaskCommandNameFromText(`/solve ${issueUrl}`), null);
});

await test('/split adds --split by default and keeps user options', () => {
  const built = buildTaskCommandArgs(`/split --model opus ${issueUrl}`);
  assert.deepEqual(built.args, [issueUrl, '--model', 'opus', '--split']);
  assert.equal(built.issueUrl, issueUrl);
});

await test('/task does not add --split by default', () => {
  const built = buildTaskCommandArgs(`/task ${issueUrl}`);
  assert.deepEqual(built.args, [issueUrl]);
  assert.equal(built.issueUrl, issueUrl);
});

await test('/task explicit --split keeps split mode available', () => {
  const built = buildTaskCommandArgs(`/task --split --split-count 3 ${issueUrl}`);
  assert.deepEqual(built.args, [issueUrl, '--split', '--split-count', '3']);
  assert.equal(built.issueUrl, issueUrl);
});

await test('explicit --split is not duplicated', () => {
  const args = applyTaskCommandDefaults([issueUrl, '--split', '--split-count', '3'], 'split');
  assert.equal(args.filter(arg => arg === '--split').length, 1);
});

await test('pull request URLs are not accepted as task issue URL', () => {
  assert.equal(findTaskIssueUrl(['https://github.com/link-assistant/hive-mind/pull/553']), null);
});

await test('tool can be parsed from task command arguments', () => {
  assert.equal(getTaskToolFromArgs([issueUrl, '--tool', 'codex']), 'codex');
  assert.equal(getTaskToolFromArgs([issueUrl, '--tool=agent']), 'agent');
  assert.equal(getTaskToolFromArgs([issueUrl]), 'claude');
});

const repoUrl = 'https://github.com/link-assistant/hive-mind';
const issueText = 'Make task issue creation work\n\nPreserve the full body.';

for (const [name, input] of [
  ['repository link before issue text', `${repoUrl}\n${issueText}`],
  ['repository link after issue text', `${issueText}\n${repoUrl}`],
  ['--repository before issue text', `--repository ${repoUrl}\n${issueText}`],
  ['--repository after issue text', `${issueText}\n--repository ${repoUrl}`],
]) {
  await test(`task issue creation parses ${name}`, () => {
    const parsed = parseTaskIssueCreationInput(input);
    assert.equal(parsed.valid, true);
    assert.deepEqual(parsed.repository, {
      owner: 'link-assistant',
      repo: 'hive-mind',
      fullName: 'link-assistant/hive-mind',
      url: repoUrl,
    });
    assert.equal(parsed.issueText, issueText);
    assert.equal(parsed.title, 'Make task issue creation work');
  });
}

// Issue #1916: replying to a message containing the issue text with
// `/task <repository-url>` must combine the inline repository with the
// replied-to issue text instead of dropping the reply.
await test('reply issue creation combines inline repo with replied issue text', () => {
  const input = resolveTaskIssueCreationInput({
    commandText: `/task ${repoUrl}`,
    replyText: issueText,
  });
  const parsed = parseTaskIssueCreationInput(input);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.repository.fullName, 'link-assistant/hive-mind');
  assert.equal(parsed.issueText, issueText);
});

await test('reply issue creation combines inline issue text with replied repo', () => {
  const input = resolveTaskIssueCreationInput({
    commandText: `/task ${issueText}`,
    replyText: repoUrl,
  });
  const parsed = parseTaskIssueCreationInput(input);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.repository.fullName, 'link-assistant/hive-mind');
  assert.equal(parsed.issueText, issueText);
});

await test('reply with bare /task uses repo and issue text from replied message', () => {
  const input = resolveTaskIssueCreationInput({
    commandText: '/task',
    replyText: `${repoUrl}\n${issueText}`,
  });
  const parsed = parseTaskIssueCreationInput(input);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.repository.fullName, 'link-assistant/hive-mind');
  assert.equal(parsed.issueText, issueText);
});

await test('reply issue creation tolerates the same repo inline and in reply', () => {
  const input = resolveTaskIssueCreationInput({
    commandText: `/task ${repoUrl}`,
    replyText: `${repoUrl}\n${issueText}`,
  });
  const parsed = parseTaskIssueCreationInput(input);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.repository.fullName, 'link-assistant/hive-mind');
  assert.equal(parsed.issueText, issueText);
});

await test('combining two different repositories still reports a conflict', () => {
  const input = resolveTaskIssueCreationInput({
    commandText: `/task ${repoUrl}`,
    replyText: `https://github.com/link-assistant/formal-ai\n${issueText}`,
  });
  const parsed = parseTaskIssueCreationInput(input);
  assert.equal(parsed.valid, false);
  assert.match(parsed.error, /Only one GitHub repository/);
});

await test('inline /task issue creation strips command prefix', () => {
  const input = stripTaskCommandPrefix(`/task ${repoUrl}\n${issueText}`);
  const parsed = parseTaskIssueCreationInput(input);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.issueText, issueText);
});

await test('task issue title truncates the first line with ASCII ellipsis', () => {
  const title = buildTaskIssueTitle(`${'x'.repeat(300)}\nBody`);
  assert.equal(title.length, 256);
  assert.equal(title.endsWith('...'), true);
});

await test('task issue creation replies with the created issue URL', async () => {
  const bot = { command() {} };
  const replies = [];
  const edits = [];
  const createdIssues = [];
  const { handleTaskCommand } = registerTaskCommands(bot, {
    VERBOSE: false,
    taskEnabled: true,
    addBreadcrumb: async () => {},
    isOldMessage: () => false,
    isGroupChat: () => true,
    isTopicAuthorized: () => true,
    buildAuthErrorMessage: () => 'not authorized',
    isChatStopped: () => false,
    getStoppedChatRejectMessage: () => 'stopped',
    safeReply: async () => {
      throw new Error('safeReply should not be used for valid issue creation');
    },
    executeAndUpdateMessage: async () => {
      throw new Error('split task execution should not run for issue creation');
    },
    createTaskIssue: async issue => {
      createdIssues.push(issue);
      return { url: 'https://github.com/link-assistant/hive-mind/issues/1734' };
    },
  });

  const ctx = {
    chat: { id: 100, type: 'group' },
    from: { id: 200, username: 'tester' },
    message: { message_id: 300, text: `/task ${repoUrl}\n${issueText}` },
    reply: async (text, options) => {
      replies.push({ text, options });
      return { chat: { id: 100 }, message_id: 301 };
    },
    telegram: {
      editMessageText: async (chatId, messageId, inlineMessageId, text, options) => {
        edits.push({ chatId, messageId, inlineMessageId, text, options });
      },
    },
  };

  await handleTaskCommand(ctx);

  assert.deepEqual(createdIssues, [
    {
      repository: {
        owner: 'link-assistant',
        repo: 'hive-mind',
        fullName: 'link-assistant/hive-mind',
        url: repoUrl,
      },
      title: 'Make task issue creation work',
      body: issueText,
    },
  ]);
  assert.equal(replies.length, 1);
  assert.equal(replies[0].options.reply_to_message_id, 300);
  assert.equal(edits.length, 1);
  assert.equal(edits[0].chatId, 100);
  assert.equal(edits[0].messageId, 301);
  assert.match(edits[0].text, /https:\/\/github\.com\/link-assistant\/hive-mind\/issues\/1734/);
  assert.match(edits[0].text, /Reply to this message with \/solve/);
});

// Issue #1916: end-to-end handler path for replying to an issue-text message
// with `/task <repository-url>`.
await test('handleTaskCommand creates issue when replying with repo and issue text in reply', async () => {
  const bot = { command() {} };
  const createdIssues = [];
  const edits = [];
  const { handleTaskCommand } = registerTaskCommands(bot, {
    VERBOSE: false,
    taskEnabled: true,
    addBreadcrumb: async () => {},
    isOldMessage: () => false,
    isGroupChat: () => true,
    isTopicAuthorized: () => true,
    buildAuthErrorMessage: () => 'not authorized',
    isChatStopped: () => false,
    getStoppedChatRejectMessage: () => 'stopped',
    safeReply: async () => {
      throw new Error('safeReply should not be used for valid issue creation');
    },
    executeAndUpdateMessage: async () => {
      throw new Error('split task execution should not run for issue creation');
    },
    createTaskIssue: async issue => {
      createdIssues.push(issue);
      return { url: 'https://github.com/link-assistant/hive-mind/issues/1916' };
    },
  });

  const ctx = {
    chat: { id: 100, type: 'group' },
    from: { id: 200, username: 'tester' },
    message: {
      message_id: 300,
      text: `/task ${repoUrl}`,
      reply_to_message: { message_id: 250, text: issueText },
    },
    reply: async () => ({ chat: { id: 100 }, message_id: 301 }),
    telegram: {
      editMessageText: async (chatId, messageId, inlineMessageId, text) => {
        edits.push({ chatId, messageId, text });
      },
    },
  };

  await handleTaskCommand(ctx);

  assert.equal(createdIssues.length, 1);
  assert.equal(createdIssues[0].repository.fullName, 'link-assistant/hive-mind');
  assert.equal(createdIssues[0].body, issueText);
  assert.equal(edits.length, 1);
  assert.match(edits[0].text, /issues\/1916/);
});

// Issue #1922: a forwarded /task command must never be re-executed. Forwarding
// the bot's own "/task <url>" reply (or any message starting with /task) used to
// create a brand-new issue / spawn a session the user never intended.
function buildTaskHarness(overrides = {}) {
  const bot = { command() {} };
  const calls = { createdIssues: [], executed: [], replies: [] };
  const { handleTaskCommand } = registerTaskCommands(bot, {
    VERBOSE: false,
    taskEnabled: true,
    addBreadcrumb: async () => {},
    isOldMessage: () => false,
    isForwarded: () => false,
    isGroupChat: () => true,
    isTopicAuthorized: () => true,
    buildAuthErrorMessage: () => 'not authorized',
    isChatStopped: () => false,
    getStoppedChatRejectMessage: () => 'stopped',
    safeReply: async (_ctx, text) => {
      calls.replies.push(text);
    },
    executeAndUpdateMessage: async () => {
      calls.executed.push(true);
    },
    createTaskIssue: async issue => {
      calls.createdIssues.push(issue);
      return { url: 'https://github.com/link-assistant/hive-mind/issues/9999' };
    },
    ...overrides,
  });
  return { handleTaskCommand, calls };
}

function buildTaskCtx(message) {
  return {
    chat: { id: 100, type: 'group' },
    from: { id: 200, username: 'tester' },
    message: { message_id: 300, ...message },
    reply: async () => ({ chat: { id: 100 }, message_id: 301 }),
    telegram: { editMessageText: async () => {} },
  };
}

await test('forwarded /task (new API forward_origin) is ignored — no issue created, no execution', async () => {
  const { handleTaskCommand, calls } = buildTaskHarness({ isForwarded: ctx => Boolean(ctx.message?.forward_origin?.type) });
  await handleTaskCommand(buildTaskCtx({ text: `/task ${repoUrl}\n${issueText}`, forward_origin: { type: 'user', sender_user: { id: 1 } } }));
  assert.equal(calls.createdIssues.length, 0);
  assert.equal(calls.executed.length, 0);
  assert.equal(calls.replies.length, 0);
});

await test('forwarded /split (split mode) is ignored — no execution', async () => {
  const { handleTaskCommand, calls } = buildTaskHarness({ isForwarded: () => true });
  await handleTaskCommand(buildTaskCtx({ text: `/split ${issueUrl}`, forward_from: { id: 1, first_name: 'T' } }));
  assert.equal(calls.executed.length, 0);
  assert.equal(calls.createdIssues.length, 0);
});

await test('non-forwarded /task still creates an issue (regression guard)', async () => {
  const { handleTaskCommand, calls } = buildTaskHarness();
  await handleTaskCommand(buildTaskCtx({ text: `/task ${repoUrl}\n${issueText}` }));
  assert.equal(calls.createdIssues.length, 1);
});

console.log(`\nTotal: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
