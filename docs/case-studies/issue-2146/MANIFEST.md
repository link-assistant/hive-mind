# Issue 2146 evidence manifest

Captured on 2026-08-08 UTC. All 15 sanitized logs linked from the three Aug 8 test pull requests, plus the complete solution-draft log attached to PR #2147, are retained under `data/tool-logs/`. The 16 logs are gzip-compressed without modifying their content. The corresponding authenticated Gist API responses are retained as `data/github/gist-*.json.gz`.

To inspect a log without creating a second copy:

```bash
zcat docs/case-studies/issue-2146/data/tool-logs/agent-initial-XOq3KX.log.gz | sed -n '440,500p'
```

## Tool log to Gist map

| Tool run                 | Local archive                    | Gist                                                                           |
| ------------------------ | -------------------------------- | ------------------------------------------------------------------------------ |
| Agent initial/final      | `agent-initial-XOq3KX.log.gz`    | [`d0553b8e…`](https://gist.github.com/konard/d0553b8e1b5ed88f1b8241f539ba4907) |
| Claude initial           | `claude-initial-PhU3X2.log.gz`   | [`3df8fd31…`](https://gist.github.com/konard/3df8fd313b592842d9dcf34bd265d7ca) |
| Claude restart 1         | `claude-restart-1.log.gz`        | [`2f8e88bd…`](https://gist.github.com/konard/2f8e88bd91b64c4d24b57a9e5addd581) |
| Claude restart 2         | `claude-restart-2.log.gz`        | [`1f4b390d…`](https://gist.github.com/konard/1f4b390d14ec5ee970de27ea80f03601) |
| Claude restart 3         | `claude-restart-3.log.gz`        | [`9bd1207a…`](https://gist.github.com/konard/9bd1207a2aeb6b8d1b19b2db7b25f0e9) |
| Claude restart 4         | `claude-restart-4.log.gz`        | [`094c0d30…`](https://gist.github.com/konard/094c0d308cc190137316c86f742d9e1a) |
| Claude restart 5         | `claude-restart-5.log.gz`        | [`75a3b842…`](https://gist.github.com/konard/75a3b84286ea78707e7a98291fd04331) |
| Claude final monitor log | `claude-final.log.gz`            | [`c36ed410…`](https://gist.github.com/konard/c36ed4109de1b12c32e40cb1a05e16fc) |
| Codex initial            | `codex-initial-8GWnaH.log.gz`    | [`111bc2c2…`](https://gist.github.com/konard/111bc2c200954b7f524e5f314e49f43e) |
| Codex restart 1          | `codex-restart-1.log.gz`         | [`800a9ae3…`](https://gist.github.com/konard/800a9ae360bd5dce18063ccf923098ee) |
| Codex restart 2          | `codex-restart-2.log.gz`         | [`143e3eb1…`](https://gist.github.com/konard/143e3eb13fb70cc71773c332572e64bd) |
| Codex restart 3          | `codex-restart-3.log.gz`         | [`89e32c90…`](https://gist.github.com/konard/89e32c9053c5963794bdeb5353492bdf) |
| Codex restart 4          | `codex-restart-4.log.gz`         | [`ee00bca9…`](https://gist.github.com/konard/ee00bca93008aa6cbc548848b8edb09e) |
| Codex restart 5          | `codex-restart-5.log.gz`         | [`85a67fa2…`](https://gist.github.com/konard/85a67fa222878c84e2965c6fae3576e8) |
| Codex final monitor log  | `codex-final.log.gz`             | [`d437f08d…`](https://gist.github.com/konard/d437f08d56495084d25bffd6153ba948) |
| Solution draft           | `solution-draft-d575f2a3.log.gz` | [`d575f2a3…`](https://gist.github.com/konard/d575f2a37a45a9f9a88ae2f8eed283b5) |

## Archive SHA-256

These hashes cover the committed gzip archives.

```text
a130c047091e1f609024ca2a23e1a39163640b0d26e4b9a96e576a74f45cba83  agent-initial-XOq3KX.log.gz
5f0ef735fd2e5f5c296fcedb329814f7c56696bb3870a6996ec9ea832512add4  claude-final.log.gz
c3fa08053abcd6a2a94dc8acabc5341710d699cf082b6eac38147e79158c8cd4  claude-initial-PhU3X2.log.gz
d1bc230f282654258f7a7ca5c8eed99e070e21747c0455ad20d54c25d90623db  claude-restart-1.log.gz
30736c6b04f018565eb9ea5e9068d1cbc0780db2b18ad15b804af593279d094b  claude-restart-2.log.gz
4443f1f272094f428fb88a8fba15c0ebeb18f24105d2712257fde7e701d2c1fa  claude-restart-3.log.gz
c4788cd515b7c3ab30a602af407a1f7706b71dc3c2dfc444c1d995e7a063e88f  claude-restart-4.log.gz
8df9ee5ced0ef8596d4faa4c0eace1e0f04c289734c6d3426b0066236f66684f  claude-restart-5.log.gz
c4d298318e2429bf968aa91a6a153431baa643a9f05dff3a14ed9820d7646d96  codex-final.log.gz
f1e1c942121806fd8d85a6ed29801501f5b6c68696713db8d055ae9e4ec0a029  codex-initial-8GWnaH.log.gz
63cd70ba70ef35fac7a6165b4b4d3527359542c025a17faccfa667077b18c923  codex-restart-1.log.gz
9e36b012dd3aa318e161c7e835ba207abfbed8080cc4814f47718d5bf87f324b  codex-restart-2.log.gz
f665a0ce2b50c6d916d953b5c68d8049c3fc9c2049ed65584729934f892c13ce  codex-restart-3.log.gz
5d40d1fa43e138bd1e387d8dad1f49240b965285e325e084be5390879fe580bd  codex-restart-4.log.gz
a9b295acd949385bc5311f9b4361d60a7251e7d9ff315baa8d42c76ed58a3f23  codex-restart-5.log.gz
cb0ac8d1570efc88ae14b524aa4b894723c3ae908d0f1f40821b4ac888ec15f3  solution-draft-d575f2a3.log.gz
```

## Other data

`data/github/` contains the issue, pull request, conversation-comment, review-comment, and review snapshots used in the analysis. All list endpoints were fetched with pagination. It includes:

- Hive Mind issues #2119, #2130, and #2146, related PRs #2120, #2131, #2139, #2142, #2143, #2145, and prepared PR #2147;
- all three GitHub comment/review channels for PR #2147 and each reproduction PR;
- Agent issue #208 and the prior broad issue search;
- Formal AI issue #848, issues #902–#909, blocking persisted-memory upgrade issue #982, and merged PR #927;
- start-command Docker-network issue #154;
- the post-implementation PR feedback and the issue/PR blocker-status comments;
- authenticated Gist API snapshots for every log above.

`data/upstream-issues/` holds the verbatim text of everything this incident published, so a reader can compare what was requested with what shipped without an authenticated API call:

| File                                      | Published as                                                                                                      |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `formal-ai-unattended-memory-upgrades.md` | [formal-ai#982](https://github.com/link-assistant/formal-ai/issues/982) — delivered in v0.336.0                   |
| `start-command-docker-network.md`         | [start#154](https://github.com/link-foundation/start/issues/154) — delivered in js-0.31.0 / rust-0.18.0           |
| `agent-model-resolution-event.md`         | [agent#295](https://github.com/link-assistant/agent/issues/295) — open follow-up, not a blocker                   |
| `start-multiple-networks.md`              | [start#156](https://github.com/link-foundation/start/issues/156) — delivered in js-0.32.0/js-0.32.1               |
| `formal-ai-openssl-build-dependency.md`   | [formal-ai#988](https://github.com/link-assistant/formal-ai/issues/988) — fixed upstream in v0.339.0              |
| `web-capture-default-tls.md`              | [web-capture#151](https://github.com/link-assistant/web-capture/issues/151) — root cause of #988, open            |
| `browser-commander-default-tls.md`        | [browser-commander#77](https://github.com/link-foundation/browser-commander/issues/77) — root cause of #988, open |
| `start-network-test-rate-limit.md`        | [start#160](https://github.com/link-foundation/start/issues/160) — fixed same day; js-0.32.x released             |
| `hive-mind-blocker-status.md`             | the blocker-status comment posted to issue #2146 and PR #2147 while the prerequisites were open                   |
| `pr-2147-body.md`                         | the PR #2147 description as submitted for review                                                                  |

`data/upstream-snapshots.json` records release and source-head facts that were queried separately from issue/PR data.
