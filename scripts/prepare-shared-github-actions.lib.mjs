/** Load the shared contract at runtime: absent remote actions cannot be skipped during runner setup. */
import { cpSync, mkdirSync, createWriteStream, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = 'link-foundation/.github';
const actions = ['resolve-github-token', 'dispatch-checks'];
const fallback = fileURLToPath(new URL('../.github/actions/shared-github-fallback/', import.meta.url));
async function request(endpoint) {
  const response = await fetch(`${process.env.GITHUB_API_URL || 'https://api.github.com'}/${endpoint}`, { headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json' } });
  if (!response.ok) throw new Error(`Shared action download failed: HTTP ${response.status}`);
  return response;
}
const github = async endpoint => (await request(endpoint)).json();

async function downloadArchive(sha, destination) {
  const archive = join(process.env.RUNNER_TEMP || '/tmp', `shared-github-${sha}.tar.gz`);
  try {
    const response = await request(`repos/${repository}/tarball/${sha}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(archive, { mode: 0o600 }));
    execFileSync('tar', ['-xzf', archive, '--strip-components=1', '-C', destination]);
  } finally {
    rmSync(archive, { force: true });
  }
}

export async function prepareSharedActions({ root = '.github/actions/shared-github', api = github, download = downloadArchive, log = console.log } = {}) {
  const commit = await api(`repos/${repository}/commits/main`);
  const tree = await api(`repos/${repository}/git/trees/${commit.sha}?recursive=1`);
  if (tree.truncated) throw new Error('The shared action tree is truncated');
  const published = actions.every(action => tree.tree.some(entry => entry.type === 'blob' && ['action.yml', 'action.yaml'].some(name => entry.path === `actions/${action}/${name}`)));
  mkdirSync(root, { recursive: true });
  if (published) {
    await download(commit.sha, root);
    for (const action of actions) {
      if (!['action.yml', 'action.yaml'].some(name => existsSync(join(root, 'actions', action, name)))) throw new Error(`Missing downloaded shared action: ${action}`);
    }
    log(`Shared GitHub actions: upstream ${repository}@${commit.sha}`);
    return 'upstream';
  }
  cpSync(fallback, root, { recursive: true });
  log(`::warning::Shared GitHub actions are unpublished in ${repository}; using the compatibility implementation of issue #1.`);
  return 'compatibility';
}
