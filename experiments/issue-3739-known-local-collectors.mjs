// Issue #3740: compares Hive Mind's known-local-token collectors with the
// library's (knownSecretsFromGitHubConfig, knownSecretsFromGitHubAuth). Prints
// counts and prefixes only, never a value.
// Usage: node experiments/issue-3739-known-local-collectors.mjs
import { knownSecretsFromGitHubAuth, knownSecretsFromGitHubConfig } from '@link-foundation/sensitive-data-sanitizer';
import { getGitHubTokensFromCommand, getGitHubTokensFromFiles } from '../src/token-sanitization.lib.mjs';

const describe = values => `${values.length} value(s) ${values.map(value => `${value.slice(0, 4)}…(${value.length})`).join(', ')}`;
const attempt = async fn => {
  try {
    return describe(await fn());
  } catch (error) {
    return `throws ${error.code || error.message}`;
  }
};
console.log(`hive  hosts.yml:      ${await attempt(getGitHubTokensFromFiles)}`);
console.log(`hive  gh auth status: ${await attempt(getGitHubTokensFromCommand)}`);
console.log(`lib   hosts.yml:      ${await attempt(() => knownSecretsFromGitHubConfig())}`);
console.log(`lib   gh auth token:  ${await attempt(() => knownSecretsFromGitHubAuth())}`);
