#!/usr/bin/env python3
"""Refuse native streaming dispatch when retained conversation evidence fails."""
import hashlib
import json
from pathlib import Path
import sys

package = Path(sys.argv[1]).resolve(strict=True)
if json.loads((package / 'package.json').read_text())['version'] != '0.65.0':
    raise SystemExit('Refusing an unpinned native Gemini package.')
bundle = package / 'bundle'
pins = {
    'chunk-DKZARV6U.js': '13f2fce9a55408b50001683d440f791a1d21cdcc3c22799f8832edad4a1ef769',
    'hive-gemini-history.mjs': '4072ef64f7258b229a63a64fb3834c28c4f54477482eaeca44cbbb409a5e1cbd',
}
for name, expected in pins.items():
    if hashlib.sha256((bundle / name).read_bytes()).hexdigest() != expected:
        raise SystemExit('Refusing changed native Gemini streaming-admission prerequisites.')
target = bundle / 'chunk-DKZARV6U.js'
source = target.read_text()


def replace(before, after):
    global source
    if source.count(before) != 1:
        raise SystemExit('Ambiguous native Gemini streaming-admission context; no files changed.')
    source = source.replace(before, after)


replace('''  async sendMessageStream(modelConfigKey, message, prompt_id, signal, role, displayContent, apiHistoryOverride) {
    await this.sendPromise;''', '''  admitNativeRecording() {
    if (!nativeGeminiHistorySelected()) return;
    const file = this.chatRecordingService.getConversationFilePath();
    if (!file || readNativeGeminiConversation(file) === null) {
      throw new Error("Gemini canonical conversation history is unavailable or unsafe.");
    }
  }
  async sendMessageStream(modelConfigKey, message, prompt_id, signal, role, displayContent, apiHistoryOverride) {
    this.admitNativeRecording();
    await this.sendPromise;
    this.admitNativeRecording();''')
replace('''      return this.context.config.getContentGenerator().generateContentStream({''', '''      this.admitNativeRecording();
      return this.context.config.getContentGenerator().generateContentStream({''')
replace('''    for await (const chunk of streamResponse) {
      const currentChunkStartCounter = runningFunctionCallCounter;''', '''    for await (const chunk of streamResponse) {
      this.admitNativeRecording();
      const currentChunkStartCounter = runningFunctionCallCounter;''')
replace('''        yield hookResult.response;
      } else {
        yield chunk;''', '''        this.admitNativeRecording();
        yield hookResult.response;
      } else {
        yield chunk;''')
# A refusal can also reject native history rollback in the error cleanup. Always
# settle its serialization promise, so later dispatch can promptly refuse too.
replace('''      } finally {
        if (!isSuccess) {''', '''      } finally {
        try {
        if (!isSuccess) {''')
replace('''        streamDoneResolver();
      }
    };
    return streamWithRetries.call(this);''', '''        } finally {
          streamDoneResolver();
        }
      }
    };
    return streamWithRetries.call(this);''')
if '--check' in sys.argv[2:]:
    print('Pinned native Gemini streaming admission applies; no files changed.')
else:
    if target.is_symlink():
        target.unlink()
    target.write_text(source)
    print('Applied disposable native Gemini streaming admission; production is unchanged.')
print(hashlib.sha256(source.encode()).hexdigest(), target.name)
