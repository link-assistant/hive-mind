#!/usr/bin/env python3
"""Preserve actual native terminal/ACP restorable metadata in canonical history."""
import hashlib
import json
from pathlib import Path
import sys

here = Path(__file__).resolve().parent
package = Path(sys.argv[1]).resolve(strict=True)
if json.loads((package / 'package.json').read_text())['version'] != '0.65.0':
    raise SystemExit('Refusing an unpinned native Gemini package.')
bundle = package / 'bundle'
pins = {
    'chunk-DKZARV6U.js': 'a88db8a10a742aa697d71f2e33b9061d2082f6e9b4330b3d9bbefa54fa9616f3',
    'chunk-YTHYCFAB.js': 'c84a70c0629aca6d58c0c67c0450397c45e856763a9131656930c1444646d546',
    'interactiveCli-AVD3AKNJ.js': 'a1f578e876bbdfd04e4140a8a2dfeb6750ab569db2d4d24aadd72e3dd4304422',
    'gemini-GLQ4MVLB.js': '9fc3e4e924a0a9ecd8f595e009dad0b4ff53ec8ed3c6171cb0e8d7418793999e',
    'hive-gemini-history.mjs': '586d39370a4344a1aaa46c81894f2c6239253a91cb84e3871288c2093c328e99',
    'hive-gemini-publication.mjs': '2e55f93d5075a6c9cc9d5b3c7e71f243accc8f72e955e038d0341cb8fed0bc00',
    'hive-gemini-git-history.mjs': '83e535c8d162480a737306aac0f4caf7288d0c790e3473e2ba5dcfaf8b0bbb35',
    'hive-gemini-git-configuration.mjs': '3be27b9f5d2aba8b4456397fea5b418cea13a8ed6f5d7a6816191091052272b1',
}
for name, expected in pins.items():
    if hashlib.sha256((bundle / name).read_bytes()).hexdigest() != expected:
        raise SystemExit('Refusing changed native Gemini restorable metadata prerequisites.')
helper = bundle / 'hive-gemini-restorable-history.mjs'
if helper.exists() or helper.is_symlink():
    raise SystemExit('Refusing an existing native Gemini restorable history helper.')
sources = {name: (bundle / name).read_text() for name in (
    'chunk-DKZARV6U.js', 'interactiveCli-AVD3AKNJ.js', 'chunk-YTHYCFAB.js', 'gemini-GLQ4MVLB.js')}


def replace(name, before, after):
    if sources[name].count(before) != 1:
        raise SystemExit('Ambiguous native restorable metadata context; no files changed: ' + name)
    sources[name] = sources[name].replace(before, after)


manager = 'chunk-DKZARV6U.js'
tui = 'interactiveCli-AVD3AKNJ.js'
commands = 'chunk-YTHYCFAB.js'
acp = 'gemini-GLQ4MVLB.js'
replace(manager, 'const schema2 = historyItemSchema ?? external_exports.any();', '''const schema2 = historyItemSchema ?? (nativeGeminiHistorySelected() ? external_exports.object({
    type: external_exports.string(), id: external_exports.number()
  }).passthrough() : external_exports.any());''')
replace(manager, '''      const fileName = `${checkpointFileName}.json`;
      checkpointsToWrite.set(fileName, JSON.stringify(checkpointData, null, 2));''', '''      const fileName = `${checkpointFileName}.json`;
      const content = JSON.stringify(checkpointData, null, 2);
      saveNativeGeminiRestorableHistory(gitService.storage, fileName, content, getToolCallDataSchema());
      checkpointsToWrite.set(fileName, content);''')
replace(manager, '''    if (this.getCheckpointingEnabled()) {
      await this.getGitService();
    }''', '''    if (this.getCheckpointingEnabled()) {
      await this.getGitService();
      readNativeGeminiRestorableHistory(this.storage, getToolCallDataSchema());
    }''')
replace(manager, '''async function* performRestore(toolCallData, gitService) {
  if (toolCallData.history && toolCallData.clientHistory) {''', '''async function* performRestore(toolCallData, gitService) {
  if (nativeGeminiHistorySelected()) {
    if (!gitService) throw new Error("Gemini canonical conversation history is unavailable or unsafe.");
    assertNativeGeminiRestorableRestore(gitService.storage, toolCallData, getToolCallDataSchema());
    await gitService.restoreProjectFromSnapshot(toolCallData.commitHash);
    if (toolCallData.history && toolCallData.clientHistory) {
      yield { type: "load_history", history: toolCallData.history, clientHistory: toolCallData.clientHistory };
    }
    yield { type: "message", messageType: "info", content: "Restored project to the state before the tool call." };
    return;
  }
  if (toolCallData.history && toolCallData.clientHistory) {''')
replace(tui, 'if (checkpointsToWrite.size > 0) {', 'if (checkpointsToWrite.size > 0 && !nativeGeminiHistorySelected()) {')
replace(commands, '''    await fs35.mkdir(checkpointDir, { recursive: true });
    const files = await fs35.readdir(checkpointDir);''', '''    const canonical = readNativeGeminiRestorableHistory(agentContext.config.storage, ToolCallDataSchema);
    if (canonical === undefined) await fs35.mkdir(checkpointDir, { recursive: true });
    const files = canonical === undefined ? await fs35.readdir(checkpointDir) : [...canonical.keys()];''')
replace(commands, '''    const data = await fs35.readFile(filePath, "utf-8");''', '''    const data = canonical === undefined ? await fs35.readFile(filePath, "utf-8") : canonical.get(selectedFile).content;''')
replace(commands, '''    const files = await fs35.readdir(checkpointDir);
    const jsonFiles = files.filter((file) => file.endsWith(".json"));
    return getTruncatedCheckpointNames(jsonFiles);''', '''    const canonical = readNativeGeminiRestorableHistory(agentContext.config.storage, ToolCallDataSchema);
    const files = canonical === undefined ? await fs35.readdir(checkpointDir) : [...canonical.keys()];
    const jsonFiles = files.filter((file) => file.endsWith(".json"));
    return getTruncatedCheckpointNames(jsonFiles);''')
replace(acp, '''        data = await fs11.readFile(filePath, "utf-8");''', '''        const canonical = readNativeGeminiRestorableHistory(config.storage, getToolCallDataSchema());
        if (canonical !== undefined && !canonical.has(selectedFile)) return { name: this.name, data: `File not found: ${selectedFile}` };
        data = canonical === undefined ? await fs11.readFile(filePath, "utf-8") : canonical.get(selectedFile).content;''')
replace(acp, '''      try {
        await fs11.mkdir(checkpointDir, { recursive: true });
      } catch {
      }
      const files = await fs11.readdir(checkpointDir);''', '''      const canonical = readNativeGeminiRestorableHistory(config.storage, getToolCallDataSchema());
      if (canonical === undefined) {
        try {
          await fs11.mkdir(checkpointDir, { recursive: true });
        } catch {
        }
      }
      const files = canonical === undefined ? await fs11.readdir(checkpointDir) : [...canonical.keys()];''')
replace(acp, '''        const data = await fs11.readFile(filePath, "utf-8");''', '''        const data = canonical === undefined ? await fs11.readFile(filePath, "utf-8") : canonical.get(file).content;''')
sources[manager] = 'import { readNativeGeminiRestorableHistory, saveNativeGeminiRestorableHistory, assertNativeGeminiRestorableRestore } from "./hive-gemini-restorable-history.mjs";\n' + sources[manager]
for name in (commands, acp):
    sources[name] = 'import { readNativeGeminiRestorableHistory } from "./hive-gemini-restorable-history.mjs";\n' + sources[name]
if '--check' in sys.argv[2:]:
    print('Pinned native Gemini restorable metadata applies; no files changed.')
else:
    for name, source in sources.items():
        target = bundle / name
        if target.is_symlink():
            target.unlink()
        target.write_text(source)
    helper.write_bytes((here / 'restorable_history.mjs').read_bytes())
    print('Applied disposable native Gemini restorable metadata; production is unchanged.')
for name, source in sources.items():
    print(hashlib.sha256(source.encode()).hexdigest(), name)
print(hashlib.sha256((here / 'restorable_history.mjs').read_bytes()).hexdigest(), helper.name)
