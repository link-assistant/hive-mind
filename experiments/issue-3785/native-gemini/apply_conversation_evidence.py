#!/usr/bin/env python3
"""Retain the observed byte prefix and inode across live conversation operations."""
import hashlib
import json
from pathlib import Path
import sys

package = Path(sys.argv[1]).resolve(strict=True)
if json.loads((package / 'package.json').read_text())['version'] != '0.65.0':
    raise SystemExit('Refusing an unpinned native Gemini package.')
bundle = package / 'bundle'
pins = {
    'chunk-DKZARV6U.js': '13f2fce9a55408b50001683d440f791a1d21cdcc3c22799f8832edad4a1ef769',
    'hive-gemini-history.mjs': '216f492a7687f3126f8cd060976656c232fcbaa057a90e3bc042c9054c8933ed',
}
for name, expected in pins.items():
    if hashlib.sha256((bundle / name).read_bytes()).hexdigest() != expected:
        raise SystemExit('Refusing changed native Gemini conversation-evidence prerequisites.')
target = bundle / 'hive-gemini-history.mjs'
source = target.read_text()


def replace(before, after):
    global source
    if source.count(before) != 1:
        raise SystemExit('Ambiguous native conversation-evidence context; no files changed.')
    source = source.replace(before, after)


replace('const writerLeases = new Map();', 'const writerLeases = new Map();\nconst conversationEvidence = new Map();')
replace('export function readNativeGeminiConversation(file, importing = false) {', '''function admitConversationEvidence(location, content, reset = false) {
  const bytes = content === null ? Buffer.alloc(0) : Buffer.from(content);
  const info = checkedFile(location, content === null);
  const currentIdentity = info === null ? null : identity(info);
  if (info !== null && info.size !== BigInt(bytes.length)) throw refuse();
  const previous = conversationEvidence.get(location.key);
  if (previous && !reset) {
    if (previous.identity !== null && currentIdentity !== previous.identity || bytes.length < previous.length || digest(bytes.subarray(0, previous.length)) !== previous.digest) throw refuse();
  }
  if (!previous && conversationEvidence.size >= 4096) throw refuse();
  conversationEvidence.set(location.key, { identity: currentIdentity, length: bytes.length, digest: digest(bytes) });
}

export function readNativeGeminiConversation(file, importing = false) {''')
replace('''      validateRecords(content, location.name);
      observed.set(location.key, content === null ? null : digest(content));''', '''      validateRecords(content, location.name);
      admitConversationEvidence(location, content);
      observed.set(location.key, content === null ? null : digest(content));''')
replace('''      validateRecords(previous, location.name);
      if (previous === null && observed.get(location.key)) throw refuse();''', '''      validateRecords(previous, location.name);
      admitConversationEvidence(location, previous);
      if (previous === null && observed.get(location.key)) throw refuse();''')
replace('''      observed.set(location.key, digest(snapshot(location)));''', '''      const acknowledged = snapshot(location);
      admitConversationEvidence(location, acknowledged);
      observed.set(location.key, digest(acknowledged));''')
replace('''      const generation = previous === null ? null : digest(previous);
      if (generation !== (observed.get(location.key) ?? null)) throw refuse();''', '''      const generation = previous === null ? null : digest(previous);
      admitConversationEvidence(location, previous);
      if (generation !== (observed.get(location.key) ?? null)) throw refuse();''')
# Native rewrites deliberately preserve the old complete generation before their
# atomic replacement. Only this acknowledged native path resets its inode/prefix.
replace('''      publish(location.parent, location.name, content, current, previous !== null);
      observed.set(location.key, digest(content));''', '''      publish(location.parent, location.name, content, current, previous !== null);
      admitConversationEvidence(location, content, true);
      observed.set(location.key, digest(content));''')
replace('''        validateRecords(previous, location.name);
        if (!observed.has(location.key)''', '''        validateRecords(previous, location.name);
        admitConversationEvidence(location, previous);
        if (!observed.has(location.key)''')
replace('''        observed.set(location.key, null);
        current();''', '''        observed.set(location.key, null);
        conversationEvidence.delete(location.key);
        current();''')
replace('''        validateRecords(content, source.name);
        if (!observed.has(source.key)''', '''        validateRecords(content, source.name);
        admitConversationEvidence(source, content);
        if (!observed.has(source.key)''')
replace('''        observed.set(destination.key, digest(content));
        return destination.target;''', '''        admitConversationEvidence(destination, content, true);
        observed.set(destination.key, digest(content));
        return destination.target;''')
if '--check' in sys.argv[2:]:
    print('Pinned native Gemini retained conversation evidence applies; no files changed.')
else:
    if target.is_symlink():
        target.unlink()
    target.write_text(source)
    print('Applied disposable native Gemini retained conversation evidence; production is unchanged.')
print(hashlib.sha256(source.encode()).hexdigest(), target.name)
