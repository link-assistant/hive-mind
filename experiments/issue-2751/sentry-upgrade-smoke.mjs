#!/usr/bin/env node

// Verify the paired Sentry SDKs and native profiling integration without sending
// telemetry. Run with: node experiments/issue-2751/sentry-upgrade-smoke.mjs
import assert from 'node:assert/strict';
import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

const client = Sentry.init({
  dsn: 'https://public@example.invalid/1',
  transport: () => ({ send: async () => ({ statusCode: 200 }), flush: async () => true }),
  defaultIntegrations: false,
  integrations: [nodeProfilingIntegration()],
  tracesSampleRate: 0,
  profileSessionSampleRate: 0,
  profileLifecycle: 'trace',
  sendDefaultPii: false,
});

try {
  assert.ok(client);
  assert.ok(client.getIntegrationByName('ProfilingIntegration'));
  assert.equal(
    Sentry.startSpan({ name: 'offline SDK smoke' }, () => 42),
    42
  );
} finally {
  assert.equal(await Sentry.close(2000), true);
}

console.log('Sentry SDK and native profiling integration initialize and close offline.');
