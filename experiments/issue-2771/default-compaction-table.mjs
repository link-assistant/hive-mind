// Prints the compaction settings hive-mind applies per tool with the default
// --sub-session-size (150k), with `default` (tool's own threshold) and with 500k.
import { parseSubSessionSize } from '../../src/sub-session-size.lib.mjs';
import { resolvePricingTier, buildGeminiFamilyCompactionSettings, buildCodexPricingTierConfigArgs, applyClaudePricingTierToEnv } from '../../src/pricing-tier.lib.mjs';
import { getClaudeEnv } from '../../src/config.lib.mjs';

const cases = [
  ['claude', 'opus', 'claude-opus-5-5'],
  ['claude', 'haiku', 'claude-haiku-5-5'],
  ['codex', 'gpt-6.1-sol', 'gpt-6.1-sol'],
  ['gemini', 'gemini-3.1-pro-preview', 'gemini-3.1-pro-preview'],
  ['gemini', 'gemini-3-flash-preview', 'gemini-3-flash-preview'],
  ['qwen', 'qwen3-coder-plus', 'qwen3-coder-plus'],
];
for (const subSessionSize of ['150k', 'default', '500k']) {
  console.log(`\n--sub-session-size ${subSessionSize}`);
  for (const [tool, model, modelId] of cases) {
    const tier = resolvePricingTier({ tool, model, modelId, subSessionSize });
    const parsedSubSessionSize = parseSubSessionSize(subSessionSize);
    let out;
    if (tool === 'claude') {
      const env = getClaudeEnv({ model: modelId, subSessionSize: parsedSubSessionSize, pricingTier: tier });
      out = Object.entries(env)
        .filter(([k]) => /1M|COMPACT|FAST/.test(k))
        .map(([k, v]) => `${k}=${v}`)
        .join(' ');
    } else if (tool === 'codex') {
      const a = buildCodexPricingTierConfigArgs({ tier, parsedSubSessionSize });
      out = [...a.serviceTierArgs, ...a.contextWindowArgs, ...a.subSessionSizeArgs].filter(x => x !== '-c').join(' ');
    } else {
      out = JSON.stringify(buildGeminiFamilyCompactionSettings({ tool, modelId, parsedSubSessionSize, longContext: tier.longContext }));
    }
    console.log(`  ${tool.padEnd(6)} ${model.padEnd(24)} long=${tier.longContext ? 'yes' : 'no '} ${out}`);
  }
}
