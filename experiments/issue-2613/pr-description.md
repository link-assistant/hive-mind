Version reports launched dozens of installed runtimes concurrently and left shell descendants alive after timeout. Failed Formal AI drafts also lost their logs when the Actions token could not create Gists and `--log-dir` was ignored during initialization.

This PR limits version probes across concurrent reports and cleans up their process groups. Failed uploads can publish the complete sanitized log on the verified existing PR branch, without committing unrelated staged work. Startup honors the requested log directory; formal drafts retain development logs, create a missing label and can dispatch checks without supplying a release bump.

Refs #2613. Includes one patch changeset.

### Reproduction and validation

`node tests/issue-2613-regressions.test.mjs` covers surviving descendants, shared concurrency, permanent Gist permission errors, secret removal, real local-Git publication, failed pushes, mismatched checkouts/origins, startup log placement, missing labels and dispatch defaults. Before/after captures are in the [case study](https://github.com/link-assistant/hive-mind/blob/issue-2613-2efa14ce78a7/docs/case-studies/issue-2613/README.md).

Local checks passed: all **563 default test files**, **9 focused regressions**, both version-info suites, formal-draft tests, live CI template inventory, ESLint, formatting, secret scanning, duplication (11.20%), syntax, file line limits and changeset validation. [Complete sanitized validation logs](https://github.com/link-assistant/hive-mind/tree/issue-2613-2efa14ce78a7/docs/case-studies/issue-2613/evidence/validation) are committed. Latest-head CI results are recorded in the PR checks.

### Evidence and remaining limits

The case study preserves both failure Gists, complete job logs, comments, recovery metadata, source analysis and a bounded Formal AI replay. The historical logs prove an OOM event and a roughly 3 GB container limit, but do not identify the OOM victim; the reproduced process leak is fixed without claiming an exact historical cause.

Formal AI 0.352.1 still mistakes `e.g.` for a file and cannot be described as fully operational for arbitrary issues. The independent reproduction, limited “for example” workaround and suggested parser/error-handling fixes are reported in [formal-ai #1189](https://github.com/link-assistant/formal-ai/issues/1189#issuecomment-6041117942). The installation-token repository fallback limitation is reported with a reproduction and proposed explicit repository target in [gh-upload-log #47](https://github.com/link-foundation/gh-upload-log/issues/47). This PR supplies the Hive Mind log-preservation workaround; the Formal AI recipe change remains upstream.
