/**
 * Issue #2156 — reproduction against the code as it was when the leak happened.
 * Synthetic token only.
 */
const SYNTHETIC_GHO = `gho_SYNTHETIC0000NotARealToken1111111111`;
const { sanitizeCredentialText } = await import('./src/credential-sanitization-core.lib.mjs');

const escaped = `{\\"token\\":\\"SYNTHETIC_ESCAPED_JSON_VALUE_9999\\"}`;
console.log('root cause 2 — escaped JSON assignment');
console.log('  plain  :', sanitizeCredentialText(`{"token":"SYNTHETIC_ESCAPED_JSON_VALUE_9999"}`));
console.log('  escaped:', sanitizeCredentialText(escaped));
console.log('  LEAKS  :', sanitizeCredentialText(escaped).includes('SYNTHETIC_ESCAPED_JSON_VALUE_9999'));

const encoded = Buffer.from(JSON.stringify({ token: SYNTHETIC_GHO })).toString('base64');
console.log('\nroot cause 1 — base64-encoded credential');
console.log('  out   :', sanitizeCredentialText(`Response body: ${encoded}`));
console.log('  LEAKS :', sanitizeCredentialText(`Response body: ${encoded}`).includes(encoded));
