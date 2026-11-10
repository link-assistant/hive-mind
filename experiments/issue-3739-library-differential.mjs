// Differential probe: Hive Mind's rule set (sanitizeCredentialText) versus
// @link-foundation/sensitive-data-sanitizer with the hive-mask transformation.
// Usage: node experiments/issue-3739-library-differential.mjs [extra input...]
import { createSyncSanitizer } from '@link-foundation/sensitive-data-sanitizer';
import { sanitizeCredentialText } from '../src/credential-sanitization-core.lib.mjs';

const lib = createSyncSanitizer({ credentialsOnly: true, transformation: { mode: 'hive-mask' } });
const gho = ['gho', '_', 'SYNTHETICabcdefghijklmnopqrstuvwxyz0123'].join('');
const bot = ['8490528355', ':', 'AAGHe', 'NpjZJqWEytzt4iw1kfW2ouXly', 'ItTEST'].join('');
const inputs = [
  'Authorization: token 0123456789abcdef0123456789abcdef01234567',
  'Authorization: Bearer ghp_SYNTHETIC_TOKEN_ABCDEF123456',
  'curl -L -H "Authorization: token $(gh auth token)"',
  '{"authorization":"Bearer opaque-authorization-secret"}',
  "{ 'password' => 'hunter2' }",
  'password => hunter2-correct-horse',
  'password=hunter2-correct-horse-value',
  'password: hunter2-correct-horse-value',
  'GOOGLE_CLIENT_SECRET=GOCSPX-SYNTHETIC-EXAMPLE-123456789',
  'A=SYNTHETIC_TOKEN_ALPHA_123456 B=SYNTHETIC_TOKEN_BETA_654321',
  'SHORT_PASSWORD=abc123',
  `DATABASE_URL=${['postgres', '://app:'].join('')}SYNTHETIC_PASSWORD_123456@database.internal/app`,
  `TELEGRAM_BOT_TOKEN=${bot}`,
  '--access-tokens abcdefghijkl123',
  '--token abcdefghijkl123',
  '--github-token=abcdefghijkl123',
  'token: <script>alert(1)</script>',
  'SharedAccessSignature sr=namespace&sig=abcdefghijklmnopqrstuvwxyz123456&se=123456',
  `token len 40\\n{\\"token\\":\\"${Buffer.from(JSON.stringify({ token: gho })).toString('base64')}\\"}\\n`,
  `Response body (base64): ${Buffer.from(JSON.stringify({ user: 'octocat', access_token: gho, scope: 'repo' })).toString('base64')} -- end`,
  'HIVE_MIND_ROUTER_AUTH_GUARD=0 disables it',
  'sent **0** `Authorization` headers.',
  '`HIVE_MIND_DISABLE_GIT_AUTH_TRANSPORT=1` opts out.',
  '{"tokens": 1234}',
  '"input_tokens": 55',
  '"secretlint": "^13.0.2"',
  'commit 0123456789abcdef0123456789abcdef01234567',
  `${['https', '://user:'].join('')}supersecretpassword123@example.com/x`,
  'https://example.com/?access_token=abcdefghijklmnop12345',
  'Cookie: session=abcdefghijklmnop1234567890',
  '<password>abcdefghijklmnop12345</password>',
  `export GH_TOKEN=${['gh', 'p_'].join('')}abcdefghijklmnopqrstuvwxyz0123456789`,
  'const f = token => !token;',
  'secret=>LH5qO6yo',
  ...process.argv.slice(2),
];
for (const input of inputs) {
  const core = sanitizeCredentialText(input, { includeEnvironmentCredentials: false });
  let library;
  try { library = lib.sanitize(input).text; } catch (error) { library = `ERR ${error.code}`; }
  const mark = core === library ? 'same' : 'DIFF';
  console.log(`${mark}\n  in:   ${JSON.stringify(input)}\n  core: ${JSON.stringify(core)}\n  lib:  ${JSON.stringify(library)}`);
}
