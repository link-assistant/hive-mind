/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for issue #2402: the codebase is not a changelog.
 *
 * Text a user reads — CLI help and usage screens, yargs option descriptions,
 * and the Telegram bot locales — describes what the software does now. It must
 * not narrate how it changed ("old behavior", "the default in newer CLIs", "the
 * legacy script has been promoted"), and it must not tag a behaviour with the
 * issue that introduced it ("(issue #1825)", "(#594)", ".../issues/1642").
 * History belongs in `.changeset/*.md`, CHANGELOG.md, commit messages and code
 * comments; see "The code is not a changelog" in docs/CONTRIBUTING.md.
 *
 * The scan reads string literals only; comments may keep their issue links.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2402
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

// Files whose string literals are user-facing help, usage or option text.
const HELP_SOURCES = ['src/solve.config.lib.mjs', 'src/task.config.lib.mjs', 'src/hive.config.lib.mjs', 'src/telegram.config.lib.mjs', 'src/task.mjs', 'src/review.mjs', 'src/reviewers-hive.mjs', 'src/memory-check.mjs', 'src/start-screen.mjs', 'src/cleanup.mjs', 'src/hive-screens.lib.mjs', 'src/hive-models.lib.mjs', 'src/configure-claude.lib.mjs', 'src/telegram-tokens-command.lib.mjs'];

const LOCALE_DIR = 'src/locales';

const PROVENANCE_TAG = [/\b[Ii]ssues? #\d+/, /[(,]\s*#\d+\s*[)）]/, /（[^）]*#\d+）/, /link-assistant\/hive-mind\/issues\/\d+/];

const CHANGE_NARRATION = [/\b(old|previous|legacy) behaviou?r\b/i, /\bin newer (hive|solve|versions?|releases?|CLIs?)\b/i, /\bnewer hive\/solve\b/i, /\bwhat'?s new\b/i, /\bnew in v?\d/i, /\bhas been (promoted|renamed|replaced)\b/i, /\bfrom the legacy\b/i, /\balready ships\b/i];

const BANNED = [...PROVENANCE_TAG, ...CHANGE_NARRATION];

// String literals on lines that are not comments. A trailing `// ...` comment
// is cut first so a comment that quotes something is not mistaken for output.
function stringLiterals(source) {
  const literals = [];
  for (const [index, line] of source.split('\n').entries()) {
    const trimmed = line.trim();
    if (/^(\/\/|\*|\/\*)/.test(trimmed)) continue;
    const code = line.replace(/\s\/\/\s.*$/, '');
    for (const match of code.matchAll(/(['"`])(?:\\.|(?!\1).)*\1/g)) {
      literals.push({ line: index + 1, text: match[0] });
    }
  }
  return literals;
}

// Help screens are multi-line template literals (`FOO_HELP = \`...\`` or
// `console.log(\`Usage: ...\`)`): scan each block as a whole.
function templateBlocks(source) {
  return [...source.matchAll(/(?:_HELP\s*=\s*|_USAGE\s*=\s*|console\.log\()`((?:\\.|[^`\\])*)`/g)].map(match => ({ line: source.slice(0, match.index).split('\n').length, text: match[1] }));
}

function findViolations(file, chunks) {
  const violations = [];
  for (const { line, text } of chunks) {
    for (const pattern of BANNED) {
      if (pattern.test(text)) violations.push(`${file}:${line} matches ${pattern}: ${text.slice(0, 160)}`);
    }
  }
  return violations;
}

// --- The patterns catch what issue #2402 removed -----------------------------

{
  const removed = ['Session terminates after command completes (old behavior)', 'prefer `--isolated screen` (the default in newer hive/solve CLIs)', 'the exact predicate from the legacy hive-screens.sh script', 'Disabled by default (issue #1877).', 'Get private DM forward of /solve completion (experimental, #1688)', 'embed Claude/Codex usage at start, end and delta (#594)', '私聊转发 /solve 完成通知（实验性，#1688）', 'Reference: https://github.com/link-assistant/hive-mind/issues/1642', '--tool agent already ships this way'];
  for (const text of removed) {
    assert.ok(
      BANNED.some(pattern => pattern.test(text)),
      `the scanner must flag: ${text}`
    );
  }

  const allowed = ['Per-run `solve-*.log` / `hive-*.log`, renamed to `<sessionId>.log` once the AI tool reports its session id.', 'Check for a newer version of the agentic CLI before starting the task.', 'Requires Claude Code >= 2.1.12', 'Closed by #${prNumber}'];
  for (const text of allowed) {
    assert.equal(
      BANNED.some(pattern => pattern.test(text)),
      false,
      `the scanner must not flag current-behaviour text: ${text}`
    );
  }
}

// --- Help, usage and option descriptions ------------------------------------

{
  const violations = [];
  for (const file of HELP_SOURCES) {
    const source = readFileSync(file, 'utf8');
    violations.push(...findViolations(file, [...stringLiterals(source), ...templateBlocks(source)]));
  }
  assert.deepEqual([...new Set(violations)], [], 'help and option text must describe current behaviour, not its history');
}

// --- Telegram bot locales ----------------------------------------------------

{
  const files = readdirSync(LOCALE_DIR).filter(name => name.endsWith('.lino'));
  assert.ok(files.length >= 4, 'every locale is scanned');
  const violations = [];
  for (const name of files) {
    const file = `${LOCALE_DIR}/${name}`;
    const chunks = readFileSync(file, 'utf8')
      .split('\n')
      .map((text, index) => ({ line: index + 1, text }));
    violations.push(...findViolations(file, chunks));
  }
  assert.deepEqual(violations, [], 'bot replies must describe current behaviour, not its history');
}

// --- Text the tool publishes on GitHub --------------------------------------

{
  const published = ['src/automation-stop-reporting.lib.mjs', 'src/session-kill-recovery.lib.mjs', 'src/live-input-capabilities.lib.mjs', 'src/solve.repository-mode.lib.mjs'];
  const violations = [];
  for (const file of published) {
    violations.push(...findViolations(file, stringLiterals(readFileSync(file, 'utf8'))));
  }
  assert.deepEqual(violations, [], 'comments, issues and reports posted to GitHub must not carry hive-mind issue provenance');
}

console.log('no-changelog-in-ui-2402.test.mjs: all assertions passed');
