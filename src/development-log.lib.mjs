import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

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

const copyIfExists = async ({ sourcePath, destinationPath }) => {
  if (!(await fileExists(sourcePath))) return false;
  await fs.copyFile(sourcePath, destinationPath);
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
  for (const candidate of candidates) {
    if (!candidate.sourcePath || seenSources.has(candidate.sourcePath)) continue;
    seenSources.add(candidate.sourcePath);

    const relativePath = `${sessionRelativeDirectory}/${safeFileName(candidate.destinationName)}`;
    const copiedPath = path.join(sessionDirectory, safeFileName(candidate.destinationName));
    if (await copyIfExists({ sourcePath: candidate.sourcePath, destinationPath: copiedPath })) {
      copied.push(addDotSlash(toPosixPath(relativePath)));
    }
  }

  return copied;
};

export const writeDevelopmentLogArtifacts = async ({ repositoryPath, logFile, issueNumber, prNumber, tool, sessionId, branchName, rawCommand, now = new Date(), homeDir = os.homedir() }) => {
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
  if (logFile) {
    copiedLogRelativePath = `${sessionRelativeDirectory}/solve.log`;
    await fs.copyFile(logFile, path.join(repositoryPath, copiedLogRelativePath));
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
    schemaVersion: 2,
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
      sessionFiles,
    },
  };

  await fs.writeFile(path.join(repositoryPath, metadataRelativePath), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');

  return {
    developmentLogDirectory,
    caseStudyDirectory,
    relativeDirectory,
    sessionRelativeDirectory,
    copiedLogRelativePath: copiedLogRelativePath ? toPosixPath(copiedLogRelativePath) : null,
    metadataRelativePath: toPosixPath(metadataRelativePath),
    sessionFiles,
  };
};

const getCommandOutput = result => (result?.stderr?.toString?.() || result?.stdout?.toString?.() || '').trim();

export const collectAndCommitDevelopmentLogArtifacts = async ({ enabled, repositoryPath, logFile, issueNumber, prNumber, tool, sessionId, branchName, rawCommand, $, log }) => {
  if (!enabled) {
    return { skipped: 'disabled' };
  }

  if (!repositoryPath) {
    await log?.('⚠️  Development log requested but no repository path is available', { level: 'warning' });
    return { skipped: 'missing-repository-path' };
  }

  try {
    const artifacts = await writeDevelopmentLogArtifacts({
      repositoryPath,
      logFile,
      issueNumber,
      prNumber,
      tool,
      sessionId,
      branchName,
      rawCommand,
    });

    await log?.(`🧾 Development log artifacts written to ${artifacts.developmentLogDirectory}`);

    if (!$) {
      return { ...artifacts, committed: false, pushed: false };
    }

    const addResult = await $({ cwd: repositoryPath })`git add -f -- ${artifacts.relativeDirectory}`;
    if (addResult.code !== 0) {
      await log?.(`⚠️  Could not stage development log: ${getCommandOutput(addResult)}`, { level: 'warning' });
      return { ...artifacts, committed: false, pushed: false };
    }

    const diffResult = await $({ cwd: repositoryPath })`git diff --cached --quiet -- ${artifacts.relativeDirectory}`;
    if (diffResult.code === 0) {
      await log?.('ℹ️  Development log artifacts already committed');
      return { ...artifacts, committed: false, pushed: false };
    }
    if (diffResult.code !== 1) {
      await log?.(`⚠️  Could not inspect staged development log changes: ${getCommandOutput(diffResult)}`, { level: 'warning' });
      return { ...artifacts, committed: false, pushed: false };
    }

    const commitMessage = prNumber ? `Add development log for issue #${issueNumber} PR #${prNumber}` : `Add development log for issue #${issueNumber}`;
    const commitResult = await $({ cwd: repositoryPath })`git commit -m ${commitMessage} -- ${artifacts.relativeDirectory}`;
    if (commitResult.code !== 0) {
      await log?.(`⚠️  Could not commit development log: ${getCommandOutput(commitResult)}`, { level: 'warning' });
      return { ...artifacts, committed: false, pushed: false };
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
    return { skipped: 'error', error };
  }
};
