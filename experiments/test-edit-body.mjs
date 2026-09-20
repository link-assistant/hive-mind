// Test: create a comment on the existing PR, then try to edit it with complex body
// This reproduces the empty body issue

const USE_M_URL = 'https://unpkg.com/use-m/use.js';
const { use } = eval(await (await fetch(USE_M_URL)).text());
const { $ } = await use('command-stream');

const owner = 'link-assistant';
const repo = 'hive-mind';
const prNumber = 1459;

// Step 1: Create a test comment
const testInitial = '## Test: editComment body truncation\n\n_Testing..._';
const result = await $`gh pr comment ${prNumber} --repo ${owner}/${repo} --body ${testInitial}`;
const output = result.stdout?.toString() || result.toString() || '';
const match = output.match(/issuecomment-(\d+)/);
const commentId = match?.[1];
console.log('Comment created:', commentId);

if (!commentId) {
  console.error('Failed to get comment ID');
  process.exit(1);
}

// Step 2: Try to edit it with a body containing code blocks, backticks, C# code
const testBody = `## 📖 Read tool use

**File:** \`/tmp/test/src/Libs/Magic.Kernel/Devices/Streams/ClawStreamDevice.cs\`

<details open>
<summary>📤 Output (✅ success)</summary>

\`\`\`
using System;
namespace Test {
    public class Foo {
        // This is a test with 'single quotes' and "double quotes"
        public string Name { get; set; }
        public async Task<int> Run(string[] args) {
            var x = $"Hello {Name}";
            return 0;
        }
    }
}
\`\`\`

</details>

---

<details>
<summary>📄 Raw JSON</summary>

\`\`\`json
[{"type": "test", "content": "hello \\"world\\""}]
\`\`\`

</details>`;

console.log('Body length:', testBody.length);

try {
  await $`gh api repos/${owner}/${repo}/issues/comments/${commentId} -X PATCH -f body=${testBody}`;
  console.log('Edit succeeded');
} catch (e) {
  console.error('Edit failed:', e.message);
}

// Step 3: Fetch the comment and check the body
const response = await $`gh api repos/${owner}/${repo}/issues/comments/${commentId} --jq .body`;
const actualBody = response.stdout?.toString() || response.toString() || '';
console.log('\nActual body length:', actualBody.trim().length);
console.log('Expected body length:', testBody.length);
console.log('Match:', actualBody.trim() === testBody);

if (actualBody.trim() !== testBody) {
  console.log('\n=== ACTUAL BODY ===');
  console.log(actualBody.trim());
  console.log('\n=== EXPECTED BODY ===');
  console.log(testBody);
}

// Cleanup: delete the test comment
await $`gh api repos/${owner}/${repo}/issues/comments/${commentId} -X DELETE`;
console.log('\nTest comment deleted');
