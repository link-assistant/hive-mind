#!/usr/bin/env node

// Test script for code block escaping in log content

// Simulate log content with code blocks (like what we see in the actual logs)
const testLogContent = `# Solve.mjs Log - 2025-11-10T12:46:02.458Z

[2025-11-10T12:46:02.459Z] [INFO] 📁 Log file: /home/hive/solve-2025-11-10T12-46-02-457Z.log
[2025-11-10T12:46:02.463Z] [INFO]    (All output will be logged here)

Raw command:
\`\`\`
cd "/tmp/gh-issue-solver-1762778773815" && claude --output-format stream-json
\`\`\`

Some more log content here.

Another code block:
\`\`\`javascript
function example() {
  console.log("test");
}
\`\`\`

End of log.`;

// The escaping function
const escapeCodeBlocksInLog = (logContent) => {
  return logContent.replace(/```/g, '\\`\\`\\`');
};

console.log('=== ORIGINAL LOG CONTENT ===');
console.log(testLogContent);
console.log('\n=== ESCAPED LOG CONTENT ===');
const escaped = escapeCodeBlocksInLog(testLogContent);
console.log(escaped);

console.log('\n=== MARKDOWN COMMENT WITH ESCAPED CONTENT ===');
const markdownComment = `## 🚨 Solution Draft Failed
The automated solution draft encountered an error:
\`\`\`
CLAUDE execution failed
\`\`\`

<details>
<summary>Click to expand failure log</summary>

\`\`\`
${escaped}
\`\`\`
</details>`;

console.log(markdownComment);

console.log('\n=== VERIFICATION ===');
// Check that the escaped content doesn't contain unescaped triple backticks
const hasUnescapedBackticks = /```/.test(escaped);
console.log(`Escaped content contains unescaped triple backticks: ${hasUnescapedBackticks}`);

if (hasUnescapedBackticks) {
  console.log('❌ FAILED: Escaping did not work correctly');
  process.exit(1);
} else {
  console.log('✅ SUCCESS: All triple backticks were properly escaped');
}
