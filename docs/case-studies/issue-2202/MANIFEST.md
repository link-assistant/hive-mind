# Manifest — issue #2202 case study data

Every file under [`data/`](data) is a captured artifact, not a summary. This
manifest records where each one came from, so a reader can re-collect it and
compare, and pins its SHA-256, so a reader can tell whether the committed copy
is the one the analysis in [`README.md`](README.md) was written against.

Collected on **2026-09-04**. Hive Mind sources quoted at commit `e062446e`
(branch `issue-2202-70688fb26570`).

## How each artifact was collected

| File                                                      | Method                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data/github/issue-2202.json`                             | `gh api repos/link-assistant/hive-mind/issues/2202`                                                                                                                                                                                                                                                                                 |
| `data/github/issue-2202-comments.json`                    | `gh api repos/link-assistant/hive-mind/issues/2202/comments --paginate` — empty; the issue body is the whole specification                                                                                                                                                                                                          |
| `data/github/pr-2203.json`                                | `gh api repos/link-assistant/hive-mind/pulls/2203`                                                                                                                                                                                                                                                                                  |
| `data/github/pr-2203-review-comments.json`                | `gh api repos/link-assistant/hive-mind/pulls/2203/comments --paginate` — empty                                                                                                                                                                                                                                                      |
| `data/github/pr-2203-conversation-comments.json`          | `gh api repos/link-assistant/hive-mind/issues/2203/comments --paginate` — empty                                                                                                                                                                                                                                                     |
| `data/hive-mind/builtin-model-catalogue.json`             | `node experiments/dump-builtin-model-catalogue.mjs` — imports `src/models/index.mjs` and dumps every tool's default, aliases, resolved ids, the 1M-context set and the fallback chains                                                                                                                                              |
| `data/hive-mind/router-wiring.md`                         | `grep -n` over `src/router-isolation.lib.mjs` and `src/router-sidecar.lib.mjs`, quoting the pinned image, every base URL, the credential mounts and the `/v1/models` references with line numbers                                                                                                                                   |
| `data/upstream/router-releases.json`                      | `gh api repos/link-assistant/router/releases --paginate --slurp` then flattened — 143 releases                                                                                                                                                                                                                                      |
| `data/upstream/router-releases-since-0.119.0.md`          | the 26 releases published after the pinned `0.119.0`, with full bodies, rendered from the JSON above                                                                                                                                                                                                                                |
| `data/upstream/router-route-contract.rs`                  | the router's own route table, the authoritative post-1.0 path for every service                                                                                                                                                                                                                                                     |
| `data/upstream/router-with-command.md`                    | the router's `with` client guide: per-client dialects and base URLs, `--pick-model`, server/token resolution order, the Claude Code 2.1.255 floor                                                                                                                                                                                   |
| `data/measurements/codex-debug-models.json`               | `codex debug models` (codex-cli 0.150.1) on this host, reduced to `slug` / `display_name` / `visibility` / `supported_in_api`. Token-free: the CLI answers from its own compiled catalogue                                                                                                                                          |
| `data/measurements/models-dev-relevant-entries.json`      | `https://models.dev/api.json` (213 providers), filtered to the anthropic/openai families this issue touches, preserving the full per-model metadata shape                                                                                                                                                                           |
| `data/measurements/catalogue-gap-analysis.json`           | set differences computed from the three files above: bundled ↔ live Codex ↔ models.dev, in both directions                                                                                                                                                                                                                          |
| `data/measurements/aggregator-coverage-2026-09-04.md`     | `claude-fable-5-1` / `gpt-6-astra` lookups against models.dev, OpenRouter `GET /api/v1/models` (unauthenticated) and LiteLLM `model_prices_and_context_window.json`                                                                                                                                                                 |
| `data/measurements/cli-versions-2026-09-04.md`            | installed `--version` for six agentic CLIs vs `npm view <pkg> version`                                                                                                                                                                                                                                                              |
| `data/measurements/router-route-comparison-2026-09-04.md` | `experiments/issue-2202/compare-router-routes.sh` — starts `ghcr.io/link-assistant/router` `0.119.0` and `1.2.0` with Hive Mind's own `serve` arguments and probes 17 paths in each, plus `experiments/issue-2202/probe-router-1.2.0.sh` (`--help` surfaces) and `probe-router-github-routes.sh` (the GitHub-credential dependency) |
| `data/research/online-research.md`                        | vendor pages fetched on 2026-09-04 — `platform.claude.com` model overview and Models API reference, `developers.openai.com` model index and per-model pages — with every specification quoted and cited                                                                                                                             |

Aggregator and vendor endpoints reflect their state on 2026-09-04; re-running
the collection later will legitimately differ, which is the point the case study
makes.

## Checksums

Regenerate with:

```bash
cd docs/case-studies/issue-2202 && find data -type f | sort | xargs sha256sum
```

| File                                                      |  Bytes | SHA-256                                                            |
| --------------------------------------------------------- | -----: | ------------------------------------------------------------------ |
| `data/github/issue-2202-comments.json`                    |      3 | `37517e5f3dc66819f61f5a7bb8ace1921282415f10551d2defa5c3eb0985b570` |
| `data/github/issue-2202.json`                             |   3275 | `dce45b3e25bcfad75c741d68e485c761a2ac390922e4d01c810304658d19170a` |
| `data/github/pr-2203-conversation-comments.json`          |      3 | `37517e5f3dc66819f61f5a7bb8ace1921282415f10551d2defa5c3eb0985b570` |
| `data/github/pr-2203-review-comments.json`                |      3 | `37517e5f3dc66819f61f5a7bb8ace1921282415f10551d2defa5c3eb0985b570` |
| `data/github/pr-2203.json`                                |    709 | `f4a52c6ba022984b30ad3514864c83ef255093ed759ab336cbbd80cadadf8222` |
| `data/hive-mind/builtin-model-catalogue.json`             |  10702 | `db1b40746352d1b47363c82728c081871bfeba529e358b8064b51e5005c976cd` |
| `data/hive-mind/router-wiring.md`                         |   3379 | `31023df56ffdb1f36bc63f57b4a558d0e82ac6f2befecd2dcaf56759c6ebffcd` |
| `data/measurements/aggregator-coverage-2026-09-04.md`     |   3185 | `704a9702e2063aeaa1dc34d17c5f811448767eea51bec39b8c839ebf8529ca97` |
| `data/measurements/catalogue-gap-analysis.json`           |   2001 | `f03a28aab9d2e9e3213d86e775c7e94a86bc64a6c6c6e713503c419067655d0f` |
| `data/measurements/cli-versions-2026-09-04.md`            |   1342 | `7fdc8da8cd64ce26a0fe53c957f2c7acdb8b8d65049186bd54b47bb35c18c013` |
| `data/measurements/codex-debug-models.json`               |   1903 | `30e416b48cb1a09ed837d1acfcdfce426bd2837584857943e78b17dc9cd39671` |
| `data/measurements/models-dev-relevant-entries.json`      |  21619 | `9d342183ff42c5766ae45314e2cb80f5d8aa1b80c2649b36140cac80280e133e` |
| `data/measurements/router-route-comparison-2026-09-04.md` |   5901 | `804a7bdcda6c0015356cddefdb03191b42bba53395f02df761ea3e6d6ba5670a` |
| `data/research/online-research.md`                        |  10590 | `a99c12b7c95a1b7369f9abeeda9888882a9bf85bff0c12729dce5bd809b9058f` |
| `data/upstream/router-releases-since-0.119.0.md`          | 182405 | `9867b114f6f51a1eae5eb28d0c2472be60aca37bfce7ca3392985fdd1171091c` |
| `data/upstream/router-releases.json`                      |  21078 | `2250324851601463b9648009bedb4dcee0c6b0a93417dffad72bd12852864513` |
| `data/upstream/router-route-contract.rs`                  |  15986 | `02c69df1ed41ee3a0d867fa10ef9e78a3f88f2e7cdfee3cc6a5a89efcfae1595` |
| `data/upstream/router-with-command.md`                    |  11086 | `d5d3669ccc9df592ef155a72c0be8656cd2965b32e8d00ea24450e3030c26688` |
