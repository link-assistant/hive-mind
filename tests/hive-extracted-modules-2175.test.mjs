/**
 * @hive-mind-test-suite default
 *
 * Coverage for the two modules extracted out of src/hive.mjs in issue #2175.
 *
 * hive.mjs sat at 1465 lines, over the 1350-line early-warning threshold that
 * scripts/check-file-line-limits.sh emits a CI warning for (the threshold that
 * issue #1593 introduced to keep concurrent merges from conflicting). The
 * repository fallback and the startup pre-flight checks moved into their own
 * modules; because they no longer close over hive.mjs's dynamically imported
 * bindings, the behaviour that was previously unreachable from a test is now
 * pinned here.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2175
 */

import assert from 'node:assert/strict';

import { createRepositoryIssueFetcher } from '../src/hive.repository-fallback.lib.mjs';
import { runStartupChecks } from '../src/hive.startup-checks.lib.mjs';

const noop = async () => {};
const nosleep = async () => {};

// --- 1. Repository fallback: GraphQL shortcut ------------------------------

{
  const fetcher = createRepositoryIssueFetcher({
    log: noop,
    cleanErrorMessage: String,
    tryFetchIssuesWithGraphQL: async () => ({ success: true, issues: [{ url: 'a' }], repoCount: 3 }),
    execGhWithRetry: async () => assert.fail('GraphQL succeeded — the paginated REST sweep must not run'),
    fetchAllIssuesWithPagination: async () => [],
    reportError: () => {},
    sleeper: nosleep,
  });

  assert.deepEqual(await fetcher('acme', 'organization', null, true), [{ url: 'a' }]);
}

{
  let graphqlCalls = 0;
  const fetcher = createRepositoryIssueFetcher({
    log: noop,
    cleanErrorMessage: String,
    tryFetchIssuesWithGraphQL: async () => {
      graphqlCalls++;
      return { success: true, issues: [], repoCount: 0 };
    },
    execGhWithRetry: async () => ({ stdout: '' }),
    fetchAllIssuesWithPagination: async () => [],
    reportError: () => {},
    sleeper: nosleep,
  });

  await fetcher('acme', 'organization', 'my-label', false);
  assert.equal(graphqlCalls, 0, 'GraphQL cannot filter by label, so labelled mode must go straight to the REST sweep');
}

// --- 2. Repository fallback: archived and foreign repositories are skipped --

{
  const repos = [
    { name: 'active', owner: { login: 'acme' }, isArchived: false },
    { name: 'archived', owner: { login: 'acme' }, isArchived: true },
    { name: 'fork-of-other', owner: { login: 'someone-else' }, isArchived: false },
  ];
  const queried = [];
  const commands = [];

  const fetcher = createRepositoryIssueFetcher({
    log: noop,
    cleanErrorMessage: String,
    tryFetchIssuesWithGraphQL: async () => ({ success: false }),
    execGhWithRetry: async command => {
      commands.push(command);
      return { stdout: repos.map(repo => JSON.stringify(repo)).join('\n') };
    },
    fetchAllIssuesWithPagination: async command => {
      queried.push(command);
      return [{ url: 'https://example.invalid/1', number: 1 }];
    },
    reportError: () => {},
    sleeper: nosleep,
  });

  const issues = await fetcher('acme', 'user', 'monitor-me', false);

  assert.match(commands[0], /^gh api users\/acme\/repos --paginate/, 'user scope must query the users endpoint');
  assert.equal(queried.length, 1, 'only the non-archived repository owned by acme is queried');
  assert.match(queried[0], /--repo acme\/active /);
  assert.match(queried[0], /--label "monitor-me"/, 'the monitor tag must be forwarded when not fetching all issues');
  assert.deepEqual(issues[0].repository, { name: 'active', owner: { login: 'acme' } }, 'issues are tagged with the repository they came from');
}

// --- 3. Repository fallback: one bad repository does not lose the rest -----

{
  const reported = [];
  const fetcher = createRepositoryIssueFetcher({
    log: noop,
    cleanErrorMessage: error => error.message,
    tryFetchIssuesWithGraphQL: async () => ({ success: false }),
    execGhWithRetry: async () => ({
      stdout: [JSON.stringify({ name: 'broken', owner: { login: 'acme' } }), JSON.stringify({ name: 'fine', owner: { login: 'acme' } })].join('\n'),
    }),
    fetchAllIssuesWithPagination: async command => {
      if (command.includes('acme/broken')) {
        throw new Error('boom');
      }
      return [{ url: 'kept' }];
    },
    reportError: error => reported.push(error.message),
    sleeper: nosleep,
  });

  const issues = await fetcher('acme', 'organization', null, true);
  assert.equal(issues.length, 1, 'a failing repository must not discard the issues collected from the others');
  assert.deepEqual(reported, ['boom']);
}

{
  const fetcher = createRepositoryIssueFetcher({
    log: noop,
    cleanErrorMessage: error => error.message,
    tryFetchIssuesWithGraphQL: async () => ({ success: false }),
    execGhWithRetry: async () => {
      throw new Error('rate limited');
    },
    fetchAllIssuesWithPagination: async () => [],
    reportError: () => {},
    sleeper: nosleep,
  });

  assert.deepEqual(await fetcher('acme', 'organization', null, true), [], 'a total failure degrades to an empty result rather than crashing the hive');
}

// --- 4. Startup checks -----------------------------------------------------

const checkDeps = overrides => ({
  log: noop,
  safeExit: async (code, reason) => {
    throw new Error(`exit:${code}:${reason}`);
  },
  ensureDiskSpaceForWorker: async () => ({ ok: true, freeMB: 99999 }),
  checkSystem: async () => ({ success: true }),
  validateToolConnection: async () => true,
  validateClaudeConnection: () => true,
  EXIT_CODE_INSUFFICIENT_DISK_SPACE: 75,
  ...overrides,
});

{
  for (const argv of [{ dryRun: true }, { skipToolConnectionCheck: true }, { toolConnectionCheck: false }]) {
    const result = await runStartupChecks(
      checkDeps({
        argv,
        ensureDiskSpaceForWorker: async () => assert.fail('checks must be skipped entirely'),
      })
    );
    assert.equal(result.skipped, true);
  }
}

{
  let requested;
  const result = await runStartupChecks(
    checkDeps({
      argv: { minDiskSpace: 2048 },
      ensureDiskSpaceForWorker: async ({ requiredMB }) => {
        requested = requiredMB;
        return { ok: true, freeMB: 4096 };
      },
    })
  );
  assert.equal(result.skipped, false);
  assert.equal(requested, 2048, '--min-disk-space must reach the guard');
}

{
  await assert.rejects(
    runStartupChecks(
      checkDeps({
        argv: {},
        ensureDiskSpaceForWorker: async () => ({ ok: false, freeMB: 10 }),
      })
    ),
    /exit:75:/,
    'an exhausted disk exits with its own code (#2160), not a generic failure'
  );
}

{
  await assert.rejects(runStartupChecks(checkDeps({ argv: {}, checkSystem: async () => ({ success: false }) })), /exit:1:System resource check failed/);
  await assert.rejects(runStartupChecks(checkDeps({ argv: {}, validateToolConnection: async () => false })), /exit:1:/);
}

{
  let passed;
  await runStartupChecks(
    checkDeps({
      argv: { tool: 'codex', model: 'gpt-5', verbose: true },
      validateToolConnection: async options => {
        passed = options;
        return true;
      },
    })
  );
  assert.equal(passed.tool, 'codex');
  assert.equal(passed.model, 'gpt-5', 'the connection must be validated with the model the run will actually use');
  assert.equal(typeof passed.validateClaudeConnection, 'function');
}

console.log('hive extracted modules (issue #2175): all assertions passed');
