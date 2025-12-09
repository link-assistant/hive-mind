#!/usr/bin/env node
/**
 * Experiment: Test comment ID capture in postComment
 *
 * This script tests whether comment IDs are being properly captured
 * when posting comments via gh pr comment.
 */

// Use dynamic import like the main code does
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}
const { $ } = await use('command-stream');

const OWNER = 'link-assistant';
const REPO = 'hive-mind';
const PR_NUMBER = 846;

// Simulate the postComment logic from interactive-mode.lib.mjs
async function postComment(body, verbose = true) {
  try {
    console.log(`\n📝 Posting comment...`);
    const result = await $`gh pr comment ${PR_NUMBER} --repo ${OWNER}/${REPO} --body ${body}`;

    // Log the raw result for analysis
    console.log('result type:', typeof result);
    console.log('result keys:', Object.keys(result));
    console.log('result.stdout type:', typeof result.stdout);
    console.log('result.stdout value:', result.stdout);

    // Current (fixed) logic:
    const output = result.stdout?.toString() || result.toString() || '';
    console.log('Processed output:', output);

    const match = output.match(/issuecomment-(\d+)/);
    console.log('Regex match:', match);

    const commentId = match ? match[1] : null;
    console.log('Extracted comment ID:', commentId);

    return commentId;
  } catch (error) {
    console.error('Error posting comment:', error.message);
    return null;
  }
}

// Simulate the edit comment logic
async function editComment(commentId, body) {
  try {
    console.log(`\n📝 Editing comment ${commentId}...`);
    await $`gh api repos/${OWNER}/${REPO}/issues/comments/${commentId} -X PATCH -f body=${body}`;
    console.log('✅ Comment edited successfully');
    return true;
  } catch (error) {
    console.error('Error editing comment:', error.message);
    return false;
  }
}

async function testCommentFlow() {
  console.log('Testing comment ID capture and edit flow...\n');
  console.log('This test mimics what happens during interactive mode:');
  console.log('1. Post a "tool use" comment');
  console.log('2. Capture the comment ID');
  console.log('3. Edit the comment to add "tool result"');
  console.log('');

  // Step 1: Post initial tool use comment
  const toolUseBody = `## 💻 Tool use: Bash

<details open>
<summary>📋 Command</summary>

\`\`\`bash
echo "test"
\`\`\`

</details>

_⏳ Waiting for result..._

---

<details>
<summary>📄 Raw JSON</summary>

\`\`\`json
[{"type": "tool_use", "id": "test-${Date.now()}"}]
\`\`\`

</details>`;

  const commentId = await postComment(toolUseBody);

  if (!commentId) {
    console.log('\n❌ FAILED: Could not capture comment ID');
    console.log('This means tool_use and tool_result cannot be merged!');
    return;
  }

  // Step 2: Wait a moment (simulating tool execution)
  console.log('\n⏳ Waiting 2 seconds (simulating tool execution)...');
  await new Promise(r => setTimeout(r, 2000));

  // Step 3: Edit the comment to add result
  const mergedBody = `## 💻 Tool use: Bash ✅

<details open>
<summary>📋 Command</summary>

\`\`\`bash
echo "test"
\`\`\`

</details>

### Result: Success

<details open>
<summary>📤 Output</summary>

\`\`\`
test
\`\`\`

</details>

---

<details>
<summary>📄 Raw JSON</summary>

\`\`\`json
[{"type": "tool_use", "id": "test-merged"}, {"type": "tool_result", "content": "test"}]
\`\`\`

</details>`;

  const editSuccess = await editComment(commentId, mergedBody);

  if (editSuccess) {
    console.log('\n✅ SUCCESS: Comment was edited to merge tool_use and tool_result');
    console.log(`Check the comment at: https://github.com/${OWNER}/${REPO}/pull/${PR_NUMBER}#issuecomment-${commentId}`);
  } else {
    console.log('\n❌ FAILED: Could not edit comment');
  }
}

testCommentFlow();
