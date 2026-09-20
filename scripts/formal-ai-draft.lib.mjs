/**
 * Open a Formal AI draft for every new issue (issue #2233).
 *
 * Why this exists
 * ---------------
 * Issue #2233 asks for a draft attempt from Formal AI within minutes of an
 * issue being opened, on a branch nobody depends on, so that a wrong attempt
 * costs nothing and a right one saves the first commit. It asks for three
 * things, and this module is the decidable part of all three:
 *
 *   1. Trigger on `issues: opened`, not on a curated label — so the decision of
 *      *whether* to attempt is made here, from the event payload, rather than
 *      by a human applying a label. `decideDraft()` is that decision.
 *   2. Point the run at Hive Mind's own
 *      `solve --tool agent --model formal-ai --attach-logs --verbose` path
 *      (#2229, #2230, v2.24.0), so the drafts measure the chain Hive Mind
 *      ships. `buildSolveArgv()` is that command, and
 *      `tests/formal-ai-draft-2233.test.mjs` parses it through solve's own
 *      strict yargs configuration, so a flag typo fails in unit tests instead
 *      of forty minutes into a container run.
 *   3. Failure policy: a draft stays open and red until a later run succeeds.
 *      `buildSolveArgv()` therefore never emits `--auto-merge` and never emits
 *      `--auto-close-pull-request-on-fail`, and `keepPullRequestAsDraftArgs()`
 *      puts the pull request back into draft after the session, because solve
 *      converts it to ready-for-review at session end (#2123/#2182).
 *
 * Why the composite action is not installed here
 * ----------------------------------------------
 * Item 1 of #2233 says "install the action once it is published". As of the
 * commit that adds this file it is not published: `link-assistant/formal-ai`
 * has no root `action.yml`, `.github/actions` holds only `cache-cargo-registry`,
 * `download-formal-ai-binary`, `setup-buildx-resilient` and `setup-sccache`,
 * and there is no `.github/workflows/self-authored-pull-request.yml`. The
 * evidence is captured in `docs/case-studies/issue-2233/`. `uses:` does not
 * accept expressions, so there is no declarative seam that could switch to the
 * action the day it appears; the swap is a one-line edit of the workflow, and
 * `docs/FORMAL-AI-DRAFTS.md` records exactly which line.
 *
 * Everything here is a pure function over plain data, on node builtins only, so
 * the workflow's behaviour is testable without GitHub, Docker or a model.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2233
 * @module formal-ai-draft
 */

/** Applied to a draft this workflow opened, so the drafts can be listed and closed as a batch. */
export const FORMAL_AI_DRAFT_LABEL = 'formal-ai-draft';

/** Put this on an issue before opening it (or on the issue template) to suppress the attempt. */
export const FORMAL_AI_DRAFT_OPT_OUT_LABEL = 'no-formal-ai-draft';

/** The published image that bakes formal-ai, the Agent CLI and hive-mind together. */
export const DEFAULT_HIVE_MIND_IMAGE = 'konard/hive-mind:latest';

/**
 * The identity every commit on a draft branch carries.
 *
 * "No human commit on its branch" is a done-when condition of #2233. git takes
 * an identity from `GIT_CONFIG_*` without a config file existing at all, which
 * is what makes this work inside a container whose HOME is not the operator's
 * (verified by `experiments/issue-2233/probe-git-identity.sh`).
 */
export const DRAFT_GIT_IDENTITY = Object.freeze({
  name: 'github-actions[bot]',
  email: '41898282+github-actions[bot]@users.noreply.github.com',
});

/**
 * The flags #2233 names, plus the ones its failure policy implies.
 *
 * `--attach-logs --verbose` is quoted verbatim from the issue: a draft that
 * fails must leave its session log attached, "so the cause is readable after
 * the container is gone".
 *
 * `--attribution formal-ai` forces the trailer/evidence machinery of #2230 on
 * rather than letting `auto` decide, because the four trailers and the evidence
 * bundle are the done-when condition, not a nice-to-have.
 *
 * `--no-auto-restart-until-mergeable` is the one flag not named in the issue.
 * It defaults to true, and left on, a CI run watches the pull request's checks
 * and restarts the model until they are green — for up to
 * `--auto-restart-until-mergeable-timeout-hours` (24). That directly contradicts
 * "it stays open and red until a later run succeeds": the later run is the next
 * scheduled attempt, not this one looping.
 */
export const DRAFT_SOLVE_FLAGS = Object.freeze(['--tool', 'agent', '--model', 'formal-ai', '--attach-logs', '--verbose', '--attribution', 'formal-ai', '--no-auto-restart-until-mergeable']);

/**
 * Flags that must never appear in a draft run.
 *
 * Each is already off by default; they are listed so the intent survives a
 * future change of default, and so the regression test can assert on it.
 * `--auto-merge` would merge a draft nobody reviewed. `--auto-close-pull-request-on-fail`
 * would delete the evidence the whole exercise exists to collect.
 */
export const FORBIDDEN_DRAFT_SOLVE_FLAGS = Object.freeze(['--auto-merge', '--auto-close-pull-request-on-fail']);

/** Reason codes `decideDraft()` can return. Stable strings: the workflow logs them and the test asserts on them. */
export const DRAFT_DECISION_CODES = Object.freeze({
  run: 'run',
  notOpened: 'not-an-opened-issue',
  pullRequest: 'issue-is-a-pull-request',
  botAuthor: 'issue-author-is-a-bot',
  optOut: 'opt-out-label',
  alreadyDrafted: 'already-drafted',
  missingIssue: 'no-issue-in-event',
  missingToken: 'no-draft-token',
});

const labelNames = issue =>
  (Array.isArray(issue?.labels) ? issue.labels : [])
    .map(label => (typeof label === 'string' ? label : label?.name))
    .filter(name => typeof name === 'string')
    .map(name => name.toLowerCase());

/**
 * Read the issue out of a `issues` webhook payload, or out of a manual replay.
 *
 * A `workflow_dispatch` replay carries only a number, so the caller fetches the
 * rest; both shapes normalise to the same object so `decideDraft()` has one
 * input shape to reason about.
 *
 * @param {object} [event] parsed contents of `GITHUB_EVENT_PATH`
 * @returns {{action: (string|null), issue: (object|null)}}
 */
export function readIssueEvent(event) {
  if (!event || typeof event !== 'object') return { action: null, issue: null };
  return { action: typeof event.action === 'string' ? event.action : null, issue: event.issue && typeof event.issue === 'object' ? event.issue : null };
}

/**
 * Decide whether this event should produce a Formal AI draft.
 *
 * The order of the checks is the order of the answers a maintainer wants: what
 * the event *is* first, then policy, then configuration. A missing token is
 * reported last on purpose — otherwise every bot-filed issue in a repository
 * without the secret would report "no token" and hide the real reason.
 *
 * @param {object} params
 * @param {string} [params.eventName] `github.event_name`
 * @param {string} [params.action] webhook action (`opened`, `labeled`, …)
 * @param {object} [params.issue] the issue object from the payload
 * @param {boolean} [params.hasToken] whether the draft token secret is configured
 * @param {string} [params.optOutLabel]
 * @returns {{run: boolean, code: string, reason: string}}
 */
export function decideDraft({ eventName = 'issues', action = null, issue = null, hasToken = false, optOutLabel = FORMAL_AI_DRAFT_OPT_OUT_LABEL } = {}) {
  const deny = (code, reason) => ({ run: false, code, reason });

  if (eventName === 'issues' && action !== 'opened') return deny(DRAFT_DECISION_CODES.notOpened, `the \`issues\` event action was "${action ?? 'missing'}", not "opened"`);
  if (!issue) return deny(DRAFT_DECISION_CODES.missingIssue, 'the event payload carried no issue');
  if (issue.pull_request) return deny(DRAFT_DECISION_CODES.pullRequest, `#${issue.number} is a pull request, not an issue`);
  if (issue.user?.type === 'Bot') return deny(DRAFT_DECISION_CODES.botAuthor, `#${issue.number} was opened by the bot ${issue.user?.login ?? 'unknown'}; drafting a bot's issue would let two automations feed each other`);

  const labels = labelNames(issue);
  if (labels.includes(optOutLabel.toLowerCase())) return deny(DRAFT_DECISION_CODES.optOut, `#${issue.number} carries the \`${optOutLabel}\` label`);
  if (labels.includes(FORMAL_AI_DRAFT_LABEL)) return deny(DRAFT_DECISION_CODES.alreadyDrafted, `#${issue.number} already carries the \`${FORMAL_AI_DRAFT_LABEL}\` label`);

  if (!hasToken) return deny(DRAFT_DECISION_CODES.missingToken, 'no draft token is configured. A pull request opened with GITHUB_TOKEN does not trigger `pull_request` workflows, so its checks would never run and the draft could not be "red until a later run succeeds" — see docs/FORMAL-AI-DRAFTS.md');

  return { run: true, code: DRAFT_DECISION_CODES.run, reason: `#${issue.number} was just opened by ${issue.user?.login ?? 'a human'}` };
}

/**
 * The `solve` arguments for one draft attempt.
 *
 * @param {object} params
 * @param {string} params.issueUrl the full `https://github.com/owner/repo/issues/N` URL
 * @param {string} [params.logDir] directory solve writes its session log into
 * @returns {string[]}
 */
export function buildSolveArgv({ issueUrl, logDir } = {}) {
  if (typeof issueUrl !== 'string' || !/^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/\d+$/.test(issueUrl)) {
    throw new Error(`buildSolveArgv needs a github.com issue URL, received ${JSON.stringify(issueUrl)}`);
  }
  const argv = [issueUrl, ...DRAFT_SOLVE_FLAGS];
  if (logDir) argv.push('--log-dir', logDir);
  return argv;
}

/**
 * `GIT_CONFIG_*` variables that give git an identity without writing a config file.
 *
 * `init.defaultBranch` is included for the same reason every other workflow in
 * this repository sets it: `git init` warns without it and the warning ends up
 * in the attached log.
 *
 * @param {{name: string, email: string}} [identity]
 * @returns {Record<string, string>}
 */
export function buildGitIdentityEnv(identity = DRAFT_GIT_IDENTITY) {
  return {
    GIT_CONFIG_COUNT: '3',
    GIT_CONFIG_KEY_0: 'init.defaultBranch',
    GIT_CONFIG_VALUE_0: 'main',
    GIT_CONFIG_KEY_1: 'user.name',
    GIT_CONFIG_VALUE_1: identity.name,
    GIT_CONFIG_KEY_2: 'user.email',
    GIT_CONFIG_VALUE_2: identity.email,
  };
}

/**
 * The full `docker run …` argument list for one draft attempt.
 *
 * Built as an argv array, never as a shell string: the issue URL comes from a
 * webhook payload, and an argv array cannot be made to mean something else by
 * its contents. Environment variables are forwarded by *name* (`-e NAME`), so
 * no secret value is ever written into the argument list — where it would be
 * visible to `ps` and to anything that logs the command.
 *
 * @param {object} params
 * @param {string[]} params.solveArgv from `buildSolveArgv()`
 * @param {string} [params.image]
 * @param {string} [params.hostLogDir] host directory bind-mounted for the session log
 * @param {string} [params.containerLogDir] where that directory appears in the container
 * @param {string[]} [params.forwardEnv] names of environment variables to forward
 * @param {Record<string,string>} [params.setEnv] literal, non-secret variables to set
 * @returns {string[]}
 */
export function buildDockerArgv({ solveArgv, image = DEFAULT_HIVE_MIND_IMAGE, hostLogDir = null, containerLogDir = '/home/box/logs', forwardEnv = ['GH_TOKEN'], setEnv = buildGitIdentityEnv() } = {}) {
  if (!Array.isArray(solveArgv) || solveArgv.length === 0) throw new Error('buildDockerArgv needs the solve argv from buildSolveArgv()');

  const argv = ['run', '--rm', '--user', 'box'];
  for (const name of forwardEnv) argv.push('-e', name);
  for (const [name, value] of Object.entries(setEnv)) argv.push('-e', `${name}=${value}`);
  if (hostLogDir) argv.push('-v', `${hostLogDir}:${containerLogDir}`);
  argv.push(image, 'solve', ...solveArgv);
  return argv;
}

/**
 * Find the pull request a draft attempt opened for `issueNumber`.
 *
 * solve names its branch `issue-<number>-<uuid-suffix>`; matching on that
 * prefix is what lets the workflow put the pull request back into draft and
 * label it without the model having to report anything back. The `-` after the
 * number matters: without it, issue 22 would match the branch of issue 223.
 *
 * @param {Array<{number: number, headRefName: string, isDraft?: boolean}>} pullRequests
 * @param {number|string} issueNumber
 * @returns {object|null} the newest matching pull request
 */
export function selectDraftPullRequest(pullRequests, issueNumber) {
  const prefix = `issue-${String(issueNumber)}-`;
  const matches = (Array.isArray(pullRequests) ? pullRequests : []).filter(pr => typeof pr?.headRefName === 'string' && pr.headRefName.startsWith(prefix));
  if (matches.length === 0) return null;
  return matches.reduce((newest, pr) => (Number(pr.number) > Number(newest.number) ? pr : newest));
}

/**
 * `gh` arguments that convert a pull request back to draft.
 *
 * solve converts the pull request to ready-for-review when the session ends
 * (#2123/#2182). For an ordinary run that is right. For a Formal AI draft it is
 * not: #2233 asks for a *draft* pull request that is never hand-corrected and
 * merged, and GitHub refuses to merge a draft. So the workflow undoes that last
 * transition, which is also why this is a separate step and not a solve flag.
 *
 * @param {{repository: string, number: number|string}} params
 * @returns {string[]}
 */
export function keepPullRequestAsDraftArgs({ repository, number }) {
  return ['pr', 'ready', String(number), '--undo', '--repo', repository];
}

/**
 * `gh` arguments that label a draft so the batch can be found later.
 *
 * @param {{repository: string, number: number|string, label?: string}} params
 * @returns {string[]}
 */
export function labelPullRequestArgs({ repository, number, label = FORMAL_AI_DRAFT_LABEL }) {
  return ['pr', 'edit', String(number), '--add-label', label, '--repo', repository];
}

/**
 * Render a decision as `key=value` lines for `$GITHUB_OUTPUT`.
 *
 * Newlines are stripped rather than escaped: a reason is one sentence, and a
 * multi-line value would need the heredoc form of the file format, which is one
 * more thing to get wrong for no gain.
 *
 * @param {{run: boolean, code: string, reason: string}} decision
 * @returns {string}
 */
export function formatDecisionOutputs(decision) {
  const oneLine = String(decision.reason ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return `should_run=${decision.run ? 'true' : 'false'}\ndecision_code=${decision.code}\ndecision_reason=${oneLine}\n`;
}
