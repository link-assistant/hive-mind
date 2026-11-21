Independently reproduced with the installed formal-ai **0.352.1** binary while investigating [hive-mind #2613](https://github.com/link-assistant/hive-mind/issues/2613), which lost two real draft sessions to `File not found: .../e.g`.

The bounded local `/v1/chat/completions` replay uses temperature 0 and a `read(filePath)` tool:

```text
Read README.md (e.g., the project documentation).
  → read("README.md"), read("e.g")

Read README.md, for example the project documentation.
  → read("README.md")
```

The control supports replacing this abbreviation with “for example” as a limited prompt workaround. It does not make arbitrary issue text safe to rewrite.

The [reusable replay](https://github.com/link-assistant/hive-mind/blob/issue-2613-2efa14ce78a7/experiments/issue-2613/replay-formal-ai.mjs) limits requests, memory, stack, CPU time and wall time. [Complete responses](https://github.com/link-assistant/hive-mind/blob/issue-2613-2efa14ce78a7/docs/case-studies/issue-2613/evidence/formal-ai-replay.json) and the [real workflow failure](https://github.com/link-assistant/hive-mind/blob/issue-2613-2efa14ce78a7/docs/case-studies/issue-2613/evidence/formal-job-2613.log#L4268) are preserved in the case study.

An additional observation: after returning a tool response for **each** requested call, including `Error: File not found: e.g` for the invalid path, the minimal recipe formats that error as the contents of `e.g`. The real Agent integration instead ends with the file-not-found error. Successful API startup therefore does not establish that the issue was solved.

The shared path predicate fix proposed here should include abbreviation cases (`e.g`, `i.e`, `a.k.a`) alongside real filenames and tests where a read cue occurs elsewhere in the prompt. A separate regression should keep tool failures recognizable as errors rather than successful file contents.
