#!/usr/bin/env python3
"""Wait for the native terminal's resumed chat before admitting its first prompt."""
import hashlib
import json
from pathlib import Path
import sys

package = Path(sys.argv[1]).resolve(strict=True)
if json.loads((package / 'package.json').read_text())['version'] != '0.65.0':
    raise SystemExit('Refusing an unpinned native Gemini package.')
bundle = package / 'bundle'
pins = {
    'interactiveCli-AVD3AKNJ.js': '1092664e6803b78047a74c8115d8f432c48ef459f121b57ac33c5543efe81a40',
    'chunk-DKZARV6U.js': 'ace42576cb7d8f0f2ef710e148cbfb81311929f42f5c3a50851e27cb5e744a07',
}
for name, expected in pins.items():
    if hashlib.sha256((bundle / name).read_bytes()).hexdigest() != expected:
        raise SystemExit('Refusing changed native Gemini terminal resume prerequisites.')
target = bundle / 'interactiveCli-AVD3AKNJ.js'
source = target.read_text()


def replace(before, after):
    global source
    if source.count(before) != 1:
        raise SystemExit('Ambiguous native terminal resume context; no files changed.')
    source = source.replace(before, after)


# React state queued by the resume effect is not visible to the initial-prompt
# effect in the same render. Start with an explicit admission barrier instead.
replace('''  const [isResuming, setIsResuming] = (0, import_react108.useState)(false);''', '''  const [isResuming, setIsResuming] = (0, import_react108.useState)(false);
  const [initialResumeReady, setInitialResumeReady] = (0, import_react108.useState)(!nativeGeminiHistorySelected() || !resumedSessionData);''')
replace('''      setIsResuming(true);
      try {
        setQuittingMessages(null);''', '''      if (nativeGeminiHistorySelected()) setInitialResumeReady(false);
      setIsResuming(true);
      try {
        setQuittingMessages(null);''')
replace('''        await config.getGeminiClient()?.resumeChat(clientHistory, resumedData);
      } catch (error) {''', '''        await config.getGeminiClient()?.resumeChat(clientHistory, resumedData);
        if (nativeGeminiHistorySelected()) setInitialResumeReady(true);
      } catch (error) {''')
replace('''  return { loadHistoryForResume, isResuming };''', '''  return { loadHistoryForResume, isResuming, initialResumeReady };''')
replace('''  const { loadHistoryForResume, isResuming } = useSessionResume({''', '''  const { loadHistoryForResume, isResuming, initialResumeReady } = useSessionResume({''')
replace('''  const isInputActive = !initError && !isProcessing && !isResuming &&''', '''  const isInputActive = initialResumeReady && !initError && !isProcessing && !isResuming &&''')
replace('''    if (initialPrompt && isConfigInitialized && !initialPromptSubmitted.current &&''', '''    if (initialPrompt && initialResumeReady && isConfigInitialized && !initialPromptSubmitted.current &&''')
replace('''  }, [
    initialPrompt,
    isConfigInitialized,
    handleFinalSubmit,''', '''  }, [
    initialPrompt,
    initialResumeReady,
    isConfigInitialized,
    handleFinalSubmit,''')
if '--check' in sys.argv[2:]:
    print('Pinned native Gemini terminal resume admission applies; no files changed.')
else:
    if target.is_symlink():
        target.unlink()
    target.write_text(source)
    print('Applied disposable native Gemini terminal resume admission; production is unchanged.')
print(hashlib.sha256(source.encode()).hexdigest(), target.name)
