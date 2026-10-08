/**
 * Regression coverage for issue #2751.
 * @hive-mind-test-suite default
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { getLinoYargsFactory } from '../src/cli-arguments.lib.mjs';
import { createYargsConfig, SOLVE_OPTION_DEFINITIONS } from '../src/solve.config.lib.mjs';
import { createYargsConfig as createHiveYargsConfig, getSolvePassthroughOptionNames } from '../src/hive.config.lib.mjs';
import { resolveFixDependencyReporting } from '../src/fix.report-dependencies.lib.mjs';
import { buildSolveArgs, FIX_MODE_UPDATE_ALL_DEPENDENCIES, partitionFixArgs } from '../src/fix.args.lib.mjs';
import { buildUpdateDependenciesIssueBody } from '../src/fix.update-dependencies.lib.mjs';
import { createUpdateDependenciesIssue } from '../src/fix.update-dependencies-issue.lib.mjs';
import { registerTaskCommands } from '../src/telegram-task-command.lib.mjs';

const reportHeading = 'Dependency issue reporting (--report-dependencies-issues).';
const reportText = /Report to each dependency[’']s upstream/;
const repository = { owner: 'owner', repo: 'repo', fullName: 'owner/repo', url: 'https://github.com/owner/repo' };
const issueUrl = `${repository.url}/issues/1`;
const parse = args => createYargsConfig(getLinoYargsFactory()([issueUrl, ...args]).exitProcess(false)).parseSync();

test('/fix resolves defaults, explicit values and repeated options using the shared parser', () => {
  for (const [args, enabled] of [
    [[], true],
    [['--no-report-dependencies-issues'], false],
    [['--report-dependencies-issues=false'], false],
    [['--report-dependencies-issues', 'false'], false],
    [['--no-report-dependencies-issues', '--report-dependencies-issues'], true],
    [['--report-dependencies-issues', '--no-report-dependencies-issues'], false],
    [['--tool', 'codex', '--model=gpt-5.5'], true],
  ]) {
    assert.equal(resolveFixDependencyReporting(args), enabled, args.join(' '));
  }
});

test('/hive preserves an omitted reporting value and explicit false for solve passthrough', () => {
  for (const [args, expected] of [
    [[], undefined],
    [['--no-report-dependencies-issues'], false],
    [['--report-dependencies-issues'], true],
  ]) {
    const argv = createHiveYargsConfig(getLinoYargsFactory()([repository.url, '--update-all-dependencies', ...args]).exitProcess(false)).parseSync();
    assert.equal(argv.reportDependenciesIssues, expected);
    assert.equal(argv.updateAllDependencies, true);
  }
});

test('reporting is registered as an independently controllable solve/hive option', { timeout: 5000 }, () => {
  assert.equal(SOLVE_OPTION_DEFINITIONS['report-dependencies-issues']?.type, 'boolean');
  assert.ok(getSolvePassthroughOptionNames().includes('report-dependencies-issues'));
  assert.equal(parse(['--no-report-dependencies-issues']).reportDependenciesIssues, false);
});

test('generated dependency issues include reporting even when deep analysis is forwarded', () => {
  const body = buildUpdateDependenciesIssueBody({ repository, languages: {}, files: [] });
  assert.match(body, reportText);
  for (const phrase of ['general logic', 'duplicated code', 'missing features', 'bugs', 'workarounds', 'do not block']) {
    assert.ok(body.includes(phrase), `reporting covers ${phrase}`);
  }
  assert.equal(body.split('Report to each dependency’s upstream').length - 1, 1);
  assert.doesNotMatch(buildUpdateDependenciesIssueBody({ repository, reportDependenciesIssues: false }), reportText);
});

test('issue creation applies default reporting and opt-out without a prepared draft', { timeout: 5000 }, async () => {
  let body;
  const run = async (_command, args) => {
    if (args[0] === 'issue' && args[1] === 'create') {
      body = await readFile(args[args.indexOf('--body-file') + 1], 'utf8');
      return { code: 0, stdout: issueUrl, stderr: '' };
    }
    if (args[1]?.endsWith('/languages')) return { code: 0, stdout: '{}', stderr: '' };
    if (args[1]?.endsWith('owner/repo')) return { code: 0, stdout: 'main', stderr: '' };
    if (args[1]?.includes('/git/trees/')) return { code: 0, stdout: '{"files":[],"truncated":false}', stderr: '' };
    return { code: 0, stdout: '{}', stderr: '' };
  };
  for (const reportDependenciesIssues of [undefined, true, false]) {
    await createUpdateDependenciesIssue({ repository, run, warn: () => {}, reportDependenciesIssues });
    assert.equal(typeof body, 'string');
    if (reportDependenciesIssues === false) assert.doesNotMatch(body, reportText);
    else assert.match(body, reportText);
  }
});

for (const tool of ['claude', 'codex', 'opencode', 'agent', 'qwen', 'gemini']) {
  test(`${tool}: default, opt-in, opt-out, and deep-analysis combinations`, { timeout: 5000 }, async () => {
    const { buildSystemPrompt } = await import(`../src/${tool}.prompts.lib.mjs`);
    const build = argv => buildSystemPrompt({ owner: 'owner', repo: 'repo', issueNumber: 1, branchName: 'issue-1', argv });
    assert.ok(!build({}).includes(reportHeading), 'off for ordinary tasks');
    for (const argv of [{ updateAllDependencies: true }, { updateAllDependencies: true, deepAnalysis: true }, { reportDependenciesIssues: true }, parse(['--report-dependencies-issues']), parse(['--update-all-dependencies'])]) {
      const prompt = build(argv);
      assert.equal(prompt.split(reportHeading).length - 1, 1, 'exactly one reporting section');
      assert.match(prompt, reportText);
    }
    for (const args of [['--no-report-dependencies-issues'], ['--report-dependencies-issues=false'], ['--report-dependencies-issues', 'false']]) {
      const prompt = build(parse(['--update-all-dependencies', '--deep-analysis', ...args]));
      assert.ok(!prompt.includes(reportHeading), `${args.join(' ')} disables reporting`);
      assert.doesNotMatch(prompt, reportText);
      assert.match(prompt, /Dependency updates \(--update-all-dependencies\)/);
    }
  });
}

test('/fix preserves reporting controls in the solve handoff', () => {
  for (const args of [[], ['--no-report-dependencies-issues'], ['--report-dependencies-issues=false'], ['--report-dependencies-issues', 'false']]) {
    const parsed = partitionFixArgs(['owner/repo', '--update-all-dependencies', ...args]);
    assert.equal(parsed.mode, FIX_MODE_UPDATE_ALL_DEPENDENCIES);
    const argv = parse(buildSolveArgs({ issueUrl, mode: parsed.mode, passthrough: parsed.passthrough }).slice(1));
    assert.equal(argv.updateAllDependencies, true);
    if (args.length) assert.equal(argv.reportDependenciesIssues, false);
  }
});

test('Telegram /task preserves reporting choices through issue generation and its suggested solve', { timeout: 5000 }, async () => {
  const replies = [];
  let generated;
  const { handleTaskCommand } = registerTaskCommands(
    { command() {} },
    {
      taskEnabled: true,
      addBreadcrumb: async () => {},
      isOldMessage: () => false,
      isGroupChat: () => true,
      isTopicAuthorized: () => true,
      isChatStopped: () => false,
      createUpdateDependenciesIssue: async options => {
        generated = options;
        return { url: issueUrl };
      },
    }
  );
  for (const [args, enabled] of [
    [[], true],
    [['--report-dependencies-issues'], true],
    [['--no-report-dependencies-issues'], false],
    [['--report-dependencies-issues=false'], false],
    [['--report-dependencies-issues', 'false'], false],
    [['--no-report-dependencies-issues', '--report-dependencies-issues'], true],
    [['--report-dependencies-issues', '--no-report-dependencies-issues'], false],
  ]) {
    await handleTaskCommand({
      chat: { id: 1, type: 'group' },
      from: { id: 2, username: 'tester' },
      message: { text: `/task --update-all-dependencies owner/repo ${args.join(' ')}`, message_id: 1 },
      reply: async text => {
        replies.push(text);
        return { chat: { id: 1 }, message_id: 2 };
      },
      telegram: { editMessageText: async (_chatId, _messageId, _inlineId, text) => replies.push(text) },
    });
    assert.equal(generated?.reportDependenciesIssues, enabled, args.join(' '));
    const body = buildUpdateDependenciesIssueBody(generated);
    assert.equal(reportText.test(body), enabled, 'the generated issue reflects the choice');
    const followUp = replies.at(-1).match(/with (\/solve .*) to continue/)?.[1];
    assert.ok(followUp, replies.at(-1));
    const solveArgv = parse(followUp.split(' ').slice(1));
    assert.equal(solveArgv.updateAllDependencies, true);
    assert.equal(solveArgv.reportDependenciesIssues ?? solveArgv.updateAllDependencies, enabled, 'the suggested solve preserves the choice');
  }
});
