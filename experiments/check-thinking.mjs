import { describeRequestedThinking } from '../src/config.lib.mjs';
const cases = [{}, { think: 'high' }, { think: 'off' }, { thinkingBudget: 16000 }, { think: 'max' }, { thinkingBudget: 0 }, { think: 'low', maxThinkingBudget: 40000 }];
for (const c of cases) console.log(JSON.stringify(c), '=>', describeRequestedThinking(c));
