import { isUtf8 } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { archiveRepo, openArchiveGit, publishedRevisionName, stageRevisionMarkers } from './lib/git.mjs';

const MiB = 1024 * 1024;
const metaSuffix = '.meta.json';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function legacyStem(repository, tool, parts) {
  const file = basename(parts.at(-1), '.jsonl');
  if (tool === 'codex') return `${repository}/codex/${parts.slice(0, -1).concat(file).join('/')}`;
  if (parts.length === 2) return `${repository}/claude/${file}`;
  if (parts[2] === 'subagents') return `${repository}/claude/${parts[1]}/subagents/${file}`;
  return null;
}

async function legacyTree(gitBytes, base, repository, indexPrefix) {
  const listing = (await gitBytes(['ls-tree', '-r', '-z', base, '--', `${repository}/claude/`, `${repository}/codex/`, indexPrefix], undefined, 16 * MiB)).toString('utf8');
  const entries = new Set();
  const blobs = new Map();
  const attachments = new Map();
  const split = new Set();
  for (const entry of listing.split('\0')) {
    const match = /^(\d+) \w+ ([a-f\d]+)\t([\s\S]+)$/.exec(entry);
    if (!match) continue;
    const [, mode, oid, path] = match;
    entries.add(path);
    if (mode === '100644') blobs.set(path, oid);
    const part = /^(.*)\.part-\d+\.(?:jsonl|lino)$/.exec(path);
    if (part) split.add(part[1]);
    const attachment = /^(.*?\/tool-results)\/.+$/.exec(path);
    if (attachment) {
      const directory = attachment[1];
      if (!attachments.has(directory)) attachments.set(directory, new Set());
      attachments.get(directory).add(path);
    }
  }
  return { entries, blobs, attachments, split };
}

async function checkMetadata(readBlob, tree, paths, stem, repository, tool, kind, source, redactions) {
  const metadata = `${stem}${metaSuffix}`;
  if (!tree.blobs.has(metadata)) return 'missing-metadata';
  if (redactions && [metadata, ...paths].some(path => redactions.contains(path))) return 'literal-residual';
  const bytes = await readBlob(metadata, MiB);
  if (!bytes || !isUtf8(bytes)) return 'invalid-metadata';
  let meta;
  try {
    meta = JSON.parse(bytes.toString('utf8'));
  } catch {
    return 'invalid-metadata';
  }
  if (meta?.tool !== tool || meta.kind !== kind || typeof meta.repository !== 'string' || meta.repository.toLowerCase() !== repository.toLowerCase() || !Array.isArray(meta.files)) return 'invalid-metadata';
  if (meta.source?.sha256 !== source.digest || (meta.source.bytes !== undefined && meta.source.bytes !== source.info.size)) return 'changed-source';
  const artifacts = new Map(meta.files.map(file => [file?.path, file]));
  if (meta.files.length !== paths.length || artifacts.size !== paths.length || paths.some(path => !artifacts.has(path))) return 'different-output-policy';
  for (const path of paths) {
    const { bytes: size, sha256: digest } = artifacts.get(path);
    if (!tree.blobs.has(path) || !Number.isSafeInteger(size) || size < 0 || size > 64 * MiB || typeof digest !== 'string' || !/^[a-f\d]{64}$/.test(digest)) return 'unverified-artifact';
    const data = await readBlob(path, size + 1);
    if (!data || data.length !== size || sha256(data) !== digest || !isUtf8(data) || data.includes(0)) return 'unverified-artifact';
    if (redactions?.contains(data.toString('utf8'))) return 'literal-residual';
  }
  return null;
}

async function checkCandidate(readBlob, tree, legacyRepo, candidate, archive, lino, redactions) {
  const { tool, parts } = candidate;
  const stem = legacyStem(legacyRepo, tool, parts);
  if (!stem || !tree.blobs.has(`${stem}${metaSuffix}`)) return { reason: 'missing-metadata' };
  if (tree.split.has(stem) || tree.entries.has(`${stem}.lino`) !== lino) return { reason: 'different-output-policy' };
  const attachmentRoot = `${stem}/tool-results`;
  const existing = tree.attachments.get(attachmentRoot);
  // The exporter's separate attachment metadata proves the selected set. With
  // no attachment evidence, an attachment-enabled legacy policy is ambiguous.
  if (archive.includeResults ? !archive.attachments.length || existing?.size !== archive.attachments.length * 2 : existing?.size) return { reason: 'different-attachment-policy' };
  const paths = [`${stem}.jsonl`, ...(lino ? [`${stem}.lino`] : [])];
  const transcriptReason = await checkMetadata(readBlob, tree, paths, stem, legacyRepo, tool, 'jsonl', archive, redactions);
  if (transcriptReason) return { reason: transcriptReason };
  const usedPaths = new Set();
  for (const attachment of archive.attachments) {
    const name = basename(attachment.file);
    const base = `${attachmentRoot}/${basename(name, extname(name))}`;
    const path = `${attachmentRoot}/${name}`;
    if (usedPaths.has(base) || !existing.has(path) || !existing.has(`${base}${metaSuffix}`)) return { reason: 'different-attachment-policy' };
    usedPaths.add(base);
    const reason = await checkMetadata(readBlob, tree, [path], base, legacyRepo, tool, 'text', attachment, redactions);
    if (reason) return { reason };
  }
  return { metadata: `${stem}${metaSuffix}` };
}

export async function importLegacy({ repository, destination, expectedDigest, policy, redactions, candidates, describeRevision, omissions }) {
  const requirePrivate = async () => {
    const current = await archiveRepo(destination);
    if (current.visibility !== 'private') throw new Error('Legacy archive import requires a private destination.');
    return current.default_branch;
  };
  const { full_name: legacyRepo, visibility } = await archiveRepo(repository);
  if (visibility !== 'public') throw new Error('The source repository must be public.');
  const branch = await requirePrivate();
  const work = await mkdtemp(join(tmpdir(), 'hive-archive-import-'));
  try {
    const { git, gitBytes, base, remote } = await openArchiveGit(destination, branch, work);
    const indexPrefix = `${repository}/.published/`;
    const tree = await legacyTree(gitBytes, base, legacyRepo, indexPrefix);
    const readBlob = (path, limit) =>
      gitBytes(['cat-file', 'blob', tree.blobs.get(path)], undefined, limit).catch(error => {
        if (error.code !== 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw error;
        return null;
      });
    const matches = [];
    const skipped = {};
    for await (const candidate of candidates(() => matches.length < policy.limit)) {
      const archive = await describeRevision(candidate);
      const index = `${indexPrefix}${publishedRevisionName(archive.archive, archive.revision)}`;
      if (tree.entries.has(index)) continue;
      const { reason, metadata } = await checkCandidate(readBlob, tree, legacyRepo, candidate, archive, policy.lino, redactions);
      if (reason) skipped[reason] = (skipped[reason] ?? 0) + 1;
      else matches.push({ metadata, index });
    }
    matches.sort((a, b) => a.index.localeCompare(b.index));
    const indexEntries = matches.map(match => match.index);
    const digest = `sha256:${sha256(JSON.stringify(['hive-manager legacy import v1', repository, destination, branch, base, policy, redactions?.digest, matches]))}`;
    if (!expectedDigest) {
      process.stdout.write(`${JSON.stringify({ repository, destination, branch, base, digest, matches, indexEntries, skipped, omissions }, null, 2)}\n`);
      return;
    }
    if (expectedDigest !== digest) throw new Error('The legacy import plan changed since review.');
    if (!indexEntries.length) return process.stdout.write('No legacy revisions to import.\n');
    await git(['read-tree', base]);
    await stageRevisionMarkers(git, work, indexEntries);
    const updated = await git(['write-tree']);
    const commit = await git(['commit-tree', updated, '-p', base, '-m', `Import reviewed legacy archive revisions for ${repository}`]);
    if ((await archiveRepo(repository)).visibility !== 'public' || (await requirePrivate()) !== branch) throw new Error('An archive repository changed during review.');
    await git(['push', '--', remote, `${commit}:refs/heads/${branch}`]);
    process.stdout.write(`Imported ${indexEntries.length} legacy archive revision(s) to https://github.com/${destination}/commit/${commit}\n`);
  } catch (error) {
    if (error.cmd || error.code) throw new Error('Legacy archive import could not proceed. Check Git identity, GitHub access, and the archive repository.', { cause: error });
    throw error;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
