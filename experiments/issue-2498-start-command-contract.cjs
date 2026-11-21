// Bounded compatibility and scope probe against the actual published package.
// Usage: npm pack start-command@0.35.2; tar xzf start-command-0.35.2.tgz
//        node experiments/issue-2498-start-command-contract.cjs ./package
// This uses synthetic counters; it never starts Docker or allocates large inputs.
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(process.argv[2] || './package');
const { resolveExitReason, resolveMemoryExhaustion } = require(path.join(root, 'src/lib/exit-reason.js'));
const { parseCgroupMemorySample, describeCgroupOomScope } = require(path.join(root, 'src/lib/cgroup-memory.js'));

for (const exitCode of [0, 1, 42, 127, 143]) {
  const input = { exitCode, oomKilled: true, cgroupMemory: { oomEvents: 1, oomKills: 3 } };
  assert.equal(resolveMemoryExhaustion(input), null);
  assert.doesNotMatch(resolveExitReason(input) || '', /memory-exhaustion/);
  console.log(`exit=${exitCode}: earlier container OOM is not the terminal cause`);
}
for (const oomKilled of [false, true]) {
  const input = { exitCode: 137, oomKilled, cgroupMemory: { oomEvents: 1, oomKills: 3 } };
  assert.match(resolveExitReason(input), /memory-exhaustion/);
  assert.equal(resolveMemoryExhaustion(input).memoryExhausted, true);
}
console.log('exit=137: task cgroup counters identify OOM even without the Docker flag');

// memory.oom.group=1 can kill three processes for one container OOM.
// The kernel does not define oom and oom_kill as comparable event counters.
const counters = parseCgroupMemorySample('3135373312 3135373312 1 3');
assert.equal(counters.oomEvents, 1);
assert.equal(counters.oomKills, 3);
console.log(JSON.stringify({ groupOomExample: counters, upstreamScope: describeCgroupOomScope(counters), evidenceSupports: 'scope unknown; compatible with a container group OOM' }, null, 2));
