// Test: reproduce the exact merge behavior from the code
import { utils } from '../src/interactive-mode.lib.mjs';
const { createCollapsible, createRawJsonSection, escapeMarkdown, truncateMiddle, getToolIcon } = utils;

// Simulate the exact data from the log
const toolName = 'Read';
const toolIcon = getToolIcon(toolName);
const inputDisplay = '**File:** `/tmp/gh-issue-solver-1774130096902/src/Space.OS.ExecutionUnit/ExecutionUnitService.cs`';
const statusIcon = '✅';
const statusText = 'success';

// Simulated tool result content (abbreviated)
const content = 'using Magic.Kernel;\nnamespace Test { }';
const truncatedContent = truncateMiddle(content, { maxLines: 60, keepStart: 25, keepEnd: 25 });

const toolData = { type: 'assistant', message: { content: [{ type: 'tool_use' }] } };
const data = { type: 'user', message: { content: [{ type: 'tool_result' }] } };

const mergedComment = `## ${toolIcon} ${toolName} tool use

${inputDisplay}

${createCollapsible(`📤 Output (${statusIcon} ${statusText.toLowerCase()})`, '```\n' + escapeMarkdown(truncatedContent) + '\n```', true)}

---

${createRawJsonSection([toolData, data])}`;

console.log('Merged comment length:', mergedComment.length);
console.log('First 500 chars:');
console.log(mergedComment.substring(0, 500));
