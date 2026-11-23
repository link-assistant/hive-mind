import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, opendir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { ghWithRateLimitRetry } from '../../github-rate-limit.lib.mjs';
import { archiveRepo, archiveRepoPattern, publishedArchiveRevisions, publishedRevisionName } from './lib/git.mjs';
import { ArchiveLimitError, archiveArtifactBytes, archiveBatchBytes, archiveManifestBytes, archiveMaxArtifacts, transcriptPartBytes } from './lib/limits.mjs';
import { stageTranscriptParts } from './lib/parts.mjs';
import { excludedArchiveRepository, redactArchiveIdentity } from './lib/privacy.mjs';
import { archiveRedactionReceipt, loadArchiveRedactions } from './lib/redactions.mjs';
import { importLegacy } from './import.mjs';
import { publishArchive } from './publish.mjs';
import { sanitizeLogFileToFileBounded } from '../../log-sanitize-worker.lib.mjs';
import { sanitizeForPublication } from '../../token-sanitization.lib.mjs';

const execFileAsync = promisify(execFile);
const metadataBytes = 256 * 1024;
const minute = 60 * 1000;
const usage = `Usage: hive-manager archive-sessions --repo OWNER/REPO --output NEW_DIRECTORY [options]
       hive-manager archive-sessions --repo OWNER/REPO --publish-private OWNER/REPO [options]
       hive-manager archive-sessions --repo OWNER/REPO --import-legacy OWNER/REPO [--apply SHA256] [options]
Stage sanitized session logs or review a legacy index import for one public GitHub repository.
Options:
  --claude-dir DIRECTORY   Claude projects directory
  --codex-dir DIRECTORY    Codex sessions directory
  --only claude|codex      Select one session format (default: both)
  --limit NUMBER           Maximum sessions per batch (default: 20 to stage/import, 3 to publish)
  --min-age MINUTES        Minimum age for transcripts and attachments (default: 10)
  --known-secrets-file FILE
                           Redact extra literals, one per line, for private archives
  --import-legacy OWNER/REPO
                           Preview index entries verified against a private legacy archive
  --apply SHA256           Apply a reviewed legacy import plan
  --published-in OWNER/REPO
                           Skip revisions already published by hive-manager to this destination
  --publish-private OWNER/REPO
                           Publish new unsplit sessions to a verified private destination
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

async function sanitizeStableFile(file, sourceInfo, destPath, redactions) {
  const sanitize = redactions ? text => sanitizeForPublication(redactions.redact(text)) : undefined;
  await sanitizeLogFileToFileBounded({ sourcePath: file, destPath, sanitize, transform: redactArchiveIdentity });
  checkSnapshot(await lstat(file), sourceInfo);
  await redactions?.assertCleanFile(destPath);
}

async function openStableSource(file, info) {
  const source = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    checkSnapshot(await source.stat(), info);
    return source;
  } catch (error) {
    await source.close();
    throw error;
  }
}

async function sourceDigest(file, info, transcript = false) {
  const source = await openStableSource(file, info);
  try {
    const hash = createHash('sha256');
    let recordBytes = 0;
    for await (const data of source.createReadStream({ autoClose: false, end: Math.max(info.size - 1, 0) })) {
      hash.update(data);
      if (!transcript || info.size <= transcriptPartBytes) continue;
      for (let offset = 0; offset < data.length;) {
        const end = data.indexOf(10, offset) + 1;
        recordBytes += (end || data.length) - offset;
        if (recordBytes > transcriptPartBytes) throw new ArchiveLimitError('oversized-record');
        if (end) recordBytes = 0;
        offset = end || data.length;
      }
    }
    checkSnapshot(await source.stat(), info);
    return hash.digest('hex');
  } finally {
    await source.close();
  }
}

async function planToolResults(session, id, cutoff) {
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
    if (attachments.length >= 100 || bytes >= transcriptPartBytes) break;
    const info = await lstat(file);
    if (!info.isFile() || info.size > Math.min(4 * 1024 * 1024, transcriptPartBytes - bytes) || info.mtimeMs > cutoff) continue;
    const hash = createHash('sha256').update(relative(root, file)).digest('hex');
    const archive = `claude-${id}-tool-results/${hash}${extname(file).toLowerCase()}`;
    attachments.push({ archive, file, info });
    bytes += info.size;
  }
  return attachments.sort((a, b) => a.archive.localeCompare(b.archive));
}

async function* discover({ root, tool, repository, checkoutCache, cutoff }, hasRoom) {
  for await (const file of archiveFiles(root, /\.jsonl$/)) {
    if (!hasRoom(tool)) return;
    const path = relative(root, file);
    const parts = path.split(sep);
    if (parts.includes('tool-results')) continue;
    const info = await lstat(file);
    if (!info.isFile() || info.mtimeMs > cutoff) continue;
    const parent = tool === 'claude' && parts.length >= 4 && parts[2] === 'subagents' ? join(root, parts[0], `${parts[1]}.jsonl`) : undefined;
    if ((await attributedRepository(file, tool, checkoutCache, parent)) !== repository) continue;
    yield { file, info, tool, path, parts };
  }
}

async function describeRevision(candidate, { lino, toolResults, cutoff, redactions }) {
  const { file, info, tool, path } = candidate;
  const id = createHash('sha256').update(path).digest('hex');
  const archive = `${tool}-${id}.jsonl`;
  const includeResults = tool === 'claude' && toolResults;
  const attachments = includeResults ? await planToolResults(file, id, cutoff) : [];
  const digest = await sourceDigest(file, info, true);
  const chunked = info.size > transcriptPartBytes;
  const revisionHash = createHash('sha256').update(`hive-manager export v1\0${lino}\0${includeResults}\0${digest}`);
  if (chunked) revisionHash.update(`\0numbered records v1\0${transcriptPartBytes}`);
  let attachmentBytes = 0;
  for (const attachment of attachments) {
    attachment.digest = await sourceDigest(attachment.file, attachment.info);
    revisionHash.update(`\0${attachment.archive}\0${attachment.digest}`);
    attachmentBytes += attachment.info.size;
  }
  if (redactions) revisionHash.update(`\0known literals\0${redactions.digest}`);
  const revision = `sha256:${revisionHash.digest('hex')}`;
  return { id, archive, revision, chunked, includeResults, attachments, attachmentBytes, digest, info };
}

async function convertPart(part, tool, output, redactions) {
  part.linksNotation = part.archive.replace(/\.jsonl$/, '.lino');
  const linksPath = join(output, part.linksNotation);
  try {
    await execFileAsync('conversation', ['import', tool, join(output, part.archive), linksPath], { timeout: 120_000, maxBuffer: 4096 });
  } catch {
    throw new Error('Could not convert a session to Links Notation. Check that the conversation CLI is installed and supports JSONL import.');
  }
  await redactions?.assertCleanFile(linksPath);
}

async function stageCandidate(candidate, descriptor, { output, lino, redactions, budget }) {
  const { file, info, tool } = candidate;
  const { id, archive, revision, chunked, includeResults, attachments } = descriptor;
  const entry = { tool, archive, revision, sourceBytes: info.size, modifiedAt: info.mtime.toISOString() };
  const partBudget = { bytes: budget.bytes, files: Math.floor((budget.files - attachments.length) / (lino ? 2 : 1)) };
  if (partBudget.files < 1) throw new ArchiveLimitError('batch-budget');
  if (chunked) {
    entry.parts = await stageTranscriptParts({ sourcePath: file, output, archive, budget: partBudget, redactions, openSource: () => openStableSource(file, info) });
    checkSnapshot(await lstat(file), info);
  } else {
    await sanitizeStableFile(file, info, join(output, archive), redactions);
  }
  let bytes = 0;
  let files = 0;
  async function account(path) {
    const artifact = await lstat(join(output, path));
    if (!artifact.isFile() || artifact.size > archiveArtifactBytes) throw new ArchiveLimitError('artifact-size');
    bytes += artifact.size;
    files++;
    if (bytes > budget.bytes || files > budget.files) throw new ArchiveLimitError('batch-budget');
  }
  const parts = entry.parts ?? [entry];
  for (const part of parts) await account(part.archive);
  if (lino) {
    for (const part of parts) {
      await convertPart(part, tool, output, redactions);
      await account(part.linksNotation);
    }
  }
  if (includeResults) {
    entry.toolResults = [];
    if (attachments.length) await mkdir(join(output, `claude-${id}-tool-results`), { mode: 0o700 });
    for (const attachment of attachments) {
      await sanitizeStableFile(attachment.file, attachment.info, join(output, attachment.archive), redactions);
      await account(attachment.archive);
      entry.toolResults.push({ archive: attachment.archive, sourceBytes: attachment.info.size });
    }
  }
  return { entry, files, bytes };
}

function reportOmissions(omissions) {
  const details = {
    'oversized-record': 'an individual JSONL record exceeds 40 MiB or could not be sanitized within that bound',
    'review-required': 'numbered transcripts require staging with --output and reviewed private publication with archive-publish',
    'artifact-size': 'an artifact exceeds 64 MiB or is not a regular file',
    'batch-budget': 'the revision exceeds the remaining batch file or size limit',
  };
  for (const [reason, counts] of Object.entries(omissions)) {
    process.stderr.write(`Omitted ${counts.claude + counts.codex} session(s) (${counts.claude} Claude, ${counts.codex} Codex) because ${details[reason]}.\n`);
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
      'min-age': { type: 'string', default: '10' },
      'known-secrets-file': { type: 'string' },
      'import-legacy': { type: 'string' },
      apply: { type: 'string' },
      'published-in': { type: 'string' },
      'publish-private': { type: 'string' },
      'tool-results': { type: 'boolean', default: false },
      lino: { type: 'boolean', default: false },
    },
  });
  if (values.help || process.argv.length === 2) {
    process.stdout.write(usage);
    return;
  }
  const repository = values.repo?.toLowerCase() ?? '';
  const autoPublish = values['publish-private'] !== undefined;
  const importing = values['import-legacy'] !== undefined;
  const destination = (values['import-legacy'] ?? values['publish-private'] ?? values['published-in'])?.toLowerCase();
  const requestedLimit = values.limit ?? (autoPublish ? '3' : '20');
  const limit = Number(requestedLimit);
  const modes = [values.output, values['publish-private'], values['import-legacy']].filter(value => value !== undefined);
  if (!archiveRepoPattern.test(repository) || modes.length !== 1 || !modes[0] || (!values.output && values['published-in'] !== undefined)) {
    throw new Error('Specify --repo OWNER/REPO and choose --output NEW_DIRECTORY, --publish-private OWNER/REPO, or --import-legacy OWNER/REPO.');
  }
  if (destination !== undefined && (!archiveRepoPattern.test(destination) || destination === repository)) throw new Error('The published index must be in a separate GitHub repository.');
  if (excludedArchiveRepository(repository)) throw new Error('This source repository is excluded from session archives.');
  if (values.only !== undefined && !['claude', 'codex'].includes(values.only)) throw new Error('--only must be claude or codex.');
  if (!/^\d+$/.test(requestedLimit) || limit < 1 || limit > 100) throw new Error('Archive limit must be between 1 and 100.');
  const minAgeMs = Number(values['min-age']) * minute;
  if (!/^\d+(?:\.\d+)?$/.test(values['min-age']) || !Number.isFinite(minAgeMs)) throw new Error('--min-age must be a nonnegative number of minutes.');
  const expectedDigest = values.apply === undefined ? undefined : `sha256:${values.apply.replace(/^sha256:/, '')}`;
  if (expectedDigest !== undefined && (!importing || !/^sha256:[a-f\d]{64}$/.test(expectedDigest))) throw new Error('--apply requires --import-legacy and its review digest.');
  const redactions = await loadArchiveRedactions(values['known-secrets-file']);
  const cutoff = Date.now() - minAgeMs;
  const omissions = {};
  const omit = (reason, tool) => {
    omissions[reason] ??= { claude: 0, codex: 0 };
    omissions[reason][tool]++;
  };
  const shared = { repository, checkoutCache: new Map(), cutoff };
  const options = { lino: values.lino, toolResults: values['tool-results'], cutoff, redactions };
  const candidates = async function* (hasRoom) {
    if (values.only !== 'codex') yield* discover({ ...shared, root: resolve(values['claude-dir']), tool: 'claude' }, hasRoom);
    if (values.only !== 'claude') yield* discover({ ...shared, root: resolve(values['codex-dir']), tool: 'codex' }, hasRoom);
  };
  if (importing) {
    await importLegacy({ repository, destination, expectedDigest, policy: { only: values.only, lino: options.lino, toolResults: options.toolResults, minAgeMs, limit }, redactions, candidates, describeRevision: candidate => describeRevision(candidate, options), omissions, omit });
    reportOmissions(omissions);
    return;
  }

  await requirePublic(repository);
  if (destination && (autoPublish || redactions) && (await archiveRepo(destination)).visibility !== 'private') throw new Error('This export requires a private destination.');
  const published = destination ? await publishedArchiveRevisions(repository, destination) : new Set();

  const output = autoPublish ? await mkdtemp(join(tmpdir(), 'hive-archive-staged-')) : resolve(values.output);
  if (!autoPublish) await mkdir(output, { mode: 0o700 });
  let completed = false;
  try {
    const reports = [];
    const toolResultBudget = { files: 100, bytes: transcriptPartBytes };
    const budget = { files: archiveMaxArtifacts, bytes: archiveBatchBytes - archiveManifestBytes };
    let claudeBudgetExhausted = false;
    for await (const candidate of candidates(tool => reports.length < limit && (tool !== 'claude' || !claudeBudgetExhausted))) {
      let staging;
      try {
        const descriptor = await describeRevision(candidate, options);
        const { archive, revision, chunked, attachments, attachmentBytes } = descriptor;
        if (published.has(publishedRevisionName(archive, revision))) continue;
        if (autoPublish && chunked) throw new ArchiveLimitError('review-required');
        if (attachments.length > toolResultBudget.files || attachmentBytes > toolResultBudget.bytes) {
          claudeBudgetExhausted = true;
          throw new ArchiveLimitError('batch-budget');
        }
        staging = await mkdtemp(join(output, '.revision-'));
        const { entry, files, bytes } = await stageCandidate(candidate, descriptor, { ...options, output: staging, budget });
        for (const path of await readdir(staging)) await rename(join(staging, path), join(output, path));
        reports.push(entry);
        budget.files -= files;
        budget.bytes -= bytes;
        toolResultBudget.files -= attachments.length;
        toolResultBudget.bytes -= attachmentBytes;
      } catch (error) {
        if (!(error instanceof ArchiveLimitError)) throw error;
        omit(error.reason, candidate.tool);
      } finally {
        if (staging) await rm(staging, { recursive: true, force: true });
      }
    }
    await requirePublic(repository);
    reportOmissions(omissions);
    const manifest = { repository, sessions: reports };
    if (Object.keys(omissions).length) manifest.omissions = omissions;
    if (redactions) {
      manifest.literalRedactions = true;
      await writeFile(join(output, archiveRedactionReceipt), redactions.digest, { mode: 0o600, flag: 'wx' });
    }
    const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
    if (Buffer.byteLength(manifestText) > archiveManifestBytes) throw new Error('The archive manifest exceeds 1 MiB.');
    redactions?.assertClean(manifestText);
    await writeFile(join(output, 'manifest.json'), manifestText, { mode: 0o600, flag: 'wx' });
    if (autoPublish && reports.length) await publishArchive(output, destination, { privateOnly: true, redactions });
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
