import { isUtf8 } from 'node:buffer';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { archiveRepo, archiveRepoPattern, archiveRevisionPattern, openArchiveGit, publishedRevisionName } from './hive-manager-archive-git.lib.mjs';
import { readBoundedFile } from './hive-manager-files.lib.mjs';
import { excludedArchiveRepository, redactArchiveIdentity } from './hive-manager-archive-privacy.lib.mjs';
import { findResidualCredentialBlock } from './log-sanitize-stream.lib.mjs';

const MiB = 1024 * 1024;
const run = promisify(execFile);
const usage = `Usage: hive-manager archive-publish DIRECTORY --destination OWNER/REPO [--apply SHA256]
       hive-manager archive-publish --initialize --destination OWNER/REPO --visibility private|public|internal
Preview the files listed in an archive-sessions manifest and print a review digest.
After reviewing every file, pass that digest to publish one commit to the existing archive repository.
`;

function artifactPaths(sessions) {
  if (!Array.isArray(sessions) || sessions.length < 1 || sessions.length > 100) throw new Error('The archive manifest must contain between 1 and 100 sessions.');
  const files = new Set(['manifest.json']);
  for (const session of sessions) {
    const match = /^(claude|codex)-([a-f\d]{64})\.jsonl$/.exec(session?.archive ?? '');
    if (!match || match[1] !== session.tool || files.has(session.archive)) throw new Error('The archive manifest contains an invalid transcript path.');
    if (session.revision !== undefined && (typeof session.revision !== 'string' || !archiveRevisionPattern.test(session.revision))) throw new Error('The archive manifest contains an invalid session revision.');
    files.add(session.archive);
    const [, tool, id] = match;
    if (session.linksNotation !== undefined) {
      if (session.linksNotation !== `${tool}-${id}.lino`) throw new Error('The archive manifest contains an invalid Links Notation path.');
      files.add(session.linksNotation);
    }
    if (session.toolResults === undefined) continue;
    if (tool !== 'claude' || !Array.isArray(session.toolResults) || session.toolResults.length > 100) throw new Error('The archive manifest contains invalid tool results.');
    const pathPattern = new RegExp(`^claude-${id}-tool-results/[a-f0-9]{64}\\.(txt|log|json|jsonl)$`);
    for (const result of session.toolResults) {
      const path = result?.archive ?? '';
      if (!pathPattern.test(path) || files.has(path)) throw new Error('The archive manifest contains an invalid tool result path.');
      files.add(path);
    }
  }
  if (files.size > 301) throw new Error('The archive manifest contains too many files.');
  return [...files].sort();
}

async function review(directory, destination, snapshot, expectedDigest) {
  if (!(await lstat(directory)).isDirectory()) throw new Error('The archive directory must be a real directory.');
  const options = { noFollow: true, allowEmpty: true };
  const manifest = await readBoundedFile(join(directory, 'manifest.json'), MiB, 'archive manifest', options);
  const { repository, sessions } = JSON.parse(manifest);
  if (!archiveRepoPattern.test(repository ?? '') || repository !== repository.toLowerCase() || repository === destination) throw new Error('Use a separate GitHub destination and a valid source repository.');
  if (excludedArchiveRepository(repository)) throw new Error('This source repository is excluded from session archives.');
  const paths = artifactPaths(sessions);
  const { visibility, default_branch: branch } = await archiveRepo(destination);
  const hash = createHash('sha256').update(`hive-manager archive v1\0${repository}\0${destination}\0${visibility}\0${branch}\0`);
  let bytes = 0;
  for (const path of paths) {
    const file = join(directory, path);
    if (!(await lstat(dirname(file))).isDirectory()) throw new Error('Archive artifacts must be in real directories.');
    const data = path === 'manifest.json' ? manifest : await readBoundedFile(file, Math.min(64 * MiB, 256 * MiB - bytes), 'archive artifact', options);
    if (!isUtf8(data) || data.includes(0)) throw new Error('Archive artifacts must contain UTF-8 text.');
    const text = data.toString('utf8');
    if (redactArchiveIdentity(text) !== text) throw new Error('The archive contains recognizable identity-document, booking, or contact details. Redact them before publishing.');
    bytes += data.length;
    if (bytes > 256 * MiB) throw new Error('An archive batch may contain at most 256 MiB. Export fewer sessions per batch.');
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
  await git(['read-tree', base]);
  for (const path of paths) {
    const blob = await git(['hash-object', '--no-filters', '-w', '--', join(snapshot, path)]);
    const target = `${prefix}/${path}`;
    if (existing.size && !existing.has(`100644 blob ${blob}\t${target}`)) throw new Error('The archive destination contains different files at the approved digest.');
    await git(['update-index', '--add', '--cacheinfo', `100644,${blob},${target}`]);
  }
  if (existing.size && existing.size !== paths.length) throw new Error('The archive destination contains extra files at the approved digest.');
  if (revisions.length) {
    const marker = join(work, 'empty');
    await writeFile(marker, '', { mode: 0o600, flag: 'wx' });
    const empty = await git(['hash-object', '--no-filters', '-w', '--', marker]);
    for (const revision of revisions) await git(['update-index', '--add', '--cacheinfo', `100644,${empty},${revision}`]);
  }
  const tree = await git(['write-tree']);
  const currentTree = await git(['rev-parse', `${base}^{tree}`]);
  await verify();
  if (tree === currentTree) {
    process.stdout.write(`Archive ${digest} is already published to ${destination}.\n`);
    return;
  }
  const commit = await git(['commit-tree', tree, '-p', base, '-m', `Archive reviewed sessions for ${source}`]);
  await git(['push', '--', remote, `${commit}:refs/heads/${branch}`]);
  process.stdout.write(`Published archive ${digest} to https://github.com/${destination}/commit/${commit}\n`);
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { help: { type: 'boolean', short: 'h' }, destination: { type: 'string' }, apply: { type: 'string' }, initialize: { type: 'boolean' }, visibility: { type: 'string' } } });
  if (values.help || process.argv.length === 2) return process.stdout.write(usage);
  const destination = values.destination?.toLowerCase() ?? '';
  if (values.initialize) {
    if (positionals.length || values.apply !== undefined || !archiveRepoPattern.test(destination) || !['private', 'public', 'internal'].includes(values.visibility)) throw new Error('Specify --initialize with a destination OWNER/REPO and explicit --visibility.');
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
  if (!values.apply) {
    const { digest, paths, bytes, source, visibility, branch, revisions } = await review(directory, destination);
    process.stdout.write(`${JSON.stringify({ source, destination, visibility, branch, digest: `sha256:${digest}`, bytes, files: paths, indexEntries: revisions }, null, 2)}\n`);
    return;
  }

  const work = await mkdtemp(join(tmpdir(), 'hive-archive-publish-'));
  try {
    const snapshot = join(work, 'reviewed');
    const approved = await review(directory, destination, snapshot, expectedDigest);
    for (const path of approved.paths) {
      if (await findResidualCredentialBlock(join(snapshot, path))) throw new Error('A reviewed file still contains credential material. Redact it before publishing.');
    }
    await publish(approved, snapshot, work);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  const detail = error.cmd || error.code ? 'Archive publication could not proceed. Check Git identity, GitHub access, and that the destination accepts a normal push.' : error.message;
  process.stderr.write(`hive-manager: ${detail}\n`);
  process.exitCode = 1;
}
