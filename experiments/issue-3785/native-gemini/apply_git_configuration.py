#!/usr/bin/env python3
"""Admit private native Git configuration before executing checkpoint children."""
import hashlib
import json
from pathlib import Path
import sys

here = Path(__file__).resolve().parent
package = Path(sys.argv[1]).resolve(strict=True)
if json.loads((package / 'package.json').read_text())['version'] != '0.65.0':
    raise SystemExit('Refusing an unpinned native Gemini package.')
bundle = package / 'bundle'
for name, expected in (
    ('hive-gemini-history.mjs', '586d39370a4344a1aaa46c81894f2c6239253a91cb84e3871288c2093c328e99'),
    ('hive-gemini-publication.mjs', '2e55f93d5075a6c9cc9d5b3c7e71f243accc8f72e955e038d0341cb8fed0bc00'),
    ('hive-gemini-shell-history.mjs', 'c1b5b1abca32643ae0674779fe21bcf5713795906b9f6aac0d57a0ce3774e2f0'),
    ('hive-gemini-tracker-history.mjs', '11e56b631ab984ad8bb7992586a9e6e8b0030fba5e47c1e9b0f2c4fb9497b2c1'),
    ('hive-gemini-tracker-transactions.mjs', 'c504c700a3c11e6d25777e8b495bfba043c729cd67a91fc476465379bb667fd9'),
    ('hive-gemini-git-lock.mjs', '6271784aa3773fc3a54056bf1ce8fd7b1f2da3a813e01537c47bcbc6d674c568'),
):
    if hashlib.sha256((bundle / name).read_bytes()).hexdigest() != expected:
        raise SystemExit('Refusing changed prerequisite native Gemini Git helpers.')
if hashlib.sha256((bundle / 'chunk-DKZARV6U.js').read_bytes()).hexdigest() != 'a88db8a10a742aa697d71f2e33b9061d2082f6e9b4330b3d9bbefa54fa9616f3':
    raise SystemExit('Refusing changed native Gemini Git configuration input.')
target = bundle / 'hive-gemini-git-history.mjs'
original = target.read_bytes()
if hashlib.sha256(original).hexdigest() != '7be869f6383b20eb21f944d9665268aa169e22ba6696f32337e9a21d52d94dcd':
    raise SystemExit('Refusing a changed native Gemini Git history helper.')
helper = bundle / 'hive-gemini-git-configuration.mjs'
if helper.exists() or helper.is_symlink():
    raise SystemExit('Refusing an existing native Gemini Git configuration helper.')
source = original.decode()


def replace(before, after):
    global source
    if source.count(before) != 1:
        raise SystemExit('Ambiguous native Git configuration context; no files changed.')
    source = source.replace(before, after)


replace('''function current(context) {
  if (failed''', '''function current(context) {
  assertNativeGeminiGitConfiguration(context, privateFile, refuse);
  if (failed''')
replace("'core.commitGraph': 'false'", "'core.commitGraph': 'false', 'core.logAllRefUpdates': 'false'")
replace("GIT_TERMINAL_PROMPT: '0'", "GIT_NO_REPLACE_OBJECTS: '1', GIT_TERMINAL_PROMPT: '0'")
replace('''        const result = await action();
        if (method''', '''        const result = await action();
        if (method === 'initialize') assertNativeGeminiGitConfiguration(context, privateFile, refuse, true);
        if (method''')
source = "import { assertNativeGeminiGitConfiguration } from './hive-gemini-git-configuration.mjs';\n" + source
if '--check' in sys.argv[2:]:
    print('Pinned native Gemini Git configuration admission applies; no files changed.')
else:
    if target.is_symlink():
        target.unlink()
    target.write_text(source)
    helper.write_bytes((here / 'git_configuration.mjs').read_bytes())
    print('Applied disposable native Gemini Git configuration admission; production is unchanged.')
print('Admitted native Git history SHA-256:', hashlib.sha256(source.encode()).hexdigest())
print('Native Git configuration helper SHA-256:', hashlib.sha256((here / 'git_configuration.mjs').read_bytes()).hexdigest())
