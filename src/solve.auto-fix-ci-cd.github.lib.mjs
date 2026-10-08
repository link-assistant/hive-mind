/** GitHub and registry evidence for post-merge CI/CD (issue #1782). */
import { commandOutput, runCommand, getActiveWorkflows, getLatestRunsForWorkflows, getRepositoryFiles, getRunsForCommit } from './fix.github.lib.mjs';
import { dedupeRunsByWorkflow } from './fix.ci-cd.lib.mjs';
import { interruptibleSleep } from './interruptible-sleep.lib.mjs';
import { detectPublishing, evaluateCiCdHealth } from './solve.auto-fix-ci-cd.detect.lib.mjs';
import { verifyPackagePublications } from './solve.auto-fix-ci-cd.packages.lib.mjs';

async function api(run, endpoint, { list = false } = {}) {
  const args = ['api', endpoint];
  if (list) args.push('--paginate', '--slurp');
  const value = JSON.parse(await commandOutput(run, 'gh', args));
  return list ? value.flat() : value;
}

export async function getBranchTarget({ repository, branch, run = runCommand }) {
  const commit = await api(run, `repos/${repository.fullName}/commits/${encodeURIComponent(branch)}`);
  return { branch, sha: commit.sha, since: commit.commit.committer.date };
}

export async function containsCommit({ repository, ancestor, sha, run = runCommand }) {
  if (!ancestor || !sha) return false;
  if (ancestor === sha) return true;
  const comparison = await api(run, `repos/${repository.fullName}/compare/${encodeURIComponent(ancestor)}...${encodeURIComponent(sha)}`);
  return ['ahead', 'identical'].includes(comparison.status);
}

async function readFile(repository, path, sha, run) {
  const contents = await api(run, `repos/${repository.fullName}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(sha)}`);
  if (contents.encoding !== 'base64' || typeof contents.content !== 'string') throw new Error(`Cannot inspect ${path}.`);
  return Buffer.from(contents.content, 'base64').toString('utf8');
}

function isFresh(date, since) {
  const timestamp = Date.parse(date);
  const mergedAt = Date.parse(since);
  return Number.isFinite(timestamp) && Number.isFinite(mergedAt) && timestamp >= mergedAt;
}

export async function verifyGitHubRelease({ repository, target, run = runCommand }) {
  const releases = await api(run, `repos/${repository.fullName}/releases?per_page=100`, { list: true });
  for (const release of releases) {
    if (release.draft || !isFresh(release.published_at, target.since)) continue;
    // target_commitish may be a branch name. Resolve the actual tag commit;
    // compare proves a newer version-bump commit includes the original merge.
    const commit = await api(run, `repos/${repository.fullName}/commits/${encodeURIComponent(release.tag_name)}`);
    if (await containsCommit({ repository, ancestor: target.sha, sha: commit.sha, run })) {
      return { kind: 'github-release', verified: true, detail: release.html_url || release.tag_name };
    }
  }
  return { kind: 'github-release', verified: false, detail: `No published GitHub release contains ${target.sha}.` };
}

export async function verifyPages({ repository, target, run = runCommand }) {
  const deployments = await api(run, `repos/${repository.fullName}/deployments?environment=github-pages&per_page=100`, { list: true });
  for (const deployment of deployments) {
    if (!isFresh(deployment.created_at, target.since)) continue;
    if (!(await containsCommit({ repository, ancestor: target.sha, sha: deployment.sha, run }))) continue;
    const statuses = await api(run, `repos/${repository.fullName}/deployments/${deployment.id}/statuses?per_page=100`, { list: true });
    if (statuses[0]?.state === 'success') return { kind: 'pages', verified: true, detail: statuses[0].environment_url || 'GitHub Pages deployment succeeded.' };
    return { kind: 'pages', verified: false, detail: `GitHub Pages deployment ${deployment.id}: ${statuses[0]?.state || 'no status'}.` };
  }
  // Branch-based Pages builds do not always create an environment deployment.
  const build = await api(run, `repos/${repository.fullName}/pages/builds/latest`);
  const verified = build.status === 'built' && Date.parse(build.created_at) >= Date.parse(target.since) && (await containsCommit({ repository, ancestor: target.sha, sha: build.commit, run }));
  return { kind: 'pages', verified, detail: verified ? `GitHub Pages built ${build.commit}.` : `GitHub Pages has no successful build containing ${target.sha}.` };
}

export async function collectCiCdHealth({ repository, target, run = runCommand, fetchJson, log = async () => {} }) {
  const errors = [];
  const warn = message => errors.push(String(message));
  const head = await getBranchTarget({ repository, branch: target.branch, run });
  if (!(await containsCommit({ repository, ancestor: target.sha, sha: head.sha, run }))) throw new Error('The target branch no longer contains the merged commit.');
  const workflows = await getActiveWorkflows(repository, run, warn);
  if (!workflows) throw new Error(errors.join('; ') || 'Cannot inspect active workflows.');
  const branchRuns = (await getLatestRunsForWorkflows(repository, target.branch, workflows, run, warn)) || [];
  // Tag-triggered publishers may run on the release/version-bump commit rather
  // than on a branch. Include them so a pending or failing tag run is visible.
  const commitRuns = await getRunsForCommit(repository, head.sha, run, warn);
  const activeIds = new Set(workflows.map(workflow => workflow.id));
  const runs = dedupeRunsByWorkflow([...commitRuns.filter(workflowRun => activeIds.has(workflowRun.workflow_id)), ...branchRuns]);
  let fresh = false;
  for (const workflowRun of runs) {
    if (Date.parse(workflowRun.created_at) >= Date.parse(target.since) && (await containsCommit({ repository, ancestor: target.sha, sha: workflowRun.head_sha, run }))) fresh = true;
  }
  // Do not query release registries while a publisher is still running.
  if (!fresh || runs.some(workflowRun => workflowRun.status !== 'completed') || runs.some(workflowRun => !['success', 'neutral', 'skipped'].includes(workflowRun.conclusion))) {
    return evaluateCiCdHealth({ runs, fresh, errors });
  }
  const tree = await getRepositoryFiles(repository, head.sha, run, warn);
  if (tree.truncated) errors.push('The repository file inventory is truncated; publication detection is incomplete.');
  const files = new Map();
  const inspect = async path => {
    if (files.has(path)) return;
    files.set(path, '');
    try {
      files.set(path, await readFile(repository, path, head.sha, run));
    } catch (error) {
      errors.push(error.message);
    }
  };
  // GitHub synthesizes Pages workflows; these paths are not repository files.
  const managedPages = workflows.some(workflow => workflow.path?.startsWith('dynamic/pages/'));
  for (const workflow of workflows.filter(workflow => !workflow.path?.startsWith('dynamic/'))) await inspect(workflow.path);
  const manifests = tree.files.filter(path => /(^|\/)(package\.json|pyproject\.toml|Cargo\.toml)$/.test(path) && !/(^|\/)(node_modules|vendor|tests?|fixtures?|examples?|experiments|docs)\//.test(path));
  for (const path of manifests) await inspect(path);
  // Follow local helper scripts, including nested scripts. Never execute code
  // from the repository being inspected. Bound the graph to keep it finite.
  for (const content of files.values()) {
    for (const match of content.matchAll(/(?:scripts\/[\w./-]+\.(?:mjs|cjs|js|sh|py))/g)) {
      if (files.size >= 200) {
        errors.push('Publication helper inspection exceeded 200 files.');
        break;
      }
      if (tree.files.includes(match[0])) await inspect(match[0]);
    }
  }
  const kinds = detectPublishing([...files.values()].join('\n'));
  if (managedPages && !kinds.includes('pages')) kinds.push('pages');
  const outputs = [];
  for (const kind of kinds.filter(value => ['github-release', 'pages'].includes(value))) {
    try {
      outputs.push(await (kind === 'pages' ? verifyPages : verifyGitHubRelease)({ repository, target, run }));
    } catch (error) {
      outputs.push({ kind, verified: false, detail: `${kind}: ${error.message}` });
    }
  }
  outputs.push(...(await verifyPackagePublications({ kinds, files, since: target.since, fetchJson })));
  await log(`CI/CD evidence: ${runs.length} workflow(s), ${outputs.length} publication/deployment check(s).`, { verbose: true });
  return evaluateCiCdHealth({ runs, outputs, fresh, errors });
}

/** Wait for CI and eventually consistent publication APIs before remediation. */
export async function monitorCiCd({ repository, target, log = async () => {}, collect = collectCiCdHealth, sleep = interruptibleSleep, now = Date.now, timeoutMs = 60 * 60 * 1000, outputGraceMs = 5 * 60 * 1000, pollMs = 30 * 1000 }) {
  const started = now();
  let missingSince = null;
  let last = { success: false, pending: true, runs: [], outputs: [], errors: [] };
  while (now() - started < timeoutMs) {
    try {
      last = await collect({ repository, target, log });
    } catch (error) {
      last = { success: false, pending: false, runs: [], outputs: [], errors: [error.message] };
    }
    // Give delayed workflows at least a minute to appear after merging.
    if (last.success && now() - Date.parse(target.since) >= 60 * 1000) return last;
    if (!last.pending && now() - Date.parse(target.since) >= 60 * 1000 && last.runs.some(workflowRun => workflowRun.status === 'completed' && !['success', 'neutral', 'skipped'].includes(workflowRun.conclusion))) return last;
    if (!last.pending && !last.success) {
      missingSince ??= now();
      if (now() - missingSince >= outputGraceMs) return last;
    } else {
      missingSince = null;
    }
    await log(`Waiting for CI/CD verification: ${last.errors.join('; ') || 'workflows/publications pending'}`, { verbose: true });
    if ((await sleep(Math.min(pollMs, timeoutMs - (now() - started))))?.interrupted) return { ...last, success: false, cancelled: true };
  }
  return { ...last, success: false, errors: [...last.errors, 'Timed out verifying post-merge CI/CD.'] };
}
