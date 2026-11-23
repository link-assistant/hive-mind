#!/usr/bin/env python3
"""Bind the final native Gemini adapter to launcher-admitted storage identities."""
import hashlib
import json
from pathlib import Path
import sys

package = Path(sys.argv[1]).resolve(strict=True)
assert json.loads((package / 'package.json').read_text())['version'] == '0.65.0'
bundle = package / 'bundle'
pins = {
    'hive-gemini-reads.mjs': 'cc0e6fafbdafe16ca23d9d31de3338f58b931f17b85e330053431e23d3b87edb',
    'hive-gemini-accounts.mjs': 'a34d60e457b3459680ed65b7b08e5e9288efdf554d32e93787ef5e760af80c9d',
    'hive-gemini-history.mjs': 'd522f9e84bffe3d7c9323596f3aa8914bd2ce74e73ff2be3233e6aff6b8729da',
    'hive-gemini-admission.mjs': '39288c41c6bfb09c9150efeb383dc25001dccd14417d2a949eaf762887bb5373',
    'hive-gemini-publication.mjs': '3b2b4dbc2296e6da81d314879e466f100f211579ebee13a63a74d9129bae28d8',
}
sources = {}
for name, expected in pins.items():
    target = bundle / name
    if target.is_symlink() or hashlib.sha256(target.read_bytes()).hexdigest() != expected:
        raise SystemExit('Refusing changed native Gemini inherited-identity prerequisites.')
    sources[name] = target.read_text()


def replace(name, before, after):
    if sources[name].count(before) != 1:
        raise SystemExit('Ambiguous native Gemini identity context; no files changed.')
    sources[name] = sources[name].replace(before, after, 1)


replace('hive-gemini-reads.mjs',
        'export const nativeGeminiSelected = () => process.env.GEMINI_AUTH_HOME !== undefined;',
        "export const nativeGeminiSelected = () => nativeGeminiStorageSelected('auth');")
replace('hive-gemini-reads.mjs', '    function admission() {',
        "    function admission() {\n      assertNativeGeminiStorageIdentity('auth');")
replace('hive-gemini-accounts.mjs', 'function context(privateFile, privateCredentialFile) {\n  try {',
        "function context(privateFile, privateCredentialFile) {\n  try {\n    assertNativeGeminiStorageIdentity('auth');")
replace('hive-gemini-history.mjs',
        '  return authority !== undefined || process.env.GEMINI_HISTORY_HOME !== undefined;',
        "  return authority !== undefined || nativeGeminiStorageSelected('history');")
replace('hive-gemini-history.mjs', "    if (failed || process.platform !== 'linux') throw refuse();",
        "    if (failed || process.platform !== 'linux') throw refuse();\n    assertNativeGeminiStorageIdentity('history');")
replace('hive-gemini-admission.mjs', 'export function assertNativeGeminiAuthority(content, configuration) {\n  assertNativeGeminiHistoryCurrent();\n  try {',
        "export function assertNativeGeminiAuthority(content, configuration) {\n  assertNativeGeminiHistoryCurrent();\n  try {\n    if (!nativeGeminiStorageSelected('auth')) return;\n    assertNativeGeminiStorageIdentity('auth');")

helper = bundle / 'hive-gemini-storage-identity.mjs'
if helper.exists() or helper.is_symlink():
    raise SystemExit('Refusing an existing native Gemini inherited-identity helper.')
outputs = {helper: Path(__file__).with_name('storage_identity.mjs').read_text()}
for name in pins:
    if name == 'hive-gemini-publication.mjs':
        continue
    imported = 'assertNativeGeminiStorageIdentity'
    if name != 'hive-gemini-accounts.mjs':
        imported += ', nativeGeminiStorageSelected'
    outputs[bundle / name] = 'import { ' + imported + ' } from "./hive-gemini-storage-identity.mjs";\n' + sources[name]
if '--check' in sys.argv[2:]:
    print('Pinned native inherited-identity stage applies; no files changed.')
else:
    for target, source in outputs.items():
        target.write_text(source)
    print('Applied native inherited storage identities to the disposable package.')
for target, source in outputs.items():
    print(hashlib.sha256(source.encode()).hexdigest(), target.name)
