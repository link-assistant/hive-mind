// Usage: node experiments/issue-4079-redaction-check.mjs <solve.log>
// Counts identity values left after redaction (prints counts only, never values).
import { readFileSync } from 'node:fs';
import { redactTelemetryIdentityWithCount } from '../src/telemetry-identity-redaction.lib.mjs';
const text = readFileSync(process.argv[2], 'utf8');
const { text: out, redacted } = redactTelemetryIdentityWithCount(text);
const left = (out.match(/user\.(email|account_id)=(?!"?<redacted>)/g) || []).length;
console.log({ redacted, left });
