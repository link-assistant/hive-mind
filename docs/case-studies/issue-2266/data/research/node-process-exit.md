# Node.js process exit semantics

- Source: <https://nodejs.org/api/process.html#processexitcode>
- Accessed: 2026-09-20
- Publisher: Node.js project (primary documentation)

Node.js follows the conventional process-status contract: an exit code of `0`
indicates success, while a nonzero code indicates failure. Assigning a no-work
condition to exit code `1` therefore tells every caller—including the Telegram
session monitor—that the command failed even when the requested repository is
already in the desired state.

This supports treating an empty repository scan as a successful terminal
result and reserving nonzero status for failures such as authentication,
transport, parsing, or issue-creation errors.
