# Raw evidence for issue #2148

Captured with authenticated GitHub CLI access on 2026-08-11 UTC. Files are intentionally preserved
in their original JSON or sanitized-log form. Verify them with `sha256sum -c SHA256SUMS` from this
directory.

## Layout

### `github/`

- `hive-mind-issue-2148.json` and `hive-mind-issue-2148-comments.json`: issue report and all issue
  comments.
- `hive-mind-pr-2149-initial.json`: prepared fix PR before implementation.
- `hive-mind-pr-2149-*-initial.json`: all three PR feedback channels before implementation.
- `formal-ai-pr-997.json`: affected pull request.
- `formal-ai-pr-997-conversation-comments.json`: complete PR conversation, including the five
  lifecycle comments.
- `formal-ai-pr-997-review-comments.json` and `formal-ai-pr-997-reviews.json`: empty inline-review
  channels, retained to prove the missing events did not appear elsewhere.
- `formal-ai-pr-997-timeline.json`: all PR timeline events.
- `gist-*.json`: API metadata for the three linked Gists, including immutable raw URLs and embedded
  file metadata.

### `logs/`

- `full-start-command.log.txt`: complete 196,447-line outer solve trace linked by issue #2148.
- `initial-solution-session.log.txt`: 137,808-line log attached to the initial Solution Draft Log
  comment.
- `usage-limit-session.log.txt`: 139,590-line snapshot attached when the usage limit was reached.

The three logs are sanitized artifacts published by Hive Mind. No unsanitized local session file
was copied into this case study.

## Capture commands

Representative commands (with `--paginate` for every collection endpoint):

```bash
gh issue view 2148 --repo link-assistant/hive-mind --json number,title,body,state,url,author,createdAt,updatedAt
gh api repos/link-assistant/hive-mind/issues/2148/comments --paginate
gh pr view 2149 --repo link-assistant/hive-mind --json number,title,body,state,isDraft,url,headRefName,baseRefName,commits,statusCheckRollup
gh api repos/link-assistant/hive-mind/pulls/2149/comments --paginate
gh api repos/link-assistant/hive-mind/issues/2149/comments --paginate
gh api repos/link-assistant/hive-mind/pulls/2149/reviews --paginate

gh pr view 997 --repo link-assistant/formal-ai --json number,title,body,state,isDraft,url,headRefName,baseRefName,commits,statusCheckRollup
gh api repos/link-assistant/formal-ai/issues/997/comments --paginate
gh api repos/link-assistant/formal-ai/pulls/997/comments --paginate
gh api repos/link-assistant/formal-ai/pulls/997/reviews --paginate
gh api repos/link-assistant/formal-ai/issues/997/timeline --paginate

gh api gists/<gist-id>
gh gist view <gist-id> --raw
```

The Gist raw downloads used `gh gist view`, not unauthenticated direct HTTP, so private or secret
Gist access would be handled by the same authenticated session.
