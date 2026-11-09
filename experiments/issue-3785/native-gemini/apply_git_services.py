#!/usr/bin/env python3
"""Reuse an admitted native Git repository across actual UI service instances."""
import hashlib
import json
from pathlib import Path
import sys

package = Path(sys.argv[1]).resolve(strict=True)
if json.loads((package / 'package.json').read_text())['version'] != '0.65.0':
    raise SystemExit('Refusing an unpinned native Gemini package.')
bundle = package / 'bundle'
pins = {
    'chunk-DKZARV6U.js': 'a88db8a10a742aa697d71f2e33b9061d2082f6e9b4330b3d9bbefa54fa9616f3',
    'hive-gemini-git-history.mjs': 'bad099a4e348abaf08d6f1295af6febc709b2c97a830cd048664a59dbab55e83',
    'hive-gemini-git-configuration.mjs': '6da4109b58c0904e490ab3f1e525d1cb42759c4e24572febdea1d67729885451',
    'hive-gemini-git-objects.mjs': '22bb570da1e211791e3bc6a6eeefe46635fd63ba6df4cc87320978b8de45bd9f',
    'hive-gemini-history.mjs': '586d39370a4344a1aaa46c81894f2c6239253a91cb84e3871288c2093c328e99',
    'hive-gemini-publication.mjs': '2e55f93d5075a6c9cc9d5b3c7e71f243accc8f72e955e038d0341cb8fed0bc00',
    'hive-gemini-git-lock.mjs': '6271784aa3773fc3a54056bf1ce8fd7b1f2da3a813e01537c47bcbc6d674c568',
}
for name, expected in pins.items():
    if hashlib.sha256((bundle / name).read_bytes()).hexdigest() != expected:
        raise SystemExit('Refusing changed native Gemini Git service prerequisites.')
sources = {name: (bundle / name).read_text() for name in (
    'hive-gemini-git-history.mjs', 'hive-gemini-git-configuration.mjs')}


def replace(name, before, after):
    if sources[name].count(before) != 1:
        raise SystemExit('Ambiguous native Git service context; no files changed.')
    sources[name] = sources[name].replace(before, after)


history = 'hive-gemini-git-history.mjs'
configuration = 'hive-gemini-git-configuration.mjs'
replace(history, 'const services = new WeakMap();',
        'const services = new WeakMap();\nconst repositories = new Map();')
replace(history, '''  const privateRoot = storage.getHistoryDir();
  if (privateRoot === root''', '''  const privateRoot = storage.getHistoryDir();
  const admitted = repositories.get(privateRoot);
  if (admitted) {
    current(admitted);
    if (!admitted.initialized || admitted.project !== project || admitted.temporary !== temporary || admitted.root !== root) throw refuse();
    context = { ...admitted, service, storage, repository: admitted.repository ?? admitted };
    services.set(service, context);
    current(context);
    return context;
  }
  if (privateRoot === root''')
replace(history, '''        const result = await action();''', '''        const result = method === 'initialize' && context.initialized ? undefined : await action();''')
replace(history, '''        context.initialized = true;
        current(context);''', '''        context.initialized = true;
        repositories.set(context.privateRoot, context.repository ?? context);
        current(context);''')
replace(configuration, 'const previous = bindings.get(context);',
        'const key = context.repository ?? context;\n  const previous = bindings.get(key);')
replace(configuration, 'if (!previous) bindings.set(context,', 'if (!previous) bindings.set(key,')
if '--check' in sys.argv[2:]:
    print('Pinned native Gemini Git service reuse applies; no files changed.')
else:
    for name, source in sources.items():
        target = bundle / name
        if target.is_symlink():
            target.unlink()
        target.write_text(source)
    print('Applied disposable native Gemini Git service reuse; production is unchanged.')
for name, source in sources.items():
    print(hashlib.sha256(source.encode()).hexdigest(), name)
