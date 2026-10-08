#!/usr/bin/env node
/** Documentation-driven tester CLI, exposed as `hive-test`. */

const args = process.argv.slice(2);
if (args.includes('--version')) {
  const { getVersion } = await import('./version.lib.mjs');
  console.log(await getVersion());
} else if (!args.length || args.includes('--help') || args.includes('-h')) {
  console.log(`Usage: hive-test <github-repository-url> [options]

Create a manual testing task and launch an agent in the role of tester/user.
The agent follows every README and documentation workflow and commits a report
with PASS, FAIL, BLOCKED, and NOT RUN results to a pull request.

Options:
  --dry-run     Print the testing task without creating an issue or starting an agent
  --no-solve    Create the testing task without starting an agent
  --help, -h    Show help
  --version     Show version

Agent options (e.g. --tool, --model, --think) are forwarded to solve.

Examples:
  hive-test https://github.com/owner/repo
  hive-test owner/repo --tool codex --model gpt-5.5
  hive-test owner/repo --dry-run`);
  if (!args.length) process.exitCode = 1;
} else {
  try {
    const { setupStdioLogInterceptor } = await import('./lib.mjs');
    setupStdioLogInterceptor();
    const { runTestCommand } = await import('./test.run.lib.mjs');
    await runTestCommand(args);
  } catch (error) {
    const { formatFatalError } = await import('./error-formatting.lib.mjs');
    console.error(formatFatalError(error));
    process.exitCode = 1;
  }
}
