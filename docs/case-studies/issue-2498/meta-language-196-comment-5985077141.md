2026-10-04T22:19:42Z
konard

## Recovery and what is left to fully deliver — audit of `6676c132` (2026-10-05)

This comment lists **only the remaining work**. [`5979473773`](https://github.com/link-foundation/meta-language/pull/196#issuecomment-5979473773), [`5971613170`](https://github.com/link-foundation/meta-language/pull/196#issuecomment-5971613170) and [`5965533606`](https://github.com/link-foundation/meta-language/pull/196#issuecomment-5965533606) stay in force until every item below is done. Implementation is already authorized: do not ask for approval, scope decisions or credentials, and do not stop.

### 1. Recover the killed session first

The last session (`48959e41-ea5e-4b70-a4f0-7b8309d597c9`) ended in three steps:

- the container was **OOM-killed** at 19:36 (`State.OOMKilled = true`, 11.7 GB limit; [kill notice](https://github.com/link-foundation/meta-language/pull/196#issuecomment-5983729348));
- [its log was uploaded](https://github.com/link-foundation/meta-language/pull/196#issuecomment-5983729144);
- the solver [stopped on expired authentication](https://github.com/link-foundation/meta-language/pull/196#issuecomment-5983718237) at 19:45, and no replacement session started.

On resume:

1. Run `git status` and `git log origin/issue-195-cc10e17ab860..HEAD`. Commit any work the killed session drafted but did not push, after re-reading it. Do not discard it. The last pushed head is `6676c132`.
2. Kill any leftover `cargo`, `rustc`, `node`, `lean`, `lake`, `coqc` and `rocq` processes, then run `node scripts/clean-caches.mjs`.
3. Read the [killed session's log](https://github.com/link-foundation/meta-language/pull/196#issuecomment-5983729144) to find **which command was running when memory ran out**. Record the cause in this PR.

**Find and fix the memory blow-up. It reproduces in CI.** In [run 37229486316](https://github.com/link-foundation/meta-language/actions/runs/37229486316), the formal-ai Rust workload behaves as follows:

- free memory stays at about 14 GB for 25 minutes;
- right after `issue_893_whole_task_validates_real_repository_files_against_the_ratchet` passes, it falls from 13.7 GB to 1.5 GB within about 3 minutes (`memory free 9.9 → 6.2 → 2.1 GiB`);
- the guard then kills the run (`exit 137`), so `I195-DOWNSTREAM-FORMAL-AI-WORKLOADS` fails.

The killed container very likely hit the same thing: a meta-language code path whose memory grows without bound on a real input. It is probably in the new native executor (memo, recovery, left recursion or settling) parsing a large file.

- Identify the exact formal-ai test and input. Run the Rust workloads in CI with `--test-threads=1` and log each test's name and peak memory.
- Fix the growth at its source. Give each parse a hard memory budget (bounded memo, bounded recovery and fork width) that fails with a diagnostic instead of growing.
- Add a regression test that parses that input under a memory cap in **both** runtimes. Test JavaScript first, with `node --max-old-space-size`.

**Never run any of these locally:** the formal-ai or RML workloads, the bulk grammar pipeline, the self-translation report, the full suites, acceptance, coverage or whole-corpus experiments. CI runs them, sharded and memory-guarded.

### 2. Make every check green

At `6676c132` the aggregate collapsed to **65/308**. One JavaScript test failure made `rust-suite` produce no record, so every Rust cell failed with it. The last real count was 280/297 at `fe9b6ff1`. Fix:

1. **JavaScript `grammar` group, 1 failure** (`294/295`): the ANTLR export test for the `ACTIONED : 'a' -> type(ID)` fixture no longer matches its expected output after `6676c132`. The export now repeats `ACTIONED` in `ID` and repeats the retype comment. Each retyped rule must appear exactly once, and the round trip must be stable.
2. **Formal AI Workloads:** the memory blow-up from section 1.
3. **The acceptance workflow must follow JavaScript first too.** `ci.yml` now correctly skips Rust when JavaScript fails. But `issue-195-acceptance.yml` still starts on its own `push`/`pull_request` triggers, in parallel. Its Rust candidate build, Rust clean consumers and the 28-minute formal-ai Rust workload all ran while JavaScript was red.
   - Start acceptance only after the JavaScript CI jobs pass: move it into `ci.yml` with `needs:`, or trigger it with `workflow_run`.
   - Inside it, run every Rust job after its JavaScript counterpart.
   - Extend the workflow-structure test to cover this workflow.
4. When a stage is skipped because JavaScript failed, report it as **one gate error** naming the blocking JavaScript failure. Do not mark it as hundreds of failed rows.

### 3. Self-translation must actually translate

The tool, the reports and the decorators exist, but the [CI report](https://github.com/link-foundation/meta-language/actions/runs/37228142594) shows that almost nothing is translated:

- across **115 modules**, **25 items are translated and 3,640 are carried** (0.7 %);
- **15** Rust functions are written, **0** identical to the hand-written Rust, and **0** translated lines appear in the hand-written Rust, with or without decorators.

Required:

- Grow the translator, **in JavaScript first**, until every `js/src` module translates, with **carried = 0**. Each carried construct is a translator gap to implement generically, not to restore.
- Make the generated Rust **replace** the hand-written Rust, module by module. It must pass `cargo check`, clippy and the shared Links Notation parity corpus. From then on, Rust changes come from translation, not hand-mirrored commits.
- Use decorators to make translated output match the existing Rust style. Publish the per-module numbers and drive "identical" and "shared lines" toward 100 %.
- **Round-trip tests must exercise translated items.** A block restored from its source text by hash proves that text is preserved, not that it was translated. Report round trips of translated items separately, both same-language (byte-identical) and cross-language (behavior-preserving).
- Translate full JavaScript/TypeScript ↔ Rust programs through meta-language, not only fixtures.

### 4. Grammars: from imported to native, merged and shared

The [bulk matrix](https://github.com/link-foundation/meta-language/actions/runs/37228142594) shows:

- **tree-sitter:** 67/67 import and compile, but only **38 accept their sample** and only **21 match the oracle rows**;
- **grammars-v4:** 39/43 import, 37 compile, 30 accept;
- **native by default:** only **13** languages;
- **merging:** it does not reconcile anything. `sharedRules` is **0 for 66 of the 67 languages and 1 for JavaScript**. JavaScript merges 143 tree-sitter rules and 239 grammars-v4 rules into **375** rules, which is a concatenation. Meaning-aware deduplication and shared concepts are therefore not achieved on real grammars.

Required:

1. **Real merging.** Reconcile tree-sitter, grammars-v4 and official sources into one grammar per language. Recognize same-meaning rules under different names, map them to shared concept records, and keep unique ones.
   - Publish a non-zero, measured `sharedRules` per language and the cross-language concept reuse.
   - A test fails when a merge only concatenates its sources.
2. **Every language accepts its sample and matches its oracle.** Implement the missing features listed in the matrix once, generically. The largest counts are Perl 108, Markdown 94, Haskell 94, Scala 71, Swift 70, Ruby 59, Bash 44, R 32, C# 25 and PHP 24. Then regenerate everything.
3. **Native by default for every catalog language**, including **Rocq**, which matches its oracle in the matrix but is not yet a native default. Move each language's tree-sitter dependency to dev-only as soon as it is native.
4. **No production tree-sitter.** `web-tree-sitter` is still in `js/package.json` `dependencies`, and `rust/Cargo.toml` still has **43 `tree-sitter*` crates in `[dependencies]`**. Both must end up as test oracles only. This covers `I195-DEPENDENCY-PRODUCTION-PARSERS-REMOVED` and `I195-GRAMMAR-DEPENDENCY-BOUNDARY`.

### 5. Requirement rows still open (as of the last real count)

These rows were failing at `fe9b6ff1` and are not shown done since:

- `I195-GRAMMAR-NATIVE-MERGED`, `I195-GRAMMAR-LANGUAGE-CATALOG`, `I195-GRAMMAR-LOSSLESS-TREES`
- `I195-MERGE-AUTOMATIC-PIPELINE`, `I195-MERGE-SHIPPED-GRAMMARS-ARE-MERGED`, `I195-MERGE-QUALITY-EVIDENCE`
- `I195-ACCEPTANCE-INDEPENDENT-ORACLES`
- `I195-INTERCHANGE-FORMAT-FEATURES`, `I195-INTERCHANGE-CROSS-FORMAT-TOOLS`
- `I195-SEMANTICS-CONSTRUCT-INVENTORY`
- `I195-DOWNSTREAM-TYPESCRIPT-TRANSLATIONS`: TypeScript now parses natively, so translate formal-ai's TypeScript ↔ Rust/JavaScript projection pairs through shared concepts.
- `I195-CONFORMANCE-lean`, `I195-GENERATIVE-lean`, `I195-GRAMMAR-NATIVE-TSX` (Rust)

The new rows (`I195-SELF-TRANSLATION-*`, `I195-DECORATORS-EVERY-LEVEL`, `I195-PARITY-FEATURE-COMPLETENESS`, `I195-GRAMMAR-DECLARED-SETTLING`) must pass with the **real** behavior described in sections 3 and 4, not only with their current fixtures.

Register **this comment** in `parity/issue-195-sources.json`. Add rows for:

- the memory budget and its regression test;
- acceptance workflow ordering;
- the single gate error for a skipped stage;
- real merge reconciliation (non-zero shared rules);
- carried = 0 self-translation.

### 6. Working rules (they prevent the next kill)

- **JavaScript first.** Finish and debug a batch in JavaScript, then port it to Rust in one batch, by translation wherever possible.
- **Bulk pushes.** Draft every change of a batch, commit, re-read the diff, then **push once**. In the last session, 33 commits were pushed in many small pushes, and most of the CI runs were cancelled.
- **No idle waiting.** While CI runs, work on the next item above.
- **Memory:**
  - Locally, run only targeted JavaScript tests, plus one `cargo check` when porting, with `CARGO_BUILD_JOBS=2 RUST_TEST_THREADS=2 CARGO_INCREMENTAL=0`.
  - Wrap heavy commands in `node scripts/with-cache-cleanup.mjs`, and check `free -m` before them.
  - Run `node scripts/clean-caches.mjs` after every batch.
  - Commit early, so that a kill loses nothing.

**Completion:** every PR check green, every requirement row passing with real behavior, and the release produced from `main` after merge.
