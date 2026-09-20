// Smoke test: verify all 6 prompt builders include the work-language directive
process.env.NODE_PATH = './node_modules';

import { setLocale, setWorkLocale, t, initI18n } from '../src/i18n.lib.mjs';
import { buildSystemPrompt as buildClaude } from '../src/claude.prompts.lib.mjs';
import { buildSystemPrompt as buildAgent } from '../src/agent.prompts.lib.mjs';
import { buildSystemPrompt as buildCodex } from '../src/codex.prompts.lib.mjs';
import { buildSystemPrompt as buildGemini } from '../src/gemini.prompts.lib.mjs';
import { buildSystemPrompt as buildOpencode } from '../src/opencode.prompts.lib.mjs';
import { buildSystemPrompt as buildQwen } from '../src/qwen.prompts.lib.mjs';

const argv = {
  branchName: 'issue-1-test',
  prNumber: 1,
  issueUrl: 'https://github.com/owner/repo/issues/1',
  issueNumber: 1,
  prUrl: 'https://github.com/owner/repo/pull/1',
  forkedRepo: 'fork/repo',
  upstreamRepo: 'owner/repo',
  isContinueMode: false,
  attachLogs: false,
  autoContinueLimit: 0,
  argv: { autoContinue: false },
};

await initI18n({ uiLanguage: 'en', workLanguage: 'ru' });

const builders = {
  claude: buildClaude,
  agent: buildAgent,
  codex: buildCodex,
  gemini: buildGemini,
  opencode: buildOpencode,
  qwen: buildQwen,
};

for (const [name, builder] of Object.entries(builders)) {
  try {
    const prompt = await builder(argv);
    const has = prompt.includes('Working language: Russian');
    console.log(`${name}: has Russian directive = ${has} (length: ${prompt.length})`);
  } catch (e) {
    console.log(`${name}: ERROR - ${e.message}`);
  }
}

// Verify "en" omits the directive
await setWorkLocale('en');
const enPrompt = await buildClaude(argv);
console.log(`claude (en): omits directive = ${!enPrompt.includes('Working language:')}`);

// Verify "zh"
await setWorkLocale('zh');
const zhPrompt = await buildClaude(argv);
console.log(`claude (zh): has Chinese directive = ${zhPrompt.includes('Working language: Chinese (Simplified)')}`);

// Verify "hi"
await setWorkLocale('hi');
const hiPrompt = await buildClaude(argv);
console.log(`claude (hi): has Hindi directive = ${hiPrompt.includes('Working language: Hindi')}`);
