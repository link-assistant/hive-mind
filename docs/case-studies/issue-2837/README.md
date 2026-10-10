# Case study: `--verbose` published AI tool account identifiers (issue #2837)

- Issue: https://github.com/link-assistant/hive-mind/issues/2837
- Pull request: https://github.com/link-assistant/hive-mind/pull/2849
- Date: 2026-10-09
- Affected versions: hive-mind 2.34.0 and 2.35.0 (both code paths unchanged)

## 1. Problem

With `--verbose`, solve also enabled the debug logging of the tool it drives:

- `src/codex.lib.mjs` (`getCodexExecEnv`): `RUST_LOG=debug` for every `codex exec`. Codex `codex_otel.log_only` / `codex_otel.trace_safe` events stamp `user.email="…"` and `user.account_id="…"` on every line. router#719 published 1,273 copies of each.
- `src/claude.lib.mjs`: `if (argv.verbose) claudeEnv.ANTHROPIC_LOG = 'debug';`. The Anthropic SDK dumps every response's headers, including `anthropic-organization-id` and `anthropic-workspace-id`. web-capture#178 published them on 629 lines.

`--attach-logs` publishes these logs to public gists. The sanitizer redacts credentials but had no rule for identifiers, so the upload summary reported `Known tokens: 0` and published everything.

## 2. Root cause

1. `--verbose` is meant to make hive-mind's own diagnostics verbose. It also switched on SDK/CLI tracing, which is many times larger (56 MB of a container log in router#719) and carries account metadata.
2. The publication boundary (`sanitizeForPublication`) only knows credentials (vendor token shapes, `key=value` secrets, known local tokens). An e-mail or a UUID is not a credential shape, so nothing matched it, and the residual scan had nothing to check.
3. The `/limits` command's verbose logging also printed the Codex account ID (`[VERBOSE] /limits Codex account id: <uuid>`). That line reached committed telegram-bot logs.

## 3. Fix

| Requirement from the issue                                                                      | Where it is handled                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SDK debug tracing is a separate opt-in, not implied by `--verbose`                              | `--codex-debug` and `--anthropic-debug` (`src/solve.config.lib.mjs`, default `false`; hive forwards them automatically). `src/tool-debug-env.lib.mjs` owns the env. A `RUST_LOG` / `ANTHROPIC_LOG` the operator exports is still inherited.                                                                                                                                                 |
| Redact `user.email=`, `user.account_id=`, `anthropic-organization-id`, `anthropic-workspace-id` | `sanitizeAccountIdentityFields` in `src/credential-sanitization-core.lib.mjs` runs inside `sanitizePlaintextCredentials`, so every publication path gets it. It handles quoted/unquoted OTEL fields and JS / JSON / escaped-JSON / raw HTTP header dumps, and also `chatgpt-account-id`, `openai-organization` and `openai-project`. Values are replaced whole, and the rule is idempotent. |
| Redact the authenticated account's e-mail                                                       | `src/account-identity.lib.mjs` reads the e-mail, account, user and organization IDs from Codex `auth.json` (including the `id_token` JWT claims) and Claude `.claude.json` (`oauthAccount`). `sanitizeOutput` replaces them anywhere in the text. The residual scan in `sanitizeForPublication` blocks publication if any survive (`account-identity:<name>`).                              |
| Regression tests with codex_otel and Anthropic SDK header fixtures                              | `tests/issue-2837-account-identity-redaction.test.mjs`                                                                                                                                                                                                                                                                                                                                      |
| Existing logs need review or rewriting                                                          | Committed evidence was rewritten; see section 4.                                                                                                                                                                                                                                                                                                                                            |

Placeholders are left readable: `user.email: (not set)`, `<redacted>`, `${email}`, Markdown inline code such as `` `user.email=` ``, `…` and env var names such as `"OpenAI-Project": "OPENAI_PROJECT"`. `git config` output has the same `user.email=` shape as the OTEL field and is redacted as well, which costs nothing diagnostic.

Identity values are deliberately **not** added to the known-token set (`getAllKnownLocalTokens`). That set feeds the Telegram `/tokens` listing and the leak-warning DM, and identifiers are not secrets to rotate.

### Trade-off: Codex compaction diagnostics

`src/codex.diagnostics.lib.mjs` rebuilds Codex sub-sessions from `context_window`, `auto_compact_token_limit` and `/responses/compact` lines. Those lines only exist under `RUST_LOG=debug`, so a `--verbose` run without `--codex-debug` now behaves like a non-verbose run: compaction-based sub-session splitting is not available. Use `--codex-debug` when that detail is needed. The identifiers on those lines are redacted, and the parser still reads redacted lines (covered by the test).

## 4. Committed evidence

Case-study logs, `dev/log` session logs and experiment captures committed before this fix held the operator's identifiers: 6 distinct values in 142 files (ChatGPT account UUIDs, Anthropic organization UUIDs, the Anthropic workspace ID, a tool account e-mail).

- `experiments/issue-2837/collect-committed-identities.mjs` lists them, showing masked previews only.
- `experiments/issue-2837/redact-committed-logs.mjs [--write]` applies the field rule. It also replaces every value such a field ever held, wherever it appears in those files, except git author e-mails (already public commit metadata) and documentation placeholders.

After the rewrite, `git grep` finds none of the six values in the tree.

**Not covered by this PR:**

- The values remain in git history.
- Gists already published by `--attach-logs` keep them until they are deleted or re-uploaded.
- Both need an owner decision: rewriting history or deleting gists cannot be done from a pull request.

## 5. Reproduce

```bash
node tests/issue-2837-account-identity-redaction.test.mjs   # 18 checks
node experiments/issue-2837/identity-redaction-probe.mjs    # every log shape: redacted + idempotent
node experiments/issue-2837/redact-committed-logs.mjs       # dry run: 0 files left to rewrite
```

Before the fix, the codex_otel and Anthropic header fixtures in the test pass through `sanitizeCredentialText` unchanged, and `getCodexExecEnv(true)` (the `--verbose` value) set `RUST_LOG=debug`.
