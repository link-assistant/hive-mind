// Reproduction of the TDZ error from tests/deliberate-draft-restarts-ai-2312.test.mjs (issue #3469 R3):
// a static import of both modules, guards first.
import { resolveDraftBlocker } from '../src/solve.auto-merge-guards.lib.mjs';
import { ensurePullRequestIsReady } from '../src/pr-draft-state.lib.mjs';
console.log('ok', typeof resolveDraftBlocker, typeof ensurePullRequestIsReady);
