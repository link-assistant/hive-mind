#!/usr/bin/env python3
"""Patch the actual pinned native manager's credential reads, in a copy only.

The experiment does not implement the independent authority selector, refresh
coordination, every native writer or full-CLI request admission yet.
"""
import hashlib
import json
from pathlib import Path
import sys

PIN = "76d55ad14363fa0ceb0ce4ef0f24c85096a93c1b93a25e311273838b746b95b8"
root = Path(sys.argv[1]).resolve(strict=True)
if json.loads((root / "package.json").read_text())["version"] != "0.26.1":
    raise SystemExit("Refusing unpinned native Qwen package.")
target = root / "chunks/chunk-KZQDCUQR.js"
source = target.read_text()
if hashlib.sha256(source.encode()).hexdigest() != PIN:
    raise SystemExit("Refusing changed native Qwen token-manager source.")


def replace_between(start, end, replacement):
    global source
    if source.count(start) != 1 or source.count(end) != 1:
        raise SystemExit("Ambiguous native Qwen method; no files changed.")
    first = source.index(start)
    last = source.index(end, first + len(start))
    source = source[:first] + replacement + source[last:]


replace_between("async checkAndReloadIfNeeded(", "withTimeout(promise,", """
async checkAndReloadIfNeeded(qwenClient) {
  // Each caller must receive its own fresh result, even with another client
  // checking or refreshing. A promise or mtime cache is not disk authority.
  await this.performFileCheck(qwenClient, Date.now());
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
    const credentials = await readNativeQwenCredentials(this.getCredentialFilePath());
    if (qwenClient) qwenClient.setCredentials(credentials);
    this.memoryCache.credentials = credentials;
  } catch {
    this.updateCacheState(null, 0, 0);
    try { if (qwenClient) qwenClient.setCredentials({}); } catch {}
    throw new TokenManagerError("FILE_ACCESS_ERROR", "Qwen credential storage is unavailable or unsafe.");
  }
}
""")
source = 'import { readNativeQwenCredentials } from "./hive-read-credentials.mjs";\n' + source
helper = (Path(__file__).parent / "read_credentials.mjs").read_text()
helper_target = target.parent / "hive-read-credentials.mjs"
if helper_target.exists():
    raise SystemExit("Refusing an existing native Qwen experiment helper.")
if "--check" in sys.argv[2:]:
    print("Pinned native Qwen read patch applies; no files changed.")
else:
    helper_target.write_text(helper)
    target.write_text(source)
    print("Applied native Qwen read experiment; production is unchanged.")
