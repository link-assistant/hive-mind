/**
 * Blocking destructive git pushes from inside a routed task (issue #2164, R13).
 *
 * The issue asks that agents lose the *physical ability* to destroy data:
 * "immediately apply block of all delete operations or history changes like git
 * reset and so on detected up on git push". A `git reset` is harmless on its
 * own — nothing is lost until the rewritten history reaches the remote — so the
 * point where the damage becomes real, and therefore the point worth guarding,
 * is the push.
 *
 * Three layers were planned for R13. This module is layer 2:
 *
 *   1. Branch protection on the remote (`src/protect-branch.mjs`) — server-side
 *      and unbypassable, but only covers branches somebody protected.
 *   2. This `pre-push` hook — covers every branch and every remote in the task
 *      container, costs nothing, and is defeated by `git push --no-verify`.
 *   3. The router's git transport (`/git/…`), which routed tasks now push
 *      through. It is unbypassable for the same reason the model traffic is —
 *      the task holds no other credential — and it refuses branch deletions
 *      outright (measured: `git push origin :refs/heads/x` → HTTP 403).
 *
 * Layer 3 covers deletions but not force pushes: the router decides by looking
 * for a `force-ref-updates` capability that git never sends, so a
 * non-fast-forward push is relayed unchanged (measured in
 * `experiments/issue-2164/probe-git-transport.sh`, reported upstream as
 * link-assistant/router#272). Until that lands, this hook is the only thing
 * standing between an agent and a rewritten branch — and `--no-verify` gets past
 * it — so branch protection remains the control that cannot be talked around.
 *
 * So this is a speed bump, not a cage, and the docs say so. It still removes the
 * accident case entirely — an agent that decides to "clean up" a branch with a
 * force push is stopped — which is the failure mode that actually happens.
 *
 * The hook is delivered by mounting a host directory read-only into the task
 * container and pointing git at it with `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_0`
 * (git >= 2.31). Env vars rather than `git config --global` because the task's
 * `~/.gitconfig` is bind-mounted from the *host*: writing to it would reconfigure
 * the operator's own machine.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2164
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Only `pre-push` is provided; git silently skips hook names that do not exist. */
export const GIT_PUSH_GUARD_HOOK_NAME = 'pre-push';

/** Operator escape hatch, propagated from an explicit `solve` opt-in (see `hasForcePushOptIn`). */
export const GIT_PUSH_GUARD_ESCAPE_ENV = 'HIVE_MIND_ALLOW_DESTRUCTIVE_PUSH';

/** Where the hook directory is mounted inside a Docker-isolated task. */
export const GIT_PUSH_GUARD_CONTAINER_DIR = '/home/box/.hive-mind/git-hooks';

/**
 * The hook itself.
 *
 * git feeds `<local ref> <local sha> <remote ref> <remote sha>` on stdin, one
 * line per ref being updated, and a non-zero exit aborts the whole push. Two
 * things are refused:
 *
 *   - an all-zero *local* sha, which is how `git push --delete`, `git push
 *     :branch` and `--mirror`/`--prune` deletions present themselves;
 *   - an update where the remote's current commit is not an ancestor of what we
 *     are about to send, i.e. a force push discarding commits that exist only on
 *     the remote — the shape a `git reset --hard` + `push --force` takes.
 *
 * A remote sha we do not have locally is refused too: it cannot be proven to be
 * an ancestor, and the honest answer to "would this destroy something?" is
 * "unknown". Everything else — ordinary fast-forward pushes, new branches, new
 * tags — passes untouched.
 *
 * POSIX sh, no bashisms: the isolation image's /bin/sh is dash.
 */
export const PRE_PUSH_GUARD_SCRIPT = `#!/bin/sh
# Hive Mind push guard (issue #2164). Refuses branch/tag deletions and
# history-rewriting (non-fast-forward) pushes from inside an isolated task.
# Generated file - edit src/git-push-guard.lib.mjs instead.
set -u

remote_name="\${1:-}"
remote_url="\${2:-}"
allow="\${${GIT_PUSH_GUARD_ESCAPE_ENV}:-}"
status=0

is_zero_sha() {
  [ -n "$1" ] || return 0
  case "$1" in
    *[!0]*) return 1 ;;
    *) return 0 ;;
  esac
}

refuse() {
  status=1
  echo "🛑 Hive Mind push guard: refused to $1" >&2
  echo "   remote: \${remote_name} \${remote_url}" >&2
  echo "   ref:    $2" >&2
}

while read -r local_ref local_sha remote_ref remote_sha; do
  [ -n "\${remote_ref:-}" ] || continue
  if is_zero_sha "\${local_sha:-}"; then
    refuse "delete a remote ref" "\${remote_ref}"
    continue
  fi
  is_zero_sha "\${remote_sha:-}" && continue
  if ! git cat-file -e "\${remote_sha}^{commit}" 2>/dev/null; then
    refuse "overwrite a remote commit this clone does not have (\${remote_sha})" "\${remote_ref}"
    continue
  fi
  if ! git merge-base --is-ancestor "\${remote_sha}" "\${local_sha}" 2>/dev/null; then
    refuse "rewrite history (the remote's \${remote_sha} is not an ancestor of \${local_sha})" "\${remote_ref}"
  fi
done

if [ "\${status}" -ne 0 ]; then
  case "\${allow}" in
    1 | true | TRUE | yes | YES)
      echo "⚠️  ${GIT_PUSH_GUARD_ESCAPE_ENV} is set, so the push is allowed anyway." >&2
      exit 0
      ;;
  esac
  echo "" >&2
  echo "Destructive pushes are blocked for routed tasks (--use-router, issue #2164)." >&2
  echo "Nothing was sent. Push a new commit instead, or ask a human operator to run it." >&2
fi

exit "\${status}"
`;

/**
 * Host directory holding the generated hook.
 *
 * Deliberately NOT the bot state directory: that holds the router's signing
 * secret, and this directory is mounted into every routed task.
 */
export function resolveGitPushGuardHostDir({ env = process.env, homeDir = os.homedir() } = {}) {
  const explicit = String(env.HIVE_MIND_GIT_HOOKS_DIR || '').trim();
  return explicit || path.join(homeDir, '.hive-mind', 'git-hooks');
}

/**
 * Write the hook to the host, ready to be mounted.
 *
 * Rewritten on every launch so an upgrade cannot leave a stale hook behind.
 * Never throws: a task that cannot get its guard is still a task worth running
 * (the caller warns), because the remaining layers — branch protection — are
 * the ones that were never bypassable anyway.
 *
 * @returns {{installed: boolean, dir: string, hookPath: string, error: string|null}}
 */
export function installGitPushGuard({ env = process.env, homeDir = os.homedir(), fsImpl = fs } = {}) {
  const dir = resolveGitPushGuardHostDir({ env, homeDir });
  const hookPath = path.join(dir, GIT_PUSH_GUARD_HOOK_NAME);
  try {
    fsImpl.mkdirSync(dir, { recursive: true });
    fsImpl.writeFileSync(hookPath, PRE_PUSH_GUARD_SCRIPT, { mode: 0o755 });
    // writeFileSync only applies `mode` when it creates the file, so an existing
    // hook keeps whatever permissions it had — including non-executable ones,
    // which git ignores silently.
    fsImpl.chmodSync(hookPath, 0o755);
    return { installed: true, dir, hookPath, error: null };
  } catch (error) {
    return { installed: false, dir, hookPath, error: error?.message || String(error) };
  }
}

/**
 * Turn `[key, value]` pairs into git's `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_n`
 * environment form (git >= 2.31).
 *
 * A routed task needs several such settings — the hook path here, plus the URL
 * rewrite and CA that send git through the router (issue #2164) — and they share
 * one counter, so building them separately would have each overwrite the other.
 * The order is preserved because git applies these last-to-win, which is what
 * lets `credential.helper=` clear an inherited helper list.
 *
 * @param {Array<[string, string]>} entries
 * @returns {Record<string,string>}
 */
export function buildGitConfigEnv(entries = []) {
  const usable = entries.filter(entry => Array.isArray(entry) && entry[0]);
  if (usable.length === 0) return {};
  const taskEnv = { GIT_CONFIG_COUNT: String(usable.length) };
  usable.forEach(([key, value], index) => {
    taskEnv[`GIT_CONFIG_KEY_${index}`] = key;
    taskEnv[`GIT_CONFIG_VALUE_${index}`] = value ?? '';
  });
  return taskEnv;
}

/**
 * Environment that points git at the mounted hook for every repository in the
 * container, without writing to the bind-mounted `~/.gitconfig`.
 *
 * `extraConfig` carries any other settings the same task needs, so all of them
 * end up under one `GIT_CONFIG_COUNT`.
 */
export function buildGitPushGuardEnv({ hooksPath = GIT_PUSH_GUARD_CONTAINER_DIR, allowDestructive = false, extraConfig = [] } = {}) {
  const entries = [...(hooksPath ? [['core.hooksPath', hooksPath]] : []), ...extraConfig];
  const taskEnv = buildGitConfigEnv(entries);
  if (Object.keys(taskEnv).length === 0) return {};
  if (allowDestructive) taskEnv[GIT_PUSH_GUARD_ESCAPE_ENV] = '1';
  return taskEnv;
}

/**
 * Read the existing fork-divergence opt-in out of a raw argument vector.
 *
 * `--allow-fork-divergence-resolution-using-force-push-with-lease` already means
 * "this operator accepts a force push", and Hive Mind performs one itself in
 * `solve.fork-sync.lib.mjs`. Blocking that would break a documented workflow, so
 * the opt-in is propagated into the container rather than overridden.
 *
 * @param {string[]} args
 */
export function hasForcePushOptIn(args) {
  const list = Array.isArray(args) ? args : [];
  return list.some(arg => {
    const value = String(arg ?? '');
    return value === '--allow-fork-divergence-resolution-using-force-push-with-lease' || value === '--allow-fork-divergence-resolution-using-force-push-with-lease=true';
  });
}

export default { buildGitConfigEnv, buildGitPushGuardEnv, hasForcePushOptIn, installGitPushGuard, resolveGitPushGuardHostDir, GIT_PUSH_GUARD_CONTAINER_DIR, PRE_PUSH_GUARD_SCRIPT };
