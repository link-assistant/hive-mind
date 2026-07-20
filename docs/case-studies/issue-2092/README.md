# Issue #2092 — the self-healing loader that only healed three call sites

Why `/fix --ci-cd` died twice in seven minutes on `await use('command-stream')`,
even though this repository has had a use-m corrupt-install recovery since
issue #1710.

## One-paragraph summary

`command-stream` is fetched from the npm registry at runtime, by use-m, at the
*module top level* of ~40 files — including `src/github.lib.mjs`, which
`/fix --ci-cd` imports the moment it starts creating the remediation issue. When
that fetch or the resulting install is damaged, the process dies before any
`try/catch` can see it. The recovery for exactly this condition already existed
(`src/use-with-retry.lib.mjs`, from #1710 and #1712) but was wired into three
call sites, none of them `command-stream`. Run 1 hit a truncated install
(`SyntaxError: Unexpected end of input`); run 2 hit a failed
`npm install -g` — the same condition one stage earlier, and precisely the state
a naive "just retry the import" fix would have produced. Both runs printed a
single line, because the entry point logged `error.message` and dropped
`error.cause`. The fix wraps the loader once, at the only place that creates it
(`ensureUseM`), so all 100 `use(...)` calls inherit recovery; adds a fourth,
backoff-based failure mode for failed installs; deletes the whole
`<pkg>-v-<version>` alias directory rather than the entry file's parent; works
around Node's poisoned ESM cache with a cache-busted re-import (a gap the unit
tests missed and the real loader exposed); and restores cause chains to fatal
error output.

## Contents

| File                                 | Purpose                                                             |
| ------------------------------------ | ------------------------------------------------------------------- |
| [`timeline.md`](timeline.md)         | Both failing runs minute by minute, plus the #1710→#1712→#2092 lineage |
| [`analysis.md`](analysis.md)         | Root causes RC1–RC5, the defective control flow, rejected alternatives |
| [`requirements.md`](requirements.md) | Every requirement from the issue, with status and the codebase sweep |
| [`research.md`](research.md)         | use-m internals, related upstream issues, library survey            |
| `raw/`                               | Run 2 log and both experiment transcripts                           |
| `data/`                              | Issue JSON, comments, and the `use-m@8.14.2` bundle that was analysed |

Reproductions:
[`experiments/issue-2092/reproduce-real-use-m.mjs`](../../../experiments/issue-2092/reproduce-real-use-m.mjs)
(real `use-m@8.14.2` against the real global install) and
[`experiments/issue-2092/reproduce-corrupt-command-stream.mjs`](../../../experiments/issue-2092/reproduce-corrupt-command-stream.mjs)
(hermetic, no network, no global state).

## The decisive evidence

Two runs, seven minutes apart, same command, same image, same package:

```
11:37:53  ❌ Failed to import module from '/home/box/.nvm/versions/node/v20.20.2/lib/node_modules/command-stream-v-latest/src/$.mjs'.
11:45:08  ❌ Failed to install command-stream@latest globally into '/home/box/.nvm/versions/node/v20.20.2/lib/node_modules'.
```

And from the repair experiment against the real loader — the reason a
delete-and-reinstall retry is not enough on its own:

```
[use-m] use('command-stream') failed on attempt 1/3: Failed to import module from '…/src/$.mjs'. — retrying
[use-m] use('command-stream') recovered via a cache-busted import of …/src/$.mjs
✅ recovered: typeof $ = function
```

## Upstream

Reported to the loader's maintainers as
[link-foundation/use-m#66](https://github.com/link-foundation/use-m/issues/66):
failed global installs are unretried and undiagnosable (`stdio: 'ignore'`
discards npm's stderr), corrupt alias installs are sticky across processes, and
any in-process self-heal must bust Node's ESM cache
([comment](https://github.com/link-foundation/use-m/issues/66#issuecomment-5022434010)).
