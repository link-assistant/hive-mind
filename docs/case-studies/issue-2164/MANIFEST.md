# Issue #2164 case study — evidence manifest

Every claim in [`README.md`](README.md) is backed by a file listed here. The
checksums let a reader confirm the evidence has not drifted since the analysis
was written, without needing network access.

Regenerate and compare at any time:

```sh
cd docs/case-studies/issue-2164
find data -type f | sort | xargs sha256sum
```

## Collection method

| Group             | How it was captured                                                                                                                                                                                             |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data/github/`    | `gh issue view 2164 --json …`, `gh api repos/link-assistant/hive-mind/issues/2164/comments --paginate`, and the three distinct PR comment endpoints for #2165 (review comments, conversation comments, reviews) |
| `data/upstream/`  | `gh api repos/link-assistant/router …` for metadata, releases and the full issue list; `gh api …/contents/README.md` and the `docs/use-cases/` files for the documentation                                      |
| `data/hive-mind/` | `sed -n` extracts from this repository at the commit recorded in `hive-mind-commit.txt`, so the quoted code is pinned                                                                                           |
| `data/research/`  | Hand-written notes from web research, each claim carrying its source                                                                                                                                            |

## Files

| File                                                          | Bytes | SHA-256                                                            |
| ------------------------------------------------------------- | ----- | ------------------------------------------------------------------ |
| `data/github/issue-2164-comments.json`                        | 2     | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` |
| `data/github/issue-2164.json`                                 | 3434  | `d205f8062ccf64ccaad4cff4b746e7bb586ef9d5c95d86f194d727ef4b14a2ce` |
| `data/github/pr-2165-conversation-comments.json`              | 2     | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` |
| `data/github/pr-2165-review-comments.json`                    | 2     | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` |
| `data/github/pr-2165.json`                                    | 604   | `8a447b9e0181a75d339fc6c4b61e002a91bc662bd127cfe256d61ed74888ee3a` |
| `data/hive-mind/formal-ai-isolation.lib.snapshot.mjs`         | 3702  | `6555450ae8b9dfb6c63d83deff9fd15f3cfe90cd4916622a558747ad2ef8d8c8` |
| `data/hive-mind/formal-ai-sidecar-header.snippet.mjs`         | 6105  | `5546e4f65b7396146952b18aa224f9976439d84ef3642a4e1988117ec872e442` |
| `data/hive-mind/hive-mind-commit.txt`                         | 48    | `eb737254c258df841d1807feb7e234ed917e982de1d9fd82072969885c6fe3e5` |
| `data/hive-mind/isolation-runner-auth-mounts.snippet.mjs`     | 7658  | `2b0cc3ca887edbd9452166396d4780cb3c5fd37e63ae9e003eccb330d5fb6ba4` |
| `data/hive-mind/isolation-runner-formal-ai-lease.snippet.mjs` | 4954  | `0620c5dd63fe6e4c959438f06e67e9b2517a0062a85914a802528d8251773eb5` |
| `data/research/online-research.md`                            | 5159  | `73f83cc952adc56c6d3d129d9e9a7c0153b94c8e5da2447399eaa875955ddc95` |
| `data/upstream/router-README.md`                              | 69210 | `569d58ed868c6f4fbe4272b1bb2aabb15ae7de694cf6d014c2cd4f8553f406b8` |
| `data/upstream/router-issues.json`                            | 33042 | `f5245657ee41d7575486138227b0742b1fae6488b0467a3772089bb9db209d92` |
| `data/upstream/router-releases.json`                          | 1195  | `1cec53f25404ca79000313460c8685dd3410602b591becc6f80318f14df4cf8c` |
| `data/upstream/router-repo.json`                              | 161   | `19fcb6c6069da96380e7ec94a4cd135a45f01e3a7de6fbcdc22fb681c27179e3` |
| `data/upstream/router-use-case-audit-and-monitoring.md`       | 4589  | `23ad8c5951f0c53b8ff58ec4580560a39c8d26b1465711c8d7609ede9839c797` |
| `data/upstream/router-use-case-per-task-tokens.md`            | 6319  | `9728d46c1e50e9e1df440a4008cb3d0047548912c860d920db18c37754c2fc68` |
| `data/upstream/router-use-case-self-hosting.md`               | 6975  | `4b176872b9cce5cf714b911682f3488ef36e27d59d8414434b72428a73361806` |
| `data/upstream/router-use-case-with-router.md`                | 7811  | `0dbfb54c493be9fc05f97c3429f5cf084289e11979d7dfd5b02a33e6c31d5c37` |

## Notes on individual artifacts

- **`data/github/issue-2164-comments.json`**, **`pr-2165-review-comments.json`**,
  **`pr-2165-conversation-comments.json`** are all the empty array `[]`
  (2 bytes, hence the identical checksum). That is a finding, not a gap in
  collection: the issue body is the entire specification and no review feedback
  exists yet, so nothing beyond the body constrains this work.
- **`data/upstream/router-issues.json`** holds all 139 issues in
  `link-assistant/router`. **None are open.** This is why the issue's
  "report upstream first, continue once implemented" rule is a workable
  sequencing plan rather than an indefinite block.
- **`data/upstream/router-releases.json`** was repaired during collection: the
  first capture concatenated two JSON arrays (the repository's own releases
  followed by a stray capture of helm-chart releases). The stored file is the
  first array only, revalidated with `python3 -m json.tool`, and contains
  10 releases with `v0.105.0` (2026-08-21T13:23:05Z) newest.
- **`data/hive-mind/*.snippet.mjs`** are extracts, not whole modules — they are
  evidence for specific quoted claims, and the live files remain the source of
  truth. `hive-mind-commit.txt` records the exact commit and package version
  they were taken from.
- **`data/research/online-research.md`** is the only artifact that is not a
  verbatim capture. Each section states its source so the underlying claim can
  be re-checked independently.
