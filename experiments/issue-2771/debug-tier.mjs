// Debug helper: print resolved pricing tiers for a few inputs.
import { resolvePricingTier, applyClaudePricingTierToEnv, getShortContextTokens } from '../../src/pricing-tier.lib.mjs';
import { buildAgentCommanderControllerOptions } from '../../src/agent-commander.lib.mjs';
console.log(getShortContextTokens('claude', 'claude-haiku-5-5'));
const t = resolvePricingTier({ tool: 'claude', model: 'haiku', modelId: 'claude-haiku-5-5', subSessionSize: '150k' });
console.log(t);
const env = {};
console.log(applyClaudePricingTierToEnv(env, t), env);
console.log(JSON.stringify(buildAgentCommanderControllerOptions({ tool: 'claude', tempDir: '/tmp', prompt: 'p', argv: { model: 'opus[1m]', subSessionSize: '150k' } }), null, 1));
