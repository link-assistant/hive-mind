# Router test compilation exceeds a roughly 3 GiB task budget

While investigating [Hive Mind #2745](https://github.com/link-assistant/hive-mind/issues/2745), the preserved session for [Router #719 / PR #742](https://github.com/link-assistant/router/pull/742) shows repeated `rustc` SIGKILL failures and container OOM activity. This is a build resource problem, independent of the routing behavior changed by that PR.

Evidence from the [original sanitized log](https://gist.github.com/konard/b2ec84b2c8ef2afce6b3d3187bf98996):

- Line 17: cgroup v2 limit `3135373312` bytes, `oom_kill=0`.
- Lines 5639–6478: the library test compile with `CARGO_BUILD_JOBS=2` exits 101; line 6532 contains `signal: 9, SIGKILL`.
- Lines 5639 and 6119: two separate Cargo invocations overlap. Limiting jobs inside each invocation does not limit their combined memory.
- Lines 23222–23766: the focused denial integration target passes with one job, debug information disabled, and increased codegen units.
- Line 23931: the full `cargo test --locked --all-features` still starts with one job, debug information disabled, CPU affinity limited, and `codegen-units=1024`.
- Line 24542: container usage `3130822656` bytes; `rustc` RSS `2219048` KiB, alongside Cargo and two Codex processes.
- Lines 24663 and 24683: Codex exits 137; cumulative cgroup OOM kills have increased to 23, peak memory `3135520768` bytes.

The counters identify kills in the cgroup, not the exact killed PID. The agent's missing failure detail is fixed separately in [Hive Mind PR #2746](https://github.com/link-assistant/hive-mind/pull/2746).

## Bounded reproduction

Use an isolated build container, not the agent's container, to keep compiler memory bounded. PR head observed during this investigation: `d80224a5dc6e85c49f036bddbddd4b5cebe3d87b`. Toolchain and warm-cache differences can change the peak, so retain `rustc --version`, the compile log and before/after `memory.events`.

```bash
docker run --rm --memory 3135373312 --memory-swap 3135373312 --pids-limit 256 \
  rust:1.98.1 bash -lc '
    git clone https://github.com/link-assistant/router /tmp/router
    cd /tmp/router
    git checkout d80224a5dc6e85c49f036bddbddd4b5cebe3d87b
    rustc --version
    cat /sys/fs/cgroup/memory.events
    CARGO_BUILD_JOBS=1 cargo test --locked --all-features --no-run \
      --config profile.dev.package.link-assistant-router.debug=0
    status=$?
    cat /sys/fs/cgroup/memory.events
    exit "$status"
  '
```

This finite compilation recipe is derived from the incident; it has not been rerun here to deliberately exhaust memory. The existing log already records repeated real failures. `--no-run` isolates compilation from vendor-backed tests.

## Workarounds and proposed changes

Run one Cargo invocation at a time with `CARGO_BUILD_JOBS=1`, use focused test targets, disable debug information for the Router package, and reserve headroom for the agent and Cargo. The incident proves these mitigations can make focused targets pass; it does not prove they make the full library test binary fit. Use a larger, dedicated CI runner for the full suite.

A possible Cargo profile for documenting and measuring a low-memory build is:

```toml
[profile.low-memory]
inherits = "dev"
debug = 0
incremental = false
codegen-units = 256
```

Pair it with `CARGO_BUILD_JOBS=1 cargo test --profile low-memory --locked --all-features --no-run` and measure the peak. This is a proposed experiment, not a verified fix: more codegen units trade compiler memory against parallel work, and disabling incremental compilation can also change peak usage. Longer-term, split large library/test compilation units and move suitable tests into smaller integration targets. Add a memory-budget compile job so regressions are observable, and document the supported budget if the full suite necessarily exceeds 3 GiB.

Primary references: [Cargo build jobs](https://doc.rust-lang.org/cargo/commands/cargo-build.html), [Cargo profiles](https://doc.rust-lang.org/cargo/reference/profiles.html), [Linux cgroup v2 memory controller](https://docs.kernel.org/admin-guide/cgroup-v2.html).
