/** Render live feedback and interventions without starting tools or polling. */
import './issue-3837-installed-dependencies.mjs';
import console from 'node:console';
import { utils } from '../src/bidirectional-interactive.lib.mjs';
import { buildPullRequestBaseBranchInterventionMessage, buildPullRequestBaseBranchMismatchMessage } from '../src/solve.pr-base-guard.lib.mjs';
import { buildPRNotUpdatedHint } from '../src/solve.results.lib.mjs';
import { buildPreExistingCiFeedback } from '../src/ci-pre-existing-failure.lib.mjs';
import { collectRestartEvidence } from '../src/restart-evidence.lib.mjs';

const outputs = [];
for (const kind of ['comment', 'ci', 'metadata', 'uncommitted']) outputs.push(utils.formatFeedbackForClaude('Payload: $& {{branchName}}', { kind }));
for (const options of [{}, { prNumber: 2, expectedBaseBranch: 'main', attemptedBaseBranch: 'feature/$&', command: 'gh pr edit --base feature/$&' }]) outputs.push(buildPullRequestBaseBranchInterventionMessage(options));
outputs.push(buildPullRequestBaseBranchMismatchMessage({ prNumber: 2, currentBaseBranch: 'develop', expectedBaseBranch: 'main' }));
for (const flags of [
  [true, true],
  [true, false],
  [false, true],
])
  outputs.push(buildPRNotUpdatedHint(...flags));
outputs.push(buildPreExistingCiFeedback({ allPreExisting: true, owner: 'example', repo: 'project', preExisting: [{ name: 'test', conclusion: 'failure', reference: { label: 'the base branch', sha: 'a'.repeat(40) } }] }));
outputs.push(collectRestartEvidence({ tracker: { record: () => 2 } }).feedback);
console.log(JSON.stringify(outputs, null, 2));
