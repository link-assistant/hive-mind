// Issue #4053: how do the detectors classify the reported Claude failure?
import { detectSubscriptionError, formatSubscriptionDetectionLine } from '../src/subscription-error.lib.mjs';
import { classifyRetryableError } from '../src/tool-retry.lib.mjs';
const msgs = ['Failed to authenticate. API Error: 403 Attention Required! | Cloudflare', 'Failed to authenticate. API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"Invalid bearer token"}}', 'OAuth token revoked. Please run /login', 'Your subscription has expired'];
for (const m of msgs) {
  const a = detectSubscriptionError({ message: m, tool: 'claude' });
  const b = detectSubscriptionError({ message: m, tool: 'claude', errorCode: 'authentication_failed', apiErrorStatus: 403 });
  const c = classifyRetryableError(m);
  console.log(JSON.stringify(m), '\n  msg-only:', a && { kind: a.kind, verifiable: a.verifiable, ev: a.transientEvidence }, '\n  with-code:', b && { kind: b.kind, verifiable: b.verifiable, ev: b.transientEvidence }, '\n  classify:', { retry: c.isRetryable, sub: !!c.isSubscriptionError, label: c.label }, '\n  line:', formatSubscriptionDetectionLine(b || a));
}
