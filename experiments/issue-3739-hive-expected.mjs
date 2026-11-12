// Prints Hive Mind's output for the upstream repro inputs (the "Expected" column
// of the upstream issues). Synthetic values only.
import { Buffer } from 'node:buffer';
import { sanitizeCredentialText } from '../src/credential-sanitization-core.lib.mjs';

const GH = ['ghp_', 'Zx9Qw7Er5Ty3Ui1Op0As', '2Df4Gh6Jk8Lz0Xc2Vb4N'].join('');
const OPAQUE = ['f3a9', 'c2e1b7d4', '9a0e6f12', 'c4b8d3e5'].join('');
const body = 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC';
const inputs = [`Authorization: Digest username="alice", realm="api", nonce="${OPAQUE}", response="${OPAQUE}"`, `https://alice:${OPAQUE}@example.com/repo.git`, `Cookie: session=${OPAQUE}; csrftoken=${OPAQUE}`, `https://hooks.slack.com/services/T00000000/B00000000/${OPAQUE.slice(0, 24)}`, `-----BEGIN PRIVATE KEY-----\n${body.repeat(3)}\n-----END PRIVATE KEY-----`, `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\nbetween line stays\n-----BEGIN PRIVATE KEY-----\n${body.repeat(3)}\n-----END PRIVATE KEY-----`, `User token: ${GH}. Next sentence stays`, 'HIVE_MIND_ROUTER_AUTH_GUARD=0', 'export TEST_VALUE=SYNTHETIC_TOKEN_ALPHA_123456', `<clientSecret attr="1">${OPAQUE}</clientSecret>`, "{ 'password' => 'hunter2long' }", 'token: <script>alert(1)</script>', `tool --access-tokens ${OPAQUE}`, `body ${Buffer.from(JSON.stringify({ access_token: GH, scope: 'repo' })).toString('base64')} end`];
for (const input of inputs) console.log(`${JSON.stringify(input)}\n  -> ${JSON.stringify(sanitizeCredentialText(input, { includeEnvironmentCredentials: false }))}`);
for (const length of [12, 15, 16]) {
  const secret = ['Pk7Rm2Qx9L', 'wZaB8yCd4E'].join('').slice(0, length);
  const input = `x ${Buffer.from(secret).toString('hex')} y`;
  console.log(`known ${length}: ${JSON.stringify(input)}\n  -> ${JSON.stringify(sanitizeCredentialText(input, { includeEnvironmentCredentials: false, knownTokens: [secret] }))}`);
}
