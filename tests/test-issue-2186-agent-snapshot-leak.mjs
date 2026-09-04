#!/usr/bin/env node

/**
 * Issue #2186 — orphaned `~/.local/share/link-assistant-agent/snapshot/` stores.
 *
 * `@link-assistant/agent` keeps a rollback snapshot per project, keyed on the
 * worktree's *root commit*. Up to js-0.26.0 `Snapshot.track()` built that store
 * as a standalone git object database — no `objects/info/alternates` — and
 * nothing ever removed it. Hive Mind runs every task in a throwaway `git init`
 * checkout under `/tmp`, so each invocation minted a brand-new full copy of the
 * repository in `$XDG_DATA_HOME` and never reclaimed one: a single 9.5 h task
 * left 115 orphaned stores / 31 GB behind (~5 GB/h), and *every* Hive Mind disk
 * check reported a healthy workspace because they all only look at `/tmp`.
 *
 * link-assistant/agent#298 (PR #300) shipped in 0.26.1: the snapshot store now
 * shares the repository's objects through `objects/info/alternates`, and
 * projects whose recorded worktree is gone are pruned. Hive Mind cannot fix an
 * older CLI from the outside, so it refuses to run on one.
 *
 * What this file locks in:
 *   1. the floor constant and its predicate,
 *   2. that `validateAgentConnection` refuses a leaking CLI *before* asking it
 *      to answer anything, and accepts the fixed one,
 *   3. that both images pin exactly the version the runtime guard demands, so
 *      the pin and the guard cannot drift apart.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/2186
 * @see https://github.com/link-assistant/agent/issues/298
 * @see https://github.com/link-assistant/agent/pull/300
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assert as check, printSummary, getFailCount } from './test-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

const { agentCliPrunesOrphanSnapshots, MIN_AGENT_FORMAL_AI_VERSION, MIN_AGENT_LIVE_INPUT_VERSION, MIN_AGENT_SNAPSHOT_HYGIENE_VERSION, validateAgentConnection } = await import('../src/agent.lib.mjs');

// ---------------------------------------------------------------------------
// 1. The floor and its predicate
// ---------------------------------------------------------------------------
console.log('\n1. The snapshot-hygiene floor\n');

check(MIN_AGENT_SNAPSHOT_HYGIENE_VERSION === '0.26.1', `the floor is the release that fixed the leak (got ${MIN_AGENT_SNAPSHOT_HYGIENE_VERSION})`);
check(agentCliPrunesOrphanSnapshots('@link-assistant/agent 0.26.0') === false, '0.26.0 still leaks a full object store per project');
check(agentCliPrunesOrphanSnapshots('@link-assistant/agent 0.26.1') === true, '0.26.1 shares objects and prunes dead projects');
check(agentCliPrunesOrphanSnapshots('@link-assistant/agent 0.27.0') === true, 'later releases keep the fix');
check(agentCliPrunesOrphanSnapshots('') === false, 'an unreadable version is treated as leaking');
check(agentCliPrunesOrphanSnapshots(undefined) === false, 'a missing version is treated as leaking');

// The guard in `validateAgentConnection` is unconditional, so it subsumes the
// two capability floors while it stays the highest of the three. If a future
// change lifts one of them above it, the ordering assumption below fails loudly
// instead of silently letting a leaking CLI through some other path.
const [major, minor, patch] = MIN_AGENT_SNAPSHOT_HYGIENE_VERSION.split('.').map(Number);
const asNumber = version => version.split('.').map(Number).reduce((total, part) => total * 1000 + part, 0);
check(asNumber(MIN_AGENT_SNAPSHOT_HYGIENE_VERSION) >= asNumber(MIN_AGENT_LIVE_INPUT_VERSION), `the snapshot floor is at least the live-input floor (${MIN_AGENT_LIVE_INPUT_VERSION})`);
check(asNumber(MIN_AGENT_SNAPSHOT_HYGIENE_VERSION) >= asNumber(MIN_AGENT_FORMAL_AI_VERSION), `the snapshot floor is at least the Formal AI floor (${MIN_AGENT_FORMAL_AI_VERSION})`);
check(Number.isInteger(major) && Number.isInteger(minor) && Number.isInteger(patch), 'the floor is a plain semver release, not a range');

// ---------------------------------------------------------------------------
// 2. A leaking CLI is refused before it is asked to do any work
// ---------------------------------------------------------------------------
console.log('\n2. `validateAgentConnection` refuses a leaking Agent CLI\n');

/** A stand-in `agent` binary that records every non-`--version` invocation. */
const withFakeAgentCli = async (version, assertions) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-mind-agent-snapshot-'));
  const requestLog = path.join(directory, 'requests.log');
  const versionBranch = version === null ? ['  echo "agent: unknown command" >&2', '  exit 1'] : [`  echo "${version}"`, '  exit 0'];
  fs.writeFileSync(path.join(directory, 'agent'), ['#!/bin/sh', 'if [ "$1" = "--version" ]; then', ...versionBranch, 'fi', `echo "$@" >> "${requestLog}"`, 'exit 0', ''].join('\n'), { mode: 0o755 });
  const previousPath = process.env.PATH;
  process.env.PATH = `${directory}${path.delimiter}${previousPath}`;
  try {
    await assertions({ requested: () => fs.existsSync(requestLog) });
  } finally {
    process.env.PATH = previousPath;
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

await withFakeAgentCli('0.26.0', async ({ requested }) => {
  check((await validateAgentConnection('agent')) === false, 'a 0.26.0 CLI is refused');
  check(requested() === false, 'the leaking CLI is never asked to answer anything');
});

await withFakeAgentCli(null, async ({ requested }) => {
  check((await validateAgentConnection('agent')) === false, 'a CLI whose version cannot be read is refused');
  check(requested() === false, 'an unidentifiable CLI is never asked to answer anything');
});

await withFakeAgentCli(MIN_AGENT_SNAPSHOT_HYGIENE_VERSION, async ({ requested }) => {
  check((await validateAgentConnection('agent')) === true, `a ${MIN_AGENT_SNAPSHOT_HYGIENE_VERSION} CLI is accepted`);
  check(requested() === true, 'the fixed CLI is actually exercised');
});

// ---------------------------------------------------------------------------
// 3. Both images pin exactly what the runtime guard demands
// ---------------------------------------------------------------------------
console.log('\n3. Image pins match the runtime floor\n');

for (const file of ['Dockerfile', 'Dockerfile.dind']) {
  const text = fs.readFileSync(path.join(repoRoot, file), 'utf8');
  const installs = [...text.matchAll(/bun install -g @link-assistant\/agent(@[^\s\\]+)?/g)].map(match => match[1]);
  check(installs.length > 0, `${file} installs the Agent CLI`);
  check(
    installs.every(pin => pin === `@${MIN_AGENT_SNAPSHOT_HYGIENE_VERSION}`),
    `${file} pins @link-assistant/agent@${MIN_AGENT_SNAPSHOT_HYGIENE_VERSION} (found ${JSON.stringify(installs)})`
  );
}

console.log('\nIssue #2186 — Agent snapshot store hygiene');
printSummary();
process.exit(getFailCount() > 0 ? 1 : 0);
