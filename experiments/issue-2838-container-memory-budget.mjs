#!/usr/bin/env node
// Issue #2838: show what the memory preflight, the "System resources" line, the
// tool prompt and hive's --concurrency cap see in the current container.
// Usage: node experiments/issue-2838-container-memory-budget.mjs [concurrency]
import { readCgroupMemory } from '../src/solve.resource-diagnostics.lib.mjs';
import { buildMemoryBudgetPrompt, evaluateWorkerMemoryBudget, formatCgroupMemorySummary } from '../src/memory-budget.lib.mjs';
import { checkRAM } from '../src/memory-check.mjs';

const cgroup = readCgroupMemory();
console.log('cgroup:', cgroup);
await checkRAM(256, { log: async line => console.log(line) });
console.log('System resources:', formatCgroupMemorySummary(cgroup) ?? '(host MemFree line)');
console.log('Prompt guidance:', buildMemoryBudgetPrompt(cgroup) || '(none: no cgroup limit)');
console.log('hive worker budget:', evaluateWorkerMemoryBudget({ concurrency: Number(process.argv[2] || 2), cgroup }));
