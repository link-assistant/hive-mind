// Prints sanitizer output for the cases pinned by
// tests/issue-3739-sensitive-data-sanitizer-migration.test.mjs (synthetic data).
import { sanitizeCredentialText } from '../src/credential-sanitization-core.lib.mjs';
const o = { includeEnvironmentCredentials: false };
const gh = ['ghp_', 'Zx9Qw7Er5Ty3Ui1Op0As', '2Df4Gh6Jk8Lz0Xc2Vb4N'].join('');
const opaque = ['f3a9', 'c2e1b7d4', '9a0e6f12', 'c4b8d3e5'].join('');
const cases = [`curl -H "Authorization: token ${gh}" https://api.github.com/user`, `Authorization: Bearer ${opaque}`, `Authorization: Basic ${Buffer.from('user:' + opaque).toString('base64')}`, `Authorization: ApiKey ${opaque}`, `Authorization: CustomScheme ${opaque}`, `{"headers":{"Authorization":"token ${gh}"}}`, 'curl -H "Authorization: token $(gh auth token)" https://api.github.com/user', 'Authorization: Bearer ${{ secrets.GITHUB_TOKEN }}', 'Contact someone@example.com, account 12345, login octocat', `User token: ${gh}. Next sentence`, `docker run --env TOKEN_SECRET=*** image`];
for (const c of cases) console.log(JSON.stringify(c), '\n   ->', JSON.stringify(sanitizeCredentialText(c, o)));
