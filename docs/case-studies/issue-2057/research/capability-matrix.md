# Capability matrix

Research date: 2026-07-14.

| Property                            | Claude Code stream-json                                                                          | Codex exec JSONL                     | Codex app-server                                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Bidirectional transport             | stdin/stdout NDJSON                                                                              | stdout JSONL; stdin is startup input | stdio/WebSocket/Unix-socket JSON-RPC                                                              |
| Additional input, same process      | Yes                                                                                              | Not documented                       | Yes                                                                                               |
| Additional input, same conversation | Yes                                                                                              | Only by a later resume invocation    | Yes, same thread                                                                                  |
| Steer active turn                   | A frame can be written while busy; processing semantics should be treated as provider-controlled | No                                   | Yes, `turn/steer`                                                                                 |
| Queue until idle                    | Client queues until `result`                                                                     | Requires process completion/restart  | Client queues until `turn/completed`, then `turn/start` on same thread                            |
| Input acknowledgement               | `--replay-user-messages`                                                                         | Not applicable                       | `turn/steer` response returns accepted `turnId`; user-message item can echo `clientUserMessageId` |
| Stale-turn protection               | Client busy/idle state                                                                           | Not applicable                       | Required `expectedTurnId`                                                                         |
| Hive Mind integration               | Shipped                                                                                          | Current Codex runner                 | Not implemented                                                                                   |
| #2057 outcome                       | Meets requirement                                                                                | Does not meet requirement            | Correct Codex solution                                                                            |

## Semantic invariants

The future Codex integration should treat these as protocol invariants:

1. exactly one app-server process owns a live solve;
2. exactly one Codex thread represents that solve;
3. at most one regular turn is active in that thread;
4. `turn/steer.expectedTurnId` always equals the last authoritative active ID;
5. a stale-turn error is a state transition, not a reason to restart;
6. after `turn/completed`, queued input uses `turn/start` on the existing thread;
7. `thread/resume` is never used merely to deliver live feedback; and
8. restart/resume fallback and app-server ownership are never active together.

## Event-to-delivery mapping

| Hive Mind event                 | Queue policy                         | Claude                     | Codex app-server target             |
| ------------------------------- | ------------------------------------ | -------------------------- | ----------------------------------- |
| Uncommitted worktree changes    | Queue by default                     | user NDJSON after `result` | `turn/start` after `turn/completed` |
| CI failure                      | Queue by default; immediate optional | user NDJSON                | `turn/steer` or queued `turn/start` |
| Issue/PR comment                | User-selected queue/stream           | user NDJSON                | `turn/steer` or queued `turn/start` |
| Issue title/body edit           | Queue by default                     | user NDJSON                | queued `turn/start`                 |
| Merge conflict/metadata blocker | Queue by default                     | user NDJSON                | queued `turn/start`                 |

The transport should receive a neutral text envelope containing event type,
source URL/number, author where applicable, timestamp, and content. Provider
adapters—not the poller—encode that envelope for their protocol.
