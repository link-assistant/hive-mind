// Test whether gh api -f body=<large content with special chars> works correctly
import { execSync } from 'child_process';

// Create a test body with markdown, code blocks, backticks, etc.
const testBody = `## 📖 Read tool use

**File:** \`/tmp/test.cs\`

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

console.log(`Body length: ${testBody.length}`);
console.log(`Body contains: single quotes=${testBody.includes("'")}, double quotes=${testBody.includes('"')}, backticks=${testBody.includes('`')}, dollar=${testBody.includes('$')}`);

// Try posting this via a test - we can't actually test gh api without a real comment
// But let's test the quoting
const { buildShellCommand, quote } = await import('/tmp/package/js/src/$.quote.mjs');

const quoted = quote(testBody);
console.log(`\nQuoted body length: ${quoted.length}`);
console.log(`Quoted body starts with: ${quoted.substring(0, 50)}`);
console.log(`Quoted body ends with: ${quoted.substring(quoted.length - 50)}`);

// Now let's test what the full command would look like
const owner = 'xlab2016';
const repo = 'space_db_private';
const commentId = '12345';
const cmd = buildShellCommand(
  ['gh api repos/', '/', '/issues/comments/', ' -X PATCH -f body=', ''],
  [owner, repo, commentId, testBody]
);
console.log(`\nFull command length: ${cmd.length}`);
console.log(`Command starts with: ${cmd.substring(0, 100)}`);
