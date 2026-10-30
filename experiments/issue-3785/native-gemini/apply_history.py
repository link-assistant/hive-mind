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
manager = replace(manager, 'const chatsDir = path28.join(tempDir, "chats");', 'const chatsDir = config2.storage.getProjectChatsDir();')
manager = replace(manager, '''async function deleteSessionFileAndArtifacts(chatsDir, file2, tempDir) {
  const filePath = path28.join(chatsDir, file2);''', '''async function deleteSessionFileAndArtifacts(chatsDir, file2, tempDir) {
  const filePath = path28.join(chatsDir, file2);
  if (nativeGeminiHistorySelected()) {
    await loadConversationRecord(filePath);
    if (archiveNativeGeminiConversation(filePath) === "busy") throw new Error("Gemini conversation is currently being written.");
    return;
  }''')
manager = replace(manager, '''    try {
      const tempDir = this.context.config.storage.getProjectTempDir();
      await fs32.promises.unlink(this.conversationFile).catch(() => {''', '''    try {
      if (nativeGeminiHistorySelected()) {
        await loadConversationRecord(this.conversationFile);
        if (archiveNativeGeminiConversation(this.conversationFile) === "busy") throw new Error("Gemini conversation is currently being written.");
        return;
      }
      const tempDir = this.context.config.storage.getProjectTempDir();
      await fs32.promises.unlink(this.conversationFile).catch(() => {''')
for assignment, count in [
    ('this.conversationFile = resumedSessionData.filePath;', 1),
    ('this.conversationFile = path29.join(chatsDir, filename);', 1),
    ('this.conversationFile = this.conversationFile + "l";', 2),
]:
    manager = replace(manager, assignment, assignment + '\n        claimNativeGeminiConversation(this.conversationFile);', count=count)
manager = replace(manager, '''  async loadProjectTempFile(filePath) {
    const absolutePath = path4.join(this.getProjectTempDir(), filePath);''', '''  async loadProjectTempFile(filePath) {
    const absolutePath = filePath.startsWith("chats/") ? path4.join(this.getProjectChatsDir(), filePath.slice(6)) : path4.join(this.getProjectTempDir(), filePath);''')
for signature in ['function loadConversationRecordSync(filePath, options) {', 'async function loadConversationRecord(filePath, options) {']:
    manager = replace(manager, signature + '\n  if (!fs32.existsSync(filePath)) {', signature + '''
  const selectedContent = readNativeGeminiConversation(filePath, options?.importSource === true);
  if (selectedContent === null || selectedContent === undefined && !fs32.existsSync(filePath)) {''')
manager = replace(manager, 'const content = fs32.readFileSync(filePath, "utf8");', 'const content = selectedContent ?? fs32.readFileSync(filePath, "utf8");')
manager = replace(manager, 'const fileStream = fs32.createReadStream(filePath);', 'const fileStream = selectedContent === undefined ? fs32.createReadStream(filePath) : HiveHistoryReadable.from([selectedContent]);')
manager = replace(manager, 'return await parseLegacyRecordFallback(filePath, options);', 'return selectedContent === undefined ? await parseLegacyRecordFallback(filePath, options) : admitNativeGeminiConversation(filePath, parseLegacyContentFallback(selectedContent, options), options?.importSource === true);')
manager = replace(manager, 'return parseLegacyContentFallback(content, options);', 'return selectedContent === undefined ? parseLegacyContentFallback(content, options) : admitNativeGeminiConversation(filePath, parseLegacyContentFallback(content, options), options?.importSource === true);')
manager = replace(manager, '''    const result2 = accumulator.finalize();
    if (result2) {
      return result2;
    }''', '''    const result2 = accumulator.finalize();
    if (result2) {
      return admitNativeGeminiConversation(filePath, result2, options?.importSource === true);
    }''', count=2)
for diagnostic in ['Error loading conversation record synchronously:', 'Error loading conversation record from JSONL:']:
    manager = replace(manager, f'''  }} catch (error40) {{
    debugLogger.error("{diagnostic}", error40);''', f'''  }} catch (error40) {{
    if (selectedContent !== undefined) return admitNativeGeminiConversation(filePath, null, options?.importSource === true);
    debugLogger.error("{diagnostic}", error40);''')
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
import { nativeGeminiChatsDirectory, readNativeGeminiConversation, appendNativeGeminiConversation, rewriteNativeGeminiConversation, admitNativeGeminiConversation, archiveNativeGeminiConversation, claimNativeGeminiConversation, nativeGeminiHistorySelected } from "./hive-gemini-history.mjs";
''' + manager
sources['chunk-DKZARV6U.js'] = manager
for name, count in [('chunk-XHQ6TTKH.js', 6), ('gemini-GLQ4MVLB.js', 1), ('interactiveCli-AVD3AKNJ.js', 1)]:
    source = sources[name]
    source, matches = re.subn(r'path\d*\.join\(((?:this\.)?(?:config\.)?storage)\.getProjectTempDir\(\), "chats"\)', r'\1.getProjectChatsDir()', source)
    if matches != count:
        raise SystemExit('Ambiguous native CLI history context; no files changed: ' + name)
    if name == 'chunk-XHQ6TTKH.js':
        source = replace(source, '  async findSession(identifier) {', '''  async listArchivedSessions() {
    const files = listNativeGeminiArchivedConversations(this.storage.getProjectChatsDir());
    if (!files) throw new Error("Canonical Gemini history must be selected to list archived sessions.");
    const sessions = [];
    for (const filePath of files) {
      const record = await loadConversationRecord(filePath, { metadataOnly: true });
      sessions.push({
        id: record.sessionId,
        fileName: path.basename(filePath),
        startTime: record.startTime,
        lastUpdated: record.lastUpdated || record.startTime,
        displayName: cleanMessage(record.summary || record.firstUserMessage || "Empty conversation"),
        messageCount: record.messageCount ?? record.messages.length,
        isCurrentSession: false,
        index: sessions.length + 1
      });
    }
    return sessions;
  }
  async findArchivedSession(identifier) {
    if (!nativeGeminiHistorySelected() || !/^[a-zA-Z0-9_-]+$/.test(identifier)) return null;
    const chatsDir = this.storage.getProjectChatsDir();
    const matches = [];
    for (const filePath of listNativeGeminiArchivedConversations(chatsDir)) {
      const sessionData = await loadConversationRecord(filePath);
      if (sessionData?.sessionId === identifier && sessionData.kind !== "subagent") matches.push({ filePath, sessionData });
    }
    if (!matches.length) return null;
    const updated = (record) => Date.parse(record.lastUpdated || record.startTime) || 0;
    matches.sort((a, b) => updated(b.sessionData) - updated(a.sessionData));
    const { filePath, sessionData } = matches[0];
    const restored = restoreNativeGeminiConversation(chatsDir, filePath, sessionData);
    return {
      id: sessionData.sessionId,
      fileName: path.basename(restored),
      startTime: sessionData.startTime,
      lastUpdated: sessionData.lastUpdated || sessionData.startTime,
      firstUserMessage: extractFirstUserMessage(sessionData.messages),
      messageCount: sessionData.messages.length,
      index: 0
    };
  }
  async findSession(identifier) {''')
        source = replace(source, '''    const trimmedIdentifier = identifier.trim();
    const sessions = await this.listSessions();
    if (sessions.length === 0) {''', '''    const trimmedIdentifier = identifier.trim();
    const sessions = await this.listSessions();
    if (!sessions.some(session => session.id === trimmedIdentifier)) {
      const archived = await this.findArchivedSession(trimmedIdentifier);
      if (archived) return archived;
    }
    if (sessions.length === 0) {''')
        source = replace(source, '''    if (matches.length === 0) {
      throw SessionError.invalidSessionIdentifier(trimmedId, chatsDir);
    }''', '''    if (matches.length === 0) {
      const archived = await this.findArchivedSession(trimmedId);
      if (archived) return this.selectSession(archived);
      throw SessionError.invalidSessionIdentifier(trimmedId, chatsDir);
    }''')
        source = replace(source, 'const chatsDir = path2.join(tempDir, "chats");', 'const chatsDir = config.storage.getProjectChatsDir();')
        source = replace(source, '''        } catch {
          return { fileName: file, sessionInfo: null };
        }''', '''        } catch {
          assertNativeGeminiHistoryCurrent();
          return { fileName: file, sessionInfo: null };
        }''')
        source = replace(source, '''            const filePath = path2.join(chatsDir, file);
            let fullSessionId;''', '''            const filePath = path2.join(chatsDir, file);
            if (nativeGeminiHistorySelected()) {
              const conversation = await loadConversationRecord(filePath, { metadataOnly: true });
              if (conversation?.sessionId === config.getSessionId()) {
                result.skipped++;
                continue;
              }
              if (archiveNativeGeminiConversation(filePath) === "busy") {
                result.skipped++;
                continue;
              }
              result.deleted++;
              continue;
            }
            let fullSessionId;''')
        source = replace(source, '''          await fs2.unlink(sessionPath);
          const sessionId = sessionToDelete.sessionInfo?.id;''', '''          const archived = archiveNativeGeminiConversation(sessionPath);
          if (archived === "busy") {
            result.skipped++;
            continue;
          }
          if (!archived) await fs2.unlink(sessionPath);
          const sessionId = archived ? undefined : sessionToDelete.sessionInfo?.id;''')
        source = 'import { assertNativeGeminiHistoryCurrent, archiveNativeGeminiConversation, nativeGeminiHistorySelected, listNativeGeminiArchivedConversations, restoreNativeGeminiConversation } from "./hive-gemini-history.mjs";\n' + source
    if name == 'gemini-GLQ4MVLB.js':
        source = replace(source, 'const sessionData = await loadConversationRecord(sessionFileArg);', 'const sessionData = await loadConversationRecord(sessionFileArg, { importSource: true });')
        source = replace(source, '''      await fsPromises.mkdir(chatsDir, { recursive: true });
      await fsPromises.writeFile(
        newSessionPath,
        lines.join("\\n") + "\\n",
        "utf-8"
      );''', '''      claimNativeGeminiConversation(newSessionPath);
      if (!rewriteNativeGeminiConversation(newSessionPath, lines.join("\\n") + "\\n")) {
        await fsPromises.mkdir(chatsDir, { recursive: true });
        await fsPromises.writeFile(newSessionPath, lines.join("\\n") + "\\n", "utf-8");
      }''')
        source = 'import { claimNativeGeminiConversation, rewriteNativeGeminiConversation } from "./hive-gemini-history.mjs";\n' + source
        source = replace(source, '''    }).option("delete-session", {
      type: "string",''', '''    }).option("list-archived-sessions", {
      type: "boolean",
      description: "List canonical archived sessions for the current project and exit."
    }).option("delete-session", {
      type: "string",''')
        source = replace(source, '''async function listSessions(config) {
  await generateSummary(config);
  const sessionSelector = new SessionSelector(config.storage);
  const sessions = await sessionSelector.listSessions();''', '''async function listSessions(config, archived = false) {
  if (!archived) await generateSummary(config);
  const sessionSelector = new SessionSelector(config.storage);
  const sessions = archived ? await sessionSelector.listArchivedSessions() : await sessionSelector.listSessions();''')
        source = replace(source, 'writeToStdout("No previous sessions found for this project.");', 'writeToStdout(archived ? "No archived sessions found for this project." : "No previous sessions found for this project.");')
        source = replace(source, 'Available sessions for this project (${sessions.length}):', 'Available ${archived ? "archived sessions" : "sessions"} for this project (${sessions.length}):')
        source = replace(source, '''    if (config.getListSessions()) {
      const authType2''', '''    if (argv.listArchivedSessions) {
      await listSessions(config, true);
      await runExitCleanup();
      process.exit(ExitCodes.SUCCESS);
    }
    if (config.getListSessions()) {
      const authType2''')
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
for name, source in sources.items():
    print('Native history output SHA-256:', name, hashlib.sha256(source.encode()).hexdigest())
