// Issue #2498: does start-command label an ordinary exit (1) as memory
// exhaustion just because Docker's sticky State.OOMKilled flag is set?
// Usage: npm pack start-command@0.35.1 && tar xzf start-command-0.35.1.tgz
//        node experiments/issue-2498-start-command-exit-reason.cjs ./package
const path = require('path');
const root = path.resolve(process.argv[2] || './package');
const { resolveExitReason, resolveMemoryExhaustion } = require(path.join(root, 'src/lib/exit-reason.js'));
for (const [exitCode, oomKilled] of [
  [0, true],
  [1, true],
  [1, false],
  [137, true],
  [137, false],
]) {
  console.log(`exit=${exitCode} oomKilled=${oomKilled} -> exitReason=${JSON.stringify(resolveExitReason({ exitCode, oomKilled }))} memory=${JSON.stringify(resolveMemoryExhaustion({ exitCode, oomKilled }))}`);
}
