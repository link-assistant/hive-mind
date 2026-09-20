/**
 * Helpers for reporting ESLint warnings only on changed lines.
 *
 * Errors are always reported, everywhere. Warnings are noise when they come
 * from untouched code: every run repeats the same findings and hides the new
 * ones. These helpers map a unified diff to the set of added/modified lines per
 * file and drop warnings that fall outside that set.
 */

import path from 'node:path';

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/**
 * Parse a unified diff into a map of file path -> Set of changed line numbers
 * (line numbers of the new file revision).
 *
 * @param {string} diff unified diff text (`git diff -U0`)
 * @returns {Map<string, Set<number>>}
 */
export function parseChangedLines(diff) {
  const changed = new Map();
  let currentFile = null;
  let lineNumber = 0;

  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      const target = line.slice(4).trim();
      currentFile = target === '/dev/null' ? null : target.replace(/^b\//, '');
      if (currentFile && !changed.has(currentFile)) {
        changed.set(currentFile, new Set());
      }
      continue;
    }

    const hunk = HUNK_HEADER.exec(line);
    if (hunk) {
      lineNumber = Number(hunk[1]);
      continue;
    }

    if (!currentFile) {
      continue;
    }

    if (line.startsWith('+')) {
      changed.get(currentFile).add(lineNumber);
      lineNumber += 1;
    } else if (line.startsWith(' ')) {
      lineNumber += 1;
    }
  }

  return changed;
}

function relativePath(filePath, cwd) {
  return path.relative(cwd, filePath).split(path.sep).join('/');
}

/**
 * Keep every error, and keep warnings only when they touch a changed line of a
 * changed file.
 *
 * @param {Array<object>} results ESLint result objects
 * @param {Map<string, Set<number>|true>} changedLines from {@link parseChangedLines};
 *   a `true` value means the whole file is new

 * @param {string} cwd directory the result paths are relative to
 * @returns {Array<object>} filtered ESLint results
 */
export function filterWarningsToChangedLines(results, changedLines, cwd) {
  return results.map((result) => {
    const fileChanges = changedLines.get(relativePath(result.filePath, cwd));

    const messages = result.messages.filter((message) => {
      if (message.severity !== 1) {
        return true;
      }

      if (!fileChanges) {
        return false;
      }

      // `true` marks a wholly new file: every line counts as changed.
      if (fileChanges === true) {
        return true;
      }

      const start = message.line ?? 0;
      const end = message.endLine ?? start;

      for (let line = start; line <= end; line += 1) {
        if (fileChanges.has(line)) {
          return true;
        }
      }

      return false;
    });

    return {
      ...result,
      messages,
      warningCount: messages.filter((message) => message.severity === 1).length,
      fixableWarningCount: messages.filter(
        (message) => message.severity === 1 && message.fix
      ).length,
    };
  });
}
