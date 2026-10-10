/**
 * @hive-mind-test-suite default
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { getLinoYargsFactory } from '../src/cli-arguments.lib.mjs';
import { parseArgsWithYargs } from '../src/telegram-solve-command.lib.mjs';

const reviewSource = await readFile(new URL('../src/review.mjs', import.meta.url), 'utf8');

test('review CLI uses shared multi-tool dispatch instead of invoking only Claude', () => {
  assert.match(reviewSource, /executeReviewTool/);
  assert.doesNotMatch(reviewSource, /await executeClaudeCommand\(/);
});

const config = await import('../src/review.config.lib.mjs');
const review = await import('../src/review.lib.mjs');
const parse = args => parseArgsWithYargs(args, getLinoYargsFactory(), config.createYargsConfig);
const prUrl = 'https://github.com/owner/repo/pull/42';

for (const tool of ['claude', 'codex', 'opencode', 'agent', 'gemini', 'qwen']) {
  test(`review accepts ${tool} with shared reasoning/model options`, async () => {
    const argv = await parse([prUrl, '--tool', tool, '--think', 'high', '--fallback-model', 'fallback']);
    assert.equal(argv.tool, tool);
    assert.equal(argv.think, 'high');
    assert.equal(argv.fallbackModel, 'fallback');
    assert.ok(argv.model);
    const calls = [];
    const runner = async params => {
      calls.push(params);
      return { success: true, sessionId: 'session' };
    };
    const entry = review.REVIEW_TOOL_DISPATCH[tool];
    const result = await review.executeReviewTool(
      { argv, prompt: 'review', systemPrompt: 'no coding' },
      {
        loadTool: async name => {
          if (name === './codex-capability-preflight.lib.mjs') return { runCodexCapabilityPreflight: async () => ({ codexHome: '/tmp/scoped-codex' }) };
          assert.equal(name, entry.module);
          return { [entry.execute]: runner };
        },
        env: {},
      }
    );
    assert.equal(result.success, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].prompt, 'review');
    assert.equal(calls[0].systemPrompt, 'no coding');
    assert.equal(calls[0].argv.reviewMode, true);
    assert.equal(calls[0].argv.attribution, 'none');
    assert.equal(calls[0].argv.autoCommitUncommittedChanges, false);
    assert.equal(calls[0][entry.pathKey], tool);
  });
}

test('review accepts full model IDs and rejects invalid or coding workflow options', async () => {
  assert.equal((await parse([prUrl, '--tool', 'codex', '--model', 'gpt-5.5', '--think', '75%'])).think, 'high');
  await assert.rejects(parse([prUrl, '--tool', 'unknown']));
  await assert.rejects(parse([prUrl, '--auto-merge']));
  await assert.rejects(parse([prUrl, '--auto-commit-uncommitted-changes']));
  await assert.rejects(parse([prUrl, '--tool', 'codex', '--think', 'adaptive']));
  await assert.rejects(parse([prUrl, '--think', 'nonsense']));
});

test('CLI help and version exit without preparing a review or requiring a PR URL', { timeout: 30000 }, () => {
  for (const flag of ['--help', '--version']) {
    const result = spawnSync(process.execPath, ['src/review.mjs', flag], { encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.trim());
    assert.doesNotMatch(result.stdout, /Review failed|Working directory|Log file/);
    if (flag === '--help') assert.match(result.stdout, /claude.*codex.*opencode.*agent.*gemini.*qwen/s);
  }
  const missingUrl = spawnSync(process.execPath, ['src/review.mjs'], { encoding: 'utf8', timeout: 15000 });
  assert.equal(missingUrl.status, 1);
  assert.match(missingUrl.stdout + missingUrl.stderr, /Not enough non-option arguments/);
});

test('review prompts limit work to review, use inline review API, and choose a verdict', () => {
  const { prompt, systemPrompt } = review.buildReviewPrompts({ prUrl, owner: 'owner', repo: 'repo', prNumber: 42, tempDir: '/tmp/review', diffFile: '/tmp/context/diff.patch', headSha: 'abc123', argv: { focus: 'security', approve: true } });
  assert.match(prompt, /security/);
  assert.match(systemPrompt, /Do not edit repository files/);
  assert.match(systemPrompt, /Do not commit, push, merge/);
  assert.match(systemPrompt, /REQUEST_CHANGES/);
  assert.match(systemPrompt, /APPROVE/);
  assert.match(systemPrompt, /"comments"/);
  assert.match(systemPrompt, /"side": "RIGHT"/);
  assert.match(systemPrompt, /"commit_id": "abc123"/);
  assert.match(systemPrompt, /--input/);
  assert.match(systemPrompt, /issues\/42\/comments --paginate/);
  assert.match(systemPrompt, /pulls\/42\/comments --paginate/);
  assert.match(systemPrompt, /pulls\/42\/reviews --paginate/);
  assert.doesNotMatch(systemPrompt, /solve\.mjs|gh pr ready|changeset|create a pull request/i);
  assert.match(review.buildReviewPrompts({ prUrl, owner: 'owner', repo: 'repo', prNumber: 42, headSha: 'abc123', argv: { approve: false } }).systemPrompt, /recommend approval/);
});

test('review URL parser requires a PR and normalizes trailing slash and fragments', () => {
  assert.equal(review.parseReviewUrl(`${prUrl}/#discussion_r1`).url, prUrl);
  assert.throws(() => review.parseReviewUrl('https://github.com/owner/repo/issues/42'));
  assert.throws(() => review.parseReviewUrl('https://example.com/owner/repo/pull/42'));
});

test('resume command preserves tool, model, focus and working directory', () => {
  const command = review.buildReviewResumeCommand({ prUrl, sessionId: 'session', tempDir: '/tmp/review directory', argv: { tool: 'codex', model: 'gpt-5.5', think: 'high', focus: 'security', approve: true, disable1mContext: false, useAgentCommander: true, geminiSandbox: true, requireCodexPlugin: 'review@marketplace' } });
  for (const value of ['review', '--tool', 'codex', '--model', 'gpt-5.5', '--think', 'high', '--focus', 'security', '--working-directory', '/tmp/review directory', '--approve', '--no-disable-1m-context', '--use-agent-commander', '--gemini-sandbox', '--require-codex-plugin', 'review@marketplace']) assert.ok(command.includes(value), value);
});

test('Codex review provisions requested capabilities in the same scoped preflight as solve', async () => {
  const calls = [];
  await review.executeReviewTool(
    { argv: { tool: 'codex', requireCodexPlugin: 'review@marketplace' }, owner: 'owner', repo: 'repo', prNumber: 42, tempDir: '/tmp/checkout', prompt: 'review', systemPrompt: 'no coding' },
    {
      env: { CODEX_PATH: '/opt/codex' },
      loadTool: async name =>
        name === './codex-capability-preflight.lib.mjs'
          ? {
              runCodexCapabilityPreflight: async params => {
                calls.push(params);
                return { codexHome: '/tmp/scoped' };
              },
            }
          : {
              executeCodexCommand: async params => {
                assert.equal(params.capabilityPreflight.codexHome, '/tmp/scoped');
                assert.equal(params.codexPath, '/opt/codex');
                return { success: true };
              },
            },
    }
  );
  assert.equal(calls[0].projectDir, '/tmp/checkout');
  assert.equal(calls[0].issueNumber, 42);
  assert.equal(calls[0].requiredPlugins, 'review@marketplace');
});

test('verification ignores old reviews, drafts, other authors and other commits', () => {
  const reviews = [
    { id: 1, user: { login: 'bot' }, state: 'APPROVED', submitted_at: 'today', commit_id: 'sha' },
    { id: 2, user: { login: 'bot' }, state: 'PENDING', submitted_at: null, commit_id: 'sha' },
    { id: 3, user: { login: 'other' }, state: 'APPROVED', submitted_at: 'today', commit_id: 'sha' },
    { id: 4, user: { login: 'bot' }, state: 'COMMENTED', submitted_at: 'today', commit_id: 'old-sha' },
    { id: 5, user: { login: 'bot' }, state: 'CHANGES_REQUESTED', submitted_at: 'today', commit_id: 'sha' },
  ];
  assert.deepEqual(
    review.getNewSubmittedReviews(reviews, { existingIds: [1], login: 'bot', headSha: 'sha' }).map(item => item.id),
    [5]
  );
});
