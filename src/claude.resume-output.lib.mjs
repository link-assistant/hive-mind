import { buildClaudeResumeCommand, buildClaudeAutonomousResumeCommand } from './claude.command-builder.lib.mjs';
import { buildSolveResumeCommand } from './solve.resume-command.lib.mjs';

export const showResumeCommand = async (sessionId, tempDir, claudePath, model, log, argv = null) => {
  if (!sessionId || !tempDir) return;
  await log(`\n💡 To continue this session:\n`);
  await log(`   Interactive mode:    ${buildClaudeResumeCommand({ tempDir, sessionId, claudePath, model })}\n`);
  await log(`   Autonomous mode:     ${buildClaudeAutonomousResumeCommand({ tempDir, sessionId, claudePath, model })}\n`);
  if (argv && argv.url) await log(`   Solve resume mode:   ${buildSolveResumeCommand({ issueUrl: argv.url, sessionId, tool: argv.tool || 'claude', model: argv.model, fallbackModel: argv.fallbackModel, tempDir })}\n`);
};
