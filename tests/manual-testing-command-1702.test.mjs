/**
 * @hive-mind-test-suite default
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { promises as fs } from 'node:fs';
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { partitionTestArgs, buildTestSolveArgs, buildTestIssueBody, selectDocumentationFiles } from '../src/test.lib.mjs';
import { createTestIssue, prepareTestIssue, runTestCommand, startTestSolve } from '../src/test.run.lib.mjs';
import { buildTestCommandArgs, registerTestCommand, validateTestCommandOptions } from '../src/telegram-test-command.lib.mjs';
import { buildTelegramHelpMessage } from '../src/telegram-ui-messages.lib.mjs';
import { initI18n, preloadAllLocales } from '../src/i18n.lib.mjs';
import { createYargsConfig } from '../src/telegram.config.lib.mjs';
import { getLinoYargsFactory } from '../src/cli-arguments.lib.mjs';

const repoUrl = 'https://github.com/owner/project';
const repository = { owner: 'owner', repo: 'project', fullName: 'owner/project', url: repoUrl };
const issueUrl = `${repoUrl}/issues/42`;
const prepared = { repository, title: 'Manual testing of README and documentation', body: 'Act as a tester/user.' };

test('repository argument and command flags are consumed; agent options remain intact', () => {
  const parsed = partitionTestArgs([repoUrl, '--dry-run', '--no-solve', '--tool', 'codex', '--model=gpt-5.5']);
  assert.deepEqual(parsed.repository, repository);
  assert.equal(parsed.dryRun, true);
  assert.equal(parsed.runSolve, false);
  assert.deepEqual(parsed.passthrough, ['--tool', 'codex', '--model=gpt-5.5']);
  assert.equal(partitionTestArgs([`${repoUrl}/issues/1`]).repository, null);
  assert.equal(partitionTestArgs(['--model', 'owner/project']).repository, null);
});

test('documentation inventory includes nested READMEs and all documentation formats', () => {
  assert.deepEqual(selectDocumentationFiles(['src/index.mjs', 'README.md', 'packages/a/README.rst', 'docs/guide.md', 'docs/api.yaml', 'documentation/install.adoc', 'README.zh.md']), ['README.md', 'README.zh.md', 'docs/api.yaml', 'docs/guide.md', 'documentation/install.adoc', 'packages/a/README.rst']);
});

test('tester task requires execution, complete coverage, truthful results and a report', () => {
  const body = buildTestIssueBody({ repository, defaultBranch: 'main', commit: { sha: 'abc123' }, files: ['README.md', 'docs/install.md'], filesTruncated: true });
  for (const text of ['tester/user', 'README.md', 'docs/install.md', 'abc123', 'PASS', 'FAIL', 'BLOCKED', 'NOT RUN', 'expected', 'actual', 'screenshots', 'docs/testing/report.md', 'truncated']) assert.ok(body.includes(text), text);
  assert.match(body, /Do not fix/);
  assert.match(body, /not.*automated test suite alone/i);
});

test('handoff attaches evidence and never implicitly enables automatic merge', () => {
  const args = buildTestSolveArgs({ issueUrl, passthrough: ['--tool', 'codex', '--attach-logs'] });
  assert.deepEqual(args, [issueUrl, '--tool', 'codex', '--attach-logs']);
  assert.ok(!buildTestSolveArgs({ issueUrl }).includes('--auto-merge'));
});

test('issue preparation inventories the exact commit without creating an issue', async () => {
  const calls = [];
  const run = async (command, args) => {
    calls.push({ command, args });
    const endpoint = args[1];
    if (endpoint === 'repos/owner/project') return { code: 0, stdout: 'main' };
    if (endpoint === 'repos/owner/project/commits/main') return { code: 0, stdout: JSON.stringify({ sha: 'abc123' }) };
    if (endpoint === 'repos/owner/project/git/trees/abc123?recursive=1') return { code: 0, stdout: JSON.stringify({ files: ['README.md', 'docs/install.md'], truncated: false }) };
    throw new Error(`Unexpected call: ${command} ${args.join(' ')}`);
  };
  const result = await prepareTestIssue({ repository, run });
  assert.equal(result.commit.sha, 'abc123');
  assert.deepEqual(result.documentationFiles, ['README.md', 'docs/install.md']);
  assert.equal(calls.length, 3);
});

test('inaccessible repository fails before task creation; missing inventory still requires discovery', async () => {
  await assert.rejects(prepareTestIssue({ repository, run: async () => ({ code: 1, stderr: 'not found' }), warn: () => {} }), /Could not access/);
  const result = await prepareTestIssue({ repository, run: async (_command, args) => (args[1] === 'repos/owner/project' ? { code: 0, stdout: 'main' } : { code: 1, stderr: 'unavailable' }), warn: () => {} });
  assert.match(result.body, /discover it in the checkout/);
  assert.equal(result.commit, null);
});

test('task creation uses a body file and returns the created task URL', async () => {
  let bodyFile;
  const issue = await createTestIssue({
    repository,
    prepared,
    run: async (command, args) => {
      assert.equal(command, 'gh');
      assert.deepEqual(args.slice(0, 4), ['issue', 'create', '--repo', repository.fullName]);
      bodyFile = args[args.indexOf('--body-file') + 1];
      assert.equal(await fs.readFile(bodyFile, 'utf8'), prepared.body);
      return { code: 0, stdout: issueUrl };
    },
  });
  assert.equal(issue.url, issueUrl);
  await assert.rejects(fs.access(bodyFile), { code: 'ENOENT' });
});

test('tester starts the real solve entrypoint and propagates exits and signals', async () => {
  for (const [code, signal] of [
    [0, null],
    [1, null],
    [null, 'SIGTERM'],
  ]) {
    const promise = startTestSolve([issueUrl, '--tool', 'codex'], {
      spawnProcess: (command, args, options) => {
        assert.equal(command, process.execPath);
        assert.ok(args[0].endsWith('/src/solve.mjs'));
        assert.deepEqual(args.slice(1), [issueUrl, '--tool', 'codex']);
        assert.equal(options.stdio, 'inherit');
        const child = new EventEmitter();
        process.nextTick(() => child.emit('close', code, signal));
        return child;
      },
    });
    if (code === 0) await promise;
    else await assert.rejects(promise, signal ? /SIGTERM/ : /code 1/);
  }
  await assert.rejects(
    startTestSolve([], {
      spawnProcess: () => {
        const child = new EventEmitter();
        process.nextTick(() => child.emit('error', new Error('ENOENT')));
        return child;
      },
    }),
    /ENOENT/
  );
});

test('dry run is read-only, no-solve creates only an issue, normal mode starts tester', async () => {
  for (const [flags, expectedCreates, expectedSolves] of [
    [['--dry-run'], 0, 0],
    [['--no-solve'], 1, 0],
    [[], 1, 1],
  ]) {
    const creates = [];
    const solves = [];
    const result = await runTestCommand([repoUrl, ...flags, '--tool', 'codex'], {
      prepare: async () => prepared,
      create: async options => {
        creates.push(options);
        return { url: issueUrl };
      },
      solve: async args => {
        solves.push(args);
      },
      log: () => {},
      validate: async () => null,
    });
    assert.equal(creates.length, expectedCreates);
    assert.equal(solves.length, expectedSolves);
    assert.equal(result.prepared, prepared);
    if (expectedSolves) assert.deepEqual(solves[0], [issueUrl, '--attach-logs', '--tool', 'codex']);
  }
});

test('invalid requests fail before creating an issue and child failures propagate', async () => {
  let created = false;
  const deps = {
    prepare: async () => prepared,
    create: async () => {
      created = true;
      return { url: issueUrl };
    },
    log: () => {},
  };
  await assert.rejects(runTestCommand([repoUrl, '--modle', 'opus'], { ...deps, validate: async () => 'Unknown option modle' }), /Unknown option/);
  assert.equal(created, false);
  await assert.rejects(runTestCommand(['https://gitlab.com/owner/project'], deps), /repository URL/);
  await assert.rejects(
    runTestCommand([repoUrl], {
      ...deps,
      validate: async () => null,
      solve: async () => {
        throw new Error('solve terminated by SIGTERM');
      },
    }),
    /SIGTERM/
  );
});

test('Telegram normalizes repository arguments and validates forwarded options', async () => {
  const built = buildTestCommandArgs('/TEST@SwarmMindBot --tool codex owner/project --dry-run');
  assert.deepEqual(built.args, [repoUrl, '--tool', 'codex', '--dry-run']);
  assert.equal(await validateTestCommandOptions(built.args), null);
  assert.match(await validateTestCommandOptions([repoUrl, '--modle', 'opus']), /Unknown|unknown/);
  assert.match(await validateTestCommandOptions([repoUrl, '--ci-cd']), /Unknown|unknown/);
  assert.match(await validateTestCommandOptions([repoUrl, '--dry-run=false']), /without a value/);
});

function harness(overrides = {}) {
  const calls = { executions: [], replies: [], registrations: [] };
  const result = registerTestCommand(
    { command: (...args) => calls.registrations.push(args) },
    {
      VERBOSE: false,
      testEnabled: true,
      addBreadcrumb: async () => {},
      isOldMessage: () => false,
      isForwardedOrReply: () => false,
      isGroupChat: () => true,
      isTopicAuthorized: () => true,
      buildAuthErrorMessage: () => 'not authorized',
      isChatStopped: () => false,
      getStoppedChatRejectMessage: () => 'stopped',
      safeReply: async (_ctx, text) => {
        calls.replies.push(text);
        return { chat: { id: 100 }, message_id: 2 };
      },
      executeAndUpdateMessage: async (...args) => calls.executions.push(args),
      ...overrides,
    }
  );
  return { ...result, calls };
}
const ctx = { chat: { id: 100, type: 'group' }, from: { id: 200, username: 'tester' }, message: { message_id: 1, text: `/test ${repoUrl} --tool codex --isolation tmux` } };

test('Telegram launches hive-test with operator overrides, isolation and locale', async () => {
  const { handleTestCommand, calls } = harness({ solveOverrides: ['--attach-logs', '--isolation', 'docker'], resolveLocale: () => 'ru' });
  await handleTestCommand(ctx);
  assert.equal(calls.registrations[0][0][0].test('TEST'), true);
  assert.equal(calls.executions.length, 1);
  const [, , command, args, , isolation, tool, urlContext] = calls.executions[0];
  assert.equal(command, 'hive-test');
  assert.deepEqual(args, [repoUrl, '--tool', 'codex', '--attach-logs', '--language', 'ru']);
  assert.equal(isolation, 'docker');
  assert.equal(tool, 'codex');
  assert.equal(urlContext.normalized, repoUrl);
});

for (const [name, overrides] of [
  ['disabled', { testEnabled: false }],
  ['old', { isOldMessage: () => true }],
  ['forwarded', { isForwardedOrReply: () => true }],
  ['private', { isGroupChat: () => false }],
  ['unauthorized', { isTopicAuthorized: () => false }],
  ['stopped', { isChatStopped: () => true }],
])
  test(`Telegram blocks ${name} requests`, async () => {
    const { handleTestCommand, calls } = harness(overrides);
    await handleTestCommand(ctx);
    assert.equal(calls.executions.length, 0);
  });

test('packaged command and Telegram fallback wiring are available', async () => {
  const pkg = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.bin['hive-test'], './src/test.mjs');
  const bot = await fs.readFile(new URL('../src/telegram-bot.mjs', import.meta.url), 'utf8');
  assert.match(bot, /registerTestCommand\(bot/);
  assert.match(bot, /test: handleTestCommand/);
});

test('Telegram rejects missing repositories, option typos, and invalid isolation', async () => {
  for (const text of ['/test', `/test ${repoUrl}/issues/1`, `/test ${repoUrl} --modle opus`, `/test ${repoUrl} --isolation invalid`]) {
    const { handleTestCommand, calls } = harness();
    await handleTestCommand({ ...ctx, message: { ...ctx.message, text } });
    assert.equal(calls.executions.length, 0);
    assert.ok(calls.replies[0].includes('❌'));
  }
});

test('test command can be disabled and is documented in every help locale', async () => {
  const argv = await createYargsConfig(getLinoYargsFactory()()).parse(['--no-test']);
  assert.equal(argv.test, false);
  await initI18n('en');
  await preloadAllLocales();
  for (const locale of ['en', 'ru', 'zh', 'hi']) {
    const enabled = buildTelegramHelpMessage({ locale, chatId: 100 });
    assert.ok(enabled.includes('*/test*'));
    assert.ok(!enabled.includes('telegram.help_test'));
    const disabled = buildTelegramHelpMessage({ locale, chatId: 100, testEnabled: false });
    assert.ok(disabled.includes('*/test* - ❌'));
  }
});

test('CLI help and version work without GitHub calls or an AI launch', () => {
  const cli = new URL('../src/test.mjs', import.meta.url);
  assert.match(execFileSync(process.execPath, [cli.pathname, '--help'], { encoding: 'utf8' }), /tester\/user/);
  assert.match(execFileSync(process.execPath, [cli.pathname, '--version'], { encoding: 'utf8' }), /\d+\.\d+\.\d+/);
});
