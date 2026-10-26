#!/usr/bin/env python3
"""Refuse unimplemented native provider authorities in the OAuth experiment."""
import hashlib
import json
from pathlib import Path
import sys

root = Path(sys.argv[1]).resolve(strict=True)
if json.loads((root / "package.json").read_text())["version"] != "0.26.1":
    raise SystemExit("Refusing unpinned native Qwen package.")
target = root / "chunks/chunk-IZBWWW2B.js"
source = target.read_text()
if hashlib.sha256(source.encode()).hexdigest() != "6ecd4c0406b7f66a8f8bcea6865644a72f7e2b5cfb6842006fb89db1ebab366f":
    raise SystemExit("Refusing changed native Qwen provider source.")


def replace(before, after):
    global source
    if source.count(before) != 1:
        raise SystemExit("Ambiguous native Qwen provider context; no files changed.")
    source = source.replace(before, after, 1)


replace("async function createContentGenerator(generatorConfig,config,isInitialAuth){", """
function assertCanonicalQwenProvider(generatorConfig) {
  if (process.env.QWEN_AUTH_HOME === undefined) return;
  // This experiment implements the native OAuth file protocol only. API keys,
  // ADC, custom headers, proxies and alternate endpoints need their own shared
  // authority contracts before they can participate. Keep no-selector behavior.
  const overrides = ["apiKey", "apiKeyEnvKey", "baseUrl", "proxy", "customHeaders", "reasoningRouteBaseUrl"];
  if (generatorConfig.authType !== "qwen-oauth" ||
      overrides.some(key => generatorConfig[key] !== undefined && generatorConfig[key] !== null)) {
    throw new Error("Canonical Qwen authentication does not support this provider authority.");
  }
}
async function createContentGenerator(generatorConfig,config,isInitialAuth) {
  assertCanonicalQwenProvider(generatorConfig);
""")
replace("constructor(loader){this.loader=loader}", "constructor(loader,admit){this.loader=loader;this.admit=admit}")
replace("getGenerator(){this.generatorPromise", "getGenerator(){this.admit();this.generatorPromise")
replace('throw wrapProviderLoadError(error,authType)}})}__name(createContentGenerator,',
        'throw wrapProviderLoadError(error,authType)}},()=>assertCanonicalQwenProvider(generatorConfig))}__name(createContentGenerator,')
if "--check" in sys.argv[2:]:
    print("Pinned native Qwen provider admission patch applies; no files changed.")
else:
    target.write_text(source)
    print("Applied native Qwen provider admission experiment; production is unchanged.")
