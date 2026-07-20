# Research — issue #2092

## Upstream mechanics (`use-m@8.14.2`, `data/use-m-8.14.2-use.js`)

The npm resolver in use-m does three things in sequence, each with its own
failure message:

| Stage             | Code                                                      | Error message                                                        |
| ----------------- | --------------------------------------------------------- | -------------------------------------------------------------------- |
| resolve `@latest` | `getLatestVersion()` → `npm show <pkg> version`           | propagated from `execAsync` (see upstream #52)                       |
| install           | `use.js:680` `npm install -g <alias>@npm:<pkg>@<version>` | `Failed to install <pkg>@<version> globally into '…'` (`use.js:682`) |
| resolve path      | `use.js:692`                                              | `Failed to resolve the path to '<spec>' from '…'`                    |
| import            | `use.js:954`                                              | `Failed to import module from '<file>'.`                             |

Two properties of this code matter for #2092:

1. **No retry anywhere.** A single transient registry/DNS failure is fatal for
   the whole process.
2. **`stdio: 'ignore'` on the install** (`use.js:681`). npm's stdout and stderr
   are discarded, so `error.cause` carries an `execAsync` error with an empty
   `stderr`. The operator can never learn _why_ the install failed — this is
   precisely what run 2 of the failing job demonstrates.

The alias scheme (`<pkg>-v-<version>`, `use.js:663`) is what makes local
self-healing possible at all: a broken install is confined to one directory that
can be deleted and re-fetched. `resolveAliasDir()` in our fix depends on this
naming contract.

## Related upstream issues

- [link-foundation/use-m#52](https://github.com/link-foundation/use-m/issues/52)
  — `npm show` returns 403 in some GitHub Actions environments when resolving
  `@latest`. Different stage from #2092 (version resolution rather than install
  or import), but the same underlying theme: use-m performs unretried network
  work on the critical path of every process start.
- [link-foundation/use-m#53](https://github.com/link-foundation/use-m/issues/53)
  — investigation + solution proposals for #52; also documents that use-m has no
  caching for `@latest` resolution.
- [link-foundation/use-m#40](https://github.com/link-foundation/use-m/issues/40)
  — "Add caching support for non-specific package versions", open. Caching would
  reduce, but not remove, the exposure.

Nothing upstream covers retrying a failed/corrupt install or preserving npm's
stderr, so this repository filed a new report (see `README.md` for the link).

## Prior art in this repository

- `src/use-with-retry.lib.mjs` (#1710, #1712) — the recovery this issue extends.
- `src/github-rate-limit.lib.mjs:51` — `collectErrorText()` already walks
  `error.cause` for rate-limit detection; the same idea, applied to fatal-error
  printing, became `formatFatalError`.
- `src/use-m-bootstrap.lib.mjs` — already had a primary/fallback CDN ladder for
  the bootstrap _bundle itself_, i.e. the project already accepted "the loader
  must survive a flaky network". #2092 extends that principle from the bootstrap
  to the packages it loads.

## Existing components/libraries considered

| Candidate                     | Verdict                                                                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `p-retry` / `async-retry`     | Would itself have to be loaded through `use-m` — circular: the retry library cannot depend on the thing it protects. Rejected.                                     |
| Node's built-in `retry` hooks | None exist for `import()`.                                                                                                                                         |
| npm's `fetch-retries` config  | Retries HTTP requests inside npm, not the `npm install` process, and does nothing for an already-corrupt tree. Useful as defence in depth via `.npmrc`, not a fix. |
| Vendoring `command-stream`    | Removes runtime resolution for the one hottest package. Real option, larger blast radius; recorded as a follow-up in `requirements.md`.                            |
| Pre-installing in the image   | Helps DinD runs only; the alias directory (`command-stream-v-latest`) would still have to match what use-m expects. Follow-up.                                     |

The chosen fix uses only Node built-ins (`node:fs/promises`, `node:path`,
`setTimeout`), so it cannot fail for the same reason it exists to fix.
