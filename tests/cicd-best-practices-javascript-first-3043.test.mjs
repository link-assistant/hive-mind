/**
 * @hive-mind-test-suite default
 *
 * Issue #3043. The guide covered release writers, cancellation and false-green
 * prevention, but not the JavaScript-first contract of link-assistant/router#759:
 * native JavaScript parity before any Rust job, a strict gate that rejects
 * missing or carried features, deterministic pinned regeneration, and a single
 * coordinator that pushes once per validated batch. Principle 18 records it.
 *
 * The example workflow, the GitHub expressions and the link targets are not
 * translated, so they are the same anchors in every language file — the same
 * shape as tests/cicd-best-practices-false-negatives-2625.test.mjs.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3043
 * @see https://github.com/link-assistant/router/issues/759
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const guidePaths = ['docs/CI-CD-BEST-PRACTICES.md', 'docs/CI-CD-BEST-PRACTICES.hi.md', 'docs/CI-CD-BEST-PRACTICES.ru.md', 'docs/CI-CD-BEST-PRACTICES.zh.md'];

for (const guidePath of guidePaths) {
  const guide = readFileSync(guidePath, 'utf8');
  const section = guide.match(/### 18\.([\s\S]*?)\n## /)?.[1];

  assert.ok(section, `${guidePath} has an eighteenth principle before the next chapter`);
  assert.ok(guide.indexOf('### 17.') < guide.indexOf('### 18.'), `${guidePath} keeps the principles in order`);
  assert.match(section, /router\/issues\/759/, `${guidePath} links the router evidence`);

  // The gate example must be correct under GitHub `needs` semantics: a skipped
  // or failed gate skips dependants by default, but `!cancelled()` would let a
  // job run anyway unless it also requires the gate's own result.
  const workflow = section.match(/```yaml\n([\s\S]*?)```/)?.[1];
  assert.ok(workflow, `${guidePath} shows the gated workflow`);
  assert.match(workflow, /uses: \.\/\.github\/workflows\/javascript-first-gate\.yml/, `${guidePath} calls the reusable gate`);
  for (const input of ['source-sha', 'javascript-command', 'parity-command', 'translation-command']) {
    assert.match(workflow, new RegExp(`\\n {6}${input}: \\S`), `${guidePath} passes a real ${input}`);
  }
  assert.doesNotMatch(workflow, /-command: (true|:|echo\b)/, `${guidePath} never shows a placeholder command`);
  assert.match(workflow, /needs: \[javascript-first\]/, `${guidePath} makes the Rust job need the gate`);
  assert.match(workflow, /if: \$\{\{ !cancelled\(\) && needs\.javascript-first\.result == 'success' \}\}/, `${guidePath} treats a skipped gate as not success`);
  assert.doesNotMatch(workflow, /always\(\)/, `${guidePath} does not run Rust after a cancelled gate`);
  assert.match(workflow, /ref: \$\{\{ needs\.javascript-first\.outputs\.tested-sha \}\}/, `${guidePath} builds the revision the gate tested`);

  assert.match(section, /needs\.<gate>\.result == 'success'/, `${guidePath} states the condition rule for always()/!cancelled()`);
  assert.match(section, /github\.event\.workflow_run\.conclusion == 'success'/, `${guidePath} checks the workflow_run conclusion`);
  assert.match(section, /github\.event\.workflow_run\.head_sha/, `${guidePath} checks out the tested workflow_run commit`);
  assert.match(section, /GITHUB_SHA/, `${guidePath} warns that GITHUB_SHA is the default branch in workflow_run`);
  assert.match(section, /cancel-in-progress: false/, `${guidePath} keeps active writers non-cancellable`);
  assert.match(section, /CARGO_TARGET_DIR/, `${guidePath} bounds local Rust builds`);
  assert.match(section, /rust-ai-driven-development-pipeline-template\/pull\/197/, `${guidePath} links the Rust template gate proposal`);
  assert.match(section, /js-ai-driven-development-pipeline-template\/pull\/231/, `${guidePath} links the JavaScript template gate proposal`);
  assert.match(section, /workflow-syntax#jobsjob_idneeds/, `${guidePath} cites GitHub needs semantics`);
  assert.match(section, /events-that-trigger-workflows#workflow_run/, `${guidePath} cites GitHub workflow_run semantics`);
  assert.match(section, /meta IR[^\n]*Links Notation/, `${guidePath} keeps the typed meta IR from PR #3044`);
  assert.match(section, /\]\(case-studies\/issue-3043\/README\.md\)/, `${guidePath} links the single-push enforcement design`);
}

const english = readFileSync(guidePaths[0], 'utf8').match(/### 18\.([\s\S]*?)\n## /)[1];
assert.match(english, /A wrapper is not an implementation/, 'it separates carried code from behavior parity');
assert.match(english, /WASM/, 'it names WASM wrapping as not native parity');
assert.match(english, /source round trip shows that source text is preserved/, 'it separates source round trip from execution parity');
assert.match(english, /fails on every entry marked missing, partial or carried/, 'it requires strict missing-feature rejection');
assert.match(english, /Pin the translator and the translation source by immutable revision/, 'it requires pinned regeneration');
assert.match(english, /fail on any difference from the tracked Rust before a Rust build starts/, 'it requires regenerate-and-diff before Rust');
assert.match(english, /A migration is incomplete until both exist/, 'it defines when a migration is complete');
assert.match(english, /keep the readiness gate red, label the port blocked/, 'it keeps unfinished ports blocked');
assert.match(english, /deliberately has no default generator and no placeholder command/, 'it requires real caller checks');
assert.match(english, /Each Rust build, test, package, container and publish job lists the gate in `needs:`/, 'it gates every Rust path');
assert.match(english, /A skipped gate is not success/, 'it rejects a skipped gate');
assert.match(english, /Path filters must not bypass the gate/, 'it closes the path-filter bypass');
assert.match(english, /fires whatever the upstream conclusion was/, 'it records that workflow_run fires on every conclusion');
assert.match(english, /Keep the existing writer rules/, 'it keeps principle 10 for writers');
assert.match(english, /One coordinator owns `git push`/, 'it names a single push owner');
assert.match(english, /Workers draft, never push/, 'it forbids worker pushes');
assert.match(english, /One coordinator pushes once per batch/, 'it pushes once per validated batch');
assert.match(english, /never pushes fix by fix/, 'it forbids push-per-fix');
assert.match(english, /does not imply permission to merge, publish, deploy or clean user-owned caches/, 'it limits what push permission means');

// PR #3044's solve scheduler proposal lives in the case study (English-only, so
// it does not need the four language siblings a top-level docs/*.md requires).
// It must stay a proposal, and the extension points it builds on must exist.
const caseStudy = readFileSync('docs/case-studies/issue-3043/README.md', 'utf8');
assert.match(caseStudy, /pull\/3044/, 'the case study records what was integrated from PR #3044');
assert.match(caseStudy, /\*\*Status: design proposal\.\*\* Nothing below is implemented\./, 'the scheduler is labelled a proposal');
assert.match(caseStudy, /These flags do not exist today/, 'the proposed flags are not advertised as working');
for (const [name, file] of [
  ['PRE_PUSH_GUARD_SCRIPT', 'src/git-push-guard.lib.mjs'],
  ['installGitPushGuard', 'src/git-push-guard.lib.mjs'],
  ['checkPRCIStatus', 'src/github-merge.lib.mjs'],
  ['getActiveBranchRuns', 'src/github-merge.lib.mjs'],
  ['waitForBranchCI', 'src/github-merge-ci-wait.lib.mjs'],
  ['detectAndCountFeedback', 'src/solve.feedback.lib.mjs'],
  ['waitForCompareApiReady', 'src/solve.auto-pr-push-sync.lib.mjs'],
  ['verifyBranchOnGitHub', 'src/solve.auto-pr-push-sync.lib.mjs'],
]) {
  assert.match(caseStudy, new RegExp(`\\[\`${name}\`\\]`), `the case study names ${name}`);
  assert.match(readFileSync(file, 'utf8'), new RegExp(`export (async )?(function|const) ${name}\\b`), `${file} still exports ${name}`);
}
for (const flag of ['ci-push-owner', 'ci-feedback-policy']) {
  assert.doesNotMatch(readFileSync('src/solve.config.lib.mjs', 'utf8'), new RegExp(`'${flag}'`), `--${flag} is not implemented yet; update the case study when it is`);
}

// Principle 18 must not weaken principle 10: active writers stay non-cancellable.
const principle10 = readFileSync(guidePaths[0], 'utf8').match(/### 10\.([\s\S]*?)\n### 11\./)[1];
assert.match(principle10, /group: main-writer-\$\{\{ github\.repository \}\}-main\n\s+cancel-in-progress: false/, 'principle 10 still keeps the shared writer group non-cancellable');

console.log('cicd-best-practices-javascript-first-3043.test.mjs: all assertions passed');
