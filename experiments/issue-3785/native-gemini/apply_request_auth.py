#!/usr/bin/env python3
"""Admit selected authority at exact native config, constructor and dispatch sites."""
import hashlib
import json
from pathlib import Path
import sys

PIN = "d7770e02fce0af146f78d6f509c83c53de8f0a5eb2933d6956707291ff3a8c9d"
here = Path(__file__).resolve().parent
root = Path(sys.argv[1]).resolve(strict=True)
if json.loads((root / "package.json").read_text())["version"] != "0.65.0":
    raise SystemExit("Refusing an unpinned native Gemini package.")
target = root / "bundle/chunk-DKZARV6U.js"
source = target.read_text()
if hashlib.sha256(source.encode()).hexdigest() != PIN:
    raise SystemExit("Refusing changed native Gemini coordinated source.")
reader_target = target.parent / "hive-gemini-reads.mjs"
reader = reader_target.read_text()
if hashlib.sha256(reader.encode()).hexdigest() != "da9795ea711dbe365a3d13d5d15a86ef60a795981c006ccde6de097d5a6ffc8f":
    raise SystemExit("Refusing changed native Gemini coordinated reads.")
if hashlib.sha256((target.parent / "hive-gemini-writers.mjs").read_bytes()).hexdigest() != "6e2f10d652d8cae21e0986c82a7302296ba84ad6a21f44cf117ce60cb99b0b40":
    raise SystemExit("Refusing changed native Gemini coordinated writers.")


def replace(value, before, after):
    if value.count(before) != 1:
        raise SystemExit("Ambiguous native Gemini admission context; no files changed.")
    return value.replace(before, after, 1)


for signature, assertion in [
    ('async function createContentGeneratorConfig(config2, authType, apiKey, baseUrl, customHeaders, vertexAiRouting) {', 'assertNativeGeminiAuthority({ authType, apiKey, baseUrl, customHeaders }, config2);'),
    ('async function createContentGenerator(config2, gcConfig, sessionId) {', 'assertNativeGeminiAuthority(config2, gcConfig);'),
    ('async function createCodeAssistContentGenerator(httpOptions, authType, config2, sessionId) {', 'assertNativeGeminiAuthority({ authType, customHeaders: httpOptions?.headers }, config2);'),
    ('async function getOauthClient(authType, config2) {', 'assertNativeGeminiAuthority({ authType }, config2);'),
    ('  constructor(client, projectId, httpOptions = {}, sessionId, userTier, userTierName, paidTier, config2) {', 'assertNativeGeminiAuthority({ authType: "oauth-personal", customHeaders: httpOptions?.headers }, config2);'),
]:
    source = replace(source, signature, signature + '\n  ' + assertion)
for signature, target_url in [
    ('  async requestPost(method, req, signal, retryDelay = 100) {', 'this.getMethodUrl(method)'),
    ('  async makeGetRequest(url3, signal) {', 'url3'),
    ('  async requestStreamingPost(method, req, signal) {', 'this.getMethodUrl(method)'),
]:
    source = replace(source, signature, signature + '\n    await validateNativeGeminiRequest(this.client, this.httpOptions, this.config, ' + target_url + ');')
source = replace(source, '  getBaseUrl() {\n    const endpoint = process.env["CODE_ASSIST_ENDPOINT"]', '''  getBaseUrl() {
    assertNativeGeminiAuthority({ authType: "oauth-personal", customHeaders: this.httpOptions?.headers }, this.config);
    const endpoint = process.env["CODE_ASSIST_ENDPOINT"]''')
source = 'import { assertNativeGeminiAuthority, validateNativeGeminiRequest } from "./hive-gemini-admission.mjs";\n' + source
reader = replace(reader, '    function admission() {', '''    function admission() {
      assertNativeGeminiAuthority({ authType });''')
reader = 'import { assertNativeGeminiAuthority } from "./hive-gemini-admission.mjs";\n' + reader
outputs = {
    target: source,
    reader_target: reader,
    target.parent / "hive-gemini-admission.mjs": (here / "admission.mjs").read_text().replace("'./reads.mjs'", "'./hive-gemini-reads.mjs'"),
}
if (target.parent / "hive-gemini-admission.mjs").exists():
    raise SystemExit("Refusing an existing native Gemini admission helper.")
if "--check" in sys.argv[2:]:
    print("Pinned native Gemini constructor/request admission applies; no files changed.")
else:
    for output, value in outputs.items():
        output.write_text(value)
    print("Applied native Gemini constructor/request experiment; production is unchanged.")
print("Native manager SHA-256:", hashlib.sha256(source.encode()).hexdigest())
