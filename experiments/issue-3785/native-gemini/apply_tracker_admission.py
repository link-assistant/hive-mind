#!/usr/bin/env python3
"""Admit pinned native tracker records before native configuration discovery."""
import hashlib
import json
from pathlib import Path
import sys

here = Path(__file__).resolve().parent
package = Path(sys.argv[1]).resolve(strict=True)
if json.loads((package / 'package.json').read_text())['version'] != '0.65.0':
    raise SystemExit('Refusing an unpinned native Gemini package.')
target = package / 'bundle/chunk-DKZARV6U.js'
original = target.read_bytes()
if hashlib.sha256(original).hexdigest() != '3442803794891386eed95dc0fdf32a41aad77e7212180205e2470d49c4c10413':
    raise SystemExit('Refusing changed native Gemini tracker admission input.')
for local, installed in (('history.mjs', 'hive-gemini-history.mjs'), ('tracker_history.mjs', 'hive-gemini-tracker-history.mjs')):
    if (target.parent / installed).read_bytes() != (here / local).read_bytes():
        raise SystemExit('Refusing different native Gemini history helpers.')
source = original.decode()
before = '''  async _initialize() {
    await this.storage.initialize();
    ragLogger.initialize(this.storage.getProjectTempLogsDir());'''
after = '''  async _initialize() {
    await this.storage.initialize();
    if (nativeGeminiHistorySelected() && this.isTrackerEnabled()) {
      await this.getTrackerService().ensureInitialized();
    }
    ragLogger.initialize(this.storage.getProjectTempLogsDir());'''
if source.count(before) != 1:
    raise SystemExit('Ambiguous native tracker admission context; no files changed.')
source = source.replace(before, after)
if '--check' in sys.argv[2:]:
    print('Pinned native Gemini tracker startup admission applies; no files changed.')
else:
    if target.is_symlink():
        target.unlink()
    target.write_text(source)
    print('Applied disposable native Gemini tracker startup admission; production is unchanged.')
print('Admitted native tracker manager SHA-256:', hashlib.sha256(source.encode()).hexdigest())
