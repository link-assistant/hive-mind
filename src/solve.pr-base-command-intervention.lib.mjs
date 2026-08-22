import { buildPullRequestBaseBranchInterventionMessage, detectForbiddenPullRequestBaseChangeCommand, extractToolCommandTextsFromStreamEvent } from './solve.pr-base-guard.lib.mjs';

export function createPullRequestBaseBranchCommandIntervention({ expectedBaseBranch, prNumber, log = async () => {}, toolLabel = 'AI tool', sendInput = null, stopSession = null } = {}) {
  const observedCommands = new Set();
  let intervention = null;
  let sent = false;

  const handleCommand = async command => {
    if (!expectedBaseBranch || intervention || sent || !command || observedCommands.has(command)) return;
    observedCommands.add(command);

    const violation = detectForbiddenPullRequestBaseChangeCommand(command, {
      expectedBaseBranch,
      prNumber,
    });
    if (!violation) return;

    const message = buildPullRequestBaseBranchInterventionMessage(violation);
    await log(`\n⚠️ Forbidden PR base retarget command observed from ${toolLabel}: ${command}`, { level: 'warning' });

    if (sendInput) {
      try {
        sent = await sendInput(message);
      } catch (sendError) {
        await log(`   Could not send requested base-branch correction to ${toolLabel} input: ${sendError.message}`, { level: 'warning' });
      }
      if (sent) {
        await log(`   Sent requested base-branch correction to ${toolLabel} input.`, { level: 'warning' });
        return;
      }
    }

    intervention = { violation, message };
    await log(`   ${message}`, { level: 'warning' });
    if (stopSession) {
      try {
        const stopped = await stopSession();
        if (stopped) {
          await log(`   Stopped ${toolLabel} session to resume with requested base-branch correction.`, { level: 'warning' });
        }
      } catch (stopError) {
        await log(`   Could not stop ${toolLabel} process for immediate correction: ${stopError.message}`, { level: 'warning' });
      }
    }
  };

  const handleCommands = async commands => {
    for (const command of commands) {
      await handleCommand(command);
      if (intervention || sent) return;
    }
  };

  return {
    handleCommand,
    handleCommands,
    handleCommandExecutions: async commandExecutions => handleCommands((commandExecutions || []).map(commandExecution => commandExecution?.command).filter(Boolean)),
    handleStreamEvent: async event => handleCommands(extractToolCommandTextsFromStreamEvent(event)),
    getIntervention: () => intervention,
    wasSent: () => sent,
  };
}
