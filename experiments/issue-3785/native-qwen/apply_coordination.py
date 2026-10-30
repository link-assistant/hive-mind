#!/usr/bin/env python3
"""Apply the pinned writer/refresh experiment after the native read repair."""
import hashlib
import json
from pathlib import Path
import sys

PIN = "9fedccce4168eab09d86b58d0252f22a2aec7f0ac0e1342e45b8494cfc69e588"
LOCK_PIN = "6271784aa3773fc3a54056bf1ce8fd7b1f2da3a813e01537c47bcbc6d674c568"
here = Path(__file__).resolve().parent
root = Path(sys.argv[1]).resolve(strict=True)
if json.loads((root / "package.json").read_text())["version"] != "0.26.1":
    raise SystemExit("Refusing unpinned native Qwen package.")
target = root / "chunks/chunk-KZQDCUQR.js"
source = target.read_text()
if hashlib.sha256(source.encode()).hexdigest() != PIN:
    raise SystemExit("Refusing changed native Qwen read-patched source.")
lock = (here.parents[2] / "src/shared-auth-refresh-lock.lib.mjs").read_text()
if hashlib.sha256(lock.encode()).hexdigest() != LOCK_PIN:
    raise SystemExit("Refusing changed shared refresh-lock implementation.")


def replace_between(start, end, replacement):
    global source
    if source.count(start) != 1 or source.count(end) != 1:
        raise SystemExit("Ambiguous native Qwen method; no files changed.")
    first = source.index(start)
    last = source.index(end, first + len(start))
    source = source[:first] + replacement + source[last:]


def replace(before, after):
    global source
    if source.count(before) != 1:
        raise SystemExit("Ambiguous native Qwen call site; no files changed.")
    source = source.replace(before, after, 1)


replace_between("registerCleanupHandlers(){", "async getValidCredentials(", """
registerCleanupHandlers() {
  // Kernel descriptor ownership releases the stable lock. A non-owner must
  // never unlink either a live lock or evidence of an old unpatched owner.
}
""")
replace_between("async getValidCredentials(", "async checkAndReloadIfNeeded(", """
async getValidCredentials(qwenClient, forceRefresh = false) {
  try {
    return await this.performTokenRefresh(qwenClient, forceRefresh);
  } catch {
    this.updateCacheState(null, 0, 0);
    try { qwenClient.setCredentials({}); } catch {}
    throw new TokenManagerError("FILE_ACCESS_ERROR", "Qwen canonical authentication is unavailable or unsafe.");
  }
}
""")
replace_between("async performFileCheck(", "async performTokenRefresh(", """
async performFileCheck(qwenClient, checkTime) {
  await this.reloadCredentialsFromFile(qwenClient);
  this.memoryCache.lastCheck = checkTime;
}
async forceFileCheck(qwenClient) {
  await this.performFileCheck(qwenClient, Date.now());
}
async reloadCredentialsFromFile(qwenClient) {
  try {
    return await withNativeQwenTransaction(this.getCredentialFilePath(), async transaction => {
      const current = await transaction.snapshot();
      await transaction.reconcile(current);
      if (qwenClient) qwenClient.setCredentials(current.credentials);
      this.memoryCache.credentials = current.credentials;
    });
  } catch {
    this.updateCacheState(null, 0, 0);
    try { if (qwenClient) qwenClient.setCredentials({}); } catch {}
    throw new TokenManagerError("FILE_ACCESS_ERROR", "Qwen canonical authentication is unavailable or unsafe.");
  }
}
""")
replace_between("async performTokenRefresh(", "isTokenValid(credentials){", """
async performTokenRefresh(qwenClient, forceRefresh = false) {
  const file = this.getCredentialFilePath();
  const requested = await readNativeQwenCredentials(file);
  return withNativeQwenTransaction(file, async transaction => {
    const current = await transaction.snapshot();
    await transaction.reconcile(current);
    if (this.isTokenValid(current.credentials) &&
        (!forceRefresh || JSON.stringify(current.credentials) !== JSON.stringify(requested))) {
      qwenClient.setCredentials(current.credentials);
      this.memoryCache.credentials = current.credentials;
      return current.credentials;
    }
    await transaction.beginRefresh(current);
    qwenClient.setCredentials(current.credentials);
    const response = await qwenClient.refreshAccessToken();
    if (!response || isErrorResponse(response) || !response.access_token ||
        !Number.isFinite(response.expires_in) || response.expires_in <= 0) {
      throw new Error("Qwen canonical refresh was refused.");
    }
    const credentials = {
      access_token: response.access_token,
      token_type: response.token_type,
      refresh_token: response.refresh_token || current.credentials.refresh_token,
      resource_url: response.resource_url,
      expiry_date: Date.now() + response.expires_in * 1000,
    };
    const published = await transaction.write(credentials, current);
    qwenClient.setCredentials(published);
    this.memoryCache.credentials = published;
    return published;
  });
}
async saveCredentialsToFile(credentials) {
  const published = await withNativeQwenTransaction(this.getCredentialFilePath(), transaction => transaction.write(credentials));
  this.memoryCache.credentials = published;
}
""")
replace('return path.join(Storage.getGlobalQwenDir(),QWEN_CREDENTIAL_FILENAME)',
        'return nativeQwenCredentialPath(Storage.getGlobalQwenDir())')
replace('return path.join(Storage.getGlobalQwenDir(),QWEN_LOCK_FILENAME)',
        'return path.join(path.dirname(this.getCredentialFilePath()),".hive-mind-refresh.lock")')
replace_between("async acquireLock(", "updateCacheState(credentials,fileModTime,lastCheck){", """
async acquireLock() {
  throw new TokenManagerError("FILE_ACCESS_ERROR", "Use the canonical native transaction.");
}
async releaseLock() {}
""")
replace('async getAccessToken(){try{const credentials=await this.sharedManager.getValidCredentials(this);return{token:credentials.access_token}}catch(error){debugLogger2.warn("Failed to get access token from shared manager:",error);return{token:void 0}}}',
        'async getAccessToken(){const credentials=await this.sharedManager.getValidCredentials(this);return{token:credentials.access_token}}')
replace('async refreshAccessToken(){', '''async refreshAccessToken(){
  const file = nativeQwenCredentialPath(Storage.getGlobalQwenDir());
  if (!nativeQwenTransactionActive(file)) {
    const credentials = await this.sharedManager.getValidCredentials(this, true);
    return {...credentials, expires_in: Math.max(1, (credentials.expiry_date - Date.now()) / 1000)};
  }
''')
replace_between("async function cacheQwenCredentials(", "__name(cacheQwenCredentials,", """
async function cacheQwenCredentials(credentials, opts) {
  await withNativeQwenTransaction(getQwenCachedCredentialPath(), transaction => transaction.write(credentials), {signal: opts?.signal});
  SharedTokenManager.getInstance().clearCache();
}
""")
replace_between("async function clearQwenCredentials(", "__name(clearQwenCredentials,", """
async function clearQwenCredentials() {
  try {
    await withNativeQwenTransaction(getQwenCachedCredentialPath(), transaction => transaction.remove());
  } finally {
    SharedTokenManager.getInstance().clearCache();
  }
}
""")
replace('return path2.join(Storage.getGlobalQwenDir(),QWEN_CREDENTIAL_FILENAME2)',
        'return nativeQwenCredentialPath(Storage.getGlobalQwenDir())')
source = 'import { nativeQwenCredentialPath, nativeQwenTransactionActive, withNativeQwenTransaction } from "./hive-qwen-transaction.mjs";\n' + source
transaction = (here / "transaction.mjs").read_text().replace("../native-oauth-transaction.mjs", "./hive-native-oauth-transaction.mjs").replace("./read_credentials.mjs", "./hive-read-credentials.mjs")
engine = (here.parent / "native-oauth-transaction.mjs").read_text()
if hashlib.sha256(engine.encode()).hexdigest() != "bc3b3820a64324a7a388a729728f98217d28454a6e1263d6a2e384b0e3bb8959":
    raise SystemExit("Refusing changed inspected native OAuth transactions.")
if hashlib.sha256((target.parent / "hive-read-credentials.mjs").read_bytes()).hexdigest() != "c3556a57278413d39e0b2cf0b8a3de1fefc2e1b0cd6f4f489fb0a722bfc43672":
    raise SystemExit("Refusing changed inspected canonical credential reads.")
engine = engine.replace("../../src/shared-auth-refresh-lock.lib.mjs", "./hive-shared-refresh-lock.mjs")
outputs = {
    target: source,
    target.parent / "hive-qwen-transaction.mjs": transaction,
    target.parent / "hive-native-oauth-transaction.mjs": engine,
    target.parent / "hive-shared-refresh-lock.mjs": lock,
}
for output in outputs:
    if output != target and output.exists():
        raise SystemExit("Refusing an existing native Qwen coordination helper.")
if "--check" in sys.argv[2:]:
    print("Pinned native Qwen coordination patch applies; no files changed.")
else:
    for output, value in outputs.items():
        output.write_text(value)
    print("Applied native Qwen coordination experiment; production is unchanged.")
