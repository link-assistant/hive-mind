# Upstream report — Claude Code transcript repeats `usage` per content block

Related upstream issue: [anthropics/claude-code#6805](https://github.com/anthropics/claude-code/issues/6805)
— "[BUG] Token Usage Statistics Duplicated in stream-json Mode Causing Massive Cost Inflation"
(opened 2025-08-29, closed 2026-02-14 as inactive/`NOT_PLANNED`, **locked** 2026-02-21).

Because #6805 is locked, its own closing message applies: "please file a new issue and reference this
one". The text filed upstream is reproduced verbatim below.

Local relevance: this is the cause of the ten `JSONL deduplication: skipped N duplicate entries`
lines in run `4c1dedd8` (P8 in [../TECHNICAL_ANALYSIS.md](../TECHNICAL_ANALYSIS.md)). Hive Mind
already deduplicates by `message.id`, so its own token and cost totals were never inflated; only the
severity of the message was wrong, and that is fixed in PR #2162.

---

## Filed text

**Title:** [BUG] Session transcript repeats the full `usage` object for every content block of one API
response (token over-counting; follow-up to #6805)

### Summary

One assistant API response is written to the session transcript
(`~/.claude/projects/<project>/<sessionId>.jsonl`) as **several** `assistant` entries — one per
content block (`thinking`, `text`, each `tool_use`) — and every one of those entries repeats the
**complete, byte-identical `usage` object** of the single underlying response. Any consumer that sums
`message.usage` over the transcript (or over `stream-json` output) therefore over-counts tokens and
any cost derived from them.

This is the same defect as #6805, which was closed as inactive and is now locked, so this is a fresh
report with first-hand measurements on a current version.

### Environment

- Claude Code CLI **2.1.233** (also observed on **2.1.228**)
- Node v24.3.0, Linux (container)
- `--output-format stream-json --verbose`, non-interactive automation

### Measurement (single real session)

| Field                         | Naive sum  | Deduplicated by `message.id` | Over-count |
| ----------------------------- | ---------- | ---------------------------- | ---------- |
| `input_tokens`                | 2 252      | 1 856                        | 1.21x      |
| `cache_creation_input_tokens` | 1 075 420  | 560 751                      | 1.92x      |
| `cache_read_input_tokens`     | 39 563 813 | 24 904 077                   | 1.59x      |
| `output_tokens`               | 292 325    | 157 507                      | 1.86x      |

521 usage records for 323 distinct `message.id`s → 198 duplicated records; 188 message ids had
duplicates and in **all 188** the duplicated `usage` objects were byte-identical. Up to 3 entries
shared one `message.id`.

The duplicated entries differ only in their content block, e.g. for
`msg_011Ce7zpWBJMrj6gSiJAuY7o`:

```
assistant uuid=70abebf3 content=[text]      usage={input_tokens:2, cache_creation_input_tokens:24896, output_tokens:244, …}
assistant uuid=2c277f40 content=[tool_use]  usage={input_tokens:2, cache_creation_input_tokens:24896, output_tokens:244, …}
assistant uuid=99c159e5 content=[tool_use]  usage={input_tokens:2, cache_creation_input_tokens:24896, output_tokens:244, …}
```

Observed block shapes behind duplicates: `text | tool_use | tool_use`, `thinking | tool_use`,
`thinking | tool_use | tool_use`, `thinking | text | tool_use`, `tool_use | tool_use` — i.e. it
happens whenever a response contains more than one content block, which for tool-using sessions is
most responses. Over a larger sample (10 automated sessions in one 4-hour run) every session was
affected, with 13, 19, 38, 39, 50, 54, 58, 63, 77 and 86 duplicated records respectively.

### Reproduction

```bash
# 1. Run any session that uses tools (so responses have several content blocks):
claude -p "list the files in this repo and summarise each in one line" \
  --output-format stream-json --verbose

# 2. Analyse that session's transcript:
node analyze.mjs ~/.claude/projects/<project>/<sessionId>.jsonl
```

`analyze.mjs`:

```js
import { readFileSync } from 'node:fs';
const FIELDS = ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'output_tokens'];
const seen = new Set();
let records = 0;
const naive = {},
  deduped = {};
for (const f of FIELDS) ((naive[f] = 0), (deduped[f] = 0));
for (const line of readFileSync(process.argv[2], 'utf8').split('\n')) {
  if (!line.trim()) continue;
  let e;
  try {
    e = JSON.parse(line);
  } catch {
    continue;
  }
  if (!e.message?.usage || !e.message?.id) continue;
  records++;
  for (const f of FIELDS) naive[f] += e.message.usage[f] || 0;
  if (seen.has(e.message.id)) continue;
  seen.add(e.message.id);
  for (const f of FIELDS) deduped[f] += e.message.usage[f] || 0;
}
console.log({ records, distinct: seen.size, duplicated: records - seen.size, naive, deduped });
```

Any output with `duplicated > 0` reproduces the bug. A fuller version of this script (which also
prints the content-block shapes and the inflation factor per field) is at
[`experiments/issue-2160-claude-jsonl-usage-duplication.mjs`](https://github.com/link-assistant/hive-mind/blob/main/experiments/issue-2160-claude-jsonl-usage-duplication.mjs).

### Workaround

Deduplicate by `message.id`, treating the first occurrence as authoritative:

```js
const seen = new Set();
for (const entry of entries) {
  if (!entry.message?.usage || !entry.message?.model) continue;
  const id = entry.message.id;
  if (id) {
    if (seen.has(id)) continue; // same API response, another content block
    seen.add(id);
  }
  accumulate(entry.message.usage);
}
```

Reference implementation:
[`src/claude.lib.mjs`](https://github.com/link-assistant/hive-mind/blob/main/src/claude.lib.mjs)
(`calculateSessionTokens`). Note the workaround requires `message.id` to be present; entries without
it cannot be deduplicated reliably.

### Suggested fix

1. **Preferred — write `usage` exactly once per API response.** When splitting a response into
   per-block entries, emit the `usage` object only on the first (or only the last) entry and omit it
   from the others. Naive summation then becomes correct by construction, and existing consumers need
   no change.
2. **Alternative — mark replays.** Add an explicit marker (e.g. `usageAlreadyCounted: true`) on every
   entry whose `usage` duplicates an earlier one, so consumers can filter without inferring
   duplication from `message.id`.
3. **Either way, document it.** If the current shape is intentional, state in the SDK/stream-json
   docs that `usage` must be aggregated per distinct `message.id` — that single sentence would have
   prevented the cost-inflation reports in #6805 and its duplicates.

Happy to provide anonymised transcripts or the per-session breakdown.

---

## Publication status

Filed upstream as **[anthropics/claude-code#87303](https://github.com/anthropics/claude-code/issues/87303)**
on 2026-08-17, referencing the locked #6805.
