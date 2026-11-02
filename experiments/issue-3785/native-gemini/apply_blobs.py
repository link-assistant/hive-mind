#!/usr/bin/env python3
"""Retain native degraded multimodal data through checked canonical storage."""
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
if hashlib.sha256(original).hexdigest() != 'ce32eec6ab27f4d9fbf1449a5bdc70ad9b06fde0aff84b560ac1540a9106a9fa':
    raise SystemExit('Refusing changed native Gemini blob input.')
if (bundle / 'hive-gemini-history.mjs').read_bytes() != (Path(__file__).parent / 'history.mjs').read_bytes():
    raise SystemExit('Refusing a different native Gemini history helper.')
source = original.decode()


def replace(before, after):
    global source
    if source.count(before) != 1:
        raise SystemExit('Ambiguous native blob context; no files changed.')
    source = source.replace(before, after)


replace('''        if (!directoryCreated) {
          await fs58.mkdir(blobOutputsDir, { recursive: true });''', '''        if (!directoryCreated && !nativeGeminiHistorySelected()) {
          await fs58.mkdir(blobOutputsDir, { recursive: true });''')
replace('''          const filePath = path70.join(blobOutputsDir, fileName);
          const buffer = Buffer.from(payload.inlineData.data, "base64");
          await fs58.writeFile(filePath, buffer);''', '''          const canonical = writeNativeGeminiBlob(env2.projectTempDir, payload.inlineData.data, payload.inlineData.mimeType, sessionId);
          const filePath = canonical ?? path70.join(blobOutputsDir, fileName);
          const buffer = Buffer.from(payload.inlineData.data, "base64");
          if (canonical === undefined) await fs58.writeFile(filePath, buffer);''')
replace('''      if (readNativeGeminiToolOutput(absolutePath) !== undefined) return null;''', '''      if (readNativeGeminiToolOutput(absolutePath) !== undefined || readNativeGeminiBlob(absolutePath) !== undefined) return null;''')
before = '    readNativeGeminiToolOutput(path52.resolve(this.config.getTargetDir(), sanitizedPath));'
# Both native parameter validation and execution check the original path.
if source.count(before) != 2:
    raise SystemExit('Ambiguous native blob read admission; no files changed.')
source = source.replace(before, before + '\n    readNativeGeminiBlob(path52.resolve(this.config.getTargetDir(), sanitizedPath));')
replace('''async function detectFileType(filePath) {
  const ext2''', '''async function detectFileType(filePath, checkedBytes) {
  const binary = () => checkedBytes === undefined ? isBinaryFile(filePath) : (0, import_isbinaryfile.isBinaryFile)(checkedBytes, checkedBytes.length);
  const ext2''')
start = source.index('async function detectFileType(filePath, checkedBytes) {')
end = source.index('\nfunction formatHiveGeminiToolText(', start)
classification = source[start:end]
if classification.count('await isBinaryFile(filePath)') != 3:
    raise SystemExit('Ambiguous native blob byte classification; no files changed.')
source = source[:start] + classification.replace('await isBinaryFile(filePath)', 'await binary()') + source[end:]
replace('''async function processSingleFileContent(filePath, rootDirectory, _fileSystemService, startLine, endLine) {
  const canonical''', '''async function processSingleFileContent(filePath, rootDirectory, _fileSystemService, startLine, endLine) {
  const blob = readNativeGeminiBlob(filePath);
  if (blob !== undefined) {
    const relativePathForDisplay = path7.relative(rootDirectory, filePath).replace(/\\\\/g, "/");
    const fileSizeInMB = blob.bytes.length / (1024 * 1024);
    if (fileSizeInMB > MAX_FILE_SIZE_MB) return {
      llmContent: `File size exceeds the ${MAX_FILE_SIZE_MB}MB limit.`,
      returnDisplay: `File size exceeds the ${MAX_FILE_SIZE_MB}MB limit.`,
      error: `File size exceeds the ${MAX_FILE_SIZE_MB}MB limit: ${filePath} (${fileSizeInMB.toFixed(2)}MB)`,
      errorType: ToolErrorType.FILE_TOO_LARGE
    };
    const fileType = await detectFileType("blob." + blob.mimeType.split("/")[1], blob.bytes);
    if (fileType === "svg" && blob.bytes.length > 1024 * 1024) return {
      llmContent: `Cannot display content of SVG file larger than 1MB: ${relativePathForDisplay}`,
      returnDisplay: `Skipped large SVG file (>1MB): ${relativePathForDisplay}`
    };
    if (fileType === "text" || fileType === "svg") {
      const bom = detectBOM(blob.bytes);
      const content = bom ? decodeBOMContent(blob.bytes, bom) : blob.bytes.toString("utf8");
      if (fileType === "svg") return { llmContent: content, returnDisplay: `Read SVG as text: ${relativePathForDisplay}` };
      return formatHiveGeminiToolText(content, filePath, rootDirectory, startLine, endLine);
    }
    const normalizedMime = blob.mimeType.toLowerCase();
    const mimeType = AUDIO_MIME_TYPE_NORMALIZATION[normalizedMime] ?? normalizedMime;
    if (fileType === "binary") return {
      llmContent: `Cannot display content of binary file: ${relativePathForDisplay}`,
      returnDisplay: `Skipped binary file: ${relativePathForDisplay}`
    };
    if (fileType === "audio" && ![...SUPPORTED_AUDIO_MIME_TYPES_BY_EXTENSION.values()].includes(mimeType)) return {
      llmContent: `Could not read audio file because its format is not supported. Supported audio formats are ${SUPPORTED_AUDIO_FORMATS_DISPLAY}.`,
      returnDisplay: `Unsupported audio file format: ${relativePathForDisplay}`,
      error: `Unsupported audio file format for ${filePath}. Supported audio formats are ${SUPPORTED_AUDIO_FORMATS_DISPLAY}.`,
      errorType: ToolErrorType.READ_CONTENT_FAILURE
    };
    return {
      llmContent: { inlineData: { data: blob.bytes.toString("base64"), mimeType } },
      returnDisplay: `Read ${fileType} file: ${relativePathForDisplay}`
    };
  }
  const canonical''')
source = 'import { writeNativeGeminiBlob, readNativeGeminiBlob } from "./hive-gemini-history.mjs";\n' + source
if '--check' in sys.argv[2:]:
    print('Pinned native Gemini blob selector applies; no files changed.')
else:
    if target.is_symlink():
        target.unlink()
    target.write_text(source)
    print('Applied disposable native Gemini blob storage; production is unchanged.')
print('Native blob manager SHA-256:', hashlib.sha256(source.encode()).hexdigest())
