# Root-cause analysis — Issue #1803

## Primary root cause: confused responsibility of the prefix option

`--prefix-fork-name-with-owner-name` (default: `true`, see
`src/solve.config.lib.mjs`) exists so that when `solve` _creates_ a fork
on the current user's GitHub account, the fork is named
`<upstream-owner>-<repo>` instead of just `<repo>`. That avoids name
collisions when the user already has a repo with the same name.

The bug: in `setupRepository`'s `else if (forkOwner)` branch — which is
entered when the tool is _continuing an existing fork PR_ and has the
fork's actual name from PR head data — the code re-applied this option
to look up the fork:

```js
const expectedForkName = argv.prefixForkNameWithOwnerName ? prefixedForkName : standardForkName;
const alternateForkName = argv.prefixForkNameWithOwnerName ? standardForkName : prefixedForkName;
```

That's category-error logic. `forkRepoName` from `headRepository.name`
is _authoritative_: it's the name GitHub reports for the actual fork the
PR was opened from. Pasting the prefix on top of it can only mangle the
name.

In the concrete failing case, `forkRepoName` already was
`labtgbot-telegram-claude-agent` (the upstream owner prefix had been
applied at _fork creation time_, which is correct). Re-applying the
prefix at _lookup time_ produced
`labtgbot-labtgbot-telegram-claude-agent` — which does not exist.

## Secondary root cause: fallback gated on the same flag

The alternate-name fallback was also gated on
`!argv.prefixForkNameWithOwnerName`:

```js
if (forkCheckResult.code !== 0 && !argv.prefixForkNameWithOwnerName) {
  forkCheckResult = await $`gh repo view ${alternateForkName} --json name 2>/dev/null`;
  ...
}
```

So with the (default) prefix flag on, lookup had exactly one shot. The
_real_ fork (`konard/labtgbot-telegram-claude-agent`) was never tried
even though its name had already been handed to the tool on a silver
platter.

## Why this isn't covered by the #1332 tests

The #1332 fix shape (and its tests) is centered on the _non-prefix_
shape: `headRepoName = forkRepoName || repo` and using `headRepoName` in
`standardForkName` / `prefixedForkName`. Those tests verify that when
`forkRepoName` differs from `repo`, the names produced no longer use
`repo`. They don't assert anything about which of the two names is
_selected_. Selection is what #1803 got wrong.

## Why was the user-facing error message misleading?

The hint suggested running with `--fork` to create your own fork —
which would have _worked_ (it goes through the `argv.fork` branch above,
which uses `actualForkName` from `gh repo fork` output, bypassing the
buggy path). But the user already had the right fork, so the real fix
was to recognize and use it.

## Did the regression have telemetry?

Yes — the fork lookup printed both `Using fork:` and `Fork tried:` with
the constructed name, which is what made the bug diagnosable from the
external comment alone (see `data/external-comment-4463389730.json`). No
extra debug output was needed; the existing logs were sufficient.
