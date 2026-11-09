#!/usr/bin/env python3
"""Recover complete native plan journal/file updates from checked durable intent."""
import hashlib
import json
from pathlib import Path
import sys

here = Path(__file__).resolve().parent
package = Path(sys.argv[1]).resolve(strict=True)
assert json.loads((package / 'package.json').read_text())['version'] == '0.65.0'
bundle = package / 'bundle'
pins = {'chunk-DKZARV6U.js': '80152a26cf924992ac283a92e1b9b2252326cf6a417edc1c4b147088ca154733',
        'hive-gemini-history.mjs': '316d864e6ba63b15c6685b7da7f86f831652eedfbc0c1c62ed01edc619a31688',
        'hive-gemini-publication.mjs': '1f61f99308e939d86592866271a032709bf4fe20a4b389f5c4870c2a2e4aa422'}
for name, expected in pins.items():
    if hashlib.sha256((bundle / name).read_bytes()).hexdigest() != expected:
        raise SystemExit('Refusing changed native plan-transaction prerequisites.')
helper = 'hive-gemini-history.mjs'
sources = {name: (bundle / name).read_text() for name in pins if name != 'chunk-DKZARV6U.js'}


def replace(before, after):
    if sources[helper].count(before) != 1:
        raise SystemExit('Ambiguous native plan transaction context; no files changed.')
    sources[helper] = sources[helper].replace(before, after)


replace("!name.startsWith('.history-')) && parts.slice(0, -1)", "!name.startsWith('.history-') && !name.startsWith('.plan-')) && parts.slice(0, -1)")
replace('''    nativePlanDirectories.set(named, { temporary, scope, parent });
    readNativeGeminiPromptHistory(temporary);''', '''    const context = { temporary, scope, parent };
    nativePlanDirectories.set(named, context);
    locked(parent, current => {
      recoverNativeGeminiPlanTransaction(context, current);
      readNativeGeminiPromptHistory(temporary);
    });''')
replace('''    return locked(location.context.parent, () => {
      const plans = nativePlanRecords''', '''    return locked(location.context.parent, current => {
      recoverNativeGeminiPlanTransaction(location.context, current);
      const plans = nativePlanRecords''')
before = (here / 'plans_history.mjs').read_text().split('    locked(location.context.parent, current => {', 1)[1].split('\n    return true;', 1)[0]
replace('    locked(location.context.parent, current => {' + before, '''    locked(location.context.parent, current => {
      recoverNativeGeminiPlanTransaction(location.context, current);
      const records = readNativeGeminiPromptHistory(location.context.temporary);
      const plans = nativePlanRecords(records, location.context);
      const parent = directory(location.directories);
      const before = nativePlanSnapshot(location, parent, plans);
      publishNativeGeminiPlanTransaction(location, parent, before, content, records, current);
    });''')
sources[helper] += '\n\n' + (here / 'plan_transactions.mjs').read_text()
publication = 'hive-gemini-publication.mjs'
before = "return name.endsWith('.md') && !name.startsWith('.publish-') && !name.startsWith('.history-') && !/[\\\\/\\0\\r\\n]/u.test(name);"
assert sources[publication].count(before) == 1
sources[publication] = sources[publication].replace(before, "return (parts.length === 4 && name === '.plan-transaction.json') || (" + before.removeprefix('return ').removesuffix(';').replace("!name.startsWith('.history-')", "!name.startsWith('.history-') && !name.startsWith('.plan-')") + ');')
if '--check' in sys.argv[2:]:
    print('Pinned native Gemini plan transaction stage applies; no files changed.')
else:
    for name, source in sources.items():
        target = bundle / name
        if target.is_symlink():
            target.unlink()
        target.write_text(source)
    print('Applied disposable native Gemini plan transaction recovery; production is unchanged.')
for name, source in sources.items():
    print(hashlib.sha256(source.encode()).hexdigest(), name)
