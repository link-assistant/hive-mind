# Evidence manifest

## Inventory

| Path                                                                                                                                                |              Count | Contents                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | -----------------: | ----------------------------------------------------------------------------------------------------- |
| [`data/github/`](./data/github/)                                                                                                                    |           78 files | Issue details/comments/events; PR details/conversation comments/inline review comments/reviews        |
| [`data/tool-logs/`](./data/tool-logs/)                                                                                                              | 21 `.log.gz` files | Every post-PR-#2155 attached solution, restart, and terminal log snapshot from the three external PRs |
| [`data/tool-logs/index.json`](./data/tool-logs/index.json)                                                                                          |            1 index | Source comment/Gist URLs, timestamps, Gist revisions, raw and gzip sizes, raw and gzip SHA-256 hashes |
| [`experiments/issue-2158-formal-ai-prompt-boundary-results.json`](../../../experiments/issue-2158-formal-ai-prompt-boundary-results.json)           |             2 runs | Sanitized real Codex → Formal AI before/after results                                                 |
| [`experiments/issue-2158-formal-ai-prompt-boundary-main-results.json`](../../../experiments/issue-2158-formal-ai-prompt-boundary-main-results.json) |             2 runs | The same real-client comparison against current Formal AI main                                        |

The 21 logs are the complete set whose PR comments were created after `2026-08-13T07:51:00Z`, the merge time of Hive Mind PR #2155. Earlier runs remain in the #2119, #2130, #2146, and #2154 case studies and are not duplicated here.

## Acquisition

Run from the repository root with an authenticated GitHub CLI:

```bash
node experiments/issue-2158-fetch-evidence.mjs
```

The script:

1. fetches issue and PR metadata with `gh issue view` / `gh pr view`;
2. fetches paginated issue comments and events;
3. fetches all three PR feedback APIs separately;
4. finds post-cutoff attached log Gists in external PR comments;
5. downloads private or public Gist content through `gh gist view --raw`;
6. redacts account identifiers, credentials, and volatile workspace/configuration paths in the committed log copy while retaining the source byte count and SHA-256;
7. writes deterministic gzip (`mtime = 0`);
8. records source and artifact checksums in `index.json`.

The evidence is a snapshot, so re-running later may add new comments or replace metadata files as GitHub state changes. The index timestamp documents when this snapshot was generated.

## Integrity verification

To verify the stored compressed artifacts:

```bash
sha256sum docs/case-studies/issue-2158/data/tool-logs/*/*.log.gz
```

Compare each digest with `gzipSha256` in `data/tool-logs/index.json`. To verify raw content, decompress to stdout and hash it:

```bash
gzip -cd PATH_TO_LOG.gz | sha256sum
```

Compare that digest with `rawSha256` for the same entry. `sourceRawSha256` is the digest of the authenticated Gist before this repository's sanitization pass.

## Reading large logs

The final snapshots have thousands of lines after decompression. Read them in chunks of at most 1,500 lines. For example:

```bash
gzip -cd PATH_TO_LOG.gz | sed -n '1,1500p'
gzip -cd PATH_TO_LOG.gz | sed -n '1501,3000p'
```

The terminal snapshot is the seventh entry for each repository in `index.json`. Earlier snapshots are still useful for reconstructing what each comment exposed, but their content is a prefix of the later cumulative log.

## Redaction and images

The source attachments are already labelled sanitized. The fetcher additionally redacts account identifiers, credential-shaped strings, solver workspace paths, and generated Formal AI client configuration paths in the checked-in copy. `sourceRawSha256` and the source URL let an authorized investigator compare with the original without committing those values here.

No screenshot or image appeared in any issue, description, comment, review, or discussion in scope. There are therefore no image files in this manifest.
