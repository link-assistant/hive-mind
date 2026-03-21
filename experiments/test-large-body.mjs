// Test: large body with complex content (>4000 chars like the failing case)
const USE_M_URL = 'https://unpkg.com/use-m/use.js';
const { use } = eval(await (await fetch(USE_M_URL)).text());
const { $ } = await use('command-stream');

const owner = 'link-assistant';
const repo = 'hive-mind';
const prNumber = 1459;

// Create initial comment
const result = await $`gh pr comment ${prNumber} --repo ${owner}/${repo} --body ${'Test large body edit'}`;
const output = result.stdout?.toString() || result.toString() || '';
const match = output.match(/issuecomment-(\d+)/);
const commentId = match?.[1];
console.log('Comment created:', commentId);

// Generate a large body (~4500 chars) with code blocks, backticks, etc.
const csharpCode = `using System;
using System.Net;
using System.Threading;
using System.Threading.Tasks;
using System.Collections.Generic;

namespace Magic.Kernel.Devices.Streams
{
    public class ClawStreamDevice : StreamDevice, IDisposable
    {
        private readonly HttpListener _listener;
        private readonly Dictionary<string, Func<object, Task<object>>> _methods = new();
        private readonly CancellationTokenSource _cts = new();
        private readonly object _lockObj = new();
        
        public string BaseUrl { get; private set; }
        public int Port { get; private set; }
        
        // Lockout progression: 10s, 30s, 1m, 5m, 15m, 30m, 1h, 1d, permanent
        private static readonly TimeSpan[] LockoutDurations = new[]
        {
            TimeSpan.FromSeconds(10),
            TimeSpan.FromSeconds(30),
            TimeSpan.FromMinutes(1),
            TimeSpan.FromMinutes(5),
            TimeSpan.FromMinutes(15),
            TimeSpan.FromMinutes(30),
            TimeSpan.FromHours(1),
            TimeSpan.FromDays(1),
        };
        
        public ClawStreamDevice()
        {
            Port = 8080;
            BaseUrl = $"http://localhost:{Port}/";
        }
        
        public async Task StartAsync()
        {
            _listener = new HttpListener();
            _listener.Prefixes.Add(BaseUrl);
            _listener.Start();
            
            while (!_cts.Token.IsCancellationRequested)
            {
                var context = await _listener.GetContextAsync();
                _ = Task.Run(() => HandleRequest(context));
            }
        }
        
        private async Task HandleRequest(HttpListenerContext context)
        {
            var request = context.Request;
            var response = context.Response;
            
            try
            {
                if (request.Url?.AbsolutePath == "/authenticate" && request.HttpMethod == "POST")
                {
                    await HandleAuthenticate(request, response);
                }
                else if (request.Url?.AbsolutePath == "/entrypoint" && request.HttpMethod == "POST")
                {
                    await HandleEntrypoint(request, response);
                }
                else
                {
                    response.StatusCode = 404;
                    response.Close();
                }
            }
            catch (Exception ex)
            {
                response.StatusCode = 500;
                response.Close();
            }
        }
    }
}`.repeat(2);

const bodyToEdit = `## 📖 Read tool use

**File:** \`/tmp/gh-issue-solver-1774130096902/src/Libs/Magic.Kernel/Devices/Streams/ClawStreamDevice.cs\`

<details open>
<summary>📤 Output (✅ success)</summary>

\`\`\`
${csharpCode}
\`\`\`

</details>

---

<details>
<summary>📄 Raw JSON</summary>

\`\`\`json
[
  {
    "type": "assistant",
    "message": {
      "model": "claude-sonnet-4-6",
      "content": [{"type": "tool_use", "id": "toolu_test", "name": "Read", "input": {"file_path": "/tmp/test.cs"}}]
    }
  },
  {
    "type": "user",
    "message": {
      "content": [{"type": "tool_result", "tool_use_id": "toolu_test", "content": "test output with \\"quotes\\""}]
    }
  }
]
\`\`\`

</details>`;

console.log('Body length:', bodyToEdit.length);

try {
  await $`gh api repos/${owner}/${repo}/issues/comments/${commentId} -X PATCH -f body=${bodyToEdit}`;
  console.log('Edit succeeded');
} catch (e) {
  console.error('Edit failed:', e.message);
}

// Verify
const resp = await $`gh api repos/${owner}/${repo}/issues/comments/${commentId} --jq .body`;
const actual = (resp.stdout?.toString() || resp.toString() || '').trim();
console.log('Actual body length:', actual.length);
console.log('Match:', actual === bodyToEdit);

if (actual !== bodyToEdit) {
  // Show first difference
  for (let i = 0; i < Math.max(actual.length, bodyToEdit.length); i++) {
    if (actual[i] !== bodyToEdit[i]) {
      console.log(`First difference at position ${i}: actual='${actual.substring(i, i+20)}' expected='${bodyToEdit.substring(i, i+20)}'`);
      break;
    }
  }
}

// Cleanup
await $`gh api repos/${owner}/${repo}/issues/comments/${commentId} -X DELETE`;
console.log('Test comment deleted');
