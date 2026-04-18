const USE_M_URL = 'https://unpkg.com/use-m/use.js';
const { use } = eval(await (await fetch(USE_M_URL)).text());
const { $ } = await use('command-stream');

const owner = 'link-assistant';
const repo = 'hive-mind';
const prNumber = 1459;

// Create initial comment
const result = await $`gh pr comment ${prNumber} --repo ${owner}/${repo} --body ${'Test quote issue'}`;
const output = result.stdout?.toString() || result.toString() || '';
const match = output.match(/issuecomment-(\d+)/);
const commentId = match?.[1];
console.log('Comment created:', commentId);

// Body with single quotes in content (like C# code)
const body = `## 📖 Read tool use

**File:** \`/tmp/test.cs\`

<details open>
<summary>📤 Output (✅ success)</summary>

\`\`\`
var x = $"Hello {Name}";
var y = 'hello world';
Console.WriteLine($"It's a test: {x}");
\`\`\`

</details>

---

<details>
<summary>📄 Raw JSON</summary>

\`\`\`json
[{"type": "test", "value": "it's here"}]
\`\`\`

</details>`;

console.log('Body length:', body.length);
console.log('Body contains single quotes:', body.includes("'"));

try {
  await $`gh api repos/${owner}/${repo}/issues/comments/${commentId} -X PATCH -f body=${body}`;
  console.log('Edit succeeded');
} catch (e) {
  console.error('Edit failed:', e.message);
}

// Verify
const resp = await $`gh api repos/${owner}/${repo}/issues/comments/${commentId} --jq .body`;
const actual = (resp.stdout?.toString() || resp.toString() || '').trim();
console.log('Actual body length:', actual.length);
console.log('First char code:', actual.charCodeAt(0));
console.log('Last char code:', actual.charCodeAt(actual.length - 1));
console.log('Starts with single quote:', actual.startsWith("'"));
console.log('Match:', actual === body);

if (actual !== body) {
  console.log('\n=== FIRST 200 CHARS OF ACTUAL ===');
  console.log(actual.substring(0, 200));
}

// Cleanup
await $`gh api repos/${owner}/${repo}/issues/comments/${commentId} -X DELETE`;
console.log('Cleaned up');
