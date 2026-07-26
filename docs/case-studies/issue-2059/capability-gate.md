# Agent default-model capability gate

The issue asks for Formal AI to become Agent's default **once it is fully supported**. Dispatch support and coding capability are independent:

- This PR supplies the missing dispatch plumbing.
- Formal AI's own coding ladder decides when implicit production selection is justified.

## Last comparable measurement

The 130-task v0.303.0 baseline in [formal-ai#848](https://github.com/link-assistant/formal-ai/issues/848) reported:

| Capability           | Result |
| -------------------- | ------ |
| Named-file reads     | 12/12  |
| All tasks            | 38/130 |
| Write tasks          | 10/60  |
| Valid generated code | 0      |
| Test authoring       | 0/8    |
| Targeted code edits  | 0/7    |
| Multifile work       | 0/4    |
| Whole issue to PR    | 0/16   |

Formal AI v0.305.0 contains newer grounded-action work, but the same 130-task coding ladder had not been republished for that release at this snapshot. A different 24-task routing journey cannot substitute for the issue-to-PR measurement.

## Promotion criteria

Change Agent's default to `formal-ai` only after a fresh release demonstrates all of the following on the committed, effect-verified ladder:

1. Non-zero and repeatable valid code generation.
2. Non-zero test authoring and targeted edits.
3. Non-zero coherent L2 and L3 coding deliverables.
4. At least one verified issue-to-PR L1 completion.
5. No regression in the 12/12 named-file read baseline.
6. A recorded real Hive Mind `solve ... --tool agent --model formal-ai` session whose resulting diff passes the target repository's checks.

Until then, users can select Formal AI explicitly and measure it without changing established Agent behavior for every solve. When the gate passes, the follow-up is intentionally small: update Agent's default model constant, its help/config documentation, and the default-model regression assertions.
