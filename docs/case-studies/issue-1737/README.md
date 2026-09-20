# Issue 1737 Case Study: Budget Stats Restored-Context Input

## Timeline

- 2026-05-01 09:00 UTC: A solution draft log was posted to `link-foundation/meta-sovereign#2` with budget stats showing `peak request:` lines for Claude Opus 4.7.
- 2026-05-01 09:23 UTC: `link-assistant/hive-mind#1737` reported that those lines no longer answered the intended question: how much input context is restored at the largest point in each sub-session.
- 2026-05-01 10:27 UTC: Draft PR `#1738` was prepared on branch `issue-1737-9967b47ad3ac`.

## Data Collected

- `data/issue-1737.json`: full issue payload.
- `data/issue-1737-comments.json`: issue comments, empty at collection time.
- `data/pr-1738.json`: initial PR metadata.
- `data/external-comment-4358605158.json`: external GitHub comment that contains the broken rendered output.
- `data/solution-draft-log-pr-1777626019826.txt`: full referenced solution draft log downloaded from the linked Gist.

## Requirements

- Rename multi-section headings from `session segments` to `sub-sessions`.
- Remove the user-facing `peak request:` label.
- For each sub-session, show the maximum restored-context input pressure, not only the maximum uncached request input.
- Keep model totals cumulative, with new input, cache writes, and cache reads split into separate buckets.
- For result-event-only sub-agent usage such as Haiku, show a simple total input line with the model context limit when the model appears to represent one parent tool call; keep the detailed cache split on the Total line.
- Keep output token display as output tokens over the model max-output limit.
- Preserve support for non-Claude token renderers by keeping the shared budget-stats shape generic.

## External References

- Anthropic prompt caching docs define total input tokens as `cache_read_input_tokens + cache_creation_input_tokens + input_tokens`, and define `cache_read_input_tokens` as tokens retrieved from cache for the request: <https://platform.claude.com/docs/en/build-with-claude/prompt-caching>
- OpenAI prompt caching docs expose cached prompt tokens through `usage.prompt_tokens_details.cached_tokens`, which supports the same general renderer design of separating cached input accounting from ordinary input accounting: <https://developers.openai.com/api/docs/guides/prompt-caching>

## Root Causes

1. `calculateSessionTokens()` intentionally changed `peakContextUsage` to `input_tokens + cache_creation_input_tokens` for issue 1710. That made the display smaller and reconcilable with non-cached cumulative input, but it no longer represented the restored prompt/context footprint.
2. The renderer labelled the line `peak request:`, which made the output sound like a largest API request measurement instead of the requested context-fit measurement.
3. Multi-sub-session headings still used the older term `session segments`.
4. Result-event-only sub-agent rows reused the detailed cumulative phrase on the detail line; this was harder to scan than a simple `input / context` line, while the Total line already carried the detailed cache split.

## Solution Plan

- Restore `peakContextUsage` semantics to total request input: `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`.
- Keep cumulative model totals unchanged, including separate cache write/read fields.
- Remove `peak request:` from both CLI and PR-comment renderers.
- Rename multi-sub-session headings to `sub-sessions`.
- Add focused regression coverage for:
  - Opus multi-sub-session formatting.
  - Haiku result-event-only single-call formatting.
  - JSONL parsing that includes cache reads in `peakContextUsage`.
- Update older issue 1710 and 1600 assertions so the test suite encodes the new issue 1737 semantics.

No upstream project issue was filed because the defect is in hive-mind's local parsing and rendering logic, not in the referenced external repository or provider APIs.
