#!/usr/bin/env python3
"""Preserve actual native tracker validation reads through checked publication."""
import hashlib
import json
from pathlib import Path
import sys

here = Path(__file__).resolve().parent
package = Path(sys.argv[1]).resolve(strict=True)
if json.loads((package / 'package.json').read_text())['version'] != '0.65.0':
    raise SystemExit('Refusing an unpinned native Gemini package.')
bundle = package / 'bundle'
target = bundle / 'chunk-DKZARV6U.js'
original = target.read_bytes()
if hashlib.sha256(original).hexdigest() != 'b1b2ad9594865d2b60aee3d1b6cbf1a8d2bb2e7d72946124f9a25bc3c2808608':
    raise SystemExit('Refusing changed native Gemini tracker coordination input.')
history = bundle / 'hive-gemini-tracker-history.mjs'
if history.read_bytes() != (here / 'tracker_history.mjs').read_bytes():
    raise SystemExit('Refusing a different native Gemini tracker helper.')
helper = bundle / 'hive-gemini-tracker-transactions.mjs'
if helper.exists() or helper.is_symlink():
    raise SystemExit('Refusing an existing native Gemini tracker transaction helper.')
source = original.decode()
data = history.read_text()


def replace(text, before, after):
    if text.count(before) != 1:
        raise SystemExit('Ambiguous native tracker coordination context; no files changed.')
    return text.replace(before, after)


for name, parameters in (('createTask', 'taskData'), ('updateTask', 'id, updates')):
    before = f'  async {name}({parameters}) {{\n'
    after = f'''  async {name}({parameters}) {{
    return nativeGeminiTrackerOperation(this, async () => {{
'''
    source = replace(source, before, after)
for before in ('    await this.saveTask(task, void 0, true);\n    return task;\n  }', '    await this.saveTask(updatedTask, task);\n    return updatedTask;\n  }'):
    source = replace(source, before, before[:-3] + '    });\n  }')
source = 'import { nativeGeminiTrackerOperation } from "./hive-gemini-tracker-transactions.mjs";\n' + source
data = replace(data, '    const item = tasks.get(id);\n    if (!item)', '    const item = tasks.get(id);\n    observeNativeGeminiTracker(service, id, item?.revision);\n    if (!item)')
data = replace(data, '    return [...tasks.values()].map(item => {', '    return [...tasks.values()].map(item => {\n      observeNativeGeminiTracker(service, item.task.id, item.revision);')
data = replace(data, '      const current = tasks(records, context, schema).get(task.id);', '      const all = tasks(records, context, schema);\n      assertNativeGeminiTrackerObservations(service, all);\n      const current = all.get(task.id);')
data = "import { observeNativeGeminiTracker, assertNativeGeminiTrackerObservations } from './hive-gemini-tracker-transactions.mjs';\n" + data
if '--check' in sys.argv[2:]:
    print('Pinned native Gemini tracker validation coordination applies; no files changed.')
else:
    for file in (target, history):
        if file.is_symlink():
            file.unlink()
    target.write_text(source)
    history.write_text(data)
    helper.write_text((here / 'tracker_transactions.mjs').read_text())
    print('Applied disposable native Gemini tracker coordination; production is unchanged.')
print('Coordinated native tracker manager SHA-256:', hashlib.sha256(source.encode()).hexdigest())
print('Coordinated native tracker history SHA-256:', hashlib.sha256(data.encode()).hexdigest())
print('Native tracker transaction helper SHA-256:', hashlib.sha256((here / 'tracker_transactions.mjs').read_bytes()).hexdigest())
