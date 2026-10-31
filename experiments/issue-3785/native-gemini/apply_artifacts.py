#!/usr/bin/env python3
"""Preserve native tool-output files without projecting private runtime code."""
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
if hashlib.sha256(original).hexdigest() != '0c70897032c0ad76419b3149d783567280dfd972ef2c04e258cbebccc9575c42':
    raise SystemExit('Refusing changed native Gemini artifact input.')
helper = bundle / 'hive-gemini-history.mjs'
if helper.read_bytes() != (Path(__file__).parent / 'history.mjs').read_bytes():
    raise SystemExit('Refusing a different native Gemini history helper.')
source = original.decode()


def replace(before, after):
    global source
    if source.count(before) != 1:
        raise SystemExit('Ambiguous native artifact context; no files changed.')
    source = source.replace(before, after)


replace('    return path4.join(tempDir, identifier);', '''    const temporary = path4.join(tempDir, identifier);
    registerNativeGeminiProjectTemp(_Storage.getGlobalGeminiDir(), this.getProjectRoot(), temporary);
    return temporary;''')
replace('''async function saveTruncatedToolOutput(content, toolName, id, projectTempDir, sessionId) {
  const safeToolName''', '''async function saveTruncatedToolOutput(content, toolName, id, projectTempDir, sessionId) {
  const canonical = writeNativeGeminiToolOutput(projectTempDir, content, sessionId);
  if (canonical !== undefined) return { outputFile: canonical };
  const safeToolName''')
replace('    await fsPromises11.mkdir(toolOutputsDir, { recursive: true });', '    if (!nativeGeminiHistorySelected()) await fsPromises11.mkdir(toolOutputsDir, { recursive: true });')
replace('''      const filePath = path68.join(toolOutputsDir, fileName);
      await fsPromises11.writeFile(filePath, content, "utf-8");''', '''      const canonical = writeNativeGeminiToolOutput(config2.storage.getProjectTempDir(), content, sessionId);
      const filePath = canonical ?? path68.join(toolOutputsDir, fileName);
      if (canonical === undefined) await fsPromises11.writeFile(filePath, content, "utf-8");''')
replace('''        if (!directoryCreated) {
          await fs57.mkdir(toolOutputsDir, { recursive: true });''', '''        if (!directoryCreated && !nativeGeminiHistorySelected()) {
          await fs57.mkdir(toolOutputsDir, { recursive: true });''')
replace('''        const filePath = path69.join(toolOutputsDir, fileName);
        await fs57.writeFile(filePath, content);''', '''        const canonical = writeNativeGeminiToolOutput(env2.projectTempDir, content, sessionId);
        const filePath = canonical ?? path69.join(toolOutputsDir, fileName);
        if (canonical === undefined) await fs57.writeFile(filePath, content);''')
# Selected history failures must propagate from optional native truncation paths
# rather than discard the full output and continue inference without its audit.
replace('''          outputFile = savedPath;
        } catch {
        }
      }
      return outputFile;''', '''          outputFile = savedPath;
        } catch (error40) {
          if (nativeGeminiHistorySelected()) throw error40;
        }
      }
      return outputFile;''')
replace('''    if (checkType === "read") {
      if (this.getWorkspaceContext().isPathReadable(absolutePath)) {''', '''    if (checkType === "read") {
      if (readNativeGeminiToolOutput(absolutePath) !== undefined) return null;
      if (this.getWorkspaceContext().isPathReadable(absolutePath)) {''')
replace('''    const sanitizedPath = resolveDefensiveToolPath(params.file_path, this.config.getTargetDir());
    let resolvedPath;''', '''    const sanitizedPath = resolveDefensiveToolPath(params.file_path, this.config.getTargetDir());
    readNativeGeminiToolOutput(path52.resolve(this.config.getTargetDir(), sanitizedPath));
    let resolvedPath;''')
replace('''    const sanitizedPath = resolveDefensiveToolPath(this.params.file_path, this.config.getTargetDir());
    let targetPathToRead = this.resolvedPath;''', '''    const sanitizedPath = resolveDefensiveToolPath(this.params.file_path, this.config.getTargetDir());
    readNativeGeminiToolOutput(path52.resolve(this.config.getTargetDir(), sanitizedPath));
    let targetPathToRead = this.resolvedPath;''')
# Reuse the native pure text formatter verbatim. Canonical files are read only
# through the checked descriptor snapshot, before native path/type inspection.
text_start = '      case "text": {\n        const content = await readFileWithEncoding(filePath, stats);\n'
text_end = '\n      }\n      case "audio": {'
if source.count(text_start) != 1:
    raise SystemExit('Ambiguous native text formatter; no files changed.')
start = source.index(text_start) + len(text_start)
end = source.index(text_end, start)
formatter = source[start:end]
replace('''      case "text": {
        const content = await readFileWithEncoding(filePath, stats);
''' + formatter + '\n      }', '''      case "text": {
        return formatHiveGeminiToolText(await readFileWithEncoding(filePath, stats), filePath, rootDirectory, startLine, endLine);
      }''')
signature = 'async function processSingleFileContent(filePath, rootDirectory, _fileSystemService, startLine, endLine) {'
replace(signature, '''function formatHiveGeminiToolText(content, filePath, rootDirectory, startLine, endLine) {
  const relativePathForDisplay = path7.relative(rootDirectory, filePath).replace(/\\\\/g, "/");
''' + formatter + '\n}\n' + signature + '''
  const canonical = readNativeGeminiToolOutput(filePath);
  if (canonical !== undefined) return formatHiveGeminiToolText(canonical, filePath, rootDirectory, startLine, endLine);''')
source = 'import { registerNativeGeminiProjectTemp, writeNativeGeminiToolOutput, readNativeGeminiToolOutput } from "./hive-gemini-history.mjs";\n' + source
if '--check' in sys.argv[2:]:
    print('Pinned native Gemini artifact selector applies; no files changed.')
else:
    if target.is_symlink():
        target.unlink()
    target.write_text(source)
    print('Applied disposable native Gemini artifact storage; production is unchanged.')
print('Native artifact manager SHA-256:', hashlib.sha256(source.encode()).hexdigest())
