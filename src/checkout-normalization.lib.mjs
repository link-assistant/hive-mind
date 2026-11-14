#!/usr/bin/env node

/**
 * Issue #4063: a fresh clone that `git status` reports as modified.
 *
 * link-foundation/java-ai-driven-development-pipeline-template committed
 * `mvnw.cmd` with CRLF line endings in the same commit that added
 *
 *     /mvnw.cmd text eol=crlf
 *
 * to `.gitattributes`. The `text` attribute tells git that the *repository*
 * copy of the file is normalized to LF and only the working tree copy uses
 * CRLF. The stored blob is CRLF, so it is not normalized. A checkout writes
 * the blob's bytes unchanged; the clone finishes within the same second it
 * writes the index, so every entry is "racily clean" and git re-reads the file,
 * converts it to LF ("clean" direction) and finds a different blob:
 *
 *     $ git clone .../java-ai-driven-development-pipeline-template && git status --porcelain
 *      M mvnw.cmd
 *
 * (docs/case-studies/issue-4063/evidence/reproduction.log)
 *
 * Nothing in the working tree differs from the commit - the bytes on disk are
 * exactly the committed blob - but solve stopped with "Repository has
 * uncommitted changes after clone" before it could create a branch.
 *
 * The same happens for every attribute that converts content between the
 * repository and the working tree when the committed blob is not in the form
 * the conversion produces: `text`/`eol` (and `core.autocrlf`), `ident`,
 * `working-tree-encoding` and clean/smudge `filter`s.
 *
 * Detection: a ` M` entry whose raw working tree bytes
 * (`git hash-object --no-filters`) hash to exactly the index blob is a
 * conversion artifact, not a change. Anything else - staged changes, untracked
 * files, deletions, type changes, or bytes that really differ - is kept as a
 * real change, and solve still refuses to start on it.
 *
 * Handling: the artifact paths are listed in `.git/info/attributes` with every
 * content conversion unset. That file has the highest attribute precedence, is
 * local to the clone, is never staged and never appears in a pull request (the
 * same approach as `.git/info/exclude` for issue #2119). Every later `git
 * status`, `git diff` and `git add -A` in every tool integration then agrees
 * that the file is unchanged, so the unrelated whole-file line-ending rewrite
 * cannot leak into the pull request either. The repository itself is not
 * modified; the log explains the defect and the command that fixes it
 * upstream (`git add --renormalize`).
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const CHECKOUT_NORMALIZATION_HEADER = '# hive-mind: committed bytes that do not match .gitattributes conversion (issue #4063)';

/** Attributes unset for an artifact path: every content conversion git applies on checkout or add. */
export const NEUTRALIZED_ATTRIBUTES = ['-text', '-eol', '-ident', '-filter', '-working-tree-encoding'];

/** Attributes reported in diagnostics. */
const DIAGNOSTIC_ATTRIBUTES = ['text', 'eol', 'ident', 'filter', 'working-tree-encoding'];

/** At most this many paths are described one by one in the log. */
export const MAX_DESCRIBED_PATHS = 20;

const GIT_TIMEOUT_MS = 120000;
const GIT_MAX_BUFFER = 64 * 1024 * 1024;

/**
 * Run git without a shell, so paths are never interpreted.
 *
 * @param {string[]} args
 * @param {{cwd: string, input?: string}} options
 * @returns {Promise<string>} stdout
 */
export const runGit = async (args, { cwd, input } = {}) => {
  const options = { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BUFFER, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' } };
  if (input === undefined) {
    const { stdout } = await execFileAsync('git', args, options);
    return stdout;
  }
  return new Promise((resolve, reject) => {
    const child = execFile('git', args, options, (error, stdout) => (error ? reject(error) : resolve(stdout)));
    child.stdin.end(input);
  });
};

/**
 * Parse `git status --porcelain=v1 -z` output.
 *
 * @param {string} output
 * @returns {{code: string, path: string, origPath?: string}[]}
 */
export const parsePorcelainZ = output => {
  const fields = String(output || '').split('\0');
  const entries = [];
  for (let index = 0; index < fields.length; index++) {
    const field = fields[index];
    if (!field) continue;
    const code = field.slice(0, 2);
    const entry = { code, path: field.slice(3) };
    // Renames and copies carry the source path in the next field.
    if (code[0] === 'R' || code[0] === 'C') entry.origPath = fields[++index];
    entries.push(entry);
  }
  return entries;
};

/**
 * Render an entry as a `git status --porcelain` line for the log.
 *
 * @param {{code: string, path: string, origPath?: string}} entry
 */
export const formatStatusEntry = entry => `${entry.code} ${entry.origPath ? `${entry.origPath} -> ` : ''}${entry.path}`;

/**
 * Escape a repository-relative path as an exact, anchored gitattributes pattern.
 *
 * Glob metacharacters are backslash-escaped; a path with whitespace or a quote
 * is written C-style quoted, which gitattributes accepts for patterns.
 *
 * @param {string} filePath
 * @returns {string}
 */
export const toAttributesPattern = filePath => {
  const escaped = `/${String(filePath).replace(/[\\*?[\]]/g, '\\$&')}`;
  if (!/[\s"]/.test(escaped)) return escaped;
  const quoted = escaped.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
  return `"${quoted}"`;
};

/** Map of path -> {mode, object} for stage-0 index entries. */
const readIndexObjects = async cwd => {
  const output = await runGit(['ls-files', '--stage', '-z'], { cwd });
  const objects = new Map();
  for (const record of output.split('\0')) {
    const match = /^(\d+) ([0-9a-f]+) (\d)\t(.*)$/s.exec(record);
    if (match && match[3] === '0') objects.set(match[4], { mode: match[1], object: match[2] });
  }
  return objects;
};

/**
 * Split `git status` entries into conversion artifacts and real changes.
 *
 * @param {{cwd: string, entries?: {code: string, path: string}[]}} options
 * @returns {Promise<{artifacts: {code: string, path: string, object: string}[], changes: {code: string, path: string}[], entries: object[]}>}
 */
export const classifyStatusEntries = async ({ cwd, entries }) => {
  const statusEntries = entries || parsePorcelainZ(await runGit(['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd }));
  // Only "unchanged in the index, modified in the working tree" can be an
  // artifact; a path with a newline cannot be passed through --stdin-paths.
  const candidates = statusEntries.filter(entry => entry.code === ' M' && !entry.path.includes('\n'));
  const artifacts = [];
  if (candidates.length > 0) {
    const index = await readIndexObjects(cwd);
    const regular = candidates.filter(entry => /^100(644|755)$/.test(index.get(entry.path)?.mode || ''));
    if (regular.length > 0) {
      const hashes = (await runGit(['hash-object', '--no-filters', '--stdin-paths'], { cwd, input: `${regular.map(entry => entry.path).join('\n')}\n` })).split('\n');
      regular.forEach((entry, position) => {
        const object = index.get(entry.path).object;
        if (hashes[position] === object) artifacts.push({ ...entry, object });
      });
    }
  }
  const artifactPaths = new Set(artifacts.map(entry => entry.path));
  const changes = statusEntries.filter(entry => !(entry.code === ' M' && artifactPaths.has(entry.path)));
  return { artifacts, changes, entries: statusEntries };
};

/**
 * Describe why git converts each path: attributes, line endings and config.
 *
 * @param {{cwd: string, paths: string[]}} options
 * @returns {Promise<{paths: {path: string, attributes: Record<string, string>, eol?: string}[], config: Record<string, string>, gitVersion: string}>}
 */
export const describeConversion = async ({ cwd, paths }) => {
  const described = paths.slice(0, MAX_DESCRIBED_PATHS);
  const result = { paths: [], config: {}, gitVersion: '' };
  try {
    result.gitVersion = (await runGit(['--version'], { cwd })).trim();
  } catch {
    // diagnostics only
  }
  for (const key of ['core.autocrlf', 'core.eol', 'core.safecrlf']) {
    try {
      result.config[key] = (await runGit(['config', '--get', key], { cwd })).trim();
    } catch {
      result.config[key] = '(unset)';
    }
  }
  if (described.length === 0) return result;
  const attributes = new Map(described.map(filePath => [filePath, {}]));
  try {
    const output = await runGit(['check-attr', '-z', '--stdin', ...DIAGNOSTIC_ATTRIBUTES], { cwd, input: `${described.join('\0')}\0` });
    const fields = output.split('\0');
    for (let index = 0; index + 2 < fields.length; index += 3) {
      const [filePath, name, value] = fields.slice(index, index + 3);
      if (attributes.has(filePath) && value !== 'unspecified') attributes.get(filePath)[name] = value;
    }
  } catch {
    // diagnostics only
  }
  const eol = new Map();
  try {
    const output = await runGit(['ls-files', '--eol', '-z', '--', ...described.map(filePath => `:(literal)${filePath}`)], { cwd });
    for (const record of output.split('\0')) {
      const tab = record.indexOf('\t');
      if (tab > 0) eol.set(record.slice(tab + 1), record.slice(0, tab).replace(/\s+/g, ' ').trim());
    }
  } catch {
    // diagnostics only
  }
  for (const filePath of described) result.paths.push({ path: filePath, attributes: attributes.get(filePath), eol: eol.get(filePath) });
  return result;
};

/** Resolve the clone-local attributes file, honoring worktrees and GIT_DIR. */
const resolveInfoAttributesPath = async cwd => {
  const gitPath = (await runGit(['rev-parse', '--git-path', 'info/attributes'], { cwd })).trim();
  return path.resolve(cwd, gitPath);
};

/**
 * Write the artifact paths to `.git/info/attributes` with every conversion
 * unset. Idempotent.
 *
 * @param {{cwd: string, paths: string[]}} options
 * @returns {Promise<{file: string, previous: string|null, added: string[]}>}
 */
export const neutralizeCheckoutArtifacts = async ({ cwd, paths }) => {
  const file = await resolveInfoAttributesPath(cwd);
  let previous = null;
  try {
    previous = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const existing = previous || '';
  const existingLines = new Set(existing.split('\n').map(line => line.trim()));
  const lines = paths.map(filePath => `${toAttributesPattern(filePath)} ${NEUTRALIZED_ATTRIBUTES.join(' ')}`).filter(line => !existingLines.has(line));
  if (lines.length === 0) return { file, previous, added: [] };
  const separator = existing && !existing.endsWith('\n') ? '\n' : '';
  const header = existingLines.has(CHECKOUT_NORMALIZATION_HEADER) ? '' : `${CHECKOUT_NORMALIZATION_HEADER}\n`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${existing}${separator}${header}${lines.join('\n')}\n`, 'utf8');
  return { file, previous, added: lines };
};

/** Undo neutralizeCheckoutArtifacts when it did not make the tree clean. */
const restoreInfoAttributes = async ({ file, previous }) => {
  if (previous === null) await fs.rm(file, { force: true });
  else await fs.writeFile(file, previous, 'utf8');
};

const formatAttributes = attributes =>
  Object.entries(attributes || {})
    .map(([name, value]) => (value === 'set' ? name : value === 'unset' ? `-${name}` : `${name}=${value}`))
    .join(' ') || '(none)';

const logConversionDetails = async ({ log, description, verbose }) => {
  const options = verbose ? { verbose: true } : {};
  await log(`   ${description.gitVersion || 'git version unknown'}; ${Object.entries(description.config).map(([key, value]) => `${key}=${value || '(empty)'}`).join(', ')}`, options); // prettier-ignore
  for (const entry of description.paths) {
    await log(`   • ${entry.path}: attributes ${formatAttributes(entry.attributes)}; ${entry.eol || 'line endings unknown'}`, options);
  }
};

/**
 * Make a freshly cloned workspace usable when its only "changes" are content
 * conversion artifacts of the committed files.
 *
 * @param {{cwd: string, log?: (msg: string, opts?: object) => Promise<void>}} options
 * @returns {Promise<{clean: boolean, neutralized: string[], changes: {code: string, path: string, origPath?: string}[], statusOutput: string}>}
 */
export const resolveCheckoutArtifacts = async ({ cwd, log = async () => {} }) => {
  const { artifacts, changes, entries } = await classifyStatusEntries({ cwd });
  const statusOutput = entries.map(formatStatusEntry).join('\n');
  if (entries.length === 0) return { clean: true, neutralized: [], changes: [], statusOutput };

  await log(`🔍 Clone status: ${entries.length} path(s) reported as changed; ${artifacts.length} of them hold exactly the committed bytes (git content conversion artifacts)`, { verbose: true });
  if (artifacts.length === 0 || changes.length > 0) {
    // Real changes stop the run; the caller reports them. Explain the artifacts
    // too, because they are part of the same picture.
    return { clean: false, neutralized: [], changes, artifacts, statusOutput };
  }

  const paths = artifacts.map(entry => entry.path);
  const description = await describeConversion({ cwd, paths });
  const neutralization = await neutralizeCheckoutArtifacts({ cwd, paths });
  const after = await classifyStatusEntries({ cwd });
  if (after.entries.length > 0) {
    await restoreInfoAttributes(neutralization);
    await log(`⚠️  Unsetting content conversion for ${paths.length} path(s) did not make the clone clean; restored ${neutralization.file}`, { level: 'warning' });
    await logConversionDetails({ log, description, verbose: false });
    return { clean: false, neutralized: [], changes: after.entries, artifacts, statusOutput: after.entries.map(formatStatusEntry).join('\n') };
  }

  await log(`⚠️  The repository's committed content does not match its own .gitattributes for ${paths.length} file(s); a fresh clone reports them as modified although their bytes equal the commit:`, { level: 'warning' });
  for (const filePath of paths.slice(0, MAX_DESCRIBED_PATHS)) await log(`   M ${filePath}`, { level: 'warning' });
  if (paths.length > MAX_DESCRIBED_PATHS) await log(`   … and ${paths.length - MAX_DESCRIBED_PATHS} more`, { level: 'warning' });
  await logConversionDetails({ log, description, verbose: true });
  await log(`   Handled locally: line-ending/encoding conversion is unset for these paths in ${path.relative(cwd, neutralization.file) || neutralization.file} (never committed), so they stay byte-for-byte as committed and out of the pull request.`);
  await log('   Repository fix (for the repository owner): git add --renormalize . && git commit -m "Normalize line endings per .gitattributes"');
  return { clean: true, neutralized: paths, changes: [], artifacts, statusOutput };
};

export default {
  CHECKOUT_NORMALIZATION_HEADER,
  MAX_DESCRIBED_PATHS,
  NEUTRALIZED_ATTRIBUTES,
  classifyStatusEntries,
  describeConversion,
  formatStatusEntry,
  neutralizeCheckoutArtifacts,
  parsePorcelainZ,
  resolveCheckoutArtifacts,
  runGit,
  toAttributesPattern,
};
