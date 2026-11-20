import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, opendir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { ghWithRateLimitRetry } from './github-rate-limit.lib.mjs';
import { sanitizeLogFileToFileBounded } from './log-sanitize-worker.lib.mjs';

const execFileAsync = promisify(execFile);
const maxSourceBytes = 40 * 1024 * 1024;
const metadataBytes = 256 * 1024;
const minimumAgeMs = 10 * 60 * 1000;
const repositoryPattern = /^[a-z\d][a-z\d-]*\/[a-z\d_.-]+$/i;
const usage = `Usage: hive-manager archive-sessions --repo OWNER/REPO --output NEW_DIRECTORY [options]
Stage sanitized session logs and a manifest for one public GitHub repository.
Options:
  --claude-dir DIRECTORY   Claude projects directory
  --codex-dir DIRECTORY    Codex sessions directory
  --limit NUMBER           Maximum number of exports (default: 20)
  --lino                   Also convert each sanitized file with the conversation CLI
`;

async function* sessionFiles(directory, depth = 0) {
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
    if (entry.isDirectory()) yield* sessionFiles(path, depth + 1);
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) yield path;
  }
}

function githubRepository(remote) {
  if (typeof remote !== 'string') return null;
  const match = /^(?:(?:https:\/\/|ssh:\/\/git@)github\.com\/|git@github\.com:)([^?#]+)$/i.exec(remote.trim());
  const repository = match?.[1].replace(/\.git$/i, '');
  return repositoryPattern.test(repository ?? '') ? repository.toLowerCase() : null;
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

async function attributedRepository(file, tool, checkoutCache) {
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
    return null;
  } finally {
    await source.close();
  }
}

async function requirePublic(repository) {
  const visibility = await ghWithRateLimitRetry(async () => {
    const { stdout } = await execFileAsync('gh', ['api', '--hostname', 'github.com', `repos/${repository}`, '--jq', '.visibility'], { timeout: 15_000, maxBuffer: 4096 });
    return stdout.trim();
  }).catch(() => null);
  if (visibility !== 'public') throw new Error('Could not confirm that the requested GitHub repository is public.');
}

async function collect({ root, tool, repository, remaining, output, reports, checkoutCache, lino }) {
  for await (const file of sessionFiles(root)) {
    const sourceInfo = await lstat(file);
    if (!sourceInfo.isFile() || sourceInfo.size > maxSourceBytes || Date.now() - sourceInfo.mtimeMs < minimumAgeMs) continue;
    if ((await attributedRepository(file, tool, checkoutCache)) !== repository) continue;
    const id = createHash('sha256').update(relative(root, file)).digest('hex');
    const archive = `${tool}-${id}.jsonl`;
    const destPath = join(output, archive);
    await sanitizeLogFileToFileBounded({ sourcePath: file, destPath });
    const current = await lstat(file);
    if (current.ino !== sourceInfo.ino || current.dev !== sourceInfo.dev || current.size !== sourceInfo.size || current.mtimeMs !== sourceInfo.mtimeMs || current.ctimeMs !== sourceInfo.ctimeMs) {
      throw new Error('A transcript changed during export. Run the export again after the session has finished.');
    }
    const entry = { tool, archive, sourceBytes: sourceInfo.size, modifiedAt: sourceInfo.mtime.toISOString() };
    if (lino) {
      entry.linksNotation = `${tool}-${id}.lino`;
      try {
        await execFileAsync('conversation', ['import', tool, destPath, join(output, entry.linksNotation)], { timeout: 120_000, maxBuffer: 4096 });
      } catch {
        throw new Error('Could not convert a session to Links Notation. Check that the conversation CLI is installed and supports JSONL import.');
      }
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
      limit: { type: 'string', default: '20' },
      lino: { type: 'boolean', default: false },
    },
  });
  if (values.help || process.argv.length === 2) {
    process.stdout.write(usage);
    return;
  }
  const repository = values.repo?.toLowerCase() ?? '';
  const limit = Number(values.limit);
  if (!repositoryPattern.test(repository) || /\/\.{1,2}$/.test(repository) || !values.output) throw new Error('Specify --repo OWNER/REPO and --output NEW_DIRECTORY.');
  if (!/^\d+$/.test(values.limit) || limit < 1 || limit > 100) throw new Error('Archive limit must be between 1 and 100.');
  await requirePublic(repository);

  const output = resolve(values.output);
  await mkdir(output, { mode: 0o700 });
  try {
    const reports = [];
    const shared = { repository, output, reports, checkoutCache: new Map(), lino: values.lino };
    await collect({ ...shared, root: resolve(values['claude-dir']), tool: 'claude', remaining: limit });
    if (reports.length < limit) await collect({ ...shared, root: resolve(values['codex-dir']), tool: 'codex', remaining: limit - reports.length });
    await requirePublic(repository);
    await writeFile(join(output, 'manifest.json'), `${JSON.stringify({ repository, sessions: reports }, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    process.stdout.write(`Staged ${reports.length} session(s) for ${repository}.\n`);
  } catch (error) {
    await rm(output, { recursive: true, force: true });
    throw error;
  }
}

try {
  await archive();
} catch (error) {
  process.stderr.write(`hive-manager: ${error.code ? 'Could not stage session archive.' : error.message}\n`);
  process.exitCode = 1;
}
