// Lists every tool's model keys that put a provider prefix in front of Formal AI (issue #3215, B1).
import { agentModels, claudeModels, CODEX_MODEL_VARIANTS, geminiModels, opencodeModels, qwenModels } from '../src/models/catalog.mjs';
const maps = { claude: claudeModels, codex: CODEX_MODEL_VARIANTS, agent: agentModels, opencode: opencodeModels, qwen: qwenModels, gemini: geminiModels };
for (const [tool, map] of Object.entries(maps)) console.log(tool, Object.entries(map).filter(([k, v]) => /formal/i.test(k + v)));
