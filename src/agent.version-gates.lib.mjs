/**
 * Version floors for the Agent CLI, and the predicates that read them.
 *
 * Each floor is the first Agent release in which a behaviour Hive Mind depends
 * on actually holds; below it the CLI does something subtly wrong rather than
 * failing, so the caller refuses to start instead of trusting the result. The
 * comments on each constant record which upstream issue moved the floor.
 *
 * Extracted from `src/agent.lib.mjs` when issue #2186 pushed that file past the
 * 1350-line warning threshold enforced by `scripts/check-file-line-limits.sh`.
 * `agent.lib.mjs` re-exports every name here, so importers are unaffected.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2198
 */

import semver from 'semver';

export const MIN_AGENT_LIVE_INPUT_VERSION = '0.24.1';

export const getAgentCliVersion = versionOutput => {
  // `agent --version` can come back as `undefined` when the probe times out or
  // the binary writes nothing to stdout, and `semver.clean(undefined)` throws.
  // The floors below must answer "unknown", not blow up, so the caller reports
  // the missing version instead of a `TypeError`.
  const text = versionOutput == null ? '' : String(versionOutput);
  return semver.clean(text) || semver.coerce(text)?.version || null;
};

export const agentCliSupportsLiveInput = versionOutput => {
  const version = getAgentCliVersion(versionOutput);
  return !!version && semver.gte(version, MIN_AGENT_LIVE_INPUT_VERSION);
};

/**
 * Agent only fails closed on a `--model` argv it cannot parse from js-0.25.8
 * onwards (link-assistant/agent#293, fixed by PR #294): earlier releases logged
 * a CRITICAL record and then answered with their *default* model. Issue #2146
 * requires Formal AI to be the only model a task can reach, and a guard that
 * reads the CRITICAL record can only stop the run after Agent has already
 * decided, so a Formal AI task refuses to start below this release.
 */
export const MIN_AGENT_FORMAL_AI_VERSION = '0.25.8';

/** True when this Agent CLI aborts instead of silently picking another model. */
export const agentCliFailsClosedOnModelMismatch = versionOutput => {
  const version = getAgentCliVersion(versionOutput);
  return !!version && semver.gte(version, MIN_AGENT_FORMAL_AI_VERSION);
};

/**
 * Agent keeps a rollback snapshot per project under
 * `$XDG_DATA_HOME/link-assistant-agent/snapshot/<project id>`, and that project
 * id is the worktree's *root commit*. Before js-0.26.1 the store was a
 * standalone object database — no `objects/info/alternates` — and nothing ever
 * removed it, so any harness that runs the agent inside a throwaway `git init`
 * checkout minted a brand-new full copy of the repository per invocation and
 * never reclaimed one. Issue #2186 measured 115 orphaned stores / 31 GB in a
 * single 9.5 h task (~5 GB/h, every recorded worktree already deleted) while
 * every Hive Mind disk check — the 10 GB pre-flight gate, `disk-guard`,
 * `hive-cleanup` — reported a healthy workspace, because all of them only look
 * at `/tmp`. link-assistant/agent#298 (PR #300, shipped in 0.26.1) shares the
 * repository's objects through `objects/info/alternates` and prunes projects
 * whose recorded worktree no longer exists, which is what makes an unattended
 * multi-hour run bounded. Older releases are refused rather than left to fill
 * the disk.
 */
export const MIN_AGENT_SNAPSHOT_HYGIENE_VERSION = '0.26.1';

/** True when this Agent CLI shares snapshot objects and prunes dead projects. */
export const agentCliPrunesOrphanSnapshots = versionOutput => {
  const version = getAgentCliVersion(versionOutput);
  return !!version && semver.gte(version, MIN_AGENT_SNAPSHOT_HYGIENE_VERSION);
};
