import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sanitizeForPublication } from './token-sanitization.lib.mjs';
import { findResidualCredentialBlock } from './log-sanitize-stream.lib.mjs';
import { sanitizeLogFileToFileBounded } from './log-sanitize-worker.lib.mjs';

const sanitizePathSegment = (value, fallback) => {
  const raw = value === null || value === undefined || value === '' ? fallback : String(value);
  const sanitized = raw.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return sanitized || fallback;
};

const stripDotSlash = value => value.replace(/^\.\//, '');
const toPosixPath = value => value.split(path.sep).join('/');
const addDotSlash = value => (value.startsWith('./') ? value : `./${value}`);

const safeFileName = value => sanitizePathSegment(value, 'session');

export const buildDevelopmentLogDirectory = ({ issueNumber, prNumber }) => {
  const issueSegment = sanitizePathSegment(issueNumber, 'unknown');
  const prSegment = sanitizePathSegment(prNumber, 'pending');
  return `./dev/log/issues/${issueSegment}/pulls/${prSegment}`;
};

export const buildCaseStudyDirectory = ({ issueNumber }) => {
  const issueSegment = sanitizePathSegment(issueNumber, 'unknown');
  return `./docs/case-studies/issue-${issueSegment}`;
};

// Normalize a GitHub issue type (or label) into one of the buckets the
// development-log prompt distinguishes. Bug issues get the stronger
// "download all logs" wording; everything else (feature, task, or an
// unspecified/unknown type) gets the universal data-collection wording.
export const isBugIssueType = issueType => {
  if (issueType === null || issueType === undefined) return false;
  const normalized = String(issueType).trim().toLowerCase();
  if (!normalized) return false;
  return normalized === 'bug' || normalized === 'bugs' || normalized.includes('bug') || normalized === 'defect';
};

// True when the run requested the development log via --development-log
// (yargs exposes both the camelCase and kebab-case keys).
export const isDevelopmentLogEnabled = argv => argv?.developmentLog === true || argv?.['development-log'] === true;

export const isIssueTypeAwarePromptEnabled = argv => isDevelopmentLogEnabled(argv) || argv?.deepAnalysis === true || argv?.['deep-analysis'] === true;

export const buildDevelopmentLogPrompt = ({ argv, issueNumber, prNumber, issueType }) => {
  if (!(argv?.developmentLog || argv?.['development-log'])) return '';

  const developmentLogDirectory = buildDevelopmentLogDirectory({ issueNumber, prNumber });
  // Automatic support for issue types: when the issue type is "bug" the
  // instruction asks to download all logs as well; for feature/task issues, or
  // when no issue type is selected, the universal data-collection wording is used.
  const resolvedIssueType = issueType ?? argv?.issueType ?? null;
  const collectionInstruction = isBugIssueType(resolvedIssueType) ? `Download all logs and collect data related about the issue to this repository, make sure we compile that data into the ${developmentLogDirectory} folder.` : `Collect data related about the issue to this repository, make sure we compile that data into the ${developmentLogDirectory} folder.`;

  return `\n${collectionInstruction}\n`;
};

// Fetch the GitHub issue type (e.g. "Bug", "Feature", "Task") for an issue.
// Returns null when the type cannot be determined (no type selected, command
// failure, or non-issue targets). Accepts an injectable command runner so the
// behavior can be unit tested without hitting the network.
export const fetchIssueType = async ({ owner, repo, issueNumber, $, log }) => {
  if (!owner || !repo || !issueNumber || typeof $ !== 'function') return null;
  try {
    // eslint-disable-next-line gh-rate-limit/no-direct-gh-exec -- $ is the injected, rate-limit-safe runner (wrapDollarWithGhRetry) passed in by the caller.
    const result = await $`gh issue view ${issueNumber} --repo ${owner}/${repo} --json issueType`;
    if (result?.code && result.code !== 0) return null;
    const stdout = result?.stdout?.toString?.() ?? String(result?.stdout ?? '');
    if (!stdout.trim()) return null;
    const parsed = JSON.parse(stdout);
    const name = parsed?.issueType?.name;
    return name ? String(name) : null;
  } catch (error) {
    await log?.(`ℹ️  Could not determine issue type: ${error.message}`, { verbose: true });
    return null;
  }
};

const fileExists = async filePath => {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
};

const writePrivatePublicationFile = async (destinationPath, content) => {
  const sanitized = await sanitizeForPublication(content);
  await fs.writeFile(destinationPath, sanitized, { encoding: 'utf8', mode: 0o600 });
  // writeFile preserves the mode of an existing file, so enforce it after
  // every write as well.
  await fs.chmod(destinationPath, 0o600);
};

// Issue #2189: `sanitizeLogFileToFileBounded` creates its destination exclusively
// (`wx`) so a pre-planted symlink cannot be followed. Collection may run more
// than once for the same session directory, so drop a previous artifact first —
// unlink-then-O_EXCL keeps the symlink guarantee that a plain truncate loses.
const sanitizeIntoPublicationFile = async ({ sourcePath, destinationPath, startByte = 0, endByte = null }) => {
  await fs.rm(destinationPath, { force: true });
  return sanitizeLogFileToFileBounded({ sourcePath, destPath: destinationPath, startByte, endByte });
};

const copyIfExists = async ({ sourcePath, destinationPath }) => {
  if (!(await fileExists(sourcePath))) return false;
  // Raw local audit sources remain available to the operator but must not be
  // group/world-readable. Only the sanitized copy enters the repository.
  await fs.chmod(sourcePath, 0o600);
  // Issue #2189: transcripts are as large as the run that produced them (the
  // captured incident had a 134 MB one). Sanitize source → destination block by
  // block instead of holding the file, its sanitized twin and the sanitizer's
  // own working copy in the heap at once.
  await sanitizeIntoPublicationFile({ sourcePath, destinationPath });
  return true;
};

const getClaudeSessionFile = ({ repositoryPath, sessionId, homeDir }) => {
  if (!repositoryPath || !sessionId || !homeDir) return null;
  const projectDirName = repositoryPath.replace(/\//g, '-');
  return path.join(homeDir, '.claude', 'projects', projectDirName, `${sessionId}.jsonl`);
};

// Codex CLI stores its transcript ("rollout") under
// ~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<sessionId>.jsonl. The date
// path and timestamp are not derivable from the sessionId, so locate the file
// by recursively matching the sessionId suffix instead.
const findCodexSessionFile = async ({ sessionId, homeDir }) => {
  if (!sessionId || !homeDir) return null;
  const sessionsRoot = path.join(homeDir, '.codex', 'sessions');
  try {
    const entries = await fs.readdir(sessionsRoot, { recursive: true });
    const match = entries.find(entry => typeof entry === 'string' && entry.includes('rollout-') && entry.endsWith(`-${sessionId}.jsonl`));
    return match ? path.join(sessionsRoot, match) : null;
  } catch {
    return null;
  }
};

// Copy a byte range of the solve log into the session directory.
// Issue #2090: each session stores only the slice of the process log that was
// produced while that session was running, so the union of all session
// directories is the complete log instead of N truncated copies of the same
// prefix. Returns the byte offset right after the copied slice.
const copyLogSlice = async ({ logFile, destinationPath, logStartByte = 0 }) => {
  const stat = await fs.stat(logFile);
  await fs.chmod(logFile, 0o600);
  // The log was rotated/truncated since the previous collection: copy it whole.
  const start = Number.isFinite(logStartByte) && logStartByte > 0 && logStartByte <= stat.size ? logStartByte : 0;
  if (stat.size === 0 || start >= stat.size) {
    await writePrivatePublicationFile(destinationPath, '');
    return { logStartByte: start, logEndByte: stat.size };
  }
  await sanitizeIntoPublicationFile({ sourcePath: logFile, destinationPath, startByte: start, endByte: stat.size });
  return { logStartByte: start, logEndByte: stat.size };
};

const copyKnownSessionFiles = async ({ repositoryPath, sessionRelativeDirectory, logFile, sessionId, tool, homeDir }) => {
  if (!sessionId) return [];

  const sessionDirectory = path.join(repositoryPath, sessionRelativeDirectory);
  const candidates = [];
  const logDirectory = logFile ? path.dirname(logFile) : null;

  if (logDirectory) {
    candidates.push({
      sourcePath: path.join(logDirectory, `${sessionId}.log`),
      destinationName: `${tool || 'tool'}-${sessionId}.log`,
    });
  }

  if (tool === 'claude') {
    const claudeSessionFile = getClaudeSessionFile({ repositoryPath, sessionId, homeDir });
    if (claudeSessionFile) {
      candidates.push({
        sourcePath: claudeSessionFile,
        destinationName: `claude-${sessionId}.jsonl`,
      });
    }
  }

  if (tool === 'codex') {
    const codexSessionFile = await findCodexSessionFile({ sessionId, homeDir });
    if (codexSessionFile) {
      candidates.push({
        sourcePath: codexSessionFile,
        destinationName: `codex-${sessionId}.jsonl`,
      });
    }
  }

  const copied = [];
  const seenSources = new Set();
  // Issue #2090: when the tool renamed the running solve log to
  // `<sessionId>.log`, this candidate resolves to the very log file that is
  // already copied as solve.log — copying it again duplicated megabytes per
  // session (PR link-assistant/formal-ai#809 stored two byte-identical 7 MB
  // files). Skip it instead.
  const resolvedLogFile = logFile ? path.resolve(logFile) : null;
  for (const candidate of candidates) {
    if (!candidate.sourcePath || seenSources.has(candidate.sourcePath)) continue;
    seenSources.add(candidate.sourcePath);
    if (resolvedLogFile && path.resolve(candidate.sourcePath) === resolvedLogFile) continue;

    const relativePath = `${sessionRelativeDirectory}/${safeFileName(candidate.destinationName)}`;
    const copiedPath = path.join(sessionDirectory, safeFileName(candidate.destinationName));
    if (await copyIfExists({ sourcePath: candidate.sourcePath, destinationPath: copiedPath })) {
      copied.push(addDotSlash(toPosixPath(relativePath)));
    }
  }

  return copied;
};

export const writeDevelopmentLogArtifacts = async ({ repositoryPath, logFile, issueNumber, prNumber, tool, sessionId, branchName, rawCommand, logStartByte = 0, now = new Date(), homeDir = os.homedir() }) => {
  if (!repositoryPath) {
    throw new Error('repositoryPath is required to write development-log artifacts');
  }

  const developmentLogDirectory = buildDevelopmentLogDirectory({ issueNumber, prNumber });
  const caseStudyDirectory = buildCaseStudyDirectory({ issueNumber });
  const relativeDirectory = stripDotSlash(developmentLogDirectory);
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  const sessionDirectoryName = safeFileName(sessionId || `run-${timestamp}`);
  const sessionRelativeDirectory = `${relativeDirectory}/sessions/${sessionDirectoryName}`;
  const sessionDirectory = path.join(repositoryPath, sessionRelativeDirectory);

  await fs.mkdir(sessionDirectory, { recursive: true });

  let copiedLogRelativePath = null;
  let logSlice = { logStartByte: 0, logEndByte: 0 };
  if (logFile) {
    copiedLogRelativePath = `${sessionRelativeDirectory}/solve.log`;
    logSlice = await copyLogSlice({
      logFile,
      destinationPath: path.join(repositoryPath, copiedLogRelativePath),
      logStartByte,
    });
  }

  const sessionFiles = await copyKnownSessionFiles({
    repositoryPath,
    sessionRelativeDirectory,
    logFile,
    sessionId,
    tool,
    homeDir,
  });

  const metadataRelativePath = `${sessionRelativeDirectory}/metadata.json`;
  const metadata = {
    // v3 (issue #2090): one directory per tool session, `solve.log` holds only
    // this session's slice of the process log (see solveLogRange).
    schemaVersion: 3,
    collectedAt: now.toISOString(),
    issueNumber: issueNumber ?? null,
    prNumber: prNumber ?? null,
    branchName: branchName || null,
    tool: tool || null,
    sessionId: sessionId || null,
    rawCommand: rawCommand || null,
    developmentLogDirectory,
    caseStudyDirectory,
    artifacts: {
      solveLog: copiedLogRelativePath ? addDotSlash(toPosixPath(copiedLogRelativePath)) : null,
      solveLogRange: copiedLogRelativePath ? { startByte: logSlice.logStartByte, endByte: logSlice.logEndByte } : null,
      sessionFiles,
    },
  };

  await writePrivatePublicationFile(path.join(repositoryPath, metadataRelativePath), `${JSON.stringify(metadata, null, 2)}\n`);

  return {
    developmentLogDirectory,
    caseStudyDirectory,
    relativeDirectory,
    sessionRelativeDirectory,
    copiedLogRelativePath: copiedLogRelativePath ? toPosixPath(copiedLogRelativePath) : null,
    metadataRelativePath: toPosixPath(metadataRelativePath),
    sessionFiles,
    logStartByte: logSlice.logStartByte,
    logEndByte: logSlice.logEndByte,
  };
};

const verifyDevelopmentLogDirectory = async directoryPath => {
  const entries = await fs.readdir(directoryPath, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const parentPath = entry.parentPath || entry.path;
    const filePath = path.join(parentPath, entry.name);
    // Issue #2189: rescan block by block. Reading each artifact back whole made
    // the verification cost as much heap as the artifact — on top of the copy
    // that had just been written.
    const residual = await findResidualCredentialBlock(filePath);
    if (residual) {
      throw new Error('Development-log publication rescan found residual credential material.');
    }
    await fs.chmod(filePath, 0o600);
  }
};

const getCommandOutput = result => (result?.stderr?.toString?.() || result?.stdout?.toString?.() || '').trim();

/**
 * Issue #2135: leave no untracked residue behind when publication fails.
 *
 * The artifacts are written into the user's workspace *before* they can be
 * verified, staged and committed. When any of those steps fails the copies stay
 * on disk, and every later `git status --porcelain` reports them:
 *
 *     ⚠️  Development log collection failed: Development-log publication rescan
 *         found residual credential material.
 *     ?? dev/log/issues/191/pulls/192/sessions/
 *     📝 Found uncommitted changes
 *     🔄 AUTO-RESTART: Restarting Claude to handle uncommitted changes...
 *
 * The restarted session is then told it MUST commit those changes - so hive-mind
 * asks the AI to commit hive-mind's own session log into the user's branch, and
 * the next `gh pr diff` carries it (docs/case-studies/issue-2135, RC6).
 *
 * The copies are exactly that - copies; the originals stay in the session log
 * and the tool's own state directory, so discarding them loses nothing. Only
 * this run's session directory is removed, and only while it is still
 * uncommitted.
 *
 * @param {object} params
 * @param {string} params.repositoryPath
 * @param {string} params.sessionRelativeDirectory - this run's session directory
 * @param {string} params.relativeDirectory - the development-log directory that may hold staged paths
 * @param {Function} [params.$]
 * @param {Function} [params.log]
 * @returns {Promise<{discarded: boolean, reason?: string}>}
 */
export const discardUnpublishedDevelopmentLog = async ({ repositoryPath, sessionRelativeDirectory, relativeDirectory, $, log }) => {
  if (!repositoryPath || !sessionRelativeDirectory) {
    return { discarded: false, reason: 'nothing-to-discard' };
  }

  if ($ && relativeDirectory) {
    // Unstage first: `git add -f` may already have run, and a staged-but-uncommitted
    // path is just as good at triggering the restart loop as an untracked one.
    try {
      await $({ cwd: repositoryPath })`git reset -q -- ${relativeDirectory}`;
    } catch (error) {
      await log?.(`⚠️  Could not unstage development log artifacts: ${error.message}`, { level: 'warning' });
    }
  }

  try {
    await fs.rm(path.join(repositoryPath, sessionRelativeDirectory), { recursive: true, force: true });
  } catch (error) {
    await log?.(`⚠️  Could not remove unpublished development log artifacts in ${sessionRelativeDirectory}: ${error.message}`, { level: 'warning' });
    return { discarded: false, reason: 'unremovable' };
  }

  await log?.(`🧹 Discarded unpublished development log artifacts in ${sessionRelativeDirectory} so they cannot be mistaken for the AI's uncommitted work (issue #2135)`);
  return { discarded: true };
};

export const collectAndCommitDevelopmentLogArtifacts = async ({ enabled, repositoryPath, logFile, issueNumber, prNumber, tool, sessionId, branchName, rawCommand, logStartByte = 0, $, log }) => {
  if (!enabled) {
    return { skipped: 'disabled' };
  }

  if (!repositoryPath) {
    await log?.('⚠️  Development log requested but no repository path is available', { level: 'warning' });
    return { skipped: 'missing-repository-path' };
  }

  // Issue #2048: verbose trace so the commit timing (relative to PR readiness signals) is diagnosable from logs.
  await log?.(`🔍 Development log finalize: issue #${issueNumber ?? '?'}, PR #${prNumber ?? 'pending'}, branch ${branchName ?? 'none'}, session ${sessionId ?? 'none'}, log slice from byte ${logStartByte}`, { verbose: true });

  // Kept outside the try so the failure paths below (and the catch) can clean up
  // the copies this run wrote into the workspace - see issue #2135, RC6.
  let artifacts = null;
  // Unstaging is only meaningful once staging has been attempted, and issue
  // #2111 requires that no git command run before the residual-credential
  // rescan - so the cleanup gets `$` only after `git add` was reached.
  let stagingAttempted = false;
  const discardArtifacts = async () =>
    discardUnpublishedDevelopmentLog({
      repositoryPath,
      sessionRelativeDirectory: artifacts?.sessionRelativeDirectory,
      relativeDirectory: artifacts?.relativeDirectory,
      $: stagingAttempted ? $ : null,
      log,
    });

  try {
    artifacts = await writeDevelopmentLogArtifacts({
      repositoryPath,
      logFile,
      issueNumber,
      prNumber,
      tool,
      sessionId,
      branchName,
      rawCommand,
      logStartByte,
    });

    await log?.(`🧾 Development log artifacts written to ${artifacts.sessionRelativeDirectory} (log bytes ${artifacts.logStartByte}-${artifacts.logEndByte})`, { verbose: true });
    await log?.(`🧾 Development log artifacts written to ${artifacts.developmentLogDirectory}`);

    if (!$) {
      return { ...artifacts, committed: false, pushed: false };
    }

    // Scan the exact directory bytes immediately before staging. This catches
    // future artifacts added by this workflow even if their writer forgot to
    // call the publication helper.
    await verifyDevelopmentLogDirectory(path.join(repositoryPath, artifacts.relativeDirectory));

    stagingAttempted = true;
    const addResult = await $({ cwd: repositoryPath })`git add -f -- ${artifacts.relativeDirectory}`;
    if (addResult.code !== 0) {
      await log?.(`⚠️  Could not stage development log: ${getCommandOutput(addResult)}`, { level: 'warning' });
      await discardArtifacts();
      return { ...artifacts, committed: false, pushed: false, discarded: true };
    }

    const diffResult = await $({ cwd: repositoryPath })`git diff --cached --quiet -- ${artifacts.relativeDirectory}`;
    if (diffResult.code === 0) {
      await log?.('ℹ️  Development log artifacts already committed');
      return { ...artifacts, committed: false, pushed: false };
    }
    if (diffResult.code !== 1) {
      await log?.(`⚠️  Could not inspect staged development log changes: ${getCommandOutput(diffResult)}`, { level: 'warning' });
      await discardArtifacts();
      return { ...artifacts, committed: false, pushed: false, discarded: true };
    }

    const commitMessage = prNumber ? `Add development log for issue #${issueNumber} PR #${prNumber}` : `Add development log for issue #${issueNumber}`;
    const commitResult = await $({ cwd: repositoryPath })`git commit -m ${commitMessage} -- ${artifacts.relativeDirectory}`;
    if (commitResult.code !== 0) {
      await log?.(`⚠️  Could not commit development log: ${getCommandOutput(commitResult)}`, { level: 'warning' });
      await discardArtifacts();
      return { ...artifacts, committed: false, pushed: false, discarded: true };
    }

    await log?.('✅ Development log committed');

    if (!branchName) {
      await log?.('ℹ️  Development log committed locally; no branch name available for push');
      return { ...artifacts, committed: true, pushed: false };
    }

    const pushResult = await $({ cwd: repositoryPath })`git push origin ${branchName}`;
    if (pushResult.code !== 0) {
      await log?.(`⚠️  Could not push development log commit: ${getCommandOutput(pushResult)}`, { level: 'warning' });
      return { ...artifacts, committed: true, pushed: false };
    }

    await log?.('✅ Development log pushed');
    return { ...artifacts, committed: true, pushed: true };
  } catch (error) {
    await log?.(`⚠️  Development log collection failed: ${error.message}`, { level: 'warning' });
    const cleanup = await discardArtifacts();
    return { skipped: 'error', error, discarded: cleanup.discarded };
  }
};
