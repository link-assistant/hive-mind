# Organizing open issues

The Telegram `/organize` command classifies all currently open issues in one
GitHub repository. It assigns an existing organization Issue Type and adjusts
existing repository labels. The command is metadata maintenance, not an
issue-solving workflow.

## Usage and defaults

```text
/organize https://github.com/owner/repository
/organize https://github.com/owner/repository --dry-run
/organize https://github.com/owner/repository --tool codex --model gpt-5.6-sol --think high
Treat examples and migration guides as documentation work.
```

You can also reply with `/organize` to a message containing the repository URL.
Only one repository is accepted. The scope is always all open issues; pull
requests and closed issues are excluded. Running the command is an explicit
request to apply changes. Use `--dry-run` to generate the same complete plan and
diff without writing to GitHub.

The bot setting `TELEGRAM_ORGANIZE=false` disables the command. It is enabled by
default.

## Permissions and safety

The command is restricted to authorized group chats and topics in the same way
as other mutating bot commands. The `gh` account used by the bot needs read
access plus triage, write, maintain, or admin permission on the repository.

Issue bodies, comments, linked pull requests, README text, and operator notes
are treated as untrusted classification data. They are kept out of the fixed
system prompt. The model receives no GitHub mutation credential or mutation
tool and can return only a plan. The application validates that plan against
the collected issue numbers, timestamps, Issue Types, and labels before it can
write anything.

Immediately before each update, the application re-reads `updatedAt`. A newer
human edit causes that issue to be skipped. Writes run in bounded batches;
partial results are re-read before retrying. A final full read-back verifies the
requested type and exact expected label set. Summaries are credential-scanned,
and an owner-only audit record is kept under the Hive Mind state directory in
`organize-audits/` without retaining issue bodies or comments.

## Fields that may change

`/organize` may change exactly these GitHub issue metadata fields:

- the issue's Issue Type, selected by exact name from enabled organization
  types;
- the issue's label set, adding or removing only labels that already exist in
  the repository.

Unrelated useful labels are preserved. The command never creates labels or
types, assigns people, changes milestones, edits titles or bodies, comments,
closes or reopens issues, changes source code, creates a branch, or creates a
pull request. If Issue Types or labels are unavailable, the supported portion
is applied and the limitation is reported rather than inventing replacements.

The completion message reports counts, issue links, exact type/label diffs,
stale skips, unsupported metadata, mutation errors, and verification failures.
A second run on unchanged issues produces no metadata writes.
