// Coverage probe: does @link-foundation/sensitive-data-sanitizer (credentialsOnly)
// remove every credential that each Hive Mind rule in
// src/credential-sanitization-core.lib.mjs was written for?
// Each entry: [rule, input, secret]. Synthetic values are assembled at runtime.
import { createSyncSanitizer } from '@link-foundation/sensitive-data-sanitizer';
const lib = createSyncSanitizer({ credentialsOnly: true, transformation: { mode: 'hive-mask' } });
const j = (...p) => p.join('');
const R = 'Q7wZ2kLp9XvB4nTr6YcM1sHd8FgJ3aEu';
const cases = [
  ['vendor github classic', `x ${j('ghp', '_', R)} y`, j('ghp', '_', R)],
  ['vendor github fine-grained', `x ${j('github_pat', '_', R, '_', R)} y`, j('github_pat', '_', R, '_', R)],
  ['vendor github server', `x ${j('ghs', '_', R)} y`, j('ghs', '_', R)],
  ['vendor gitlab', `x ${j('glpat', '-', R)} y`, j('glpat', '-', R)],
  ['vendor gitlab runner', `x ${j('glrt', '-', R)} y`, j('glrt', '-', R)],
  ['vendor openai', `x ${j('sk', '-proj-', R)} y`, j('sk', '-proj-', R)],
  ['vendor anthropic', `x ${j('sk', '-ant-api03-', R)} y`, j('sk', '-ant-api03-', R)],
  ['vendor aws akid', `x ${j('AKIA', 'Q7WZ2KLP9XVB4NTR')} y`, j('AKIA', 'Q7WZ2KLP9XVB4NTR')],
  ['vendor google api', `x ${j('AIza', R, 'abcdef')} y`, j('AIza', R, 'abcdef')],
  ['vendor google oauth', `x ${j('GOCSPX', '-', R)} y`, j('GOCSPX', '-', R)],
  ['vendor slack', `x ${j('xoxb', '-', '123456789012-', R)} y`, j('xoxb', '-', '123456789012-', R)],
  ['vendor slack app', `x ${j('xapp', '-', '1-A0', R)} y`, j('xapp', '-', '1-A0', R)],
  ['vendor stripe', `x ${j('sk', '_live_', R)} y`, j('sk', '_live_', R)],
  ['vendor stripe webhook', `x ${j('whsec', '_', R)} y`, j('whsec', '_', R)],
  ['vendor sendgrid', `x ${j('SG', '.', 'abcdefghijkl', '.', R)} y`, j('SG', '.', 'abcdefghijkl', '.', R)],
  ['vendor twilio', `x ${j('SK', '0123456789abcdef0123456789abcdef')} y`, j('SK', '0123456789abcdef0123456789abcdef')],
  ['vendor npm', `x ${j('npm', '_', R)} y`, j('npm', '_', R)],
  ['vendor pypi', `x ${j('pypi', '-', R, R)} y`, j('pypi', '-', R, R)],
  ['vendor telegram', `x ${j('8490528355', ':', 'AAGHeNpjZJqWEytzt4iw1kfW2ouXlyItTE')} y`, j('8490528355', ':', 'AAGHeNpjZJqWEytzt4iw1kfW2ouXlyItTE')],
  ['vendor discord', `x ${j('MTA4', 'NzY1NDMyMTA5ODc2NTQzMjE', '.', 'GaBcDe', '.', R)} y`, j('MTA4', 'NzY1NDMyMTA5ODc2NTQzMjE', '.', 'GaBcDe', '.', R)],
  ['vendor huggingface', `x ${j('hf', '_', R)} y`, j('hf', '_', R)],
  ['vendor shopify', `x ${j('shpat', '_', '0123456789abcdef0123456789abcdef')} y`, j('shpat', '_', '0123456789abcdef0123456789abcdef')],
  ['vendor databricks', `x ${j('dapi', '0123456789abcdef0123456789abcdef')} y`, j('dapi', '0123456789abcdef0123456789abcdef')],
  ['vendor square', `x ${j('sq0atp', '-', R)} y`, j('sq0atp', '-', R)],
  ['vendor jwt', `x ${j('eyJ', 'hbGciOiJIUzI1NiJ9', '.', 'eyJ', 'zdWIiOiIxMjM0NTY3ODkwIn0', '.', 'dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U')} y`, 'dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'],
  ['vendor all-caps marker', 'leaked SYNTHETIC_TOKEN_ALPHA_123456 in a log', 'SYNTHETIC_TOKEN_ALPHA_123456'],
  ['pem', `-----BEGIN RSA PRIVATE KEY-----\nMIIEow${R}\n-----END RSA PRIVATE KEY-----`, `MIIEow${R}`],
  ['pem unterminated', `-----BEGIN PRIVATE KEY-----\nMIIEow${R}`, `MIIEow${R}`],
  ['authorization bearer', `Authorization: Bearer ${R}`, R],
  ['authorization basic', `Proxy-Authorization: Basic ${Buffer.from('user:' + R).toString('base64')}`, Buffer.from('user:' + R).toString('base64')],
  ['authorization token', `Authorization: token ${R}`, R],
  ['url userinfo', `https://user:${R}@example.com/x`, R],
  ['sas header', `SharedAccessSignature sr=ns&sig=${R}&se=123&skn=root`, R],
  ['sas assignment', `SharedAccessSignature=${R}`, R],
  ['cookie', `Cookie: session=${R}; theme=dark`, R],
  ['set-cookie', `Set-Cookie: sid=${R}; Path=/`, R],
  ['xml', `<password>${R}</password>`, R],
  ['xml clientSecret', `<clientSecret attr="1">${R}</clientSecret>`, R],
  ['quoted json', `{"api_key":"${R}"}`, R],
  ['quoted escaped json', `{\\"token\\":\\"${R}\\"}`, R],
  ['quoted single', `password: '${R}'`, R],
  ['unquoted env', `MY_SERVICE_SECRET=${R}`, R],
  ['unquoted yaml', `client_secret: ${R}`, R],
  ['unquoted hash-rocket', `password => ${R}`, R],
  ['unquoted hash-rocket tight', `secret=>${R}`, R],
  ['unquoted ruby', `{ 'password' => '${R}' }`, R],
  ['unquoted <value>', 'token: <script>alert(1)</script>', '<script>alert(1)</script>'],
  ['unquoted access_token', `access_token=${R}`, R],
  ['unquoted docker auth', `"auth": "${Buffer.from('u:' + R).toString('base64')}"`, Buffer.from('u:' + R).toString('base64')],
  ['unquoted AccountKey', `AccountKey=${R};EndpointSuffix=core.windows.net`, R],
  ['cli flag space', `--token ${R}`, R],
  ['cli flag eq', `--github-token=${R}`, R],
  ['cli flag quoted', `--password "${R}"`, R],
  ['cli flag plural', `--access-tokens ${R}`, R],
  ['cli flag api-key', `--api-key ${R}`, R],
  ['query', `https://example.com/cb?code=1&access_token=${R}&x=1`, R],
  ['query sig', `https://example.com/blob?sv=1&sig=${R}`, R],
  ['slack webhook', `https://hooks.slack.com/services/T00000000/B00000000/${R}`, R],
  ['discord webhook', `https://discord.com/api/webhooks/123456789012345678/${R}`, R],
  ['base64 json', `body ${Buffer.from(JSON.stringify({ access_token: j('gho', '_', R) })).toString('base64')} end`, Buffer.from(JSON.stringify({ access_token: j('gho', '_', R) })).toString('base64')],
  ['percent', `x=${encodeURIComponent('password=' + R + '/+')}`, R],
  ['hex', `x ${Buffer.from(j('ghp', '_', R)).toString('hex')} y`, Buffer.from(j('ghp', '_', R)).toString('hex')],
];
let misses = 0;
for (const [rule, input, secret] of cases) {
  let out;
  try { out = lib.sanitize(input).text; } catch (e) { out = `ERR ${e.code}`; }
  const ok = !out.includes(secret);
  if (!ok) misses++;
  console.log(`${ok ? 'ok  ' : 'MISS'} ${rule}: ${JSON.stringify(out)}`);
}
console.log(`${misses} misses / ${cases.length}`);
