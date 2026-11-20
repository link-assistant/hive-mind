import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, opendir, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { ghWithRateLimitRetry } from '../../github-rate-limit.lib.mjs';
import { archiveRepo, archiveRepoPattern, publishedArchiveRevisions, publishedRevisionName } from './lib/git.mjs';
import { excludedArchiveRepository, redactArchiveIdentity } from './lib/privacy.mjs';
import { publishArchive } from './publish.mjs';
import { sanitizeLogFileToFileBounded } from '../../log-sanitize-worker.lib.mjs';

const execFileAsync = promisify(execFile);
const maxSourceBytes = 40 * 1024 * 1024;
const metadataBytes = 256 * 1024;
const minimumAgeMs = 10 * 60 * 1000;
const usage = `Usage: hive-manager archive-sessions --repo OWNER/REPO --output NEW_DIRECTORY [options]
       hive-manager archive-sessions --repo OWNER/REPO --publish-private OWNER/REPO [options]
Stage sanitized session logs and a manifest for one public GitHub repository.
Options:
  --claude-dir DIRECTORY   Claude projects directory
  --codex-dir DIRECTORY    Codex sessions directory
  --only claude|codex      Select one session format (default: both)
  --limit NUMBER           Maximum number of exports (default: 20 to stage, 3 to publish)
  --published-in OWNER/REPO
                           Skip revisions already published by hive-manager to this destination
  --publish-private OWNER/REPO
                           Publish new sanitized sessions to a verified private destination
  --tool-results           Include sanitized text attachments from eligible Claude sessions
  --lino                   Also convert each sanitized file with the conversation CLI
`;

async function* archiveFiles(directory, extension, depth = 0) {
  if (depth > 12) return;
  let entries;
  try {
    entries = await opendir(directory);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  for await (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* archiveFiles(path, extension, depth + 1);
    else if (entry.isFile() && extension.test(entry.name)) yield path;
  }
}

function githubRepository(remote) {
  if (typeof remote !== 'string') return null;
  const match = /^(?:(?:https:\/\/|ssh:\/\/git@)github\.com\/|git@github\.com:)([^?#]+)$/i.exec(remote.trim());
  const repository = match?.[1].replace(/\.git$/i, '');
  return archiveRepoPattern.test(repository ?? '') ? repository.toLowerCase() : null;
}

async function localRepository(cwd, cache) {
  if (typeof cwd !== 'string' || !cwd.startsWith('/') || cwd.includes('\0')) return null;
  if (!cache.has(cwd)) {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
    let repository = null;
    try {
      const { stdout } = await execFileAsync('git', ['-C', cwd, 'config', '--local', '--no-includes', '--get', 'remote.origin.url'], { env, timeout: 5000, maxBuffer: 4096 });
      repository = githubRepository(stdout);
    } catch {
      // A missing checkout or remote leaves the transcript unattributed.
    }
    cache.set(cwd, repository);
  }
  return cache.get(cwd);
}

async function attributedRepository(file, tool, checkoutCache, parent) {
  const source = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const metadata = Buffer.alloc(metadataBytes);
    const { bytesRead } = await source.read(metadata);
    const lines = metadata.subarray(0, bytesRead).toString('utf8').split('\n');
    for (const line of tool === 'codex' ? lines.slice(0, 1) : lines) {
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      if (tool === 'codex' && record?.type === 'session_meta') {
        const { cwd, git } = record.payload ?? {};
        return git?.repository_url ? githubRepository(git.repository_url) : localRepository(cwd, checkoutCache);
      }
      if (tool === 'claude' && typeof record?.cwd === 'string') return localRepository(record.cwd, checkoutCache);
    }
  } finally {
    await source.close();
  }
  if (
    parent &&
    (
      await lstat(parent).catch(error => {
        if (error.code !== 'ENOENT') throw error;
        return null;
      })
    )?.isFile()
  )
    return attributedRepository(parent, tool, checkoutCache);
  return null;
}

async function requirePublic(repository) {
  const visibility = await ghWithRateLimitRetry(async () => {
    const { stdout } = await execFileAsync('gh', ['api', '--hostname', 'github.com', `repos/${repository}`, '--jq', '.visibility'], { timeout: 15_000, maxBuffer: 4096 });
    return stdout.trim();
  }).catch(() => null);
  if (visibility !== 'public') throw new Error('Could not confirm that the requested GitHub repository is public.');
}

function checkSnapshot(current, sourceInfo) {
  if (current.ino !== sourceInfo.ino || current.dev !== sourceInfo.dev || current.size !== sourceInfo.size || current.mtimeMs !== sourceInfo.mtimeMs || current.ctimeMs !== sourceInfo.ctimeMs) {
    throw new Error('An archive source changed during export. Run the export again after the session has finished.');
  }
}

async function sanitizeStableFile(file, sourceInfo, destPath) {
  await sanitizeLogFileToFileBounded({ sourcePath: file, destPath, transform: redactArchiveIdentity });
  checkSnapshot(await lstat(file), sourceInfo);
}

async function sourceDigest(file, info) {
  const source = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    checkSnapshot(await source.stat(), info);
    const hash = createHash('sha256');
    for await (const data of source.createReadStream({ autoClose: false, end: Math.max(info.size - 1, 0) })) hash.update(data);
    checkSnapshot(await source.stat(), info);
    return hash.digest('hex');
  } finally {
    await source.close();
  }
}

async function planToolResults(session, id) {
  const attachments = [];
  const sessionDirectory = join(dirname(session), basename(session, '.jsonl'));
  const root = join(sessionDirectory, 'tool-results');
  try {
    if (!(await lstat(sessionDirectory)).isDirectory() || !(await lstat(root)).isDirectory()) return attachments;
  } catch (error) {
    if (error.code === 'ENOENT') return attachments;
    throw error;
  }
  let bytes = 0;
  for await (const file of archiveFiles(root, /\.(?:txt|log|jsonl?)$/i)) {
    if (attachments.length >= 100 || bytes >= maxSourceBytes) break;
    const info = await lstat(file);
    if (!info.isFile() || info.size > Math.min(4 * 1024 * 1024, maxSourceBytes - bytes) || Date.now() - info.mtimeMs < minimumAgeMs) continue;
    const hash = createHash('sha256').update(relative(root, file)).digest('hex');
    const archive = `claude-${id}-tool-results/${hash}${extname(file).toLowerCase()}`;
    attachments.push({ archive, file, info });
    bytes += info.size;
  }
  return attachments.sort((a, b) => a.archive.localeCompare(b.archive));
}

async function collect({ root, tool, repository, remaining, output, reports, checkoutCache, lino, toolResultBudget, published }) {
  for await (const file of archiveFiles(root, /\.jsonl$/)) {
    const path = relative(root, file);
    const parts = path.split(sep);
    if (parts.includes('tool-results')) continue;
    const sourceInfo = await lstat(file);
    if (!sourceInfo.isFile() || sourceInfo.size > maxSourceBytes || Date.now() - sourceInfo.mtimeMs < minimumAgeMs) continue;
    const parent = tool === 'claude' && parts.length >= 4 && parts[2] === 'subagents' ? join(root, parts[0], `${parts[1]}.jsonl`) : undefined;
    if ((await attributedRepository(file, tool, checkoutCache, parent)) !== repository) continue;
    const id = createHash('sha256').update(path).digest('hex');
    const archive = `${tool}-${id}.jsonl`;
    const includeResults = tool === 'claude' && Boolean(toolResultBudget);
    const attachments = includeResults ? await planToolResults(file, id) : [];
    const revisionHash = createHash('sha256').update(`hive-manager export v1\0${lino}\0${includeResults}\0${await sourceDigest(file, sourceInfo)}`);
    let attachmentBytes = 0;
    for (const attachment of attachments) {
      revisionHash.update(`\0${attachment.archive}\0${await sourceDigest(attachment.file, attachment.info)}`);
      attachmentBytes += attachment.info.size;
    }
    const revision = `sha256:${revisionHash.digest('hex')}`;
    if (published.has(publishedRevisionName(archive, revision))) continue;
    if (includeResults && (attachments.length > toolResultBudget.files || attachmentBytes > toolResultBudget.bytes)) break;
    const destPath = join(output, archive);
    await sanitizeStableFile(file, sourceInfo, destPath);
    const entry = { tool, archive, revision, sourceBytes: sourceInfo.size, modifiedAt: sourceInfo.mtime.toISOString() };
    if (lino) {
      entry.linksNotation = `${tool}-${id}.lino`;
      try {
        await execFileAsync('conversation', ['import', tool, destPath, join(output, entry.linksNotation)], { timeout: 120_000, maxBuffer: 4096 });
      } catch {
        throw new Error('Could not convert a session to Links Notation. Check that the conversation CLI is installed and supports JSONL import.');
      }
    }
    if (includeResults) {
      entry.toolResults = [];
      if (attachments.length) await mkdir(join(output, `claude-${id}-tool-results`), { mode: 0o700 });
      for (const attachment of attachments) {
        await sanitizeStableFile(attachment.file, attachment.info, join(output, attachment.archive));
        entry.toolResults.push({ archive: attachment.archive, sourceBytes: attachment.info.size });
      }
      toolResultBudget.files -= attachments.length;
      toolResultBudget.bytes -= attachmentBytes;
    }
    reports.push(entry);
    if (--remaining === 0) break;
  }
}

async function archive() {
  const { values } = parseArgs({
    options: {
      help: { type: 'boolean', short: 'h' },
      repo: { type: 'string' },
      output: { type: 'string' },
      'claude-dir': { type: 'string', default: join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects') },
      'codex-dir': { type: 'string', default: join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions') },
      only: { type: 'string' },
      limit: { type: 'string' },
      'published-in': { type: 'string' },
      'publish-private': { type: 'string' },
      'tool-results': { type: 'boolean' },
      lino: { type: 'boolean', default: false },
    },
  });
  if (values.help || process.argv.length === 2) {
    process.stdout.write(usage);
    return;
  }
  const repository = values.repo?.toLowerCase() ?? '';
  const autoPublish = values['publish-private'] !== undefined;
  const destination = (values['publish-private'] ?? values['published-in'])?.toLowerCase();
  const requestedLimit = values.limit ?? (autoPublish ? '3' : '20');
  const limit = Number(requestedLimit);
  if (!archiveRepoPattern.test(repository) || (autoPublish ? values.output !== undefined || values['published-in'] !== undefined : !values.output)) {
    throw new Error('Specify --repo OWNER/REPO with either --output NEW_DIRECTORY or --publish-private OWNER/REPO.');
  }
  if (destination !== undefined && (!archiveRepoPattern.test(destination) || destination === repository)) throw new Error('The published index must be in a separate GitHub repository.');
  if (excludedArchiveRepository(repository)) throw new Error('This source repository is excluded from session archives.');
  if (values.only !== undefined && !['claude', 'codex'].includes(values.only)) throw new Error('--only must be claude or codex.');
  if (!/^\d+$/.test(requestedLimit) || limit < 1 || limit > 100) throw new Error('Archive limit must be between 1 and 100.');
  await requirePublic(repository);
  if (autoPublish && (await archiveRepo(destination)).visibility !== 'private') throw new Error('Scheduled publication requires a private destination.');
  const published = destination ? await publishedArchiveRevisions(repository, destination) : new Set();

  const output = autoPublish ? await mkdtemp(join(tmpdir(), 'hive-archive-staged-')) : resolve(values.output);
  if (!autoPublish) await mkdir(output, { mode: 0o700 });
  let completed = false;
  try {
    const reports = [];
    const toolResultBudget = values['tool-results'] ? { files: 100, bytes: maxSourceBytes } : null;
    const shared = { repository, output, reports, checkoutCache: new Map(), lino: values.lino, toolResultBudget, published };
    if (values.only !== 'codex') await collect({ ...shared, root: resolve(values['claude-dir']), tool: 'claude', remaining: limit });
    if (values.only !== 'claude' && reports.length < limit) await collect({ ...shared, root: resolve(values['codex-dir']), tool: 'codex', remaining: limit - reports.length });
    await requirePublic(repository);
    await writeFile(join(output, 'manifest.json'), `${JSON.stringify({ repository, sessions: reports }, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    if (autoPublish && reports.length) await publishArchive(output, destination, { privateOnly: true });
    else process.stdout.write(`Staged ${reports.length} session(s) for ${repository}.\n`);
    completed = true;
  } finally {
    if (autoPublish || !completed) await rm(output, { recursive: true, force: true });
  }
}

try {
  await archive();
} catch (error) {
  process.stderr.write(`hive-manager: ${error.code ? 'Could not stage session archive.' : error.message}\n`);
  process.exitCode = 1;
}
