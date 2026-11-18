/* global console */
// Check that extractFrameText reads the text of the real bidirectional frames (PR #4083 feedback).
import { utils } from '../src/bidirectional-interactive.lib.mjs';
const { formatFeedbackForClaude, buildInitialUserFrame } = utils;
import { extractFrameText, formatPromptLogBlock } from '../src/prompt-log.lib.mjs';

for (const frame of [formatFeedbackForClaude('Line one\nLine two', { kind: 'metadata' }), buildInitialUserFrame('Initial\nprompt')]) {
  console.log(frame);
  console.log(formatPromptLogBlock({ tool: 'Claude', kind: 'live', text: extractFrameText(frame), delivery: 'a stream-json frame on Claude stdin' }));
}
