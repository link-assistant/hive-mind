/**
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/2326
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseGitHubUrl } from '../src/github-url-parser.lib.mjs';
import { getLinoYargsFactory, parseCliArgumentsWithLino } from '../src/cli-arguments.lib.mjs';
import { createYargsConfig, parseArguments } from '../src/solve.config.lib.mjs';
import { parseArgsWithYargs } from '../src/telegram-solve-command.lib.mjs';
import { validateTelegramGitHubUrl } from '../src/telegram-url-validation.lib.mjs';
import { initI18n } from '../src/i18n.lib.mjs';
import { detectMalformedFlags } from '../src/option-suggestions.lib.mjs';
import { enhanceArgumentError, formatCaretSnippet, formatInputLocationMarkdown } from '../src/input-diagnostics.lib.mjs';
import { formatTaskUrlError } from '../src/telegram-task-command.lib.mjs';
import { parseTaskIssueUrl } from '../src/task.split.lib.mjs';

await initI18n();

const url = 'https://github.com/bpmbpm/mdld-test/issuese/1';
const issueUrl = url.replace('/issuese/', '/issues/');

test('the screenshot typo identifies the URL segment and suggests its correction', () => {
  const parsed = parseGitHubUrl(url);
  assert.equal(parsed.type, 'other', 'a suggestion must not change the target');
  assert.equal(parsed.suggestion, issueUrl);
  assert.equal(parsed.inputLocation.part, 'issuese');
  assert.equal(url.slice(parsed.inputLocation.start, parsed.inputLocation.end), 'issuese');
});

for (const parse of [args => parseArgsWithYargs(args, getLinoYargsFactory(), createYargsConfig), args => parseCliArgumentsWithLino({ argv: ['node', 'solve', ...args], commandName: 'solve', createYargsConfig, positionalAliases: ['issue-url'] })]) {
  test('unknown options identify their argument position and keep suggestions', async () => {
    await assert.rejects(
      async () => parse([issueUrl, '--modl', 'opus']),
      error => {
        assert.match(error.message, /Did you mean `--model`/);
        assert.match(error.message, /argument 2/i);
        assert.match(error.message, /--modl/);
        return true;
      }
    );
  });
}

test('solve rejects input validation errors instead of continuing with empty arguments', async () => {
  await assert.rejects(() => parseArguments(getLinoYargsFactory(), () => [issueUrl, '--tool', 'cluade']), /cluade/);
});

test('the Telegram validator reports the screenshot typo and preserves the original URL', () => {
  const result = validateTelegramGitHubUrl(url, { allowedTypes: ['issue', 'pull', 'repo'] });
  assert.equal(result.valid, false);
  assert.equal(result.suggestion, issueUrl);
  assert.match(result.error, /URL path segment \*issuese\* \(column 37\)/);
  // Compiler-style caret under the typo, in a monospace block so it stays aligned.
  assert.deepEqual(result.error.split('\n').slice(-4), ['```', url, `${' '.repeat(36)}^^^^^^^`, '```']);
});

test('CLI hints underline the offending part under the echoed input', () => {
  const lines = parseGitHubUrl(url).inputHint.split('\n');
  assert.deepEqual(lines, ['Check URL path segment "issuese" (column 37):', `  ${url}`, `  ${' '.repeat(36)}^^^^^^^`]);
  assert.deepEqual(parseGitHubUrl('https://github.com/o/r/pull', { recover: false }).inputHint.split('\n').slice(1), ['  https://github.com/o/r/pull', `  ${' '.repeat(27)}^`]);
});

test('caret snippets trim long input at boundaries and align wide characters', () => {
  const long = 'https://github.com/some-long-organization-name/some-long-repository/issuese/1';
  const start = long.indexOf('issuese');
  assert.equal(formatCaretSnippet(long, { start, end: start + 7 }, { maxWidth: 48 }), `…/some-long-repository/issuese/1\n${' '.repeat(23)}^^^^^^^`);
  assert.equal(formatCaretSnippet('o/漢字/x', { start: 5, end: 6 }), `o/漢字/x\n${' '.repeat(7)}^`);
});

test('Telegram hints fall back to escaped text with capitals when a code block cannot hold the input', () => {
  const input = 'https://github.com/o/r`x/issuese/1';
  const start = input.indexOf('issuese');
  assert.equal(formatInputLocationMarkdown(input, { part: 'issuese', start, end: start + 7, label: 'URL path segment' }), 'Check URL path segment *issuese* (column 26):\nhttps://github.com/o/r\\`x/ISSUESE/1');
  assert.match(formatInputLocationMarkdown('a_b', { part: 'a_b', start: 0, end: 3, label: 'URL' }), /^Check URL:\n```\na_b\n\^\^\^\n```$/);
});

test('Telegram legacy-Markdown fallback keeps backslashes as typed', () => {
  // Outside entities legacy Markdown reads `\` as an escape only before _ * ` [, so `\\_` shows `\_`.
  assert.equal(formatInputLocationMarkdown('o\\_r`x', { part: 'r', start: 3, end: 4 }), 'Check input *r* (column 4):\no\\\\_R\\`x');
  assert.equal(formatInputLocationMarkdown('o/r`\\x', { part: '`\\', start: 3, end: 5 }), 'Check input "\\`\\\\" (column 4):\no/r\\`\\x');
});

test('Telegram /task replies use the same caret block', () => {
  const input = 'https://github.com/o/r/issuese/1';
  const reply = formatTaskUrlError(parseTaskIssueUrl(input), input);
  assert.match(reply, /\*issuese\* \(column 24\):\n```\nhttps:\/\/github\.com\/o\/r\/issuese\/1\n {23}\^{7}\n```/);
  assert.equal(reply.split('\n').at(-1), '💡 Did you mean `https://github.com/o/r/issues/1`?');
});

for (const [input, part, suggestion] of [
  ['https://github.com/o/r/issuse/1?tab=foo#bar', 'issuse', 'https://github.com/o/r/issues/1?tab=foo#bar'],
  ['https://github.com/o/r/pul/2', 'pul', 'https://github.com/o/r/pull/2'],
  ['https://githb.com/o/r/issues/1', 'githb.com', 'https://github.com/o/r/issues/1'],
  ['https://github.com/issuese/issuese/issuese/1', 'issuese', 'https://github.com/issuese/issuese/issues/1'],
  ['o/r/issuese/1', 'issuese', 'o/r/issues/1'],
  ['https://github.com/o/r/issues/one', 'one', undefined],
  ['https://github.com/o/r/unknown/1', 'unknown', undefined],
]) {
  test(`locates the actual malformed segment in ${input}`, () => {
    const parsed = parseGitHubUrl(input);
    assert.equal(parsed.inputLocation.part, part);
    assert.equal(input.slice(parsed.inputLocation.start, parsed.inputLocation.end), part);
    assert.equal(parsed.suggestion, suggestion);
  });
}

test('valid targets and existing URL recovery retain their behavior', () => {
  for (const input of [issueUrl, issueUrl.replace('/issues/', '/pull/'), 'https://github.com/o/r']) {
    assert.equal(validateTelegramGitHubUrl(input, { allowedTypes: ['issue', 'pull', 'repo'] }).valid, true);
    assert.equal(parseGitHubUrl(input).inputHint, undefined);
  }
  assert.equal(parseGitHubUrl('https://github.com/o/r/pulls/2').type, 'pull');
  assert.equal(parseGitHubUrl('https://github.com/o/r/pulls/2').recovered, true);
  assert.equal(parseGitHubUrl('https://github.com/o/r/pull/1/files').type, 'pull');
});

test('URL rejections echo input even when no safe correction is known', () => {
  for (const input of ['https://example.com/o/r/issues/1', 'https://github.com/o/r/pull', 'https://github.com/o/r/actions/runs/1']) {
    const result = validateTelegramGitHubUrl(input);
    assert.equal(result.valid, false);
    const lines = result.error.split('\n');
    assert.equal(lines[lines.indexOf('```') + 1], input, 'the complete URL is echoed above the caret line');
    assert.equal(result.suggestion, undefined);
  }
  assert.match(validateTelegramGitHubUrl('https://github.com/o/r/pull').error, /NUMBER/);
  assert.equal(validateTelegramGitHubUrl(null).valid, false);
});

test('unrepaired URLs distinguish missing numbers from extra paths', () => {
  assert.match(parseGitHubUrl('https://github.com/o/r/pull', { recover: false }).inputHint, /^Expected an issue or pull request number at column 28:/);
  const parsed = parseGitHubUrl('https://github.com/o/r/pull/1/files', { recover: false });
  assert.equal(parsed.inputLocation.part, 'files');
  assert.match(parsed.inputHint, /extra URL path/);
});

test('malformed flags include the original token and position', () => {
  const result = detectMalformedFlags([issueUrl, '-think', 'high', '--', 'model', 'opus']);
  assert.match(result.errors[0], /argument 2: "-think"/);
  assert.match(result.errors[1], /arguments 4–5: "-- model"/);
});

test('every unknown flag is located, while unrelated values stay private', async () => {
  await assert.rejects(
    () => parseArgsWithYargs([issueUrl, '--modl', 'opus', '--tink', 'high', '--token', 'secret-fixture'], getLinoYargsFactory(), createYargsConfig),
    error => {
      assert.match(error.message, /argument 2: "--modl"/);
      assert.match(error.message, /argument 4: "--tink"/);
      assert.equal(error.message.includes('secret-fixture'), false);
      return true;
    }
  );
});

test('invalid option values show the flag, value, and position', async () => {
  await assert.rejects(() => parseArgsWithYargs([issueUrl, '--tool=cluade'], getLinoYargsFactory(), createYargsConfig), /argument 2: "--tool=cluade"/);
  await assert.rejects(() => parseArgsWithYargs([issueUrl, '--think', 'hihg'], getLinoYargsFactory(), createYargsConfig), /argument 2: "--think hihg"/);
});

test('enhancement is idempotent and preserves error metadata', () => {
  const error = Object.assign(new Error('Unknown argument: modl'), { name: 'ValidationError', _enhanced: true });
  const enhanced = enhanceArgumentError(error, ['--modl']);
  assert.equal(enhanced.name, error.name);
  assert.equal(enhanced.cause, error);
  assert.equal(enhanced._enhanced, true);
  assert.equal(enhanceArgumentError(enhanced, ['--modl']), enhanced);
});

test('solve retains unknown-option suggestions instead of dropping the input', async () => {
  await assert.rejects(() => parseArguments(getLinoYargsFactory(), () => [issueUrl, '--modl', 'opus']), /argument 2: "--modl"/);
});
