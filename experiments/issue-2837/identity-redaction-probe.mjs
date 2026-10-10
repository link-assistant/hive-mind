// Issue #2837: probe the account-identity redaction rule on real log shapes.
/* global console */
import { sanitizeCredentialText, findCredentialResiduals } from '../../src/credential-sanitization-core.lib.mjs';
const samples = [
  'INFO app_server.request{otel.name="x"}: codex_otel.log_only: event.name="codex.conversation_starts" auth_mode="Chatgpt" originator=codex_exec user.account_id="0a1b2c3d-0000-4000-8000-00000000a001" user.email="someone@example.com" terminal.type=unknown',
  'user.account_id=0a1b2c3d-0000-4000-8000-00000000a001 user.email=someone@example.com model=gpt',
  "  'anthropic-organization-id': '0a1b2c3d-0000-4000-8000-00000000c003',\n  'anthropic-workspace-id': 'wrkspc_01TestFixtureWorkspace00',",
  '{"anthropic-organization-id": "0a1b2c3d-0000-4000-8000-00000000b002", "anthropic-workspace-id": "wrkspc_01TestFixtureWorkspace00", "request-id": "req_1"}',
  '{\\"anthropic-organization-id\\": \\"0a1b2c3d-0000-4000-8000-00000000b002\\", \\"x\\": 1}',
  'anthropic-workspace-id: "wrkspc_01TestFixtureWorkspace00"',
  'anthropic-organization-id: 0a1b2c3d-0000-4000-8000-00000000b002\r\nanthropic-ratelimit-unified-5h-utilization: 0.42',
  'git config user.email "someone@example.com"',
  'user.email="[REDACTED]" user.account_id="[REDACTED]"',
];
for (const s of samples) {
  const out = sanitizeCredentialText(s, { includeEnvironmentCredentials: false });
  console.log(JSON.stringify(out), findCredentialResiduals(out).length ? 'NOT-IDEMPOTENT' : 'ok');
}
