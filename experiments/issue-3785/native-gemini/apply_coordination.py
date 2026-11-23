#!/usr/bin/env python3
"""Coordinate inspected native writers after the exact Gemini read stage."""
import hashlib
import json
from pathlib import Path
import sys

PIN = "e7df0d9801b8ec39c3ed283a614c9ffc6399c00410418d2ed0e6ff86d79b57cd"
here = Path(__file__).resolve().parent
root = Path(sys.argv[1]).resolve(strict=True)
if json.loads((root / "package.json").read_text())["version"] != "0.65.0":
    raise SystemExit("Refusing an unpinned native Gemini package.")
target = root / "bundle/chunk-DKZARV6U.js"
source = target.read_text()
if hashlib.sha256(source.encode()).hexdigest() != PIN:
    raise SystemExit("Refusing changed native Gemini read-stage source.")
reader_target = target.parent / "hive-gemini-reads.mjs"
reader = reader_target.read_text()
expected = (here / "reads.mjs").read_text().replace("../native-qwen/read_credentials.mjs", "./hive-read-credentials.mjs")
if reader != expected:
    raise SystemExit("Refusing changed native Gemini read admission.")


def replace(value, before, after):
    if value.count(before) != 1:
        raise SystemExit("Ambiguous native Gemini writer context; no files changed.")
    return value.replace(before, after, 1)


source = replace(source, 'if (nativeGeminiSelected()) refuseNativeGeminiWriter();\n  const filePath', 'if (nativeGeminiSelected()) return publishNativeGeminiCredentials(credentials3);\n  const filePath')
# Cache and logout use distinct following statements in the pinned manager.
source = replace(source, 'if (nativeGeminiSelected()) refuseNativeGeminiWriter();\n  try {', 'if (nativeGeminiSelected()) { await clearNativeGeminiCredentials(); clearOauthClientCache(); return; }\n  try {')
source = replace(source, '  const client = await oauthClientPromises.get(authType);', '''  const pending = oauthClientPromises.get(authType);
  let client;
  try { client = await pending; }
  catch (error) {
    if (nativeGeminiSelected() && oauthClientPromises.get(authType) === pending) oauthClientPromises.delete(authType);
    throw error;
  }''')
source = replace(source,
    'return initializeNativeGeminiClient(createBaseOAuth2Client, Storage.getGlobalGeminiDir(), authType);',
    '''return initializeNativeGeminiClient(createBaseOAuth2Client, Storage.getGlobalGeminiDir(), authType, {
      interactive: config2.isInteractive(),
      accountFile: Storage.getGoogleAccountsPath(),
      onLogout: clearOauthClientCache,
      login: client => completeNativeGeminiLogin(client, authType, config2),
      onReady: async client => {
        if (!userAccountManager2.getCachedGoogleAccount()) await fetchAndCacheUserInfo(client);
        await triggerPostAuthCallbacks(client.credentials);
      },
    });''')
login_start = source.index('  const client = createBaseOAuth2Client();\n  if (authType === AuthType2.COMPUTE_ADC) {')
login_end = source.index('\nasync function getOauthClient(', login_start)
login_body = source[login_start + len('  const client = createBaseOAuth2Client();\n'):login_end]
source = source[:login_end] + '\nasync function completeNativeGeminiLogin(client, authType, config2) {\n' + login_body + source[login_end:]
first_oauth = source.index('var require_oauth2client2 = __commonJS({')
next_module = source.index('\nvar require_', first_oauth + 1)
oauth = source[first_oauth:next_module]
oauth = replace(oauth, '          authclient_1.AuthClient.setMethodName(opts, "refreshTokenNoCache");', '''          if (nativeGeminiSelected()) {
            opts.retry = false;
            opts.retryConfig = { retry: 0, noResponseRetries: 0 };
          }
          authclient_1.AuthClient.setMethodName(opts, "refreshTokenNoCache");''')
oauth = replace(oauth, '        authclient_1.AuthClient.setMethodName(opts, "getTokenAsync");', '''        if (nativeGeminiSelected()) {
          opts.retry = false;
          opts.retryConfig = { retry: 0, noResponseRetries: 0 };
        }
        authclient_1.AuthClient.setMethodName(opts, "getTokenAsync");''')
oauth = replace(oauth, '        authclient_1.AuthClient.setMethodName(opts, "revokeToken");', '''        if (nativeGeminiSelected()) {
          opts.retry = false;
          opts.retryConfig = { retry: 0, noResponseRetries: 0 };
        }
        authclient_1.AuthClient.setMethodName(opts, "revokeToken");''')
source = source[:first_oauth] + oauth + source[next_module:]
source = replace(source, '  async cacheGoogleAccount(email3) {', '''  async cacheGoogleAccount(email3, credentials3) {
    if (nativeGeminiSelected()) return cacheNativeGeminiAccount(email3, credentials3);''')
source = replace(source, '  getGoogleAccountsCachePath() {', '''  getGoogleAccountsCachePath() {
    if (nativeGeminiSelected()) return getNativeGeminiAccountsPath(Storage.getGoogleAccountsPath(), Storage.getOAuthCredsPath());''')
for signature in ['readAccountsSync(filePath)', 'async readAccounts(filePath)']:
    source = replace(source, '  ' + signature + ' {', '  ' + signature + ''' {
    if (nativeGeminiSelected()) {
      if (filePath !== this.getGoogleAccountsCachePath()) throw new Error("Gemini canonical account storage is unavailable or unsafe.");
      return readNativeGeminiAccounts(Storage.getGoogleAccountsPath(), Storage.getOAuthCredsPath());
    }''')
source = replace(source, '  getCachedGoogleAccount() {', '''  getCachedGoogleAccount() {
    if (nativeGeminiSelected()) return readNativeGeminiAccounts(Storage.getGoogleAccountsPath(), Storage.getOAuthCredsPath()).active;''')
source = replace(source, '  getLifetimeGoogleAccounts() {', '''  getLifetimeGoogleAccounts() {
    if (nativeGeminiSelected()) {
      const accounts = readNativeGeminiAccounts(Storage.getGoogleAccountsPath(), Storage.getOAuthCredsPath());
      return new Set([...accounts.old, ...(accounts.active ? [accounts.active] : [])]).size;
    }''')
source = replace(source, '  async clearCachedGoogleAccount() {', '''  async clearCachedGoogleAccount() {
    if (nativeGeminiSelected()) return clearNativeGeminiAccount();''')
source = replace(source, 'async function triggerPostAuthCallbacks(tokens) {', '''async function triggerPostAuthCallbacks(tokens) {
  if (nativeGeminiSelected()) return withNativeGeminiPostAuth(emitPostAuthCallbacks);
  return emitPostAuthCallbacks(tokens);
}
async function emitPostAuthCallbacks(tokens) {''')
source = replace(source, '    const response = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {', '''    const accountCredentials = nativeGeminiSelected() ? { ...client.credentials } : undefined;
    const response = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {''')
source = replace(source, 'await userAccountManager2.cacheGoogleAccount(userInfo2.email);', 'await userAccountManager2.cacheGoogleAccount(userInfo2.email, accountCredentials);')
source = 'import { publishNativeGeminiCredentials, clearNativeGeminiCredentials, withNativeGeminiPostAuth } from "./hive-gemini-writers.mjs";\nimport { getNativeGeminiAccountsPath, readNativeGeminiAccounts, cacheNativeGeminiAccount, clearNativeGeminiAccount } from "./hive-gemini-accounts.mjs";\n' + source
first = reader.index('    async function current() {')
last = reader.index("    for (const method of ['getAccessTokenAsync'", first)
reader = reader[:first] + '''    const coordinator = bindNativeGeminiWriters(client, {
      file: path.join(selected, 'oauth_creds.json'),
      accountFile,
      configurationDirectory,
      onReady,
      onLogout,
      rootIdentity: identity(initial),
      assertAdmission: async () => {
        admission();
        if (identity(await fs.lstat(selected, { bigint: true })) !== identity(initial) || client.apiKey || client.refreshHandler) throw refused();
      },
    });
    async function current() { await coordinator.current(); }
''' + reader[last:]
reader = replace(reader, "['refreshToken', 'refreshTokenNoCache', 'refreshAccessTokenAsync', 'getTokenAsync', 'revokeCredentialsAsync']", "[]")
reader = replace(reader, 'configurationDirectory, authType) {', 'configurationDirectory, authType, { interactive, login, onReady, onLogout, accountFile } = {}) {')
reader = replace(reader, '    await current();\n    await client.getTokenInfo', '''    try { await current(); }
    catch {
      if (!interactive || typeof login !== 'function' || !(await coordinator.canLogin())) throw refused();
      await login(client);
      await current();
      onReady = undefined;
    }
    await client.getTokenInfo''')
reader = replace(reader, '    admitted.add(client);', '    if (onReady) await onReady(client);\n    admitted.add(client);')
reader = 'import { bindNativeGeminiWriters } from "./hive-gemini-writers.mjs";\n' + reader
engine = (here.parent / "native-oauth-transaction.mjs").read_text()
if hashlib.sha256(engine.encode()).hexdigest() != "d8c3408738e965afbc53b8354dcab7745421a11f7744a119545931b61b88d174":
    raise SystemExit("Refusing changed inspected native OAuth transactions.")
if hashlib.sha256((target.parent / "hive-read-credentials.mjs").read_bytes()).hexdigest() != "c3556a57278413d39e0b2cf0b8a3de1fefc2e1b0cd6f4f489fb0a722bfc43672":
    raise SystemExit("Refusing changed inspected canonical credential reads.")
transaction = engine.replace('../../src/shared-auth-refresh-lock.lib.mjs', './hive-shared-refresh-lock.mjs')
lock = (here.parents[2] / "src/shared-auth-refresh-lock.lib.mjs").read_text()
if hashlib.sha256(lock.encode()).hexdigest() != '6271784aa3773fc3a54056bf1ce8fd7b1f2da3a813e01537c47bcbc6d674c568':
    raise SystemExit("Refusing changed inspected refresh locking.")
writers = (here / "writers.mjs").read_text().replace('../native-oauth-transaction.mjs', './hive-native-oauth-transaction.mjs').replace('../native-qwen/read_credentials.mjs', './hive-read-credentials.mjs').replace('./accounts.mjs', './hive-gemini-accounts.mjs')
outputs = {
    target: source,
    reader_target: reader,
    target.parent / "hive-gemini-writers.mjs": writers,
    target.parent / "hive-gemini-accounts.mjs": (here / "accounts.mjs").read_text(),
    target.parent / "hive-native-oauth-transaction.mjs": transaction,
    target.parent / "hive-shared-refresh-lock.mjs": lock,
}
for output in outputs:
    if output not in (target, reader_target) and output.exists():
        raise SystemExit("Refusing an existing native Gemini writer helper.")
if "--check" in sys.argv[2:]:
    print("Pinned native Gemini writer coordination applies; no files changed.")
else:
    for output, value in outputs.items():
        output.write_text(value)
    print("Applied native Gemini writer experiment; production remains unchanged.")
print("Native manager SHA-256:", hashlib.sha256(source.encode()).hexdigest())
