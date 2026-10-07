# Failed Docker tasks: issue 2631

[Issue](https://github.com/link-assistant/hive-mind/issues/2631) · [Pull request](https://github.com/link-assistant/hive-mind/pull/2636)

The issue reviewed 18 failed tasks on a small production host and 57 GB of retained containers. Provider authentication, unsupported reasoning, exhausted restart budgets, refusal and memory pressure were different failure classes. Retaining every failed container obscured which failures actually held unique work.

The latest operator comment found one lost 550 KB screenshot among 17 removed containers. Recovery classified every file with a NUL byte as disposable build output. The reproduction uses a local bare Git remote and verifies screenshot/fixture bytes on the recovery branch, with the original PR HEAD and index unchanged. It failed before the fix. Binary size/build-directory classification now records each skipped reason, and incomplete preservation prevents cleanup.

The host launch reproduction empties PATH so neither Docker nor start-command can run. The previous runner reaches the missing start-command check before authentication; the fixed runner returns the injected authentication failure first. The Claude adapter regression uses mocked stream events. Before the fix an expired token starts one attempt; after the fix it starts two, accepts successful refresh, and returns a terminal login-required failure if the second attempt fails. No credentials or paid provider requests are used by these tests.

Container-retention regression failed before the policy change. Coverage also verifies that a clean working tree with unpushed commits, incomplete recovery or failed log upload cannot produce a cleanup receipt. Only a system `RECOVERY` log record authorizes the monitor; quoted tool output does not.

The refusal-report probe reproduces missing guidance on the original issue when failure logs were uploaded to its PR. The fixed helper posts the rephrase/`--tool claude` guidance on the issue and avoids a duplicate when the issue already received the log report.

Cooldown tests cover persisted commit identity, elapsed time, routine automation comments, new/edited feedback and paginated issue/PR/inline/review reads. The budget-exhaustion summary carries the failing checks and the remote PR commit; deferred queue entries can be evaluated in later iterations.

Reusable probes:

```bash
node experiments/reproduce-host-preflight-2631.mjs
node experiments/reproduce-claude-authentication-2631.mjs
node experiments/reproduce-model-refusal-2631.mjs
node --test tests/*2631.test.mjs
```

The host and Claude probes compare against commit `900a6443`, which contains binary recovery but precedes host preflight and Claude retry. The refusal probe uses `7a7f1c75`, before original-issue reporting was fixed. Baseline adapters are temporary and removed after each probe. See [production recovery](../../PRODUCTION-RECOVERY.md) for upgrade instructions, operating behavior and the boundaries with credential-mount, TTL and resume-image work.
