import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ghWithRateLimitRetry } from '../../../github-rate-limit.lib.mjs';

const run = promisify(execFile);
export const archiveRepoPattern = /^[a-z\d][a-z\d-]*\/(?!\.{1,2}$)[a-z\d_.-]+$/i;
export const archiveRevisionPattern = /^sha256:([a-f\d]{64})$/;

export function publishedRevisionName(archive, revision) {
  return `${archive}.${archiveRevisionPattern.exec(revision)[1]}`;
}

export async function archiveRepo(repository) {
  try {
    return await ghWithRateLimitRetry(async () => {
      const { stdout } = await run('gh', ['api', '--hostname', 'github.com', `repos/${repository}`, '--jq', '{full_name, visibility, default_branch}'], { timeout: 15_000, maxBuffer: 4096 });
      const result = JSON.parse(stdout);
      if (result.full_name?.toLowerCase() !== repository || !result.default_branch || !['private', 'internal', 'public'].includes(result.visibility)) throw new Error();
      return result;
    });
  } catch {
    throw new Error(`Could not verify GitHub repository ${repository}.`);
  }
}

export async function openArchiveGit(destination, branch, work) {
  const remote = `https://github.com/${destination}.git`;
  const repo = join(work, 'archive.git');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES'].includes(key)));
  const git = async (args, cwd = repo, maxBuffer = 1024 * 1024) => (await run('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd, env: { ...env, GIT_TERMINAL_PROMPT: '0' }, timeout: 180_000, maxBuffer })).stdout.trim();
  await git(['clone', '--bare', '--filter=blob:none', '--depth=1', '--single-branch', '--branch', branch, '--', remote, repo], work);
  const base = await git(['rev-parse', '--verify', 'HEAD']);
  return { git, base, remote };
}

export async function publishedArchiveRevisions(source, destination) {
  const { default_branch: branch } = await archiveRepo(destination);
  const work = await mkdtemp(join(tmpdir(), 'hive-archive-index-'));
  try {
    const { git, base } = await openArchiveGit(destination, branch, work);
    const prefix = `${source}/.published/`;
    const listing = await git(['ls-tree', '-r', '--name-only', base, '--', prefix], undefined, 16 * 1024 * 1024);
    return new Set(
      listing
        .split('\n')
        .filter(path => path.startsWith(prefix))
        .map(path => path.slice(prefix.length))
    );
  } catch {
    throw new Error(`Could not read the published session index for ${source} in ${destination}.`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
