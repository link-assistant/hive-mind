# Issue 2154 evidence manifest

Captured on 2026-08-13 UTC. Everything the analysis in [`README.md`](README.md) relies on is committed under `data/`, so the case study can be re-checked without network access and without trusting a summary.

## `data/logs/`

| File                           | Contents                                                                                                                                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hive-telegram-bot.log.txt.gz` | The Telegram bot log attached to the issue, gzip-compressed without modification: 13 467 lines, 1 039 805 bytes uncompressed, covering `2026-08-12T17:16:20.882Z` → `2026-08-13T05:46:07.110Z`. |

To read it without creating a second copy:

```bash
zcat docs/case-studies/issue-2154/data/logs/hive-telegram-bot.log.txt.gz | sed -n '1155,1250p'
```

The log mixes two streams — timestamped structured-logger lines (`<ISO> INFO  EVENT …`, `<ISO> DEBUG …`) and untimestamped console lines (`[VERBOSE] …`, `🧠 …`). Quotations in the case study preserve that difference exactly; where a timestamp is shown in parentheses it is the nearest preceding structured line, not part of the quoted text.

## `data/github/`

Snapshots of every GitHub conversation the issue asks to re-check. All list endpoints were fetched with `--paginate`, and all three pull-request comment channels (conversation comments, review comments, reviews) were captured separately, since `gh pr view --json comments` returns only the first.

- Issues: #2154 (this one), #2146, #2130, #2119, #2059, each with its comments.
- Pull requests: #2155 (this one), #2147 (→ #2146), #2131 (→ #2130), #2120 (→ #2119), #2108 (→ #2059), each with conversation comments, review comments and reviews.
- `upstream-formal-ai-issue-1001.json` — the upstream report filed from this investigation, [link-assistant/formal-ai#1001](https://github.com/link-assistant/formal-ai/issues/1001).

A `[]` file is not a capture failure: this project reviews in conversation comments, so the `-reviews.json` and `-review-comments.json` snapshots are genuinely empty. The substantive threads are `pr-2147-conversation-comments.json` (23 comments), `pr-2120-conversation-comments.json` (8), `pr-2131-conversation-comments.json` (3) and `pr-2108-conversation-comments.json` (3).

## `data/registry-probes/`

Credential-free probes of GHCR's anonymous token endpoint, produced by [`experiments/issue-2154-ghcr-visibility-probe.mjs`](../../../experiments/issue-2154-ghcr-visibility-probe.mjs) on 2026-08-13:

```bash
node experiments/issue-2154-ghcr-visibility-probe.mjs --write docs/case-studies/issue-2154/data/registry-probes
```

| File                                                 | Result                                                                     |
| ---------------------------------------------------- | -------------------------------------------------------------------------- |
| `token-link-assistant-formal-ai.json`                | HTTP 401 `UNAUTHORIZED` — the package exists and is **private**            |
| `token-link-assistant-agent.json`                    | HTTP 403 `DENIED` — absent or invisible to an anonymous caller             |
| `token-link-assistant-hive-mind-does-not-exist.json` | HTTP 403 `DENIED` — control: a package that certainly does not exist       |
| `token-public-homebrew-core-hello.json`              | HTTP 200 + token — control: a known-public package                         |
| `token-public-actions-actions-runner.json`           | HTTP 200 + token — control: a known-public package                         |
| `ghcr-visibility-probe.json`                         | All five probes in one file                                                |
| `dockerhub-hive-mind-dind.json`                      | Docker Hub metadata for `konard/hive-mind-dind`, the public fallback image |

Returned tokens are redacted in the written files. They are short-lived anonymous pull tokens for public images; the status code is the evidence.

## `data/upstream/`

`formal-ai-release.yml` — `.github/workflows/release.yml` from `link-assistant/formal-ai` (1 424 lines, workflow name "CI/CD Pipeline"), the pipeline that pushes `ghcr.io/link-assistant/formal-ai` with the workflow `GITHUB_TOKEN` and never sets or verifies the package visibility.

## SHA-256

```text
4d491af2fcf408baa41728c16f051fc1e11335ea631830117018f97bcfb32a65  github/issue-2059-comments.json
a410f74845bf2d438e815c4f1b98cead96f53ee9515ea4b7ae35b8fb9bc486d8  github/issue-2059.json
37517e5f3dc66819f61f5a7bb8ace1921282415f10551d2defa5c3eb0985b570  github/issue-2119-comments.json
9e48651a36cf072587fb997b2054ca2ef023c296e5807426166dd5db12bb78a0  github/issue-2119.json
37517e5f3dc66819f61f5a7bb8ace1921282415f10551d2defa5c3eb0985b570  github/issue-2130-comments.json
e030b9cae85dbb02aa795028aa9b22dedfa7e9dbd5e5d627f65fcb95b3925f10  github/issue-2130.json
ed3a826432e1092522bce479f0e1925e49bdd0eac1918eac561a3724dcd5f4e2  github/issue-2146-comments.json
2b8ec6a0c1107340f27b64ce7699059ac5d1dad9bd89f3f48a9eff81bcb7701b  github/issue-2146.json
37517e5f3dc66819f61f5a7bb8ace1921282415f10551d2defa5c3eb0985b570  github/issue-2154-comments.json
722e74ffa65fd105e4141d7aea366a82c89cd4a66b7c340a7852101059d2a7dd  github/issue-2154.json
ec9e197b6814335656741f6ddd0cde52c2cb9ecd55c9af1a783a32b91e2e0739  github/pr-2108-conversation-comments.json
37517e5f3dc66819f61f5a7bb8ace1921282415f10551d2defa5c3eb0985b570  github/pr-2108-review-comments.json
37517e5f3dc66819f61f5a7bb8ace1921282415f10551d2defa5c3eb0985b570  github/pr-2108-reviews.json
99fc1030d69508a6dd50184e8c54a8ee8a99ade74d82ea75401b187b599b21c2  github/pr-2108.json
3277d86444406c8e68b4c0ca748920df6b6766bf46486122bdfd4a19d36cfad9  github/pr-2120-conversation-comments.json
37517e5f3dc66819f61f5a7bb8ace1921282415f10551d2defa5c3eb0985b570  github/pr-2120-review-comments.json
37517e5f3dc66819f61f5a7bb8ace1921282415f10551d2defa5c3eb0985b570  github/pr-2120-reviews.json
10ad3850593944b4e3e2ba5b41db5fc5cccad2f49dad4ce8cbba3616a55d6b0e  github/pr-2120.json
88f11a7206cc0d9f069c810836238b57606a7f652b0ff5df77fa43f4477a1dc7  github/pr-2131-conversation-comments.json
37517e5f3dc66819f61f5a7bb8ace1921282415f10551d2defa5c3eb0985b570  github/pr-2131-review-comments.json
37517e5f3dc66819f61f5a7bb8ace1921282415f10551d2defa5c3eb0985b570  github/pr-2131-reviews.json
4ccf324008704a71d6dc14a1c09ee1ead7e1e82f6b93359b262619dc84be181e  github/pr-2131.json
b6ffd6fd61ce3b34b7e7ceff96093adea1664f775ba1ff4c3282d87827b76184  github/pr-2147-conversation-comments.json
37517e5f3dc66819f61f5a7bb8ace1921282415f10551d2defa5c3eb0985b570  github/pr-2147-review-comments.json
37517e5f3dc66819f61f5a7bb8ace1921282415f10551d2defa5c3eb0985b570  github/pr-2147-reviews.json
d47458f266eac46d1b62c6a6e70cbee0e98cdfd63eeb9ffee6c6089040a63445  github/pr-2147.json
37517e5f3dc66819f61f5a7bb8ace1921282415f10551d2defa5c3eb0985b570  github/pr-2155-conversation-comments.json
37517e5f3dc66819f61f5a7bb8ace1921282415f10551d2defa5c3eb0985b570  github/pr-2155-review-comments.json
37517e5f3dc66819f61f5a7bb8ace1921282415f10551d2defa5c3eb0985b570  github/pr-2155-reviews.json
d24f538f131775c2c297f181ad321fe07939a8b0bc0c93397e430b945612b8ac  github/pr-2155.json
13205ee8ee4ab45432aca81eb04d3692204b2bc7ee3dcf53b9feb2b666806aec  github/upstream-formal-ai-issue-1001.json
244e9775298d77b8a44267e39ca7c1ff9d762d847bb844082cf1b34d9cc05dfa  logs/hive-telegram-bot.log.txt.gz
48872faaa2ed350a1f4035c37e785b30d74ce2b48c3a0973fcb01c6858012932  registry-probes/dockerhub-hive-mind-dind.json
43840cb13b62d3f3e72eb891cacfe134b72c6d1447a193ad5d84fb706a161a57  registry-probes/ghcr-visibility-probe.json
2b8e440cd47f852e9723472bcf628e9e1e4b2db3388cba84aef8852d90f07135  registry-probes/token-link-assistant-agent.json
176d235872d1045e82b2fa90ff99f36a424e69d2fcd8fb718f8573cb4e66051c  registry-probes/token-link-assistant-formal-ai.json
e0cd57bc974990f0665c94fd1b1f9200eac2940ae66d9418730230a69bed9200  registry-probes/token-link-assistant-hive-mind-does-not-exist.json
5dd3f4369c54a871fcfd996dfe1bf8091fd53d6960bf4244eb5cd18774d3c405  registry-probes/token-public-actions-actions-runner.json
471a2cda38a46d85e252636c0b507266d21c44150f5219f36600f358af6d7e53  registry-probes/token-public-homebrew-core-hello.json
b125a2f0a4f6b9540ec29e29a87c6653d61f9c0203323e0bb86ad96a5ceef447  upstream/formal-ai-release.yml
```

Verify with:

```bash
cd docs/case-studies/issue-2154/data && \
  grep -E '^[0-9a-f]{64}  ' ../MANIFEST.md | sha256sum --check
```
