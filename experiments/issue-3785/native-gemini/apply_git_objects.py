#!/usr/bin/env python3
"""Admit acknowledged native Git object graphs before checkpoint operations."""
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
    ('hive-gemini-git-configuration.mjs', '6da4109b58c0904e490ab3f1e525d1cb42759c4e24572febdea1d67729885451'),
):
    if hashlib.sha256((bundle / name).read_bytes()).hexdigest() != expected:
        raise SystemExit('Refusing changed prerequisite native Gemini Git helpers.')
if hashlib.sha256((bundle / 'chunk-DKZARV6U.js').read_bytes()).hexdigest() != 'a88db8a10a742aa697d71f2e33b9061d2082f6e9b4330b3d9bbefa54fa9616f3':
    raise SystemExit('Refusing changed native Gemini Git object input.')
target = bundle / 'hive-gemini-git-history.mjs'
original = target.read_bytes()
if hashlib.sha256(original).hexdigest() != 'f0573a298e7ebf4ced71dba4b3a90a4d2eac1ddf5be011a525b793530cf39e61':
    raise SystemExit('Refusing a changed native Gemini Git configuration helper.')
helper = bundle / 'hive-gemini-git-objects.mjs'
if helper.exists() or helper.is_symlink():
    raise SystemExit('Refusing an existing native Gemini Git objects helper.')
source = original.decode()


def replace(before, after):
    global source
    if source.count(before) != 1:
        raise SystemExit('Ambiguous native Git objects context; no files changed.')
    source = source.replace(before, after)


replace("fs.readdirSync(privateRoot).some", "nativeGitObjectNames(privateRoot, 2, refuse).some")
replace('function inspectObjects(context, synchronize = false) {', 'function inspectObjects(context, synchronize = false, required = []) {')
replace('''  let files = 0;
  let bytes = 0;
  for (const entry of fs.readdirSync(context.objects.anchor, { withFileTypes: true })) {''', '''  let files = 0;
  let bytes = 0;
  const objects = new Map();
  for (const name of nativeGitObjectNames(context.objects.anchor, 258, refuse)) {
    const entry = { name };''')
replace('const names = fs.readdirSync(parent.anchor);', 'const names = nativeGitObjectNames(parent.anchor, 10000 - files, refuse);')
replace('''        if (BigInt(length) !== before.size || hash(inflateSync(buffer.subarray(0, length), { maxOutputLength: 32 * 1024 * 1024 }), 'sha1') !== entry.name + name) throw refuse();''', '''        if (BigInt(length) !== before.size) throw refuse();
        const inflated = inflateSync(buffer.subarray(0, length), { maxOutputLength: 32 * 1024 * 1024 });
        if (hash(inflated, 'sha1') !== entry.name + name) throw refuse();
        objects.set(entry.name + name, nativeGitObjectMetadata(inflated, refuse));''')
replace('''  if (synchronize) fs.fsyncSync(context.objects.fd);
  current(context);''', '''  if (synchronize) fs.fsyncSync(context.objects.fd);
  assertNativeGitObjectGraph(objects, required, refuse);
  current(context);''')
replace('const count = inspectObjects(context);', 'const count = inspectObjects(context, false, previous);')
replace('inspectObjects(context, true);', 'inspectObjects(context, true, [...previous, actual]);')
source = "import { nativeGitObjectNames, nativeGitObjectMetadata, assertNativeGitObjectGraph } from './hive-gemini-git-objects.mjs';\n" + source
if '--check' in sys.argv[2:]:
    print('Pinned native Gemini Git object admission applies; no files changed.')
else:
    if target.is_symlink():
        target.unlink()
    target.write_text(source)
    helper.write_bytes((here / 'git_objects.mjs').read_bytes())
    print('Applied disposable native Gemini Git object admission; production is unchanged.')
print('Admitted native Git history SHA-256:', hashlib.sha256(source.encode()).hexdigest())
print('Native Git objects helper SHA-256:', hashlib.sha256((here / 'git_objects.mjs').read_bytes()).hexdigest())
