// Prints Hive policy output for the issue #3739 shapes and any argv inputs.
import { sanitizeWithPolicy, findCredentialFindings } from '../src/sensitive-data-sanitizer.lib.mjs';
const R = 'Q7wZ2kLp9XvB4nTr6YcM1sHd8FgJ3aEu';
const inputs =
  process.argv.length > 2
    ? process.argv.slice(2)
    : [
        `Authorization: token ${R}`,
        `Authorization: Bearer ${R}`,
        `Proxy-Authorization: Basic ${Buffer.from('user:' + R).toString('base64')}`,
        `Authorization: ApiKey ${R}`,
        'curl -L -H "Authorization: token $(gh auth token)" -o x.png "https://x"',
        `{"headers":{"Authorization":"token ${R}"}}`,
        `Authorization: ${R}`,
        'Authorization: Digest username="x", response="6629fae49393a05397450978507c4ef1"',
        `-----BEGIN RSA PRIVATE KEY-----\nMIIEow${R}\n-----END RSA PRIVATE KEY-----`,
        `-----BEGIN PRIVATE KEY-----\nMIIEow${R}`,
        `Cookie: session=${R}; theme=dark`,
        `Set-Cookie: sid=${R}; Path=/`,
        `https://user:${R}@example.com/x`,
        `https://hooks.slack.com/services/T00000000/B00000000/${R}`,
        `body ${Buffer.from(JSON.stringify({ user: 'octocat', access_token: 'gho_' + R })).toString('base64')} end`,
        'HIVE_MIND_ROUTER_AUTH_GUARD=0 x',
        '`HIVE_MIND_DISABLE_GIT_AUTH_TRANSPORT=1` opts',
        'password=hun…lue',
        '{"tokens": 1234}',
        "{ 'password' => 'hunter2' }",
        'secret=>LH5qO6yo',
        'token: <script>alert(1)</script>',
        'run --access-tokens abcdefghijkl123 now',
        `<clientSecret attr="1">${R}</clientSecret>`,
        'leaked SYNTHETIC_TOKEN_ALPHA_123456 in a log',
        'Enhance --tokens-budget-stats with sub-session tracking',
        'const f = token => !token;',
        `SharedAccessSignature sr=ns&sig=${R}&se=123&skn=root`,
      ];
for (const t of inputs) {
  let out;
  try {
    out = sanitizeWithPolicy(t);
  } catch (e) {
    out = `ERR ${e.code} ${e.message}`;
  }
  let twice;
  try {
    twice = sanitizeWithPolicy(out);
  } catch (e) {
    twice = 'ERR';
  }
  console.log(JSON.stringify(t).slice(0, 90), '\n  =>', JSON.stringify(out), twice === out ? '' : `\n  NOT IDEMPOTENT => ${JSON.stringify(twice)}`);
}
