# OOM scope cannot be inferred by comparing `oom_kill` with `oom`

Filed as https://github.com/link-foundation/start/issues/185.

Observed in `start-command@0.35.2`, `src/lib/cgroup-memory.js:describeCgroupOomScope()` (introduced by PR #184).

The new raw task cgroup counters are useful, but this comparison assigns a scope without enough evidence:

```js
oomKills > (oomEvents || 0) ? HOST_OR_PARENT : CONTAINER_LIMIT;
```

The [kernel documentation](https://docs.kernel.org/admin-guide/cgroup-v2.html#memory-interface-files) defines `oom` as allocation attempts reaching the limit and `oom_kill` as processes killed by any OOM killer. With `memory.oom.group=1`, a single container OOM can kill several processes. These counters have different units and are hierarchical; their ratio cannot distinguish container, parent, and host scope. Unknown `oomEvents` should also not be treated as zero for attribution.

Reproduce safely, without creating an actual OOM:

```sh
npm pack start-command@0.35.2
tar xzf start-command-0.35.2.tgz
node -e 'const c = require("./package/src/lib/cgroup-memory.js"); const m = c.parseCgroupMemorySample("3135373312 3135373312 1 3"); console.log(m, c.describeCgroupOomScope(m));'
```

The result is `host-or-parent`, although that sample is compatible with a container group OOM. The inverse comparison also does not prove container scope: earlier limit-related allocation failures can coexist with a later host OOM kill.

Suggested fix: retain raw counters and describe scope as unknown unless separately attributed kernel/cgroup evidence establishes it. Exposing `oom_group_kill` and `memory.events.local` would add useful context but still requires care when attributing the final exit. Keep the 0.35.2 exit-code guard that prevents an earlier child OOM from explaining ordinary exits or other signals.

Workaround in Hive Mind PR #2499: retain `cgroupMemory` from status/list, report process counts and the raw `memory.events oom` count separately, and do not derive scope from their ratio. Keep bot-cgroup counters and uncorrelated host OOM victims as context rather than task evidence. A complete bounded probe is in `experiments/issue-2498-start-command-contract.cjs`.
