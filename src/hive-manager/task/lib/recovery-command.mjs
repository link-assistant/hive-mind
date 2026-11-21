import { parseGitHubUrl } from '../../../github-url-parser.lib.mjs';
import { buildResumeCommand, selectLastSessionId } from '../../../session-resume.lib.mjs';
import { buildShellCommand } from '../../../shell-command.lib.mjs';
import { applySolveToolAlias, SOLVE_COMMAND_NAMES, TOOL_SOLVE_COMMAND_ALIASES } from '../../../telegram-solve-command.lib.mjs';
import { readAttemptEvidence } from './evidence.mjs';

export function issueTarget(url) {
  if (!/^https:\/\/github\.com\//i.test(url ?? '')) return null;
  const target = parseGitHubUrl(url, { recover: false });
  return target.valid && ['issue', 'pull'].includes(target.type) ? target.canonical.toLowerCase() : null;
}

export function solveTask(command) {
  if (typeof command !== 'string') return {};
  const alias = /^\s*\/([\w-]+)\s+['"]?(https:\/\/github\.com\/[^\s'";]+)['"]?(?=\s|$)/i.exec(command);
  if (alias) {
    const name = alias[1].toLowerCase();
    return { target: issueTarget(alias[2]), alias: name, knownAlias: SOLVE_COMMAND_NAMES.includes(name) };
  }
  const solve = /(?:^\s*|;\s*exec\s+)(?:'solve'|"solve"|solve)\s+['"]?(https:\/\/github\.com\/[^\s'";]+)['"]?(?=\s|$)/i.exec(command);
  return { target: issueTarget(solve?.[1]) };
}

// Read literal words from the stored command without asking a shell to evaluate it.
function literalArgs(text) {
  const word = /(?:"(?:\\["\\]|[^"\\])*"|'[^']*'|\\[^\r\n]|[^\s"'\\;&|<>()`$])+/y;
  const space = /[ \t]*/y;
  const args = [];
  let index = 0;
  while (index < text.length) {
    space.lastIndex = index;
    space.exec(text);
    if (space.lastIndex === text.length) break;
    word.lastIndex = space.lastIndex;
    const match = word.exec(text);
    if (!match || (word.lastIndex < text.length && !/[ \t]/.test(text[word.lastIndex]))) return null;
    args.push(match[0].replace(/"((?:\\["\\]|[^"\\])*)"|'([^']*)'|\\(.)/g, (_, doubleQuoted, singleQuoted, escaped) => doubleQuoted?.replace(/\\(["\\])/g, '$1') ?? singleQuoted ?? escaped));
    index = word.lastIndex;
  }
  return args;
}

export async function aliasResumeCommand(task, alias, target) {
  const args = literalArgs(task.command.trim());
  if (args?.[0].toLowerCase() !== `/${alias}` || issueTarget(args[1]) !== target) return null;
  const solveArgs = applySolveToolAlias(args.slice(1), TOOL_SOLVE_COMMAND_ALIASES[alias]);
  const { text } = await readAttemptEvidence(task.logPath, 0, Infinity);
  const resume = buildResumeCommand({ sessionInfo: { command: 'solve', args: solveArgs }, lastSessionId: selectLastSessionId(text) });
  return buildShellCommand('solve', resume?.args ?? solveArgs);
}
