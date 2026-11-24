import { isUtf8 } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { archiveRepo, openArchiveGit, publishedRevisionName, stageRevisionMarkers } from './lib/git.mjs';
import { ArchiveLimitError, archiveArtifactBytes, archiveBatchBytes, archiveManifestBytes, archiveMaxArtifacts, MiB, numberedPart } from './lib/limits.mjs';
import { redactArchiveIdentity } from './lib/privacy.mjs';

const metaSuffix = '.meta.json';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const unverified = artifact => ({ reason: 'unverified-artifact', artifact });

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
  const split = new Map();
  for (const entry of listing.split('\0')) {
    const match = /^(\d+) \w+ ([a-f\d]+)\t([\s\S]+)$/.exec(entry);
    if (!match) continue;
    const [, mode, oid, path] = match;
    entries.add(path);
    if (mode === '100644') blobs.set(path, oid);
    const part = /^(.*)\.part-\d+\.(?:jsonl|lino|txt|log|json)$/.exec(path);
    if (part) {
      if (!split.has(part[1])) split.set(part[1], new Set());
      split.get(part[1]).add(path);
    }
    const attachment = /^(.*?\/tool-results)\/.+$/.exec(path);
    if (attachment) {
      const directory = attachment[1];
      if (!attachments.has(directory)) attachments.set(directory, new Set());
      attachments.get(directory).add(path);
    }
  }
  return { entries, blobs, attachments, split };
}

function legacyParts(tree, stem, extension, lino) {
  const numbered = tree.split.get(stem);
  if (!numbered) {
    if (tree.entries.has(`${stem}.lino`) !== lino) return { reason: 'different-output-policy' };
    return { paths: [`${stem}.${extension}`, ...(lino ? [`${stem}.lino`] : [])] };
  }
  if (tree.entries.has(`${stem}.${extension}`) || tree.entries.has(`${stem}.lino`) || numbered.size > archiveMaxArtifacts) return unverified(`${stem}${metaSuffix}`);
  const count = [...numbered].filter(path => path.endsWith(`.${extension}`)).length;
  const hasLino = [...numbered].some(path => path.endsWith('.lino'));
  if (hasLino !== lino) return { reason: 'different-output-policy' };
  if (!count || numbered.size !== count * (lino ? 2 : 1)) return unverified(`${stem}${metaSuffix}`);
  const paths = [];
  for (let i = 1; i <= count; ++i) {
    paths.push(numberedPart(stem, i, extension));
    if (lino) paths.push(numberedPart(stem, i, 'lino'));
  }
  const missing = paths.find(path => !numbered.has(path));
  if (missing) return unverified(missing);
  return { paths };
}

async function checkMetadata(readBlob, tree, paths, stem, repository, tool, kind, source, redactions, budget) {
  const metadata = `${stem}${metaSuffix}`;
  if (!tree.blobs.has(metadata)) return { reason: 'missing-metadata' };
  if (redactions && [metadata, ...paths].some(path => redactions.contains(path))) return { reason: 'literal-residual' };
  const bytes = await readBlob(metadata, archiveManifestBytes);
  if (!bytes || !isUtf8(bytes)) return { reason: 'invalid-metadata' };
  let meta;
  try {
    meta = JSON.parse(bytes.toString('utf8'));
  } catch {
    return { reason: 'invalid-metadata' };
  }
  if (meta?.tool !== tool || meta.kind !== kind || typeof meta.repository !== 'string' || meta.repository.toLowerCase() !== repository.toLowerCase() || !Array.isArray(meta.files)) return { reason: 'invalid-metadata' };
  if (meta.source?.sha256 !== source.digest || (meta.source.bytes !== undefined && meta.source.bytes !== source.info.size)) return { reason: 'changed-source' };
  const artifacts = new Map(meta.files.map(file => [file?.path, file]));
  if (meta.files.length !== paths.length || artifacts.size !== paths.length || paths.some(path => !artifacts.has(path))) return unverified(metadata);
  for (const path of paths) {
    const { bytes: size, sha256: digest } = artifacts.get(path);
    if (!tree.blobs.has(path) || !Number.isSafeInteger(size) || size < 0 || size > archiveArtifactBytes || typeof digest !== 'string' || !/^[a-f\d]{64}$/.test(digest)) return unverified(path);
    if (--budget.files < 0 || (budget.bytes -= size) < 0) return unverified(path);
    const data = await readBlob(path, size + 1);
    if (!data || data.length !== size || sha256(data) !== digest || !isUtf8(data) || data.includes(0)) return unverified(path);
    if (redactions?.contains(data.toString('utf8'))) return { reason: 'literal-residual' };
  }
  return null;
}

async function checkCandidate(readBlob, tree, legacyRepo, candidate, archive, lino, redactions) {
  const { tool, parts } = candidate;
  const stem = legacyStem(legacyRepo, tool, parts);
  if (!stem || !tree.blobs.has(`${stem}${metaSuffix}`)) return { reason: 'missing-metadata' };
  const transcript = legacyParts(tree, stem, 'jsonl', lino);
  if (transcript.reason) return transcript;
  const attachmentRoot = `${stem}/tool-results`;
  const existing = tree.attachments.get(attachmentRoot);
  // The exporter's separate attachment metadata proves the selected set. With
  // no attachment evidence, an attachment-enabled legacy policy is ambiguous.
  if (archive.includeResults ? !archive.attachments.length || !existing?.size : existing?.size) return { reason: 'different-attachment-policy' };
  const budget = { files: archiveMaxArtifacts, bytes: archiveBatchBytes };
  const transcriptFailure = await checkMetadata(readBlob, tree, transcript.paths, stem, legacyRepo, tool, 'jsonl', archive, redactions, budget);
  if (transcriptFailure) return transcriptFailure;
  const usedPaths = new Set();
  for (const attachment of archive.attachments) {
    const name = basename(attachment.file);
    const base = `${attachmentRoot}/${basename(name, extname(name))}`;
    const meta = `${base}${metaSuffix}`;
    if (usedPaths.has(meta) || !existing.has(meta)) return { reason: 'different-attachment-policy' };
    const selected = legacyParts(tree, base, extname(name).slice(1), false);
    if (selected.reason) return selected;
    usedPaths.add(meta);
    for (const path of selected.paths) usedPaths.add(path);
    const failure = await checkMetadata(readBlob, tree, selected.paths, base, legacyRepo, tool, 'text', attachment, redactions, budget);
    if (failure) return failure;
  }
  if (existing?.size && existing.size !== usedPaths.size) return { reason: 'different-attachment-policy' };
  return { metadata: `${stem}${metaSuffix}` };
}

export async function importLegacy({ repository, destination, expectedDigest, policy, redactions, candidates, describeRevision, omissions, omit }) {
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
    const unverifiedArtifacts = [];
    for await (const candidate of candidates(() => matches.length < policy.limit)) {
      let archive;
      try {
        archive = await describeRevision(candidate);
      } catch (error) {
        if (!(error instanceof ArchiveLimitError)) throw error;
        omit(error.reason, candidate.tool);
        continue;
      }
      const index = `${indexPrefix}${publishedRevisionName(archive.archive, archive.revision)}`;
      if (tree.entries.has(index)) continue;
      const { reason, artifact, metadata } = await checkCandidate(readBlob, tree, legacyRepo, candidate, archive, policy.lino, redactions);
      if (reason) {
        skipped[reason] = (skipped[reason] ?? 0) + 1;
        if (artifact && unverifiedArtifacts.length < policy.limit) unverifiedArtifacts.push(redactArchiveIdentity(redactions ? redactions.redact(artifact) : artifact));
      } else {
        matches.push({ metadata, index });
      }
    }
    matches.sort((a, b) => a.index.localeCompare(b.index));
    const indexEntries = matches.map(match => match.index);
    const digest = `sha256:${sha256(JSON.stringify(['hive-manager legacy import v2', repository, destination, branch, base, policy, redactions?.digest, matches, skipped, omissions]))}`;
    if (!expectedDigest) {
      process.stdout.write(`${JSON.stringify({ repository, destination, branch, base, digest, matches, indexEntries, skipped, unverifiedArtifacts: unverifiedArtifacts.sort(), omissions }, null, 2)}\n`);
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
