// Prints the sorted Codex model variant keys, to diff before/after a catalogue change.
import { CODEX_MODEL_VARIANTS } from '../src/models/catalog.mjs';
console.log(JSON.stringify(Object.entries(CODEX_MODEL_VARIANTS).sort(), null, 1));
