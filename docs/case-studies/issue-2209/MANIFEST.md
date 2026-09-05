# Issue 2209 evidence manifest

Captured on 2026-09-05 UTC. Everything [`README.md`](README.md) quotes is committed under `data/`, so the analysis can be re-checked without network access and without trusting a summary. Nothing here was edited after capture; where a file had to be reassembled from another one, this manifest says so.

## `data/github/`

Snapshots of every GitHub conversation the issues ask to re-check, fetched with `--paginate`. All three pull-request comment channels were captured separately, since `gh pr view --json comments` returns only the conversation one.

| File                                          | Contents                                                                                                                   |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `issue-2207.json`, `issue-2207-comments.json` | Sub-issue #2207 (accepted image discarded by the next task) and its comments.                                              |
| `issue-2208.json`, `issue-2208-comments.json` | Sub-issue #2208 (serving-backend provenance) and its comments.                                                             |
| `issue-2209.json`, `issue-2209-comments.json` | The parent issue and its comments.                                                                                         |
| `pr-2210.json`                                | This pull request.                                                                                                         |
| `pr-2210-conversation-comments.json`          | `repos/…/issues/2210/comments`.                                                                                            |
| `pr-2210-review-comments.json`                | `repos/…/pulls/2210/comments` — the three CodeQL `js/incomplete-sanitization` notes on the new tests, fixed in `d76c7a61`. |
| `pr-2210-reviews.json`                        | `repos/…/pulls/2210/reviews`.                                                                                              |

A `[]` file is not a capture failure: the three `-comments.json` issue snapshots and `pr-2210-conversation-comments.json` are genuinely empty at capture time.

## `data/logs/`

| File                             | Contents                                                                                                                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reproductions-before.log`       | Both minimal reproductions run from a worktree at `559c9801` — the commit that adds them and no fix. Both exit 1.                                                                      |
| `reproductions-after.log`        | The same two scripts on this branch. Both exit 0.                                                                                                                                      |
| `real-image-evidence-before.log` | `experiments/issue-2209/real-image-evidence.mjs` against a real Docker daemon and the real GHCR images, before the fix.                                                                |
| `real-image-evidence-after.log`  | The same run after it: lease digest, `docker inspect --format {{.Image}}` and an independent `GET /health` all agree, and the second task after another stop reaches the same release. |
| `regression-suites.log`          | The three new regression suites: 1 + 10 + 2 assertions, all passing.                                                                                                                   |

## `data/registry/`

`tag-digests.txt` — the manifest digests GHCR served for `ghcr.io/link-assistant/formal-ai` at `0.345.0`, `0.346.0` and `latest`, read from the registry API. The tag `latest` moved during this investigation (0.346.0 → 0.347.0), which is why the fix leads with the immutable digest and attaches `expectDigest` to the tag.

## `data/replay/`

The replay of the three tasks named in #2207 through their real clients, produced by [`experiments/issue-2209/replay-real-clients.mjs`](../../../experiments/issue-2209/replay-real-clients.mjs):

```bash
node experiments/issue-2209/replay-real-clients.mjs --only codex  --timeout 1800
node experiments/issue-2209/replay-real-clients.mjs --only claude --timeout 1800
node experiments/issue-2209/replay-real-clients.mjs --only agent  --timeout 1800
```

| File                                                              | Contents                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `remote-before.txt`                                               | The three target pull requests before the replay: Rust PR #2 (`issue-1-09b0c76bd0e4`) holds only `.gitkeep`; Kotlin PR #2 (`issue-1-604f2202fd18`) and Scala PR #2 (`issue-1-1f3e3886bcb8`) hold no files. Matches #2207's description.                                                                                                                                  |
| `remote-after.txt`                                                | The same three pull requests after it, with `gh pr diff`. Unchanged.                                                                                                                                                                                                                                                                                                     |
| `driver-codex.log`, `driver-claude.log`, `driver-agent.log`       | The driver's own output per run: the update that was accepted, the image acquire, the lease, and the client's exit code and remote state.                                                                                                                                                                                                                                |
| `codex-rust.log.gz`, `claude-kotlin.log.gz`, `agent-scala.log.gz` | The full `src/solve.mjs --verbose` logs, gzip-compressed without modification (99 206, 2 747 577 and 593 073 bytes uncompressed).                                                                                                                                                                                                                                        |
| `replay-summary-claude.json`, `replay-summary-agent.json`         | The driver's machine-readable summary, as written.                                                                                                                                                                                                                                                                                                                       |
| `replay-summary-codex.json`                                       | **Reassembled.** The driver writes `logs/replay/replay-summary.json` in place, so the codex file was overwritten by the two later runs; every field in it is parsed back out of `driver-codex.log` by [`experiments/issue-2209/rebuild-codex-summary.mjs`](../../../experiments/issue-2209/rebuild-codex-summary.mjs), and `logFile` was repointed at the committed log. |

To read a client log without unpacking it:

```bash
zcat docs/case-studies/issue-2209/data/replay/codex-rust.log.gz | sed -n '520,535p'
```

## SHA-256

```text
4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945  github/issue-2207-comments.json
780ece752f8ac0d3daef96c43066c0231e78c5d213af05349649a4fd24fa3ebe  github/issue-2207.json
4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945  github/issue-2208-comments.json
7f0611632ff335b07b614cca3e1481ff0811803b3e5866cfc6afafdeb24390bd  github/issue-2208.json
4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945  github/issue-2209-comments.json
b91deb60fc2ba0f6892ad5943adf9f1ec9c8d986ff1c0a13e24ac0b75e97bc81  github/issue-2209.json
4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945  github/pr-2210-conversation-comments.json
526b5e5c39c5593fc2389f6470158236d3a3b7d5fad482b493204d05b82d5ca3  github/pr-2210-review-comments.json
c91b3842d9ab55635ca58f7ea23466fb5b5f1f0d6d3bad2c6e32478be7616c9e  github/pr-2210-reviews.json
766ee0126645919fe10ca5eb1ae83094b43894fd41d1f982131a6ce2b60204c0  github/pr-2210.json
740d8cb730367336eb4b7c5187836595cd671ad4225320bcc2170fc7fc51f1e3  logs/real-image-evidence-after.log
731f24f755bf277bde2d0bd5e90643de93e7b9cc5873ec6f6b434517dfee0be2  logs/real-image-evidence-before.log
fd3e5b74ac32935148db8a3af37e75bfd9b6061ecadf1616bc617ab6ae0a8bb1  logs/regression-suites.log
1ce2cabe66240186005077ca3261e8a9744328da3c0b2e599c0b74887a5d85d1  logs/reproductions-after.log
5903fcdda3e185fbfe75f9ccacc262483efdc65927a870cac8129d9371d027c6  logs/reproductions-before.log
3aa2ea99744d1f893e30e13ec02f15de584acd7f9c98ef453bdad5a3ceb2f453  registry/tag-digests.txt
e5df8d6d05133ebd92d17b803f9ff9076c58749abe7d54796d207864dcaf21d1  replay/agent-scala.log.gz
0e99f83af28be04ee060fed819602bbaaee5d8e2bf25e98a74e4b619bc07c8f5  replay/claude-kotlin.log.gz
c8e24ad0af8eb6b23269e805b0abf860128bb40a864c00fd9a544fbef58a60d0  replay/codex-rust.log.gz
ed6008657a1e84fb8c803b8916981d6796a843496f72bbdd670725d373efdecd  replay/driver-agent.log
2786cd1bb8de6b42c4066e2f95801cdae2b3fe42abd81540ad8a8da9fb5f65e1  replay/driver-claude.log
11895075503808eedb422fb293af4da486272aa7d995f93d4daf1ffe61b35f30  replay/driver-codex.log
00dec6d8d20239a57b376eed24295da0716cbb9a6f2d8d71c42e8f7232057720  replay/remote-after.txt
7064b7a1bb708005fd2d46b813d910d5da01e4dd80f7a7b75036cf85c49859b0  replay/remote-before.txt
b3876a46d6f5d844da4c34c9ed9fae8bb17c4afc0382bf08b5f78bd76b696f87  replay/replay-summary-agent.json
a6b39679c33ae2b56717e8419716aeadda1eadebc8f33fc4b917c36c8ae2e9c0  replay/replay-summary-claude.json
ee474fdd9ed95381e6bc34c936e4fc9842824355abce27e582455efeaeead149  replay/replay-summary-codex.json
```

Verify with:

```bash
cd docs/case-studies/issue-2209/data && \
  grep -E '^[0-9a-f]{64}  ' ../MANIFEST.md | sha256sum --check
```
