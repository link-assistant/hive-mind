#!/usr/bin/env node

globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;

import { calculateSessionTokens, fetchModelInfo, calculateModelCost } from '../src/claude.lib.mjs';

async function testPerModelUsageCalculation() {
  console.log('Testing per-model usage calculation with models.dev integration...\n');

  // Use a recent session that has multiple models
  // First, let's find the most recent session with data
  const os = await use('os');
  const path = await use('path');
  const fs = await use('fs/promises');
  const homeDir = os.homedir();

  // Try to find a recent session file
  const projectsDir = path.join(homeDir, '.claude', 'projects');

  try {
    const projects = await fs.readdir(projectsDir);
    let foundSession = null;
    let foundTempDir = null;

    for (const project of projects) {
      const projectPath = path.join(projectsDir, project);
      const stats = await fs.stat(projectPath);

      if (stats.isDirectory()) {
        const files = await fs.readdir(projectPath);
        const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));

        if (jsonlFiles.length > 0) {
          // Use the first session we find
          foundSession = jsonlFiles[0].replace('.jsonl', '');
          foundTempDir = project.replace(/^-/, '/').replace(/-/g, '/');
          console.log(`Found session: ${foundSession}`);
          console.log(`Project dir: ${project} -> Temp dir: ${foundTempDir}\n`);
          break;
        }
      }
    }

    if (!foundSession) {
      console.log('⚠️ No session files found. Run a Claude command first.');
      process.exit(0);
    }

    // Test token calculation with per-model breakdown
    console.log('🔍 Calculating token usage...\n');
    const tokenUsage = await calculateSessionTokens(foundSession, foundTempDir);

    if (tokenUsage) {
      console.log('✅ Token calculation successful!\n');

      // Show per-model breakdown
      if (tokenUsage.modelUsage) {
        console.log('📊 Per-Model Usage Breakdown:');
        console.log('=' .repeat(60));

        for (const [modelId, usage] of Object.entries(tokenUsage.modelUsage)) {
          console.log(`\n🤖 ${usage.modelName || modelId}`);
          console.log('-'.repeat(60));

          // Show all model characteristics if available
          if (usage.modelInfo) {
            const info = usage.modelInfo;
            console.log(`   Model ID: ${info.id}`);
            console.log(`   Provider: ${info.provider || 'Unknown'}`);

            if (info.limit?.context) {
              console.log(`   Context window: ${info.limit.context.toLocaleString()} tokens`);
            }

            if (info.limit?.output) {
              console.log(`   Max output: ${info.limit.output.toLocaleString()} tokens`);
            }

            if (info.modalities) {
              console.log(`   Input modalities: ${info.modalities.input?.join(', ') || 'N/A'}`);
              console.log(`   Output modalities: ${info.modalities.output?.join(', ') || 'N/A'}`);
            }

            if (info.knowledge) {
              console.log(`   Knowledge cutoff: ${info.knowledge}`);
            }

            if (info.release_date) {
              console.log(`   Released: ${info.release_date}`);
            }

            console.log(`   Capabilities: ${[
              info.attachment ? 'Attachments' : null,
              info.reasoning ? 'Reasoning' : null,
              info.temperature ? 'Temperature' : null,
              info.tool_call ? 'Tool calls' : null
            ].filter(Boolean).join(', ') || 'N/A'}`);

            console.log(`   Open weights: ${info.open_weights ? 'Yes' : 'No'}`);
            console.log('');
          } else {
            console.log(`   ⚠️  Model info not available from models.dev`);
            console.log('');
          }

          // Show usage
          console.log(`   Usage:`);
          console.log(`     Input tokens: ${usage.inputTokens.toLocaleString()}`);

          if (usage.cacheCreationTokens > 0) {
            console.log(`     Cache creation tokens: ${usage.cacheCreationTokens.toLocaleString()}`);
          }

          if (usage.cacheReadTokens > 0) {
            console.log(`     Cache read tokens: ${usage.cacheReadTokens.toLocaleString()}`);
          }

          console.log(`     Output tokens: ${usage.outputTokens.toLocaleString()}`);

          if (usage.webSearchRequests > 0) {
            console.log(`     Web search requests: ${usage.webSearchRequests}`);
          }

          // Show detailed cost calculation
          if (usage.costUSD !== null && usage.costUSD !== undefined && usage.costBreakdown) {
            console.log('');
            console.log(`   Cost Calculation (USD):`);

            const breakdown = usage.costBreakdown;

            if (breakdown.input.tokens > 0) {
              console.log(`     Input: ${breakdown.input.tokens.toLocaleString()} tokens × $${breakdown.input.costPerMillion}/M = $${breakdown.input.cost.toFixed(6)}`);
            }

            if (breakdown.cacheWrite.tokens > 0) {
              console.log(`     Cache write: ${breakdown.cacheWrite.tokens.toLocaleString()} tokens × $${breakdown.cacheWrite.costPerMillion}/M = $${breakdown.cacheWrite.cost.toFixed(6)}`);
            }

            if (breakdown.cacheRead.tokens > 0) {
              console.log(`     Cache read: ${breakdown.cacheRead.tokens.toLocaleString()} tokens × $${breakdown.cacheRead.costPerMillion}/M = $${breakdown.cacheRead.cost.toFixed(6)}`);
            }

            if (breakdown.output.tokens > 0) {
              console.log(`     Output: ${breakdown.output.tokens.toLocaleString()} tokens × $${breakdown.output.costPerMillion}/M = $${breakdown.output.cost.toFixed(6)}`);
            }

            console.log(`     ─────────────────────────────────`);
            console.log(`     Total: $${usage.costUSD.toFixed(6)}`);
          } else if (usage.modelInfo === null) {
            console.log('');
            console.log(`   Cost: Not available (could not fetch pricing from models.dev)`);
          }
        }

        // Show totals
        console.log('\n' + '='.repeat(60));
        console.log('📈 TOTAL ACROSS ALL MODELS:');
        console.log('='.repeat(60));
        console.log(`   Input tokens: ${tokenUsage.inputTokens.toLocaleString()}`);

        if (tokenUsage.cacheCreationTokens > 0) {
          console.log(`   Cache creation tokens: ${tokenUsage.cacheCreationTokens.toLocaleString()}`);
        }

        if (tokenUsage.cacheReadTokens > 0) {
          console.log(`   Cache read tokens: ${tokenUsage.cacheReadTokens.toLocaleString()}`);
        }

        console.log(`   Output tokens: ${tokenUsage.outputTokens.toLocaleString()}`);
        console.log(`   Total tokens: ${tokenUsage.totalTokens.toLocaleString()}`);

        if (tokenUsage.totalCostUSD !== null && tokenUsage.totalCostUSD !== undefined) {
          console.log(`   💰 Total Cost: $${tokenUsage.totalCostUSD.toFixed(6)}`);
        }
      } else {
        console.log('⚠️ No per-model data available (old format)');
      }
    } else {
      console.log('⚠️ No token data found');
    }

    // Test fetchModelInfo separately
    console.log('\n\n🔍 Testing model info fetching from models.dev...\n');
    const testModels = [
      'claude-sonnet-4-5-20250929',
      'claude-haiku-4-5-20251001'
    ];

    for (const modelId of testModels) {
      console.log(`Fetching info for: ${modelId}`);
      const modelInfo = await fetchModelInfo(modelId);

      if (modelInfo) {
        console.log(`  ✅ Found: ${modelInfo.name}`);
        console.log(`     Context: ${modelInfo.limit?.context?.toLocaleString()} tokens`);
        console.log(`     Input cost: $${modelInfo.cost?.input}/M tokens`);
        console.log(`     Output cost: $${modelInfo.cost?.output}/M tokens`);
        console.log(`     Cache read: $${modelInfo.cost?.cache_read}/M tokens`);
        console.log(`     Cache write: $${modelInfo.cost?.cache_write}/M tokens`);
      } else {
        console.log(`  ❌ Not found`);
      }
      console.log();
    }

    // Test cost calculation
    console.log('\n🔍 Testing cost calculation...\n');
    const mockUsage = {
      inputTokens: 1000,
      cacheCreationTokens: 5000,
      cacheReadTokens: 10000,
      outputTokens: 2000
    };

    const mockModelInfo = {
      cost: {
        input: 3,
        output: 15,
        cache_read: 0.3,
        cache_write: 3.75
      }
    };

    const cost = calculateModelCost(mockUsage, mockModelInfo);
    console.log('Mock usage:');
    console.log(`  Input: ${mockUsage.inputTokens.toLocaleString()} tokens`);
    console.log(`  Cache creation: ${mockUsage.cacheCreationTokens.toLocaleString()} tokens`);
    console.log(`  Cache read: ${mockUsage.cacheReadTokens.toLocaleString()} tokens`);
    console.log(`  Output: ${mockUsage.outputTokens.toLocaleString()} tokens`);
    console.log(`\nCalculated cost: $${cost.toFixed(6)}`);

    // Manual verification:
    const manualCost = (
      (mockUsage.inputTokens / 1000000) * mockModelInfo.cost.input +
      (mockUsage.cacheCreationTokens / 1000000) * mockModelInfo.cost.cache_write +
      (mockUsage.cacheReadTokens / 1000000) * mockModelInfo.cost.cache_read +
      (mockUsage.outputTokens / 1000000) * mockModelInfo.cost.output
    );
    console.log(`Manual verification: $${manualCost.toFixed(6)}`);
    console.log(cost === manualCost ? '✅ Cost calculation correct!' : '❌ Cost calculation mismatch!');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

testPerModelUsageCalculation();
