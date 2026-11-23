// Historical library-only reproductions for the 0.19.3 gaps (#131–#141),
// resolved in 0.21.0. Current gaps are in issue-3739/latest-library-audit.mjs.
// No Hive Mind code is used; retain these probes when upgrading the library.
// All secrets are synthetic and assembled at runtime.
//
// Usage: node experiments/issue-3739-upstream-repros.mjs [key]
import { performance } from 'node:perf_hooks';

const started = performance.now();
const library = await import('@link-foundation/sensitive-data-sanitizer');
const loadMs = Math.round(performance.now() - started);
const { createSyncSanitizer } = library;
const { Buffer } = await import('node:buffer');

const OPTIONS = { credentialsOnly: true, preserveEncoding: true, transformation: { mode: 'hive-mask' } };
const GH = ['ghp_', 'Zx9Qw7Er5Ty3Ui1Op0As', '2Df4Gh6Jk8Lz0Xc2Vb4N'].join('');
const OPAQUE = ['f3a9', 'c2e1b7d4', '9a0e6f12', 'c4b8d3e5'].join('');

const run = (text, options = {}) => {
  try {
    return createSyncSanitizer({ ...OPTIONS, ...options }).sanitize(text).text;
  } catch (error) {
    return `throws ${error.code}: ${error.message.slice(0, 160)}`;
  }
};
const show = (label, text, options) => {
  const output = run(text, options);
  const short = value => (value.length > 240 ? `${JSON.stringify(value.slice(0, 120))} … (${value.length} chars) … ${JSON.stringify(value.slice(-80))}` : JSON.stringify(value));
  console.log(`  ${label}\n    in:  ${short(text)}\n    out: ${short(output)}`);
  return output;
};

const cases = {
  authorizationScheme() {
    show('scheme word', `Authorization: token ${GH}`);
    show('custom scheme', `Authorization: CustomScheme ${OPAQUE}`);
    show('JSON header', `{"Authorization":"token ${GH}"}`);
  },
  digestAuthorization() {
    show('digest', `Authorization: Digest username="alice", realm="api", nonce="${OPAQUE}", response="${OPAQUE}"`);
  },
  idempotency() {
    const encoded = Buffer.from(JSON.stringify({ access_token: GH, scope: 'repo' })).toString('base64');
    const once = show('first pass (base64 JSON)', `body ${encoded} end`);
    show('second pass of its own output', once);
    show('mask of another tool', 'docker run --env TOKEN_SECRET=*** image');
    show('GitHub Actions mask', 'password: ***');
  },
  exemptionHook() {
    show('callback keeping a configuration flag', 'HIVE_MIND_ROUTER_AUTH_GUARD=0', { transformation: finding => finding.value });
  },
  configurationFlags() {
    for (const text of ['HIVE_MIND_ROUTER_AUTH_GUARD=0', 'GIT_AUTH_TRANSPORT=1', 'AUTH_MODE=2', '"tokens": 1234', 'token_count=5', '"next-auth": "^4.24.5"', 'const fileTokens = await getTokens();']) show('configuration, counter or code', text);
  },
  formatContext() {
    show('URL user name', `https://alice:${OPAQUE}@example.com/repo.git`);
    show('cookie names', `Cookie: session=${OPAQUE}; csrftoken=${OPAQUE}`);
    show('webhook endpoint', `https://hooks.slack.com/services/T00000000/B00000000/${OPAQUE.slice(0, 24)}`);
    show('PEM markers', `-----BEGIN PRIVATE KEY-----\n${'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC'.repeat(3)}\n-----END PRIVATE KEY-----`);
  },
  missedShapes() {
    show('caps marker', `export TEST_VALUE=SYNTHETIC_TOKEN_ALPHA_123456`);
    show('XML element with attributes', `<clientSecret attr="1">${OPAQUE}</clientSecret>`);
    show('hash rocket', `{ 'password' => 'hunter2long' }`);
    show('angle value', 'token: <script>alert(1)</script>');
    show('plural flag', `tool --access-tokens ${OPAQUE}`);
  },
  syncLoading() {
    console.log(`  import() of the package took ${loadMs} ms; package.json exports conditions:`);
  },
  wrappedEncoding() {
    const doc = JSON.stringify({ note: 'x'.repeat(60), token: GH, more: 'y'.repeat(60) });
    const wrapped = Buffer.from(doc)
      .toString('base64')
      .match(/.{1,40}/g)
      .join('\n');
    const output = show('base64 wrapped at 40 columns', wrapped);
    const decoded = Buffer.from(output.replace(/\n/g, ''), 'base64').toString();
    console.log(`    decoded output still contains the token: ${decoded.includes(GH)}`);
  },
  candidateLimit() {
    for (const count of [4000, 5000]) {
      const words = Array.from({ length: count }, (_, i) => Buffer.from(`chunk number ${i} ok`).toString('base64')).join('\n');
      show(`${count} short base64 text lines, then a token`, `${words}\ntoken: ${GH}`);
    }
  },
  pemSpan() {
    const body = 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC';
    show('short block, text, long block', `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\nbetween line stays\n-----BEGIN PRIVATE KEY-----\n${body}${body}${body}\n-----END PRIVATE KEY-----`);
  },
  shortEncodedMask() {
    const secret = ['Pk7Rm2Qx9L', 'wZaB8y'].join('');
    show('hex of a 16-character known secret in a long log', `x ${Buffer.from(secret).toString('hex')} y\n${'other log lines\n'.repeat(3)}`, { knownSecrets: [secret] });
    show('the same secret in base64', `x ${Buffer.from(secret).toString('base64')} y`, { knownSecrets: [secret] });
  },
  lineContextSpan() {
    show('line context after a vendor token', `User token: ${GH}. Next sentence stays`);
  },
  encodedLimitLines() {
    const lines = Array.from({ length: 1000 }, (_, i) => `id_${String(i).padStart(4, '0')}abcdefghijklmnop`).join('\n');
    show('1000 identifier lines', `${lines}\ntoken: ${GH}\n`);
    const shas = Array.from({ length: 250 }, (_, i) => Buffer.from(`commit-${i}`).toString('hex').padEnd(40, 'a').slice(0, 40)).join('\n');
    show('250 commit SHAs (git rev-list)', `${shas}\n`);
  },
  shortHexKnownSecret() {
    for (const length of [12, 15, 16]) {
      const secret = ['Pk7Rm2Qx9L', 'wZaB8yCd4E'].join('').slice(0, length);
      show(`hex of a ${length}-character known secret`, `x ${Buffer.from(secret).toString('hex')} y`, { knownSecrets: [secret] });
    }
  },
};

const only = process.argv[2];
for (const [key, fn] of Object.entries(cases)) {
  if (only && key !== only) continue;
  console.log(`\n${key}`);
  fn();
}
