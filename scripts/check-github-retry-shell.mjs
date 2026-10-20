#!/usr/bin/env node
/**
 * The shell half of the `gh-rate-limit` lint rules (issue #3552): every
 * GitHub operation in a production shell script or a workflow `run:` block
 * must go through `scripts/github-retry.mjs`, the CLI over the shared
 * `retryGitHubOperation` loop. ESLint cannot see these files, and a bare
 * `gh release upload` / `git fetch` in a release step dies on the first
 * `HTTP 502` or `fatal error in commit_refs` exactly like the JS ones did.
 *
 * What counts as a GitHub operation is decided by the same
 * `classifyGitHubCommand` the runtime wrappers use. A deliberate single shot
 * is marked with `# github-retry-ok: <reason>` on the line or the one above.
 *
 * Scope: tracked `*.sh` outside experiments/, examples/, docs/ and dev/
 * (archived logs and one-off probes), plus `.github/workflows/*.yml` and
 * `.github/actions/**` `run:` blocks.
 *
 * Usage: node scripts/check-github-retry-shell.mjs [file...]
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { classifyGitHubCommand } from '../src/github-operation-retry.lib.mjs';

export const ESCAPE_COMMENT = 'github-retry-ok:';
const RETRY_CLI = 'github-retry.mjs';
const EXCLUDED_DIRS = /^(experiments|examples|docs|dev|node_modules)\//;

/** Words that run the command after them (`sudo gh ...`, `timeout 30 git fetch`). */
const PREFIX_COMMANDS = new Set(['sudo', 'env', 'command', 'exec', 'time', 'nice', 'nohup', 'then', 'else', 'do', 'if', 'elif', 'while', 'until', '!', '{', '(']);

const stripComment = line => {
  // A `#` starts a comment at the start of a word, outside quotes.
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === '\\' && quote === '"') i++;
    } else if (ch === "'" || ch === '"') quote = ch;
    else if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
};

/** Split a shell line into simple commands on `;`, `&&`, `||`, `|`, `$(`, backticks and parens. */
const segmentsOf = line =>
  line
    .split(/;|&&|\|\||\||\$\(|`|\(|\)/)
    .map(segment => segment.trim())
    .filter(Boolean);

/** Words of a simple command, with quotes removed and leading `VAR=value` / prefix commands skipped. */
const commandWords = segment => {
  const words = (segment.match(/"[^"]*"|'[^']*'|\S+/g) || []).map(word => word.replace(/^["']|["']$/g, ''));
  let i = 0;
  for (;;) {
    const word = words[i];
    if (word === undefined) break;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word) || PREFIX_COMMANDS.has(word)) i++;
    else if (word === 'timeout') i += 2;
    else break;
  }
  return words.slice(i);
};

/** Shell functions defined in the file, mapped to whether their body runs the retry CLI. */
const shellFunctions = lines => {
  const functions = new Map();
  const text = lines.join('\n');
  for (const match of text.matchAll(/(?:^|\n)\s*(?:function\s+)?([A-Za-z_][\w-]*)\s*\(\)\s*\{([\s\S]*?)\n?\s*\}/g)) {
    functions.set(match[1], match[2].includes(RETRY_CLI));
  }
  return functions;
};

/**
 * @param {string[]} lines - shell source lines.
 * @returns {{ line: number, label: string, text: string }[]} unretried GitHub operations (1-based lines).
 */
export const findUnretriedShellOperations = lines => {
  const functions = shellFunctions(lines);
  const violations = [];
  lines.forEach((raw, index) => {
    const escaped = raw.includes(ESCAPE_COMMENT) || (index > 0 && lines[index - 1].includes(ESCAPE_COMMENT));
    for (const segment of segmentsOf(stripComment(raw))) {
      let words = commandWords(segment);
      // `retry gh ...` through a local function: fine when it calls the CLI.
      if (functions.has(words[0]) && (words[1] === 'gh' || words[1] === 'git')) {
        if (functions.get(words[0])) continue;
        words = words.slice(1);
      }
      if (words[0] === 'node' && words[1]?.endsWith(RETRY_CLI)) continue;
      const [tool, ...args] = words;
      if (tool !== 'gh' && tool !== 'git') continue;
      const operation = classifyGitHubCommand(tool, args);
      if (operation && !escaped) violations.push({ line: index + 1, label: operation.label, text: raw.trim() });
    }
  });
  return violations;
};

/**
 * The `run:` blocks of a workflow/action YAML file, as shell lines that keep
 * their original line numbers (every other line is blanked).
 *
 * @param {string} yaml
 * @returns {string[]}
 */
export const workflowRunLines = yaml => {
  const lines = yaml.split('\n');
  const shell = lines.map(() => '');
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(\s*)(?:-\s+)?run:\s*(.*)$/);
    if (!match) continue;
    const keyIndent = match[1].length;
    const value = match[2].trim();
    if (!/^[|>][-+0-9]*$/.test(value)) {
      // A one-line `run: gh ...`; an escape comment on the YAML line above still applies.
      shell[i] = value.replace(/^(['"])(.*)\1$/, '$2') + (i > 0 && lines[i - 1].includes(ESCAPE_COMMENT) ? ` # ${ESCAPE_COMMENT}` : '');
      continue;
    }
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      if (line.trim() !== '' && line.match(/^\s*/)[0].length <= keyIndent) break;
      shell[j] = line;
      i = j;
    }
  }
  return shell;
};

const trackedFiles = () =>
  execFileSync('git', ['ls-files', '*.sh', '.github/workflows/*.yml', '.github/workflows/*.yaml', '.github/actions/**'], { encoding: 'utf8' })
    .split('\n')
    .filter(file => file && !EXCLUDED_DIRS.test(file) && /\.(sh|ya?ml)$/.test(file));

export const checkFiles = files => {
  const violations = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const lines = /\.ya?ml$/.test(file) ? workflowRunLines(text) : text.split('\n');
    for (const violation of findUnretriedShellOperations(lines)) violations.push({ file, ...violation });
  }
  return violations;
};

const isMain = () => {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
};

if (isMain()) {
  const files = process.argv.length > 2 ? process.argv.slice(2) : trackedFiles();
  const violations = checkFiles(files);
  for (const { file, line, label, text } of violations) {
    console.error(`${file}:${line}  \`${label}\` is not retried: ${text}`);
  }
  if (violations.length > 0) {
    console.error(`\n✖ ${violations.length} GitHub operation(s) in shell bypass the shared retry loop (issue #3552).`);
    console.error('  Run them as `node scripts/github-retry.mjs <command...>`, or mark a deliberate single shot with `# github-retry-ok: <reason>`.');
    process.exit(1);
  }
  console.log(`✓ ${files.length} shell/workflow file(s): every GitHub operation runs under the shared retry loop.`);
}
