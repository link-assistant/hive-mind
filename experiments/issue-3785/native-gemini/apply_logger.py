#!/usr/bin/env python3
"""Coordinate inspected native Logger prompt history and named checkpoints."""
import hashlib
import json
from pathlib import Path
import sys

package = Path(sys.argv[1]).resolve(strict=True)
if json.loads((package / 'package.json').read_text())['version'] != '0.65.0':
    raise SystemExit('Refusing an unpinned native Gemini package.')
bundle = package / 'bundle'
target = bundle / 'chunk-DKZARV6U.js'
original = target.read_bytes()
if hashlib.sha256(original).hexdigest() != '236c3faf39cbe2a022409be5ee3ee3147ac1686d146336d0126f6e23f0b465b2':
    raise SystemExit('Refusing changed native Gemini Logger input.')
if (bundle / 'hive-gemini-history.mjs').read_bytes() != (Path(__file__).parent / 'history.mjs').read_bytes():
    raise SystemExit('Refusing a different native Gemini history helper.')
source = original.decode()


def replace(before, after):
    global source
    if source.count(before) != 1:
        raise SystemExit('Ambiguous native Logger context; no files changed.')
    source = source.replace(before, after)


replace('''  async _readLogFile() {
    if (!this.logFilePath)''', '''  async _readLogFile() {
    if (nativeGeminiHistorySelected()) return readNativeGeminiPromptHistory(this.storage.getProjectTempDir());
    if (!this.logFilePath)''')
replace('''  async initialize() {
    if (this.initialized) {
      return;
    }
    await this.storage.initialize();''', '''  async initialize() {
    if (this.initialized) {
      if (nativeGeminiHistorySelected()) this.logs = await this._readLogFile();
      return;
    }
    await this.storage.initialize();''')
replace('''    this.logFilePath = path100.join(this.geminiDir, LOG_FILE_NAME);
    try {''', '''    this.logFilePath = path100.join(this.geminiDir, LOG_FILE_NAME);
    if (nativeGeminiHistorySelected()) {
      this.logs = await this._readLogFile();
      this.messageId = this.logs.reduce((next, entry) => entry.sessionId === this.sessionId ? entry.messageId + 1 : next, 0);
      this.initialized = true;
      return;
    }
    try {''')
replace('''  async _updateLogFile(entryToAppend) {
    if (!this.logFilePath)''', '''  async _updateLogFile(entryToAppend) {
    if (nativeGeminiHistorySelected()) {
      const result = appendNativeGeminiPromptHistory(this.storage.getProjectTempDir(), entryToAppend);
      this.logs = result.logs;
      return result.writtenEntry;
    }
    if (!this.logFilePath)''')
replace('''  async getPreviousUserMessages() {
    if (!this.initialized)
      return [];
    return this.logs.filter''', '''  async getPreviousUserMessages() {
    if (!this.initialized)
      return [];
    if (nativeGeminiHistorySelected()) this.logs = await this._readLogFile();
    return this.logs.filter''')
replace('''    } catch {
    }
  }
  _checkpointPath(tag) {''', '''    } catch (error40) {
      if (nativeGeminiHistorySelected()) throw error40;
    }
  }
  _checkpointPath(tag) {''')
for method, parameters, body in (
    ('saveCheckpoint', 'checkpoint, tag', 'return nativeGeminiCheckpoint(this.storage.getProjectTempDir(), tag, "save", checkpoint);'),
    ('loadCheckpoint', 'tag', '''const checkpoint = nativeGeminiCheckpoint(this.storage.getProjectTempDir(), tag);
      return checkpoint === undefined ? { history: [] } : Array.isArray(checkpoint) ? { history: checkpoint } : checkpoint;'''),
    ('deleteCheckpoint', 'tag', 'return nativeGeminiCheckpoint(this.storage.getProjectTempDir(), tag, "delete");'),
    ('checkpointExists', 'tag', 'return nativeGeminiCheckpoint(this.storage.getProjectTempDir(), tag) !== undefined;'),
):
    signature = f'  async {method}({parameters}) {{\n'
    replace(signature, signature + '''    if (nativeGeminiHistorySelected()) {
      if (!this.initialized) throw new Error("Gemini canonical conversation history is unavailable or unsafe.");
      ''' + body + '\n    }\n')
source = 'import { readNativeGeminiPromptHistory, appendNativeGeminiPromptHistory, nativeGeminiCheckpoint } from "./hive-gemini-history.mjs";\n' + source
if '--check' in sys.argv[2:]:
    print('Pinned native Gemini Logger selector applies; no files changed.')
else:
    if target.is_symlink():
        target.unlink()
    target.write_text(source)
    print('Applied disposable native Gemini Logger storage; production is unchanged.')
print('Native Logger manager SHA-256:', hashlib.sha256(source.encode()).hexdigest())
