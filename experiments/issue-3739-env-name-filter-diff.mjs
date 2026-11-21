// Compares Hive Mind's credential environment-name filter with the library's
// knownSecretsFromEnv default selection (issue #3740: remove duplicated rules).
// Names only; every value is a synthetic placeholder.
// Usage: node experiments/issue-3739-env-name-filter-diff.mjs
import { knownSecretsFromEnv } from '@link-foundation/sensitive-data-sanitizer';
import { KNOWN_LOCAL_TOKEN_ENV_VARS } from '../src/token-sanitization.lib.mjs';

const HIVE = /(?:API_?KEY|ACCOUNT_?KEY|CLIENT_?SECRET|CONSUMER_?SECRET|WEBHOOK_?SECRET|ACCESS_?TOKEN|REFRESH_?TOKEN|AUTH_?TOKEN|PASSWORD|PASSWD|PRIVATE_?KEY|SECRET|TOKEN|COOKIE|AUTH)$/i;
const names = [...KNOWN_LOCAL_TOKEN_ENV_VARS, 'MYTOKEN', 'GITHUBTOKEN', 'OPENAI_APIKEY', 'SESSION_COOKIE', 'AWS_SECRET_ACCESS_KEY', 'AWS_ACCESS_KEY_ID', 'DB_PASSWORD', 'PGPASSWORD', 'NPM_CONFIG__AUTH', 'BASIC_AUTH', 'GIT_AUTH_TRANSPORT', 'HIVE_MIND_ROUTER_AUTH_GUARD', 'AUTH_MODE', 'OAUTH', 'GOOGLE_APPLICATION_CREDENTIALS', 'MAX_TOKEN_COUNT', 'TOKEN_LIMIT', 'SSH_KEY_PATH', 'KEY_FILE', 'GITHUB_PAT', 'PAT', 'SECRET_NAME', 'TOKENIZERS_PARALLELISM', 'HIVE_MIND_SANITIZER_DEBUG'];
const env = Object.fromEntries(names.map(name => [name, `value-of-${name}`]));
const library = new Set(knownSecretsFromEnv(env).map(value => value.slice('value-of-'.length)));
for (const name of names) {
  const hive = HIVE.test(name);
  const lib = library.has(name);
  if (hive !== lib) console.log(`${name.padEnd(32)} hive=${hive} library=${lib}`);
}
