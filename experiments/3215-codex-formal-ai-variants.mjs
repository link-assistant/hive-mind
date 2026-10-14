// Lists the Codex model variants that mention Formal AI (issue #3215, B1).
import { CODEX_MODEL_VARIANTS } from '../src/models/catalog.mjs';
console.log(Object.entries(CODEX_MODEL_VARIANTS).filter(([k, v]) => /formal/.test(k + v)));
