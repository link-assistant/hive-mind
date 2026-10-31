# Interrupted native plan publication

This is stage 26 of the disposable Gemini CLI 0.65.0 experiment. It repairs
interrupted updates of a native plan document and its full-generation journal.
Production launchers and images remain unchanged. A9 remains incomplete.

Stage 25 appends the new full journal generation before publishing the document.
Killing the actual `StandardFileSystemService` writer after the journal directory
is synchronized leaves a mismatch. A fresh native reader refuses permanently.
Both first-publication and replacement controls reproduce this before repair,
after deleting the writer's whole private home.

The next stage first prepares a checked, synchronized staging document, retaining
the identity of its opened descriptor. It durably publishes a checked intent
containing the plan scope/name, preceding generation/version, complete next
generation and staging identity. Under the existing namespace and journal locks,
recovery validates the intent, document and journal before appending a missing
generation, publishing the document and removing the completed intent.
Startup, native reads and native writes recover this intent before admission.
Existing complete journal generations remain retained. Unsafe or inconsistent
proof refuses instead of reconstructing a document from an untrusted journal.

The generic publication allowlist admits only the exact session-root intent
filename. Native plan documents reserve `.plan-` components so tool writes cannot
collide with transaction metadata. Existing restricted Plan Mode policy remains.

Run the complete strict-before/repair/after sequence on a stage-25 package:

```sh
bash experiments/issue-3785/native-gemini/check_plan_transactions.sh "$package" /tmp/gemini-plan-publication
```

The bounded actual native API controls cover first publication and replacement
at three synchronized boundaries: after intent, after journal and after document
publication. Each owner is killed and reaped; its private home is deleted.
A fresh process must recover the complete new document, retain all complete
generations and remove completed transaction metadata. These six cases pass
twelve assertions. They inject finite filesystem kill points into the actual
native API; they do not instrument the provider or SDK.

A live staging substitution control also requires refusal before a new journal
generation when an adversary substitutes identical bytes in another inode.
Twenty-three unsafe-intent, staging, target and conflicting-journal controls each
require fresh-process refusal, repeated read/write refusal and unchanged complete
canonical/protected-file fingerprints. They include links, permissions, malformed
JSON/schema, invalid UTF-8, oversized intent, traversal, wrong scope/digest/revision
and a staged-name array that JavaScript would otherwise coerce to a string.
The full publication suite passes 59 assertions; storage passes 30 across
24 scenarios when explicitly selected with `--plan-transactions`.

Two draft defects have separate strict reproductions: accepting a substituted
staging inode with identical bytes, and accepting an array-valued staging name.
The final helper pins the writer's descriptor identity and validates JSON field
types before interpreting names or versions. The earlier stage-25 suite remains
separate, preventing later-stage assertions from breaking prerequisite CI.

Fresh reconstruction adds `--plan-transactions` to the preceding `--plans`
selectors and compares all 17 native manager/CLI/helper files across 26 stages.
CI runs the same driver, repeats recovery on the reconstructed package and checks
actual CLI plan resume plus the existing surrounding native lifecycle controls.
See [recorded evidence](../../../docs/case-studies/issue-3785/evidence/native-gemini-plan-publication.txt).

This verifies the stated synchronized native API boundaries. A whole actual CLI
interrupted-plan cycle, partial or malformed intent creation, unreferenced staging
before valid intent, physical power loss, persisted fresh-process rollback
authority, alternate/sandboxed writers, broader nested/Unicode Plan Mode policy,
every other task/memory path and complete production lifecycle remain unfinished.
No automatic cleanup of pre-intent orphan staging is claimed.
