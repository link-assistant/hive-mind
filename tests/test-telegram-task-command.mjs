#!/usr/bin/env node

/**
 * @hive-mind-test-suite default
 */

import assert from 'assert/strict';
import { applyTaskCommandDefaults, buildTaskCommandArgs, findTaskIssueUrl, getTaskCommandNameFromText, getTaskToolFromArgs, registerTaskCommands } from '../src/telegram-task-command.lib.mjs';
import { buildTaskIssueTitle, parseTaskIssueCreationInput, stripTaskCommandPrefix } from '../src/task.issue-creation.lib.mjs';

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

console.log(`\nTotal: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
