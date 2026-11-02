#!/usr/bin/env python3
"""Apply exact-byte native Gemini read admission to a disposable package copy."""
import hashlib
import json
from pathlib import Path
import sys

PIN = "4d9cf6435503e5280ecb0f55078793531c8041fe435f60fa8dfce92317c8a28e"
READER_PIN = "c3556a57278413d39e0b2cf0b8a3de1fefc2e1b0cd6f4f489fb0a722bfc43672"
here = Path(__file__).resolve().parent
root = Path(sys.argv[1]).resolve(strict=True)
if json.loads((root / "package.json").read_text())["version"] != "0.65.0":
    raise SystemExit("Refusing an unpinned native Gemini package.")
target = root / "bundle/chunk-DKZARV6U.js"
source = target.read_text()
if hashlib.sha256(source.encode()).hexdigest() != PIN:
    raise SystemExit("Refusing changed native Gemini manager source.")
reader = (here.parent / "native-qwen/read_credentials.mjs").read_text()
if hashlib.sha256(reader.encode()).hexdigest() != READER_PIN:
    raise SystemExit("Refusing a changed inspected credential reader.")


def replace(before, after):
    global source
    if source.count(before) != 1:
        raise SystemExit("Ambiguous native Gemini method; no files changed.")
    source = source.replace(before, after, 1)


replace('async function initOauthClient(authType, config2) {', '''async function initOauthClient(authType, config2) {
  if (nativeGeminiSelected()) {
    return initializeNativeGeminiClient(createBaseOAuth2Client, Storage.getGlobalGeminiDir(), authType);
  }''')
replace('  return oauthClientPromises.get(authType);', '''  const client = await oauthClientPromises.get(authType);
  if (nativeGeminiSelected()) await validateNativeGeminiClient(client);
  return client;''')
replace('async function cacheCredentials(credentials3) {', '''async function cacheCredentials(credentials3) {
  if (nativeGeminiSelected()) refuseNativeGeminiWriter();''')
replace('async function clearCachedCredentialFile() {', '''async function clearCachedCredentialFile() {
  if (nativeGeminiSelected()) refuseNativeGeminiWriter();''')
source = 'import { nativeGeminiSelected, initializeNativeGeminiClient, validateNativeGeminiClient, refuseNativeGeminiWriter } from "./hive-gemini-reads.mjs";\n' + source
helper = (here / "reads.mjs").read_text().replace("../native-qwen/read_credentials.mjs", "./hive-read-credentials.mjs")
outputs = {
    target: source,
    target.parent / "hive-gemini-reads.mjs": helper,
    target.parent / "hive-read-credentials.mjs": reader,
}
for output in outputs:
    if output != target and output.exists():
        raise SystemExit("Refusing an existing native Gemini experiment helper.")
if "--check" in sys.argv[2:]:
    print("Pinned native Gemini read experiment applies; no files changed.")
else:
    for output, value in outputs.items():
        output.write_text(value)
    print("Applied native Gemini read experiment; production is unchanged.")
print("Native manager SHA-256:", hashlib.sha256(source.encode()).hexdigest())
