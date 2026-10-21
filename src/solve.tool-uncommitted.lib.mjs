import { toolCommitName, withSubmoduleWork } from './submodule-uncommitted.lib.mjs';

const TOOL_MODULES = {
  agent: './agent.lib.mjs',
  codex: './codex.lib.mjs',
  gemini: './gemini.lib.mjs',
  opencode: './opencode.lib.mjs',
  qwen: './qwen.lib.mjs',
};

export async function resolveUncommittedChangesTool({ argv, claudeLib, importModule = specifier => import(specifier) }) {
  if (argv.useAgentCommander) {
    const agentCommanderLib = await importModule('./agent-commander.lib.mjs');
    return { agentCommanderLib, checkForUncommittedChanges: agentCommanderLib.checkForUncommittedChanges };
  }

  const toolModule = TOOL_MODULES[argv.tool];
  if (toolModule) {
    const module = await importModule(toolModule);
    return { agentCommanderLib: null, checkForUncommittedChanges: module.checkForUncommittedChanges };
  }

  return { agentCommanderLib: null, checkForUncommittedChanges: claudeLib.checkForUncommittedChanges };
}

// Issue #3433: the same check, also looking inside git submodules (unchanged without .gitmodules).
export async function resolveUncommittedChangesToolWithSubmodules(params) {
  const resolved = await resolveUncommittedChangesTool(params);
  return { ...resolved, checkForUncommittedChanges: withSubmoduleWork(resolved.checkForUncommittedChanges, { tool: toolCommitName(params.argv) }) };
}
