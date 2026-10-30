#!/usr/bin/env python3
"""Select native conversation storage without sharing an execution home."""
import hashlib
import json
from pathlib import Path
import re
import sys

here = Path(__file__).resolve().parent
package = Path(sys.argv[1]).resolve(strict=True)
if json.loads((package / 'package.json').read_text())['version'] != '0.65.0':
    raise SystemExit('Refusing an unpinned native Gemini package.')
bundle = package / 'bundle'
pins = {
    'chunk-DKZARV6U.js': 'c52e6e574c9bd960a60a3a3364351be8eccf1d1236d933d44204ded015047792',
    'chunk-XHQ6TTKH.js': 'ee00e2ad4cfbdf1349e724528327e3ac158f2966550bc1f4c8b18fe29c2d46fb',
    'gemini-GLQ4MVLB.js': '1c5053102d2204335a96a71f930a0419d2b153cd6d17e1d1ee96753b5272fd9f',
    'interactiveCli-AVD3AKNJ.js': 'e906563eb050d4a32551b3bba0942956138e5de86818c23b5e134efb5fc80c86',
    'hive-gemini-admission.mjs': '11821bca3691a7869aa19cca50c667d846913f3b6f7e9b2da7aace52571b4288',
}
sources = {}
for name, expected in pins.items():
    target = bundle / name
    data = target.read_bytes()
    if hashlib.sha256(data).hexdigest() != expected:
        raise SystemExit('Refusing changed native Gemini history input: ' + name)
    sources[name] = data.decode()
if (bundle / 'hive-gemini-history.mjs').exists():
    raise SystemExit('Refusing an existing native Gemini history helper.')


def replace(source, before, after, count=1):
    if source.count(before) != count:
        raise SystemExit('Ambiguous native Gemini history context; no files changed.')
    return source.replace(before, after)


manager = sources['chunk-DKZARV6U.js']
for before, after in [
    ('path4.join(this.getProjectTempDir(), "chats")', 'this.getProjectChatsDir()'),
    ('path29.join(this.context.config.storage.getProjectTempDir(), "chats")', 'this.context.config.storage.getProjectChatsDir()'),
    ('path98.join(config2.storage.getProjectTempDir(), "chats")', 'config2.storage.getProjectChatsDir()'),
    ('path106.join(config2.storage.getProjectTempDir(), "chats")', 'config2.storage.getProjectChatsDir()'),
]:
    manager = replace(manager, before, after)
manager = replace(manager, '  async listProjectChatFiles() {', '''  getProjectChatsDir() {
    return nativeGeminiChatsDirectory(_Storage.getGlobalGeminiDir(), this.getProjectRoot()) ?? path4.join(this.getProjectTempDir(), "chats");
  }
  async listProjectChatFiles() {''')
manager = replace(manager, '''  async loadProjectTempFile(filePath) {
    const absolutePath = path4.join(this.getProjectTempDir(), filePath);''', '''  async loadProjectTempFile(filePath) {
    const absolutePath = filePath.startsWith("chats/") ? path4.join(this.getProjectChatsDir(), filePath.slice(6)) : path4.join(this.getProjectTempDir(), filePath);''')
for signature in ['function loadConversationRecordSync(filePath, options) {', 'async function loadConversationRecord(filePath, options) {']:
    manager = replace(manager, signature + '\n  if (!fs32.existsSync(filePath)) {', signature + '''
  const selectedContent = readNativeGeminiConversation(filePath);
  if (selectedContent === null || selectedContent === undefined && !fs32.existsSync(filePath)) {''')
manager = replace(manager, 'const content = fs32.readFileSync(filePath, "utf8");', 'const content = selectedContent ?? fs32.readFileSync(filePath, "utf8");')
manager = replace(manager, 'const fileStream = fs32.createReadStream(filePath);', 'const fileStream = selectedContent === undefined ? fs32.createReadStream(filePath) : HiveHistoryReadable.from([selectedContent]);')
manager = replace(manager, 'return await parseLegacyRecordFallback(filePath, options);', 'return selectedContent === undefined ? await parseLegacyRecordFallback(filePath, options) : parseLegacyContentFallback(selectedContent, options);')
manager = replace(manager, '      fs32.appendFileSync(this.conversationFile, line);', '      if (!appendNativeGeminiConversation(this.conversationFile, line)) fs32.appendFileSync(this.conversationFile, line);')
manager = replace(manager, '''    const content = lines.join("\\n") + "\\n";
    try {
      fs32.mkdirSync(path29.dirname(this.conversationFile), { recursive: true });''', '''    const content = lines.join("\\n") + "\\n";
    if (rewriteNativeGeminiConversation(this.conversationFile, content)) return;
    try {
      fs32.mkdirSync(path29.dirname(this.conversationFile), { recursive: true });''')
manager = replace(manager, '''    await fs89.appendFile(sessionPath, `${JSON.stringify({ $set: metadataUpdate })}
`);''', '''    const record = `${JSON.stringify({ $set: metadataUpdate })}\\n`;
    if (!appendNativeGeminiConversation(sessionPath, record)) await fs89.appendFile(sessionPath, record);''')
manager = replace(manager, '''    await fs89.writeFile(sessionPath, JSON.stringify({
      ...freshConversation,
      ...metadataUpdate,
      lastUpdated
    }, null, 2));''', '''    const record = JSON.stringify({ ...freshConversation, ...metadataUpdate, lastUpdated }, null, 2);
    if (!rewriteNativeGeminiConversation(sessionPath, record)) await fs89.writeFile(sessionPath, record);''')
manager = '''import { Readable as HiveHistoryReadable } from "node:stream";
import { nativeGeminiChatsDirectory, readNativeGeminiConversation, appendNativeGeminiConversation, rewriteNativeGeminiConversation } from "./hive-gemini-history.mjs";
''' + manager
sources['chunk-DKZARV6U.js'] = manager
for name, count in [('chunk-XHQ6TTKH.js', 6), ('gemini-GLQ4MVLB.js', 1), ('interactiveCli-AVD3AKNJ.js', 1)]:
    source = sources[name]
    source, matches = re.subn(r'path\d*\.join\(((?:this\.)?(?:config\.)?storage)\.getProjectTempDir\(\), "chats"\)', r'\1.getProjectChatsDir()', source)
    if matches != count:
        raise SystemExit('Ambiguous native CLI history context; no files changed: ' + name)
    if name == 'chunk-XHQ6TTKH.js':
        source = replace(source, 'const chatsDir = path2.join(tempDir, "chats");', 'const chatsDir = config.storage.getProjectChatsDir();')
        source = replace(source, '''        } catch {
          return { fileName: file, sessionInfo: null };
        }''', '''        } catch {
          assertNativeGeminiHistoryCurrent();
          return { fileName: file, sessionInfo: null };
        }''')
        source = 'import { assertNativeGeminiHistoryCurrent } from "./hive-gemini-history.mjs";\n' + source
    sources[name] = source
admission = sources['hive-gemini-admission.mjs']
admission = replace(admission, 'export function assertNativeGeminiAuthority(content, configuration) {', '''export function assertNativeGeminiAuthority(content, configuration) {
  assertNativeGeminiHistoryCurrent();''')
sources['hive-gemini-admission.mjs'] = 'import { assertNativeGeminiHistoryCurrent } from "./hive-gemini-history.mjs";\n' + admission
sources['hive-gemini-history.mjs'] = (here / 'history.mjs').read_text()
if '--check' in sys.argv[2:]:
    print('Pinned native Gemini conversation selector applies; no files changed.')
else:
    for name, source in sources.items():
        target = bundle / name
        # Disposable package fixtures may symlink original chunks. Replace the
        # link itself, never write through it into the installed native package.
        if target.is_symlink():
            target.unlink()
        target.write_text(source)
    print('Applied native Gemini conversation experiment; production is unchanged.')
print('Native manager SHA-256:', hashlib.sha256(manager.encode()).hexdigest())
