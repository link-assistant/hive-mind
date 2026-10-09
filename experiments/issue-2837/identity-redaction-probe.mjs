// Issue #2837: probe the account-identity redaction rule on real log shapes.
/* global console */
import { sanitizeCredentialText, findCredentialResiduals } from '../../src/credential-sanitization-core.lib.mjs';
const samples = [
  'INFO app_server.request{otel.name="x"}: codex_otel.log_only: event.name="codex.conversation_starts" auth_mode="Chatgpt" originator=codex_exec user.account_id="e9c72023-174b-4cfd-8374-963550c2ef98" user.email="someone@example.com" terminal.type=unknown',
  'user.account_id=e9c72023-174b-4cfd-8374-963550c2ef98 user.email=someone@example.com model=gpt',
  "  'anthropic-organization-id': '684cb0ba-85b8-4b30-a841-e92fb92cc97f',\n  'anthropic-workspace-id': 'wrkspc_0117gBnPr68DBsCrmom3Bxq6',",
  '{"anthropic-organization-id": "ebc2ac93-f86f-4d15-aff3-de8830d8d789", "anthropic-workspace-id": "wrkspc_0117gBnPr68DBsCrmom3Bxq6", "request-id": "req_1"}',
  '{\\"anthropic-organization-id\\": \\"ebc2ac93-f86f-4d15-aff3-de8830d8d789\\", \\"x\\": 1}',
  'anthropic-workspace-id: "wrkspc_0117gBnPr68DBsCrmom3Bxq6"',
  'anthropic-organization-id: ebc2ac93-f86f-4d15-aff3-de8830d8d789\r\nanthropic-ratelimit-unified-5h-utilization: 0.42',
  'git config user.email "someone@example.com"',
  'user.email="[REDACTED]" user.account_id="[REDACTED]"',
];
for (const s of samples) {
  const out = sanitizeCredentialText(s, { includeEnvironmentCredentials: false });
  console.log(JSON.stringify(out), findCredentialResiduals(out).length ? 'NOT-IDEMPOTENT' : 'ok');
}
