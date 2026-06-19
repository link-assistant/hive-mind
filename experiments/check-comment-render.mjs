import { getModelInfoForComment } from '../src/models/index.mjs';
import { describeRequestedThinking } from '../src/config.lib.mjs';

const thinkingInfo = describeRequestedThinking({ think: 'high' });
const out = await getModelInfoForComment({
  requestedModel: 'opus',
  tool: 'claude',
  thinkingInfo,
});
console.log(out);
