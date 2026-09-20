# Anthropic OAuth endpoints probe — 2026-05-12

We probed the Anthropic OAuth API used by Claude Code with the user’s live
OAuth bearer token to confirm what is and isn’t exposed for subscription
end-date discovery. All requests use the documented headers:

```
Authorization: Bearer <oauth-access-token>
anthropic-beta: oauth-2025-04-20
User-Agent: claude-code/2.0.55
```

| Endpoint                              | HTTP | Notes                                                                                                                               |
| ------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/oauth/profile`              | 200  | Includes `organization.subscription_status`, `subscription_created_at`, `claude_code_trial_ends_at`. **No `subscription_ends_at`.** |
| `GET /api/oauth/account`              | 200  | Same plus `internal_tier_override_expires_at` (null on user accounts).                                                              |
| `GET /api/oauth/usage`                | 200  | The endpoint `/limits` already uses; reset windows, no plan end date.                                                               |
| `GET /api/oauth/subscription`         | 404  | Not exposed.                                                                                                                        |
| `GET /api/oauth/subscriptions`        | 404  | Not exposed.                                                                                                                        |
| `GET /api/oauth/subscription/details` | 404  | Not exposed.                                                                                                                        |
| `GET /api/oauth/subscription_details` | 404  | Not exposed.                                                                                                                        |
| `GET /api/oauth/subscription_end`     | 404  | Not exposed.                                                                                                                        |
| `GET /api/oauth/billing`              | 404  | Not exposed.                                                                                                                        |
| `GET /api/oauth/billing/subscription` | 404  | Not exposed.                                                                                                                        |
| `GET /api/oauth/billing/invoices`     | 404  | Not exposed.                                                                                                                        |
| `GET /api/oauth/renewal`              | 404  | Not exposed.                                                                                                                        |
| `GET /api/oauth/claude_code`          | 404  | Not exposed.                                                                                                                        |
| `GET /api/oauth/organizations`        | 404  | Not exposed (`/account` is the documented org lookup).                                                                              |
| `GET /api/oauth/current_period_end`   | 404  | Not exposed.                                                                                                                        |
| `GET /api/oauth/session`              | 404  | Not exposed.                                                                                                                        |
| `GET /api/oauth/settings`             | 404  | Not exposed.                                                                                                                        |

## Conclusion

For paid Claude subscriptions there is no public OAuth field that publishes
the subscription end date. The closest we get is:

- `subscription_status` ("active" / "inactive")
- `subscription_created_at` (when the subscription was set up)
- `claude_code_trial_ends_at` (set only for trial accounts)

We surface those when present and **do not** fabricate an end date for paid
subscriptions. If/when Anthropic exposes a renewal date, the renderer
already has a one-line slot for it (`subscription_ends_at` → "Subscription
ends …").
