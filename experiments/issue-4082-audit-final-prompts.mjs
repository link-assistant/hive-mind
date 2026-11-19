/* global console, process */
// Issue #4082 (PR feedback): render the final solve prompts of every tool with
// representative parameters and report markdown syntax and long single lines.
// Usage: node experiments/issue-4082-audit-final-prompts.mjs [--print]
const tools = ['claude', 'codex', 'agent', 'opencode', 'gemini', 'qwen'];
const params = {
  owner: 'owner',
  repo: 'repo',
  issueNumber: 1,
  issueUrl: 'https://github.com/owner/repo/issues/1',
  prNumber: 2,
  prUrl: 'https://github.com/owner/repo/pull/2',
  branchName: 'issue-1-abc',
  tempDir: '/tmp/work',
  workspaceTmpDir: '/tmp/work-tmp',
  isContinueMode: true,
  forkedRepo: null,
  modelSupportsVision: true,
  feedbackLines: ['📬 New comments detected from non-bot users:', '  - someone: "please fix"'],
  argv: { tool: 'claude', model: 'opus', verbose: true },
};
const markdown = [
  [/^#{1,6} /m, 'heading'],
  [/\*\*[^*\n]+\*\*/, 'bold'],
  [/```/, 'code fence'],
  [/\[[^\]\n]+\]\([^)\n]+\)/, 'link'],
  [/^\s*\|.*\|\s*$/m, 'table'],
];
for (const tool of tools) {
  const mod = await import(`../src/${tool}.prompts.lib.mjs`);
  const argv = { ...params.argv, tool };
  for (const [kind, build] of [
    ['user', mod.buildUserPrompt],
    ['system', mod.buildSystemPrompt],
  ]) {
    const text = build({ ...params, argv });
    const lines = text.split('\n');
    const longest = Math.max(...lines.map(l => l.length));
    const long = lines.filter(l => l.length > 400).length;
    const found = markdown.filter(([re]) => re.test(text)).map(([, n]) => n);
    console.log(`${tool.padEnd(8)} ${kind.padEnd(6)} lines=${String(lines.length).padStart(4)} chars=${String(text.length).padStart(6)} longest=${longest} lines>400=${long} markdown=[${found.join(', ')}]`);
    if (process.argv.includes('--print')) console.log(`---BEGIN ${tool} ${kind}---\n${text}\n---END---`);
  }
}
