#!/usr/bin/env node

/**
 * Decide whether the release job has anything to do (issue #2175).
 *
 * Emits GitHub Actions step outputs:
 *   has_changesets   - changeset files are pending, so a version bump is needed
 *   changeset_count  - number of pending changeset files
 *   should_release   - the job should proceed (bump and/or publish)
 *   skip_bump        - publish the current package.json version as-is, because
 *                      it is not on npm yet and there is nothing to bump
 *
 * The logic lives in scripts/check-release-needed.lib.mjs so it can be
 * unit-tested (see tests/check-release-needed-2175.test.mjs). This file only
 * wires the real filesystem, npm and GitHub Actions output into it.
 *
 * Set HIVE_MIND_CI_VERBOSE=1 to trace every command and its exit code.
 */

import { appendFileSync } from 'node:fs';

import { countChangesets, decideRelease, emitDecision, readPackageInfo } from './check-release-needed.lib.mjs';
import { isVersionPublished } from './publish-to-npm.mjs';
import { isVerbose, runCommand } from './run-command.lib.mjs';

const verbose = isVerbose();

function setOutput(key, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    appendFileSync(outputFile, `${key}=${value}\n`);
  }
  console.log(`Output: ${key}=${value}`);
}

const { version } = readPackageInfo();
const decision = await decideRelease({
  changesetCount: countChangesets(),
  version,
  isPublished: candidate => isVersionPublished((command, args) => runCommand(command, args, { verbose }), candidate),
});

emitDecision(decision, setOutput);
