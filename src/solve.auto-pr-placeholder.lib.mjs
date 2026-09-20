/**
 * Placeholder-staging helper for auto PR creation.
 *
 * Extracted from solve.auto-pr.lib.mjs (issue #1825) to keep that module under
 * the max-lines lint budget.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Decide whether a single .gitignore line is a literal entry for `fileName`.
 *
 * We only auto-remove exact placeholder entries (e.g. a line that is just
 * `.gitkeep`, `/.gitkeep`, `.gitkeep/` or `/.gitkeep/`). Glob rules such as
 * `.git*` are intentionally left untouched: removing them could un-ignore
 * unrelated files, which the user did not ask for.
 *
 * @param {string} line - raw .gitignore line.
 * @param {string} fileName - placeholder file name (e.g. `.gitkeep`).
 * @returns {boolean}
 */
function isLiteralIgnoreEntry(line, fileName) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return false;
  }
  // Normalize away an optional leading "/" (anchored) and trailing "/" (dir).
  const normalized = trimmed.replace(/^\//, '').replace(/\/$/, '');
  return normalized === fileName;
}

/**
 * Parse a single `git check-ignore -v <file>` output line.
 *
 * Format (when the rule comes from a file):
 *   <source>:<linenum>:<pattern>\t<pathname>
 *
 * @param {string} output - raw stdout from `git check-ignore -v`.
 * @returns {{source: string, lineNum: number, pattern: string} | null}
 */
function parseCheckIgnoreVerbose(output) {
  const firstLine = (output || '')
    .split('\n')
    .map(l => l.trim())
    .find(Boolean);
  if (!firstLine) {
    return null;
  }
  // Split off the trailing "\t<pathname>" so colons in the pathname can't confuse us.
  const meta = firstLine.split('\t')[0];
  // Greedy source match lets us tolerate paths containing ":" (rare); the
  // line number is the last ":<digits>:" group before the pattern.
  const match = meta.match(/^(.*):(\d+):(.*)$/);
  if (!match) {
    return null;
  }
  return { source: match[1], lineNum: Number(match[2]), pattern: match[3] };
}

/**
 * Remove the literal placeholder entry (e.g. `.gitkeep`) from whatever
 * .gitignore file currently causes `fileName` to be ignored, used by the
 * opt-in `--remove-git-keep-from-git-ignore` flow (issue #1825).
 *
 * Walks the ignore chain (`git check-ignore -v`) and strips each literal
 * matching line until the placeholder is no longer ignored. Glob rules and
 * ignore sources outside the working tree (global excludes file) are left
 * untouched and cause the removal to report failure so the caller can fall
 * back to a clear message instead of silently mangling the repo.
 *
 * @returns {Promise<{removed: boolean, reason?: string, modifiedFiles: string[], stagedFiles: string[]}>}
 */
export async function removePlaceholderFromGitignore({ $, tempDir, fileName }) {
  const repoRoot = path.resolve(tempDir);
  const modifiedFiles = [];
  const stagedFiles = [];

  for (let i = 0; i < 50; i++) {
    const stillIgnored = await $({ cwd: tempDir, silent: true })`git check-ignore ${fileName}`;
    if (stillIgnored.code !== 0) {
      // No longer ignored — done.
      return { removed: true, modifiedFiles, stagedFiles };
    }

    const verbose = await $({ cwd: tempDir, silent: true })`git check-ignore -v ${fileName}`;
    const parsed = parseCheckIgnoreVerbose(verbose.stdout ? verbose.stdout.toString() : '');
    if (!parsed) {
      return { removed: false, reason: 'could-not-locate-rule', modifiedFiles, stagedFiles };
    }

    // Only edit ignore files that live inside the working tree.
    const sourcePath = path.resolve(repoRoot, parsed.source);
    if (sourcePath !== repoRoot && !sourcePath.startsWith(repoRoot + path.sep)) {
      return { removed: false, reason: 'rule-outside-worktree', modifiedFiles, stagedFiles };
    }

    let content;
    try {
      content = await fs.readFile(sourcePath, 'utf8');
    } catch {
      return { removed: false, reason: 'cannot-read-ignore-file', modifiedFiles, stagedFiles };
    }

    const lines = content.split('\n');
    const targetLine = lines[parsed.lineNum - 1];
    if (targetLine === undefined || !isLiteralIgnoreEntry(targetLine, fileName)) {
      // The rule is a glob (e.g. ".git*") or otherwise not a literal entry we
      // can safely remove — refuse rather than over-editing the user's config.
      return { removed: false, reason: 'rule-not-literal', modifiedFiles, stagedFiles, pattern: parsed.pattern };
    }

    lines.splice(parsed.lineNum - 1, 1);
    await fs.writeFile(sourcePath, lines.join('\n'));

    const relSource = path.relative(repoRoot, sourcePath);
    if (!modifiedFiles.includes(relSource)) {
      modifiedFiles.push(relSource);
    }

    // Stage committable ignore files (.gitignore); skip non-committable sources
    // such as .git/info/exclude which the un-ignore already takes effect for.
    const insideGitDir = relSource.split(path.sep)[0] === '.git';
    if (!insideGitDir) {
      const addIgnore = await $({ cwd: tempDir, silent: true })`git add ${relSource}`;
      if (addIgnore.code === 0 && !stagedFiles.includes(relSource)) {
        stagedFiles.push(relSource);
      }
    }
  }

  return { removed: false, reason: 'too-many-rules', modifiedFiles, stagedFiles };
}

/**
 * Convenience wrapper: stage the placeholder and, if it failed solely because
 * the repository gitignores it, stop with a clear user-facing explanation
 * (issue #1825). Keeps the auto-PR caller small (it is near the max-lines
 * budget). Returns the {@link addPlaceholderFileToGit} result for any other
 * outcome so the caller can handle genuine failures as before.
 *
 * @returns {Promise<{code: number, ignored: boolean, action: string, stderr: string, removal?: object}>}
 */
export async function stagePlaceholderFileOrExplain(params) {
  const addResult = await addPlaceholderFileToGit(params);
  if (addResult.code !== 0 && addResult.ignored) {
    await reportIgnoredPlaceholderAndThrow({
      fileName: params.fileName,
      issueUrl: params.issueUrl,
      addResult,
      log: params.log,
      formatAligned: params.formatAligned,
    });
  }
  return addResult;
}

/**
 * Log a clear, friendly explanation of why the auto-PR placeholder could not be
 * committed (it is listed in the repository's .gitignore) and then throw a
 * user-facing error so the run stops without a scary stack trace.
 *
 * This is the default behaviour for issue #1825's follow-up: instead of forcing
 * the commit through, we explain the root cause and let the user choose how to
 * proceed (manual fix, or one of the two opt-in flags). The message deliberately
 * stays environment-agnostic — it only mentions the `solve` / `/solve` options.
 *
 * @param {object} params
 * @param {string} params.fileName - placeholder file name (e.g. `.gitkeep`).
 * @param {string} params.issueUrl - issue URL, used to build copy-paste commands.
 * @param {object} [params.addResult] - result from addPlaceholderFileToGit (for the remove-failed reason).
 * @param {Function} params.log - async logger.
 * @param {Function} params.formatAligned - log line formatter.
 * @throws always — the thrown error carries `hiveMindUserFacingLogged = true`.
 */
export async function reportIgnoredPlaceholderAndThrow({ fileName, issueUrl, addResult, log, formatAligned }) {
  const url = issueUrl || '<issue-url>';
  await log('');
  await log(formatAligned('🛑', 'Cannot add placeholder:', `${fileName} is listed in .gitignore`), { level: 'error' });
  await log('');
  await log('  🔍 Root cause:');
  await log(`     The repository's .gitignore matches the temporary placeholder file "${fileName}".`);
  await log('     The placeholder is created only to seed the initial draft pull request and is');
  await log('     removed automatically when the task completes — but git refuses to add an ignored');
  await log('     file, so the initial commit cannot be created.');

  if (addResult?.action === 'remove-failed') {
    await log('');
    await log('  ⚠️  The ignore rule is not a plain "' + fileName + '" entry, so it cannot be removed');
    await log('     automatically (removing it might un-ignore unrelated files). Resolve it manually');
    await log('     or use --force-git-keep-commit.');
  }

  await log('');
  await log('  💡 How to resolve (pick one):');
  await log(`     1. Remove "${fileName}" from .gitignore in the repository, then re-run.`);
  await log('     2. Let the tool remove it for you before committing:');
  await log(`          solve ${url} --remove-git-keep-from-git-ignore`);
  await log(`          /solve ${url} --remove-git-keep-from-git-ignore`);
  await log('     3. Commit the placeholder anyway, ignoring the .gitignore rule:');
  await log(`          solve ${url} --force-git-keep-commit`);
  await log(`          /solve ${url} --force-git-keep-commit`);
  await log('');

  const error = new Error(`Placeholder "${fileName}" is listed in .gitignore; use --remove-git-keep-from-git-ignore or --force-git-keep-commit, or remove it from .gitignore manually.`);
  error.hiveMindUserFacingLogged = true;
  throw error;
}

/**
 * Emit the verbose "git add staged nothing" troubleshooting report and throw.
 *
 * Reached by auto-PR creation when the placeholder file was written but git did
 * not stage any change (e.g. identical content is already tracked, or the file
 * is gitignored in .gitkeep mode). Extracted from solve.auto-pr.lib.mjs to keep
 * that module under the max-lines budget.
 *
 * @param {object} params
 * @param {string} params.fileName - placeholder file name.
 * @param {boolean} params.useClaudeFile - true for CLAUDE.md mode, false for .gitkeep mode.
 * @param {string} params.tempDir - repository working directory.
 * @param {string} params.branchName - target branch (debug info).
 * @param {boolean} params.existingContent - whether the file already existed.
 * @param {Function} params.log - async logger.
 * @param {Function} params.formatAligned - log line formatter.
 * @throws always.
 */
export async function explainNothingStagedAndThrow({ fileName, useClaudeFile, tempDir, branchName, existingContent, log, formatAligned }) {
  await log('');
  await log(formatAligned('❌', 'GIT ADD FAILED:', 'Nothing was staged'), { level: 'error' });
  await log('');
  await log('  🔍 What happened:');
  await log(`     ${fileName} was created but git did not stage any changes.`);
  await log('');
  await log('  💡 Possible causes:');
  await log(`     • ${fileName} already exists with identical content`);
  await log('     • File system sync issue');
  if (!useClaudeFile) {
    await log(`     • ${fileName} is in .gitignore`);
  }
  await log('');
  await log('  🔧 Troubleshooting steps:');
  await log(`     1. Check file exists: ls -la "${tempDir}/${fileName}"`);
  await log(`     2. Check git status: cd "${tempDir}" && git status`);
  if (useClaudeFile) {
    await log(`     3. Force add: cd "${tempDir}" && git add -f ${fileName}`);
  } else {
    await log(`     3. Check if ignored: cd "${tempDir}" && git check-ignore ${fileName}`);
    await log(`     4. Force add: cd "${tempDir}" && git add -f ${fileName}`);
  }
  await log('');
  await log('  📂 Debug information:');
  await log(`     Working directory: ${tempDir}`);
  await log(`     Branch: ${branchName}`);
  if (!useClaudeFile) {
    await log('     Mode: .gitkeep');
  }
  if (existingContent) {
    await log(`     Note: ${fileName} already existed (attempted to update with timestamp)`);
  }
  await log('');
  throw new Error(`Git add staged nothing - ${fileName} may be unchanged${useClaudeFile ? '' : ' or ignored'}`);
}

/**
 * Stage the temporary placeholder file (CLAUDE.md or .gitkeep) used to seed the
 * initial auto-PR commit.
 *
 * The solver writes this placeholder deliberately to create the first commit so
 * a draft PR can be opened, and removes it again once the task completes (see
 * cleanupClaudeFile in solve.results.lib.mjs). When the target repository's
 * .gitignore matches the placeholder — issue #1825: e.g. rumaster/tg-games
 * ignores `.gitkeep` — a plain `git add <file>` exits non-zero with
 * "The following paths are ignored by one of your .gitignore files".
 *
 * Behaviour when the placeholder is git-ignored (issue #1825 follow-up):
 *   - Default: do NOT force anything. Return `action: 'blocked'` so the caller
 *     can explain the root cause and offer the opt-in flags below.
 *   - `--remove-git-keep-from-git-ignore`: strip the literal placeholder entry
 *     from .gitignore, then add normally (`action: 'removed-from-gitignore'`).
 *   - `--force-git-keep-commit`: keep the previous behaviour and force-add with
 *     `git add -f` (`action: 'forced'`).
 *
 * Any add failure that is NOT caused by .gitignore is surfaced unchanged
 * (`action: 'failed'`) so genuine errors are not masked.
 *
 * @param {object} params
 * @param {Function} params.$ - command-stream tagged-template runner.
 * @param {string} params.tempDir - repository working directory.
 * @param {string} params.fileName - placeholder file name (CLAUDE.md or .gitkeep).
 * @param {Function} [params.log] - async logger.
 * @param {Function} [params.formatAligned] - log line formatter.
 * @param {boolean} [params.verbose] - emit verbose diagnostics.
 * @param {boolean} [params.forceGitKeepCommit] - force-add even when ignored.
 * @param {boolean} [params.removeGitKeepFromGitIgnore] - remove the .gitignore entry first.
 * @returns {Promise<{code: number, ignored: boolean, action: string, stderr: string, removal?: object}>}
 */
export async function addPlaceholderFileToGit({ $, tempDir, fileName, log, formatAligned, verbose = false, forceGitKeepCommit = false, removeGitKeepFromGitIgnore = false }) {
  // Run silently: `git add` is quiet on success and only emits the noisy
  // "paths are ignored ... Use -f" hint on failure, which we capture in
  // `stderr` and re-surface from the caller only when the failure is genuine.
  const addResult = await $({ cwd: tempDir, silent: true })`git add ${fileName}`;
  if (addResult.code === 0) {
    return { code: 0, ignored: false, action: 'added', stderr: '' };
  }

  const stderr = addResult.stderr ? addResult.stderr.toString() : '';

  // Determine whether the add failed because the placeholder is git-ignored.
  // `git check-ignore` exits 0 when the path matches a .gitignore rule.
  const checkIgnore = await $({ cwd: tempDir, silent: true })`git check-ignore ${fileName}`;
  const ignored = checkIgnore.code === 0;

  if (!ignored) {
    // The failure was not caused by .gitignore — surface the original error so
    // genuine problems (permissions, corrupt index, ...) are not masked.
    return { code: addResult.code, ignored: false, action: 'failed', stderr };
  }

  // The placeholder is ignored. Resolve based on the opt-in flags.
  if (removeGitKeepFromGitIgnore) {
    if (log && formatAligned) {
      await log(formatAligned('ℹ️', `${fileName} is ignored:`, 'Removing it from .gitignore (--remove-git-keep-from-git-ignore)'));
    }
    const removal = await removePlaceholderFromGitignore({ $, tempDir, fileName });
    if (!removal.removed) {
      // Could not safely remove (glob rule, external source, ...). Block with
      // detail so the caller can explain and suggest --force-git-keep-commit.
      return { code: addResult.code, ignored: true, action: 'remove-failed', stderr, removal };
    }
    if (verbose && log) {
      await log(`   Removed ${fileName} from: ${removal.modifiedFiles.join(', ') || '(none)'}`, { verbose: true });
    }
    const retry = await $({ cwd: tempDir, silent: true })`git add ${fileName}`;
    return {
      code: retry.code,
      ignored: true,
      action: 'removed-from-gitignore',
      stderr: retry.stderr ? retry.stderr.toString() : '',
      removal,
    };
  }

  if (forceGitKeepCommit) {
    if (log && formatAligned) {
      await log(formatAligned('ℹ️', `${fileName} is ignored:`, 'Force-adding placeholder (--force-git-keep-commit)'));
    }
    if (verbose && log) {
      await log(`   ${fileName} matched a .gitignore rule; --force-git-keep-commit is set, retrying with: git add -f ${fileName}`, { verbose: true });
    }
    const forcedResult = await $({ cwd: tempDir, silent: true })`git add -f ${fileName}`;
    return {
      code: forcedResult.code,
      ignored: true,
      action: 'forced',
      stderr: forcedResult.stderr ? forcedResult.stderr.toString() : '',
    };
  }

  // Default: do not force through. Let the caller explain the root cause and
  // offer the opt-in flags or a manual fix (issue #1825 follow-up).
  return { code: addResult.code, ignored: true, action: 'blocked', stderr };
}
