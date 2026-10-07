// Persist exhaustion in the PR rather than only in the worker's memory.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isToolGeneratedComment } from './tool-comments.lib.mjs';

const execFileAsync = promisify(execFile);
export const RESTART_COOLDOWN_MARKER = 'hive-mind:auto-restart-limit';
export const DEFAULT_RESTART_COOLDOWN_HOURS = 6;
export const buildRestartCooldownMarker = headSha => (/^[a-f\d]{40,64}$/i.test(headSha || '') ? `<!-- ${RESTART_COOLDOWN_MARKER} ${headSha} -->` : '');

export function evaluateRestartCooldown({ headSha, comments = [], activity = [], now = Date.now(), hours = DEFAULT_RESTART_COOLDOWN_HOURS }) {
  if (!Number.isFinite(hours) || hours <= 0) return null;
  const stops = comments.filter(comment => comment.body?.includes(`<!-- ${RESTART_COOLDOWN_MARKER} ${headSha} -->`)).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const stop = stops[0];
  if (!stop) return null;
  const stoppedAt = Date.parse(stop.created_at);
  const until = stoppedAt + hours * 3600000;
  if (!Number.isFinite(stoppedAt) || stoppedAt > now || now >= until) return null;
  const changed = [...comments, ...activity].some(comment => {
    if (comment.user?.type === 'Bot' || comment.body?.includes(RESTART_COOLDOWN_MARKER) || isToolGeneratedComment(comment.body || '')) return false;
    return Date.parse(comment.updated_at || comment.submitted_at || comment.created_at) > stoppedAt;
  });
  return changed ? null : { until, reason: `Auto-restart budget exhausted for this commit; deferred until ${new Date(until).toISOString()}, a new commit, or a new comment.` };
}

const defaultRunGh = async args => JSON.parse((await execFileAsync('gh', args, { maxBuffer: 16 * 1024 * 1024 })).stdout);

export async function checkPullRequestRestartCooldown({ owner, repo, prNumber, issueNumber, env = process.env, now = Date.now(), runGh = defaultRunGh }) {
  const hours = env.HIVE_MIND_AUTO_RESTART_COOLDOWN_HOURS === undefined ? DEFAULT_RESTART_COOLDOWN_HOURS : Number(env.HIVE_MIND_AUTO_RESTART_COOLDOWN_HOURS);
  const repository = `${owner}/${repo}`;
  const api = async endpoint => (await runGh(['api', `repos/${repository}/${endpoint}`, '--paginate', '--slurp'])).flat();
  const [pr, comments] = await Promise.all([runGh(['pr', 'view', String(prNumber), '--repo', repository, '--json', 'headRefOid']), api(`issues/${prNumber}/comments`)]);
  const initial = evaluateRestartCooldown({ headSha: pr.headRefOid, comments, hours, now });
  if (!initial) return null;
  // Both conversation and inline/review feedback can unblock the task.
  const sources = [`pulls/${prNumber}/comments`, `pulls/${prNumber}/reviews`];
  if (issueNumber && Number(issueNumber) !== Number(prNumber)) sources.push(`issues/${issueNumber}/comments`);
  const activity = (await Promise.all(sources.map(api))).flat();
  return evaluateRestartCooldown({ headSha: pr.headRefOid, comments, activity, hours, now });
}
