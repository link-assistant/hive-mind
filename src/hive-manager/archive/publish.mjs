import { isUtf8 } from 'node:buffer';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { archiveRepo, archiveRepoPattern, archiveRevisionPattern, openArchiveGit, publishedRevisionName, stageRevisionMarkers } from './lib/git.mjs';
import { archiveArtifactBytes, archiveBatchBytes, archiveManifestBytes, archiveMaxArtifacts, numberedPart, transcriptPartBytes } from './lib/limits.mjs';
import { readBoundedFile } from '../lib/files.mjs';
import { excludedArchiveRepository, redactArchiveIdentity } from './lib/privacy.mjs';
import { archiveRedactionReceipt, loadArchiveRedactions } from './lib/redactions.mjs';
import { findResidualCredentialBlock } from '../../log-sanitize-stream.lib.mjs';

const run = promisify(execFile);
const usage = `Usage: hive-manager archive-publish DIRECTORY --destination OWNER/REPO [--apply SHA256]
         [--private] [--known-secrets-file FILE]
       hive-manager archive-publish --initialize --destination OWNER/REPO --visibility private|public|internal
Preview the files listed in an archive-sessions manifest and print a review digest.
After reviewing every file, pass that digest to publish one commit to the existing archive repository.
Use --private to require a private destination. A known secrets file also requires a private destination.
Numbered transcripts always require a private destination.
`;

function artifactPaths(sessions) {
  if (!Array.isArray(sessions) || sessions.length < 1 || sessions.length > 100) throw new Error('The archive manifest must contain between 1 and 100 sessions.');
  const files = new Map([['manifest.json', {}]]);
  const transcripts = new Set();
  let chunked = false;
  for (const session of sessions) {
    const match = /^(claude|codex)-([a-f\d]{64})\.jsonl$/.exec(session?.archive ?? '');
    if (!match || match[1] !== session.tool || transcripts.has(session.archive)) throw new Error('The archive manifest contains an invalid transcript path.');
    if (session.revision !== undefined && (typeof session.revision !== 'string' || !archiveRevisionPattern.test(session.revision))) throw new Error('The archive manifest contains an invalid session revision.');
    transcripts.add(session.archive);
    const [, tool, id] = match;
    const stem = `${tool}-${id}`;
    if (session.parts === undefined) {
      files.set(session.archive, {});
      if (session.linksNotation !== undefined) {
        if (session.linksNotation !== `${stem}.lino`) throw new Error('The archive manifest contains an invalid Links Notation path.');
        files.set(session.linksNotation, {});
      }
    } else {
      const { parts, revision } = session;
      if (!revision || session.linksNotation !== undefined || !Array.isArray(parts) || !parts.length || parts.length > archiveMaxArtifacts) throw new Error('The archive manifest contains invalid transcript parts.');
      const hasLino = parts[0]?.linksNotation !== undefined;
      for (const [index, part] of parts.entries()) {
        if (part?.archive !== numberedPart(stem, index + 1, 'jsonl') || (hasLino ? part.linksNotation !== numberedPart(stem, index + 1, 'lino') : part.linksNotation !== undefined)) throw new Error('The archive manifest contains invalid transcript parts.');
        files.set(part.archive, { limit: transcriptPartBytes, newline: index + 1 < parts.length });
        if (hasLino) files.set(part.linksNotation, {});
      }
      chunked = true;
    }
    if (session.toolResults === undefined) continue;
    if (tool !== 'claude' || !Array.isArray(session.toolResults) || session.toolResults.length > 100) throw new Error('The archive manifest contains invalid tool results.');
    const pathPattern = new RegExp(`^claude-${id}-tool-results/[a-f0-9]{64}\\.(txt|log|json|jsonl)$`);
    for (const result of session.toolResults) {
      const path = result?.archive ?? '';
      if (!pathPattern.test(path) || files.has(path)) throw new Error('The archive manifest contains an invalid tool result path.');
      files.set(path, {});
    }
  }
  if (files.size > archiveMaxArtifacts + 1) throw new Error('The archive manifest contains too many files.');
  return { files, chunked };
}

async function review(directory, destination, { snapshot, expectedDigest, privateOnly, redactions } = {}) {
  if (!(await lstat(directory)).isDirectory()) throw new Error('The archive directory must be a real directory.');
  const options = { noFollow: true, allowEmpty: true };
  const manifest = await readBoundedFile(join(directory, 'manifest.json'), archiveManifestBytes, 'archive manifest', options);
  const { repository, sessions, literalRedactions } = JSON.parse(manifest);
  if (!archiveRepoPattern.test(repository ?? '') || repository !== repository.toLowerCase() || repository === destination) throw new Error('Use a separate GitHub destination and a valid source repository.');
  if (excludedArchiveRepository(repository)) throw new Error('This source repository is excluded from session archives.');
  const { files, chunked } = artifactPaths(sessions);
  const paths = [...files.keys()].sort();
  if (literalRedactions === true) {
    const receipt = redactions && (await readBoundedFile(join(directory, archiveRedactionReceipt), 64, 'local redaction policy', options).catch(() => null));
    if (!receipt || receipt.toString('utf8') !== redactions.digest) throw new Error('Review and apply require the same --known-secrets-file literals used to stage this archive.');
  }
  const { visibility, default_branch: branch } = await archiveRepo(destination);
  if ((privateOnly || redactions || chunked) && visibility !== 'private') throw new Error('This publication requires a private destination.');
  if (snapshot && chunked && !expectedDigest) throw new Error('Numbered transcripts require the archive-publish review digest.');
  const hash = createHash('sha256').update(`hive-manager archive v1\0${repository}\0${destination}\0${visibility}\0${branch}\0`);
  if (redactions) hash.update(`known literals\0${redactions.digest}\0`);
  let bytes = 0;
  for (const path of paths) {
    const file = join(directory, path);
    if (!(await lstat(dirname(file))).isDirectory()) throw new Error('Archive artifacts must be in real directories.');
    const { limit = archiveArtifactBytes, newline } = files.get(path);
    const data = path === 'manifest.json' ? manifest : await readBoundedFile(file, Math.min(limit, archiveBatchBytes - bytes), 'archive artifact', options);
    if (!isUtf8(data) || data.includes(0)) throw new Error('Archive artifacts must contain UTF-8 text.');
    if (newline && data.at(-1) !== 10) throw new Error('Each nonfinal transcript part must end at a JSONL record boundary.');
    const text = data.toString('utf8');
    redactions?.assertClean(text);
    if (redactArchiveIdentity(text) !== text) throw new Error('The archive contains recognizable identity-document, booking, or contact details. Redact them before publishing.');
    bytes += data.length;
    if (bytes > archiveBatchBytes) throw new Error('An archive batch may contain at most 256 MiB. Export fewer sessions per batch.');
    hash.update(`${path}\0${data.length}\0`).update(data);
    if (snapshot) {
      const output = join(snapshot, path);
      await mkdir(dirname(output), { recursive: true, mode: 0o700 });
      await writeFile(output, data, { mode: 0o600, flag: 'wx' });
    }
  }
  const digest = hash.digest('hex');
  if (expectedDigest && expectedDigest !== digest) throw new Error('The archive files or destination changed since review.');
  const revisions = sessions.filter(session => session.revision).map(session => `${repository}/.published/${publishedRevisionName(session.archive, session.revision)}`);
  return { source: repository, destination, visibility, branch, digest, paths, bytes, revisions };
}

async function publish({ source, destination, digest, paths, visibility, branch, revisions }, snapshot, work) {
  const verify = async () => {
    const origin = await archiveRepo(source);
    if (origin.visibility !== 'public') throw new Error('The source repository must still be public.');
    const latest = await archiveRepo(destination);
    if (latest.default_branch !== branch || latest.visibility !== visibility) throw new Error('The archive destination changed during review.');
  };
  await verify();
  const { git, base, remote } = await openArchiveGit(destination, branch, work);
  const prefix = `${source}/${digest}`;
  const existing = new Set((await git(['ls-tree', '-r', base, '--', prefix])).split('\n').filter(Boolean));
  if (!existing.size && revisions.length && (await git(['ls-tree', '-r', base, '--', ...revisions]))) {
    throw new Error('An archive revision has already been published. Stage a fresh batch with --published-in.');
  }
  await git(['read-tree', base]);
  for (const path of paths) {
    const blob = await git(['hash-object', '--no-filters', '-w', '--', join(snapshot, path)]);
    const target = `${prefix}/${path}`;
    if (existing.size && !existing.has(`100644 blob ${blob}\t${target}`)) throw new Error('The archive destination contains different files at the approved digest.');
    await git(['update-index', '--add', '--cacheinfo', `100644,${blob},${target}`]);
  }
  if (existing.size && existing.size !== paths.length) throw new Error('The archive destination contains extra files at the approved digest.');
  await stageRevisionMarkers(git, work, revisions);
  const tree = await git(['write-tree']);
  const currentTree = await git(['rev-parse', `${base}^{tree}`]);
  if (tree === currentTree) {
    await verify();
    process.stdout.write(`Archive ${digest} is already published to ${destination}.\n`);
    return;
  }
  const commit = await git(['commit-tree', tree, '-p', base, '-m', `Archive reviewed sessions for ${source}`]);
  await verify();
  await git(['push', '--', remote, `${commit}:refs/heads/${branch}`]);
  process.stdout.write(`Published archive ${digest} to https://github.com/${destination}/commit/${commit}\n`);
}

export async function publishArchive(directory, destination, { expectedDigest, privateOnly = false, redactions = null } = {}) {
  const work = await mkdtemp(join(tmpdir(), 'hive-archive-publish-'));
  try {
    const snapshot = join(work, 'reviewed');
    const approved = await review(directory, destination, { snapshot, expectedDigest, privateOnly, redactions });
    for (const path of approved.paths) {
      if (await findResidualCredentialBlock(join(snapshot, path))) throw new Error('An archive file still contains credential material. Redact it before publishing.');
    }
    await publish(approved, snapshot, work);
  } catch (error) {
    if (error.cmd || error.code) throw new Error('Archive publication could not proceed. Check Git identity, GitHub access, and that the destination accepts a normal push.', { cause: error });
    throw error;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { help: { type: 'boolean', short: 'h' }, destination: { type: 'string' }, apply: { type: 'string' }, initialize: { type: 'boolean' }, visibility: { type: 'string' }, private: { type: 'boolean' }, 'known-secrets-file': { type: 'string' } } });
  if (values.help || process.argv.length === 2) return process.stdout.write(usage);
  const destination = values.destination?.toLowerCase() ?? '';
  if (values.initialize) {
    if (positionals.length || values.apply !== undefined || values.private || values['known-secrets-file'] !== undefined || !archiveRepoPattern.test(destination) || !['private', 'public', 'internal'].includes(values.visibility)) throw new Error('Specify --initialize with a destination OWNER/REPO and explicit --visibility.');
    try {
      // github-retry-ok: A timed-out creation may already have created the repository.
      await run('gh', ['repo', 'create', destination, `--${values.visibility}`, '--add-readme', '--description', 'Reviewed Hive Mind session archives'], { env: { ...process.env, GH_HOST: 'github.com' }, timeout: 30_000, maxBuffer: 4096 });
    } catch {
      throw new Error(`Repository creation could not be confirmed. Check https://github.com/${destination} before retrying.`);
    }
    const { visibility } = await archiveRepo(destination);
    if (visibility !== values.visibility) throw new Error('The archive repository did not report the requested visibility.');
    process.stdout.write(`Initialized ${visibility} archive https://github.com/${destination}\n`);
    return;
  }
  if (values.visibility !== undefined) throw new Error('--visibility requires --initialize.');
  const expectedDigest = values.apply?.replace(/^sha256:/, '');
  if (positionals.length !== 1 || !archiveRepoPattern.test(destination) || (expectedDigest !== undefined && !/^[a-f\d]{64}$/.test(expectedDigest))) throw new Error('Specify a staged archive directory, an OWNER/REPO destination, and an optional review digest.');
  const directory = resolve(positionals[0]);
  const redactions = await loadArchiveRedactions(values['known-secrets-file']);
  const privateOnly = values.private;
  if (!values.apply) {
    const { digest, paths, bytes, source, visibility, branch, revisions } = await review(directory, destination, { privateOnly, redactions });
    process.stdout.write(`${JSON.stringify({ source, destination, visibility, branch, digest: `sha256:${digest}`, bytes, files: paths, indexEntries: revisions }, null, 2)}\n`);
    return;
  }

  await publishArchive(directory, destination, { expectedDigest, privateOnly, redactions });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await main();
  } catch (error) {
    const detail = error.cmd || error.code ? 'Archive publication could not proceed. Check Git identity, GitHub access, and that the destination accepts a normal push.' : error.message;
    process.stderr.write(`hive-manager: ${detail}\n`);
    process.exitCode = 1;
  }
}
