import { buildClaudeResumeCommand, buildClaudeAutonomousResumeCommand } from './claude.command-builder.lib.mjs';
import { buildSolveResumeCommandFromArgv } from './solve.resume-command.lib.mjs';

export const showResumeCommand = async (sessionId, tempDir, claudePath, model, log, argv = null) => {
  if (!sessionId || !tempDir) return;
  await log(`\n💡 To continue this session:\n`);
  await log(`   Interactive mode:    ${buildClaudeResumeCommand({ tempDir, sessionId, claudePath, model })}\n`);
  await log(`   Autonomous mode:     ${buildClaudeAutonomousResumeCommand({ tempDir, sessionId, claudePath, model })}\n`);
  const solveResumeCmd = buildSolveResumeCommandFromArgv({ argv, sessionId, tempDir });
  if (solveResumeCmd) await log(`   Solve resume mode:   ${solveResumeCmd}\n`);
};
