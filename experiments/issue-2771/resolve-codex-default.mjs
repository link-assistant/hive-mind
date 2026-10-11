// Prints the Codex default model hive-mind resolves against the installed Codex catalogue.
import { resolveRuntimeDefaultModel } from '../../src/models/index.mjs';
console.log(await resolveRuntimeDefaultModel('codex'));
