#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseCodexExecJsonOutput } from '../src/codex.lib.mjs';
import { parseAgentTokenUsage } from '../src/agent.lib.mjs';
import { parseOpenCodeTokenUsage } from '../src/opencode.lib.mjs';
import { buildCostInfoString } from '../src/github-cost-info.lib.mjs';
import { buildAgentBudgetStats, buildBudgetStatsString, mergeResultModelUsage } from '../src/claude.budget-stats.lib.mjs';

let passed = 0;
let failed = 0;

const test = (name, fn) => {
  try {
    fn();
    console.log(`PASS ${name}`);
    passed++;
  } catch (error) {
    console.log(`FAIL ${name}`);
    console.log(`   ${error.message}`);
    failed++;
  }
};

const read = path => fs.readFileSync(path, 'utf8');

const extractCodexJsonLines = text =>
  text
    .split('\n')
    .map(line => line.match(/\[INFO\]\s+(\{.*\})$/)?.[1])
    .filter(Boolean)
    .join('\n');

const stripInfoPrefixes = text =>
  text
    .split('\n')
    .map(line => line.replace(/^\[[^\]]+\]\s+\[INFO\]\s?/, ''))
    .join('\n');

const extractInfoJsonObjects = text => {
  const source = stripInfoPrefixes(text);
  const objects = [];

  for (let i = 0; i < source.length; i++) {
    if (source[i] !== '{' || (i > 0 && source[i - 1] !== '\n')) continue;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let j = i; j < source.length; j++) {
      const char = source[j];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
      } else if (char === '{') {
        depth++;
      } else if (char === '}') {
        depth--;
        if (depth === 0) {
          try {
            objects.push(JSON.parse(source.slice(i, j + 1)));
            i = j;
          } catch {
            // Ignore non-JSON text blocks that happen to contain balanced braces.
          }
          break;
        }
      }
    }
  }

  return objects;
};

const modelDisplayNames = {
  'claude-opus-4-6': 'Claude Opus 4.6',
  'claude-sonnet-4-6': 'Claude Sonnet 4.6',
  'claude-haiku-4-5-20251001': 'Claude Haiku 4.5',
};

test('committed Codex PR #1615 logs parse exact observed usage fields and totals', () => {
  const cases = [
    {
      file: 'docs/case-studies/issue-1600/logs/hive-mind-pr-1615-codex-initial.log',
      turns: 1,
      inputTokens: 58628,
      cacheReadTokens: 732032,
      outputTokens: 4030,
    },
    {
      file: 'docs/case-studies/issue-1600/logs/hive-mind-pr-1615-codex-auto-restart-1.log',
      turns: 2,
      inputTokens: 103451,
      cacheReadTokens: 1120512,
      outputTokens: 7061,
    },
    {
      file: 'docs/case-studies/issue-1600/logs/hive-mind-pr-1615-codex-auto-merge-1.log',
      turns: 3,
      inputTokens: 145623,
      cacheReadTokens: 1636352,
      outputTokens: 10334,
    },
  ];

  for (const fixture of cases) {
    const parsed = parseCodexExecJsonOutput(extractCodexJsonLines(read(fixture.file)), {}, 'gpt-5.4');
    assert.equal(parsed.tokenUsage.stepCount, fixture.turns, fixture.file);
    assert.equal(parsed.tokenUsage.inputTokens, fixture.inputTokens, fixture.file);
    assert.equal(parsed.tokenUsage.cacheReadTokens, fixture.cacheReadTokens, fixture.file);
    assert.equal(parsed.tokenUsage.outputTokens, fixture.outputTokens, fixture.file);
    assert.equal(parsed.tokenUsage.cacheWriteTokens, 0, fixture.file);
    assert.equal(parsed.tokenUsage.tokenFieldAvailability.cacheReadTokens, true, fixture.file);
    assert.equal(parsed.tokenUsage.tokenFieldAvailability.cacheWriteTokens, false, fixture.file);
    assert.deepEqual(parsed.observedUsageFieldSets.at(-1), ['input_tokens', 'cached_input_tokens', 'output_tokens'], fixture.file);

    const costInfo = buildCostInfoString(null, null, {
      modelName: 'gpt-5.4',
      provider: 'OpenAI',
      tokenUsage: parsed.tokenUsage,
    });
    assert.equal(costInfo.includes('cache read'), true, fixture.file);
    assert.equal(costInfo.includes('cache write'), false, fixture.file);
  }
});

test('committed Claude web-capture log keeps result model usage, costs, and output detail lines', () => {
  const objects = extractInfoJsonObjects(read('docs/case-studies/issue-1600/logs/web-capture-pr-55-claude-code.log'));
  const resultEvent = objects.find(object => object.type === 'result' && object.modelUsage);
  assert.ok(resultEvent, 'result event with modelUsage should be present');
  assert.equal(resultEvent.total_cost_usd, 3.58761405);

  const modelUsage = {};
  mergeResultModelUsage(modelUsage, resultEvent.modelUsage);
  for (const [modelId, usage] of Object.entries(modelUsage)) {
    usage.modelName = modelDisplayNames[modelId] || modelId;
    usage.modelInfo = { limit: { context: usage._resultContextWindow, output: usage._resultMaxOutputTokens } };
    usage.costUSD = usage._resultCostUSD;
  }

  assert.equal(modelUsage['claude-opus-4-6'].inputTokens, 2965);
  assert.equal(modelUsage['claude-opus-4-6'].cacheCreationTokens, 95081);
  assert.equal(modelUsage['claude-opus-4-6'].cacheReadTokens, 4635997);
  assert.equal(modelUsage['claude-opus-4-6'].outputTokens, 19708);
  assert.equal(modelUsage['claude-sonnet-4-6'].outputTokens, 1786);
  assert.equal(modelUsage['claude-haiku-4-5-20251001'].outputTokens, 282);

  const stats = buildBudgetStatsString({ modelUsage, subSessions: [] });
  assert.equal(stats.includes('Context window:'), false);
  assert.match(stats, /Claude Opus 4\.6/);
  assert.match(stats, /19\.7K \/ 64K \(31%\) output tokens/);
  assert.match(stats, /1\.8K \/ 32K \(6%\) output tokens/);
  assert.match(stats, /282 \/ 32K \(1%\) output tokens/);
  assert.match(stats, /\$3\.419780 cost/);
  assert.match(stats, /\$0\.137594 cost/);
  assert.match(stats, /\$0\.030241 cost/);
});

test('previous Agent/OpenCode-style log extracts step_finish tokens, limits, and zero cache write availability', () => {
  const objects = extractInfoJsonObjects(read('docs/case-studies/issue-1526/agent-cli-log.txt'));
  const ndjson = objects
    .filter(object => object.type === 'step_finish' && object.part?.tokens)
    .map(object => JSON.stringify(object))
    .join('\n');
  const agentUsage = parseAgentTokenUsage(ndjson);
  const opencodeUsage = parseOpenCodeTokenUsage(ndjson);

  for (const usage of [agentUsage, opencodeUsage]) {
    assert.equal(usage.stepCount, 23);
    assert.equal(usage.inputTokens, 71551);
    assert.equal(usage.outputTokens, 4020);
    assert.equal(usage.reasoningTokens, 0);
    assert.equal(usage.cacheReadTokens, 322656);
    assert.equal(usage.cacheWriteTokens, 0);
    assert.equal(usage.tokenFieldAvailability.cacheWriteTokens, true);
    assert.equal(usage.requestedModelId, 'minimax-m2.5-free');
    assert.equal(usage.respondedModelId, 'MiniMax-M2.5');
    assert.equal(usage.contextLimit, 204800);
    assert.equal(usage.outputLimit, 32000);
    assert.equal(usage.peakContextUsage, 20383);
  }

  const costInfo = buildCostInfoString(null, null, {
    modelName: 'MiniMax-M2.5',
    provider: 'OpenCode Zen',
    isOpencodeFreeModel: true,
    opencodeCost: 0,
    tokenUsage: opencodeUsage,
  });
  assert.match(costInfo, /322,656 cache read/);
  assert.match(costInfo, /0 cache write/);

  const budgetStats = buildBudgetStatsString(
    buildAgentBudgetStats(agentUsage, {
      modelId: 'opencode/minimax-m2.5-free',
      modelName: 'MiniMax-M2.5',
      totalCostUSD: 0,
    })
  );
  assert.match(budgetStats, /20\.4K \/ 204\.8K \(10%\) input tokens/);
  assert.match(budgetStats, /4\.0K \/ 32K \(13%\) output tokens/);
});

console.log(`\nPassed: ${passed}  Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
