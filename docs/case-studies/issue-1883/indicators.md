# Deferred-Work Indicators — Issue #1883

The catalogue of patterns used by `detectDeferredWork`, defined in
`src/solve.keep-working.detect.lib.mjs` as `DEFERRED_WORK_PATTERNS`. Each is a
**global, case-insensitive** RegExp with a human-readable label that is shown to
the user (and to the AI as the restart reason).

These intentionally favour **recall over precision** — per the issue, when the
user enables the feature they want the AI to keep going, so a few false positives
are acceptable (each costs at most one extra bounded restart).

| #   | Label                                      | Catches phrasing like                                                                     |
| --- | ------------------------------------------ | ----------------------------------------------------------------------------------------- |
| 1   | out of scope                               | "out of scope", "beyond the scope", "outside the scope", "not in scope"                   |
| 2   | future work                                | "future work", "future improvements", "future enhancements", "future iterations"          |
| 3   | future / separate / follow-up pull request | "in a future PR", "a separate pull request", "subsequent change", "next commit"           |
| 4   | follow-up work                             | "follow-up", "follow up work", "follow-up task", "follow-up issue"                        |
| 5   | deferred                                   | "deferred", "deferring", "defers" (but **not** "defer to the caller")                     |
| 6   | delayed / postponed                        | "delayed", "postponed", "postpone", "deprioritized"                                       |
| 7   | planned for later / another pull request   | "planned for a future…", "planned for the next…", "planned for another…"                  |
| 8   | left / leaving for later                   | "left it for later", "leaving this for now", "leave as future"                            |
| 9   | will be addressed later / separately       | "will be addressed later", "to be handled separately", "will be done in a follow-up"      |
| 10  | not implemented yet                        | "not implemented", "not yet done", "not completed yet", "not supported"                   |
| 11  | to be implemented / TBD                    | "to be implemented", "TBD", "TODO", "FIXME", "to be determined"                           |
| 12  | remaining work / not covered               | "remaining work", "not covered in this PR", "won't be implemented here"                   |
| 13  | tracked separately / in a separate issue   | "tracked in a separate issue", "tracking in a follow-up ticket"                           |
| 14  | for now / as a stopgap / temporary         | "for now", "as a stopgap", "as a temporary measure", "in the meantime", "as a first step" |

## Notable anti-false-trigger details

- **Pattern 5 (`deferred`)** uses a negative lookahead `(?!\s+to\s+the\s+caller)`
  so the common programming phrase "defer to the caller" does not count as
  deferred _work_.
- **Self-match avoidance.** The patterns are anchored on deferral _semantics_, not
  bare keywords, so the injected `KEEP_WORKING_PROMPT` (which contains words like
  "until", "everything", "indefinitely") does **not** match. A unit test asserts
  `detectDeferredWork(KEEP_WORKING_PROMPT)` returns `[]`. Without this, the
  reinforcement prompt could re-trigger the loop forever.
- **The feedback block is never scanned.** `buildKeepWorkingFeedback` deliberately
  contains deferral vocabulary ("There is NO future pull request", "Do not defer,
  delay or postpone…") to instruct the model. Because only the three external
  sources (PR description, AI summary, changed markdown) are scanned — never the
  prompt or the feedback — this instructive text cannot cause a restart.

## How a detection is rendered to the AI

`buildKeepWorkingFeedback` formats each detection with its label, source, and a
±40-character snippet, e.g.:

```
🔁 KEEP WORKING UNTIL ALL REQUIREMENTS ARE FULLY DONE (restart 1/5):

It looks like some work was deferred, delayed or planned for a future pull request.
The following strong indicators of unfinished / deferred work were detected:

  • [out of scope] in pr-description: "Caching is out of scope for this PR and will be"
  • [to be implemented / TBD] in changed-markdown: "// TODO: validate the config schema"

There is NO future pull request. ...

Please plan and execute everything in this single pull request, ...
```

Up to 15 distinct reasons are shown per restart to keep the prompt focused; any
overflow is summarised as "…and N more indicator(s)".

## Extending the catalogue

To add an indicator, append `{ label, pattern }` to `DEFERRED_WORK_PATTERNS`.
Keep the pattern **global + case-insensitive**, anchor it on deferral semantics
(not a bare keyword that appears in normal prose), and add a test asserting it
fires on a realistic example **and** that `KEEP_WORKING_PROMPT` still yields no
detections.
