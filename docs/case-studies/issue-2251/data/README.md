# Evidence inventory

Collected from GitHub on 2026-09-14 UTC. API responses and attachments are preserved verbatim. Authentication was used for GitHub user-attachment downloads; no token is stored here.

| File | Bytes | SHA-256 | Provenance |
| --- | ---: | --- | --- |
| `issue-2251.json` | 4,487 | `4d27763511457ee788794d111202b8a66f00b559e1338e73bd1dcd59c759282a` | REST representation of `link-assistant/hive-mind#2251`. |
| `issue-2251-comments.json` | 2 | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | Complete paginated comment response; empty array. |
| `issue-2251-timeline.json` | 13,986 | `a3d051faf329a5a239ff94fe3c78774c86e23bce43fb86a5b9c009c31ae72525` | Complete paginated issue timeline. |
| `telegram-command-screenshot.png` | 124,110 | `23db890211f22c1facd164a4ddebdb16ead9b9f652fbb14b8c8b88d79533024f` | Authenticated download of the issue's `github.com/user-attachments` image. |
| `source-issue-577.json` | 13,698 | `23f3ed3f48e6e860c43f8eac15e4fc118e4294ed4cb9f9cdb4adf48201507ed9` | REST representation of `G-Ivan-A/hybrid-Intelligence-lab#577`. |
| `source-issue-577-comments.json` | 2 | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | Complete paginated comment response; empty array. |
| `source-issue-577-timeline.json` | 2 | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | Complete paginated timeline response; empty array. |
| `source-dialogue-140926.txt` | 101,206 | `5cecc56d3ac31e1497b8b90fdf35e1b4e34d3e02f8f186a5f8faa98450da80f2` | Full attachment linked from source issue #577; 544 lines, valid UTF-8. |

## Integrity checks

- `telegram-command-screenshot.png` begins `89 50 4E 47 0D 0A 1A 0A`, the PNG signature. It is not an HTML/text authentication response.
- The issue JSON contains U+00A0 NO-BREAK SPACE immediately after `/claude`; its UTF-8 byte sequence is `C2 A0`.
- Empty arrays are intentionally retained to establish that neither issue had discussion evidence at collection time.
- The screenshot displays `12:06 AM` but no date or time zone, so that presentation time is not converted to UTC in the case-study timeline.

## Retrieval endpoints

- `GET /repos/link-assistant/hive-mind/issues/2251`
- `GET /repos/link-assistant/hive-mind/issues/2251/comments` with pagination
- `GET /repos/link-assistant/hive-mind/issues/2251/timeline` with pagination and the timeline media type
- `GET /repos/G-Ivan-A/hybrid-Intelligence-lab/issues/577`
- corresponding paginated comments and timeline endpoints for #577
- authenticated redirects from the two `github.com/user-attachments` URLs embedded in the issues

The evidence directory contains no production Telegram update or Hive Mind service log because none was attached to either issue or found in repository/GitHub searches.
