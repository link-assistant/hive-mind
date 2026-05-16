# Case Study: Issue #1654 - `hive-screens` issues after sh → mjs port

- Issue: [link-assistant/hive-mind#1654](https://github.com/link-assistant/hive-mind/issues/1654)
- Prepared fix PR: [link-assistant/hive-mind#1655](https://github.com/link-assistant/hive-mind/pull/1655)
- Predecessor issue: [#1649](https://github.com/link-assistant/hive-mind/issues/1649) and merge PR [#1650](https://github.com/link-assistant/hive-mind/pull/1650)
- Predecessor case study: [docs/case-studies/issue-1649](../issue-1649/README.md)
- Related command: [`src/hive-screens.mjs`](../../../src/hive-screens.mjs) + [`src/hive-screens.lib.mjs`](../../../src/hive-screens.lib.mjs).
- Tests: [`tests/test-hive-screens.mjs`](../../../tests/test-hive-screens.mjs)

## Summary

Issue #1649 replaced the embedded `hive-screens.sh` script (previously in
`README.md`) with a JavaScript `hive-screens` bin command, landed in PR #1650.
After the port, three regressions surfaced that Issue #1654 asks to fix:

1. `--list` requires `--all` to actually list all matches. The user expects
   `hive-screens --list` alone to be sufficient.
2. `--enter` only prints `[screen is terminating]` / `Left <session>` when the
   user detaches. `--close` prints `Session:` / `Log:` / `Issue:`; `--enter`
   should do the same so the operator can see which log/issue they just
   finished with.
3. `--close` lists matching sessions but no longer actually closes them — the
   original sh script did close them, and this behavior regressed in the JS
   port.

The issue also asks for:

- Deep root-cause analysis backed by data.
- Maximum code reuse across `--list`, `--enter`, `--close`.
- Adding debug/verbose output when not enough data is present to identify a
  root cause.
- A case-study write-up collected under `docs/case-studies/issue-1654`.

## Timeline of events

- **Apr 16, 2026** — Original `hive-screens.sh` script lives inside `README.md`
  under _Maintenance → Script for managing screens_ (commits `27b77675`,
  `9b8a2008`, `cf2d551e`). The final sh form is snapshot at
  [`source-data/hive-screens.final.sh.txt`](source-data/hive-screens.final.sh.txt).
- **Apr 22, 2026** — Issue #1649 filed asking to convert the sh script into a
  proper `hive-screens` bin command with shared matching logic.
- **Apr 22, 2026** — PR #1650 lands: `src/hive-screens.mjs` +
  `src/hive-screens.lib.mjs` ship, README's sh snippet is replaced with a
  pointer to `hive-screens`.
- **Apr 23, 2026** — Issue #1654 is opened reporting the three regressions
  listed above; PR #1655 is opened against branch `issue-1654-5a4e862443ee`
  to address them.

## Requirements (verbatim from the issue)

> - `--list` option should be default list all, so `--list` should be enough
>   to list all.
> - `--enter` option on entering and `exit` should display also display log
>   and issue, like we do with `--close`, now `--enter` only shows this one:
>   ```
>   [screen is terminating]
>   Left 1619129.solve-veb86-zcadvelecAI-994
>   -----------------------------------
>   ```
> - `--close` option is not working like it was working in sh script, that was
>   removed from readme at [PR #1650], double check original sh script, and
>   find root cause why `--close` command stopped actually close screens, they
>   are listed, but not closed.
> - Double check for all options we reuse as much code as possible, so if it
>   works with one option we are sure it will work with other in hive-screens.
> - Compile data and write a case-study analysis under
>   `docs/case-studies/issue-1654` — timeline, root causes, solution plans,
>   and a survey of existing components that could help.
> - If there is not enough data to find the actual root cause, add debug
>   output and verbose mode.
> - If the issue is related to any other repository where we can report
>   issues on GitHub, please do so with a reproducible example, workarounds,
>   and a proposed fix.

## Root-cause analysis

### Regression 1 — `--list` needs `--all` to list everything

**Symptom.** `hive-screens --list` prints exactly one match even when several
match the predicate.

**Root cause.** `parseHiveScreensArgs` defaulted the selection flag to
`'oldest'` for every action, including the non-destructive `--list`:

```js
// src/hive-screens.lib.mjs (before the fix)
if (!result.selection) result.selection = 'oldest';
```

The implementation intentionally unified the default for all three flags so
the sh script's behaviour (`--oldest` as default) would be preserved. But the
legacy sh script only ever had `--enter` and `--close`; `--list` is a
JS-port-only action whose natural default should be `--all`, since it is a
read-only preview used to _discover_ which sessions match.

**Fix.** Split the default by action: `--list` → `--all`, `--enter` / `--close`
→ `--oldest` (unchanged, since those are destructive and preserving the sh
script's conservative default matters for user muscle memory).

### Regression 2 — `--enter` does not print Log/Issue context

**Symptom.** After `screen -r` detaches, the user only sees:

```
[screen is terminating]
Left 1619129.solve-veb86-zcadvelecAI-994
-----------------------------------
```

They want to also see `Log:` and `Issue:` lines (like `--close` prints).

**Root cause.** The previous code printed the session header _before_ calling
`screen -r`:

```js
// src/hive-screens.lib.mjs (before the fix)
printSession(match, { log }); // Session / Log / Issue
if (args.enter) {
  log(`Entering ${match.session}`);
  await spawnScreen(match.session); // screen -r blocks here
  log(`Left ${match.session}`);
}
```

The logic was correct on paper — `Log:` and `Issue:` _were_ printed. But GNU
screen switches the terminal to the [_alternate_ screen
buffer](https://invisible-island.net/xterm/xterm.faq.html#xterm_tite) (xterm
`smcup`/`rmcup`, terminfo `ti`/`te`) when attaching. On detach, the terminal
restores the _primary_ buffer, wiping every line printed before attaching,
including the `Log:` and `Issue:` lines the user wants to see.

The same thing happens for `less`, `vim`, `man`, etc.: content printed before
the tool runs is wiped once it exits, because we’re back on the primary
buffer.

**Fix.** Print the `Log:` / `Issue:` lines _after_ `screen -r` returns, not
before. The `Session: …` and `Entering …` lines stay before so the user knows
which session they are about to attach to while they type `Ctrl+a d`.

### Regression 3 — `--close` lists but does not close

**Symptom.** `hive-screens --close` prints `Closing <session>` but the target
screen session is still detached afterwards.

**Root cause.** The JS port uses `child_process.exec` to send the `exit`
command into the screen session:

```js
// src/hive-screens.lib.mjs (before the fix)
const shellSession = match.session.replace(/'/g, "'\\''");
await exec(`screen -S '${shellSession}' -X stuff $'exit\\n'`);
```

`exec` spawns `/bin/sh -c <command>`. On Debian/Ubuntu (and our Docker image,
and Gitpod, and Coolify base images) `/bin/sh` is **dash**, not **bash**.
Dash does **not** support bash ANSI-C quoting (`$'…'`), which is the only
reason the literal `$'exit\n'` meant “the string `exit` followed by a
newline”. Under dash, `$'exit\n'` degrades to the literal 7-character string
`$exit\n` (i.e. a `$`, `exit`, a backslash, and an `n`):

```text
$ /bin/sh -c "echo \$'exit\n' | od -c | head -3"
0000000   $   e   x   i   t  \n  \n
0000007

$ /bin/bash -c "echo \$'exit\n' | od -c | head -3"
0000000   e   x   i   t  \n  \n
0000006
```

So on every dash host, `screen -X stuff` received `$exit\n` (with the
literal `\n`) and typed those exact keystrokes into the session’s foreground
program, which is typically the long-running `solve`/`hive` Node process.
Neither the session’s shell nor the running Node process interprets
`$exit\n` as “quit”, so the session keeps running.

See `experiments/dash-vs-bash-ansi-c-quoting.mjs` for a runnable
reproduction.

**Fix.** Don’t rely on the shell at all. Use `child_process.spawn` with an
argv array, passing the newline as a literal character inside an argv
element:

```js
// src/hive-screens.lib.mjs (after the fix)
export const closeScreenSession = async (session, { spawn } = {}) => {
  const spawnFn = spawn || (await import('node:child_process')).spawn;
  return new Promise((resolve, reject) => {
    const child = spawnFn('screen', ['-S', session, '-X', 'stuff', 'exit\n'], {
      stdio: 'ignore',
    });
    child.on('error', reject);
    child.on('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`screen -X stuff exited with code ${code}`));
    });
  });
};
```

No shell is involved, so there is no shell metacharacter, no ANSI-C quoting,
and no difference between bash/dash/zsh/fish hosts.

### Why `--list` kept working even with broken `--close`

`--list` and `--close` _do_ share the matching predicate (`sessionMatches`) and
the scanning function (`findMatchingSessions`). That is why `--list` correctly
identified the sessions `--close` was supposed to terminate — the shared code
paths were right. What differed was the side-effect branch: `--list` had no
side effect, while `--close` relied on a shell-dependent command format that
silently degraded on dash. Tests did not catch it because the previous test
only asserted on the exact `screen -S … -X stuff $'exit\n'` string passed to
the injected `exec` stub, not on whether that string would actually be
interpreted by the real system shell.

## Solution plan & code reuse audit

1. **`src/hive-screens.lib.mjs`**
   - Add `closeScreenSession(session, { spawn })` — shell-free
     implementation using argv `'exit\n'`. Exported so tests and other
     callers can swap in fakes.
   - `runHiveScreens`: inject both `spawnScreen` (for `--enter`) and
     `closeScreen` (for `--close`), mirroring the same injection pattern.
   - Reorder `--enter` output so Log/Issue print after `screen -r` returns.
   - Update `parseHiveScreensArgs` so `--list` defaults to `--all` and
     `--enter`/`--close` keep defaulting to `--oldest`.
   - Add `--verbose` / `-v` that prints `[hive-screens]` diagnostics to
     stderr while scanning. Off by default to keep the existing output
     clean.
   - Keep `printSessionInfo` as the single source of truth for rendering
     `Session:` / `Log:` / `Issue:` — used by all three actions, so any
     future tweak to that block automatically covers `--list`, `--enter`,
     `--close`.

2. **`tests/test-hive-screens.mjs`**
   - Update the arg-parsing assertions for the new `--list` default and
     `--verbose` flag.
   - Add a regression test pinning `closeScreenSession` to `spawn('screen',
['-S', session, '-X', 'stuff', 'exit\n'])` so we can never ship the
     dash-broken `exec` form again.
   - Add a regression test asserting `--enter` prints `Log:` / `Issue:`
     _after_ `Left <session>`, so the alternate-buffer wipe doesn’t hide
     them.
   - Bare `hive-screens --list` with two matching sessions should show
     both.

3. **`README.md`** — update the example to use bare `hive-screens --list`
   (no `--all`), document the new `--verbose` flag, and record the
   per-action default.

4. **`.changeset/fix-hive-screens-1654.md`** — patch changeset describing the
   three fixes, so the next changesets release bumps the package version.

## Existing components / libraries surveyed

- **GNU screen `-X stuff`** — already used; we are just invoking it without
  a shell now. See `screen(1)` — `stuff` literally types the given string
  into the window, so any terminator character (newline, `^D`) works as
  long as we transmit the byte. No alternative library was needed.
- **[`execa`](https://www.npmjs.com/package/execa)** — popular wrapper around
  `child_process` that would also sidestep `/bin/sh`; considered but we
  prefer the stdlib `spawn` to avoid adding a runtime dependency for what is
  ~10 lines of code.
- **[`tmux`](https://tmux.github.io/)** / **[`tmuxinator`](https://github.com/tmuxinator/tmuxinator)** —
  `tmux send-keys -t <session> 'exit' Enter` is the closest analogue and has
  the same “newline token needs to reach tmux literally” property. Noting it
  here in case we migrate off GNU screen later.
- **[`node-pty`](https://www.npmjs.com/package/node-pty)** — considered for
  `--enter` to avoid `stdio: 'inherit'`-induced alternate-buffer wipe. Not
  adopted: we actually _want_ the alternate buffer while attached, we just
  need to print context _after_ leaving. So printing order is the cheaper
  fix.

## Reproducible examples

- `experiments/dash-vs-bash-ansi-c-quoting.mjs` — runs the literal dash vs
  bash command used by the old `exec` code path and prints the octal dump so
  the regression is obvious. Run with `node
experiments/dash-vs-bash-ansi-c-quoting.mjs`.
- `examples/hive-screens-close-regression.mjs` — documents exactly what the
  pre-fix code sent into a session and what the post-fix code sends, using
  the injected `spawn` hook, without needing a live screen server. Run with
  `node examples/hive-screens-close-regression.mjs`.

## Related external issues

We reviewed whether any upstream project was a root cause and therefore
worth a bug report:

- **GNU screen / dash** — not bugs. Both behave as documented. The bug was
  in our code assuming `/bin/sh` == `bash`.
- **Node.js `child_process`** — documented to use `/bin/sh -c` on POSIX. Not
  a bug.

No external report is warranted. The fix is entirely inside this repo.

## Source data

- [`source-data/github/issue-1654.json`](source-data/github/issue-1654.json)
- [`source-data/github/issue-1649.json`](source-data/github/issue-1649.json)
- [`source-data/github/pr-1650.json`](source-data/github/pr-1650.json)
- [`source-data/github/pr-1655.json`](source-data/github/pr-1655.json)
- [`source-data/hive-screens.final.sh.txt`](source-data/hive-screens.final.sh.txt)
  — final state of the sh script just before it was removed from README.md
  in PR #1650 (commit `cf2d551e2`).
